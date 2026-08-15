/**
 * Telegram bridge for Porcupine: a phone becomes a remote control and
 * approval surface for the SAME session the TUI shows.
 *
 * Visibility model (one-directional mirror):
 * - A message sent through Telegram is injected into the shared session, so
 *   it renders in the TUI, and the agent's response is sent back to Telegram
 *   (shown in both places).
 * - A turn started in the TUI stays in the TUI only.
 *
 * Attended-only safety is preserved: Ask-mode confirmations (bash commands,
 * file mutations) are forwarded to Telegram as Approve/Deny buttons AND shown
 * in the TUI; the first response wins. Unauthorized chats are ignored.
 *
 * Long polling via the Bot API (plain fetch, no SDK, no webhook infra).
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AgentMessage } from "@porcupineai/agent-core";
import type { AssistantMessage } from "@porcupineai/ai";
import { type BridgeCommandContext, handleBridgeCommand, parseBridgeCommand } from "./bridge-commands.ts";
import type { RemoteSlashResult } from "./remote-command-dispatcher.ts";
import {
	buildRemoteCatalog,
	formatRemoteCommandList,
	type RemoteCatalog,
	type RemoteCommandDescriptor,
	resolveRemoteCommand,
} from "./remote-slash-commands.ts";
import { transcribeSpeech } from "./voice/stt.ts";

export interface TelegramBridgeOptions {
	/** Bot token from @BotFather. */
	token: string;
	/** Allowed chat ids. Empty allowlist = only /start works. */
	allowlist: number[];
	/**
	 * Users allowed inside group chats. Private chats authenticate by requiring
	 * the sender id to equal the allowed chat id. Groups fail closed unless this
	 * list explicitly authorizes the sender.
	 */
	userAllowlist?: number[];
	/** Inject a user message into the shared session (session.prompt). */
	prompt: (text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => void | Promise<void>;
	/** The TUI confirmation dialog, used when the phone is not the decider. */
	confirmTui?: (title: string, message: string) => Promise<boolean>;
	/** Session context for /status (cwd, session id). */
	getStatus?: () => string;
	/** Injectable fetch (tests). Defaults to global fetch. */
	fetchImpl?: typeof fetch;
	/** How long a Telegram answer to a confirmation may take before the TUI decides alone. */
	confirmTimeoutMs?: number;
	/** How long Telegram buttons/reply-wait stay open before resolving empty (leak guard). */
	dialogTimeoutMs?: number;
	/**
	 * Canonical slash-command descriptors (builtins + templates + skills +
	 * extensions) used to register the Telegram / command menu.
	 */
	getCommands?: () => RemoteCommandDescriptor[];
	/**
	 * Runs a canonical remote command line ("/task list") and returns the reply
	 * to send back. Wired by the interactive mode to the shared session.
	 */
	dispatch?: (commandLine: string) => Promise<RemoteSlashResult>;
	/**
	 * Transcribe an incoming voice/audio attachment into session prompt text.
	 * Defaults to ffmpeg WAV decode + on-device Moonshine STT. Injectable so
	 * tests can mock transcription without loading the STT runtime.
	 */
	transcribeAudio?: (audio: Buffer) => Promise<string>;
}

interface TelegramMessage {
	message_id: number;
	chat: { id: number; type: string };
	from?: { id: number };
	text?: string;
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: {
		id: string;
		from?: { id: number };
		message?: { chat: { id: number } };
		data?: string;
	};
}

const API = "https://api.telegram.org/bot";
/** Base URL for file downloads: `file/bot<token>/<file_path>`. */
const API_FILE = "https://api.telegram.org/file/bot";

/**
 * Match a pending remote prompt against the turn's last user message.
 * Exact match after trimming; also accept the prompt appearing as its own line
 * (skill/template expansion may embed or repeat the raw text).
 */
export function textsMatch(prompt: string, turnText: string): boolean {
	const a = prompt.trim();
	const b = turnText.trim();
	if (a === b) return true;
	if (b.length > a.length && b.includes(`\n${a}\n`)) return true;
	return false;
}

/** Text of the LAST user message in a session (the one that started the turn). */
export function lastUserMessageText(messages: readonly AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "user") continue;
		const text = (message.content as unknown as Array<{ type: string; text?: string }>)
			.filter((block) => block?.type === "text" && typeof block.text === "string")
			.map((block) => block.text)
			.join("\n")
			.trim();
		return text || undefined;
	}
	return undefined;
}

/** Join the text blocks of the last assistant message (skips thinking/tool calls). */
export function extractAssistantText(messages: readonly AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const text = (message.content as unknown as Array<{ type: string; text?: string }>)
			.filter((block) => block?.type === "text" && typeof block.text === "string")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return "";
}

/** Compact "work" summary: tool calls made in the last assistant message. */
export function summarizeToolCalls(messages: readonly AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const calls = (message.content as unknown as Array<{ type: string; name?: string }>).filter(
			(block) => block?.type === "toolCall" && typeof block.name === "string",
		);
		if (calls.length === 0) continue;
		const names = calls.map((call) => call.name);
		const unique = [...new Set(names)];
		return unique.length === 1 ? `⚙️ used ${unique[0]}` : `⚙️ used ${unique.join(", ")}`;
	}
	return "";
}

/** Split `MEDIA:/path/to/file` markers out of a response (Hermes-style protocol). */
export function extractMediaMarkers(text: string): { clean: string; paths: string[] } {
	const paths: string[] = [];
	const clean = text
		.split("\n")
		.map((line) => {
			const match = /^\s*MEDIA:\s*(.+?)\s*$/i.exec(line);
			if (!match) return line;
			paths.push(match[1]!.trim());
			return "";
		})
		.filter((line) => line.length > 0)
		.join("\n")
		.trim();
	return { clean, paths };
}

/** True when a Telegram message carries a voice/audio attachment (a voice
 * note or a generic audio file) so it can be transcribed instead of ignored. */
export function isVoiceMessage(message: unknown): boolean {
	const m = message as { voice?: unknown; audio?: unknown };
	return m?.voice !== undefined || m?.audio !== undefined;
}

/** file_id of a voice/audio attachment, or undefined when there is none. */
export function extractVoiceFileId(message: unknown): string | undefined {
	const m = message as { voice?: { file_id?: string }; audio?: { file_id?: string } };
	const voice = m?.voice?.file_id;
	if (typeof voice === "string" && voice.length > 0) return voice;
	const audio = m?.audio?.file_id;
	return typeof audio === "string" && audio.length > 0 ? audio : undefined;
}

/**
 * Default voice-note-to-text for the telegram bridge: decode the incoming
 * audio to a 16 kHz mono WAV via ffmpeg (a system dependency of the voice
 * stack, used the same way as microphone capture), then run Moonshine STT.
 * Missing/invalid audio or ffmpeg surfaces a diagnostic so the caller can
 * reply instead of crashing.
 */
async function transcribeTelegramAudio(audio: Buffer): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "porcupine-tg-voice-"));
	const input = join(dir, "input.audio");
	const wav = join(dir, "voice.wav");
	writeFileSync(input, audio);
	let text: string;
	try {
		const result = spawnSync(
			"ffmpeg",
			["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-ac", "1", "-ar", "16000", "-f", "wav", wav],
			{ timeout: 30_000 },
		);
		if (result.status !== 0) {
			const stderr = (Array.isArray(result.stderr) ? Buffer.concat(result.stderr) : (result.stderr ?? ""))
				.toString()
				.trim();
			throw new Error(stderr || "ffmpeg could not decode the voice note (is it installed? brew install ffmpeg)");
		}
		const wavBytes = readFileSync(wav);
		if (wavBytes.length === 0) throw new Error("ffmpeg produced no audio from the voice note");
		text = await transcribeSpeech(wavBytes);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return text;
}

function parseUpdate(raw: unknown): TelegramUpdate[] {
	const payload = raw as { ok?: boolean; result?: TelegramUpdate[] };
	if (!payload?.ok || !Array.isArray(payload.result)) return [];
	return payload.result;
}

export class TelegramBridge {
	private readonly options: TelegramBridgeOptions;
	private running = false;
	private offset = 0;
	/**
	 * Telegram-originated prompts awaiting their response turn. Each entry is
	 * matched against the ending turn's last user message so a follow-up queued
	 * behind a TUI turn never forwards the wrong response.
	 */
	private pendingTelegram: Array<{ chatId: number; userId?: number; text: string }> = [];
	/** Most recent authorized actor that sent a prompt; confirmations go only to that actor. */
	private activeChatId: number | undefined;
	private activeUserId: number | undefined;
	private confirmWaiters = new Map<
		string,
		{ chatId: number; userId: number; resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
	>();
	/** ask_question option selections waiting for a button tap (by request id and actor). */
	private pendingSelects = new Map<
		string,
		{
			chatId: number;
			userId: number;
			options: string[];
			resolve: (value: string | undefined) => void;
		}
	>();
	/** ask_question free-text answer waiting for a reply from one authorized actor. */
	private pendingTextRequest:
		| { chatId: number; userId: number; resolve: (value: string | undefined) => void }
		| undefined;
	private pollPromise: Promise<void> | undefined;
	/** Consecutive update-handling failures; after a cap an update is dead-lettered so one stuck update can't stall the poll. */
	private consecutiveFailures = 0;
	/** Epoch ms when the bridge started polling; drives the !status uptime line. */
	private startedAt: number | undefined;
	/** Materialized remote slash catalog for this bridge (rebuilt on refresh). */
	private catalog: RemoteCatalog | undefined;

	constructor(options: TelegramBridgeOptions) {
		this.options = options;
	}

	get isRunning(): boolean {
		return this.running;
	}

	get pendingTurns(): number {
		return this.pendingTelegram.length;
	}

	/** Seconds the bridge has been polling (used by the !status command). */
	get uptimeSeconds(): number | undefined {
		return this.startedAt === undefined ? undefined : (Date.now() - this.startedAt) / 1000;
	}

	private async api(method: string, params: Record<string, string>, attempt = 0): Promise<unknown> {
		const url = `${API}${this.options.token}/${method}`;
		const body = new URLSearchParams(params);
		const response = await (this.options.fetchImpl ?? fetch)(url, {
			method: "POST",
			body,
			headers: { "content-type": "application/x-www-form-urlencoded" },
			signal: AbortSignal.timeout(45_000),
		});
		const payload = (await response.json().catch(() => undefined)) as
			| { ok?: boolean; description?: string; parameters?: { retry_after?: number } }
			| undefined;
		if ((response.status === 429 || payload?.parameters?.retry_after) && attempt < 3) {
			const retrySeconds = Math.max(0.25, Math.min(30, payload?.parameters?.retry_after ?? 1));
			await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
			return this.api(method, params, attempt + 1);
		}
		if (response.ok === false || payload?.ok === false) {
			throw new Error(`Telegram API ${method} failed: ${payload?.description ?? `HTTP ${response.status}`}`);
		}
		if (payload === undefined) {
			throw new Error(`Telegram API ${method} failed: invalid JSON response`);
		}
		return payload;
	}

	async sendText(chatId: number, text: string): Promise<void> {
		if (!text) return;
		// Telegram rejects messages over 4096 characters; chunk long responses
		// so a long agent reply can never be lost to an API error.
		const CHUNK = 4000;
		for (let i = 0; i < text.length; i += CHUNK) {
			await this.api("sendMessage", { chat_id: String(chatId), text: text.slice(i, i + CHUNK) });
		}
	}

	/** Send a local file as a Telegram document (multipart upload). */
	/** Send an outbound notification to the most recently active chat (if any). Attended-only; silently skipped when no chat has prompted yet. */
	async notifyTaskResult(text: string): Promise<void> {
		if (!text || this.activeChatId === undefined) return;
		await this.sendText(this.activeChatId, text).catch(() => {});
	}

	async sendDocument(chatId: number, filePath: string): Promise<void> {
		const resolved = filePath.startsWith("~") ? join(homedir(), filePath.slice(1)) : filePath;
		const buffer = await readFile(resolved);
		const form = new FormData();
		form.append("chat_id", String(chatId));
		form.append("document", new Blob([buffer]), basename(resolved));
		const response = await (this.options.fetchImpl ?? fetch)(`${API}${this.options.token}/sendDocument`, {
			method: "POST",
			body: form,
		});
		if (response.ok === false) throw new Error(`Telegram API sendDocument failed: HTTP ${response.status}`);
	}

	/** Resolve file_path for a file_id and download the raw bytes (Bot API). */
	private async downloadVoiceFile(fileId: string): Promise<Buffer> {
		const payload = (await this.api("getFile", { file_id: fileId })) as {
			result?: { file_path?: string };
		};
		const filePath = payload?.result?.file_path;
		if (!filePath) {
			throw new Error("Telegram did not return a file path for the voice note");
		}
		const url = `${API_FILE}${this.options.token}/${filePath}`;
		const response = await (this.options.fetchImpl ?? fetch)(url);
		if (!response.ok) {
			throw new Error(`Telegram file download failed: HTTP ${response.status}`);
		}
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.length === 0) {
			throw new Error("Telegram voice note came back empty");
		}
		return bytes;
	}

	/** Combined confirmation: Telegram Approve/Deny buttons race the TUI dialog. */
	async confirm(title: string, message: string): Promise<boolean> {
		const tui = this.options.confirmTui;
		const chatId = this.activeChatId;
		if (!tui && !chatId) return false; // no human anywhere → fail closed
		const decisions: Promise<boolean>[] = [];
		if (tui) decisions.push(tui(title, message));
		if (chatId !== undefined) {
			decisions.push(this.telegramConfirm(chatId, this.activeUserId ?? chatId, title, message));
		}
		if (decisions.length === 0) return false;
		return Promise.race(decisions);
	}

	/** Remote-only confirmation (no TUI): Telegram buttons on the active chat. */
	remoteConfirm(title: string, message: string): Promise<boolean> | undefined {
		const chatId = this.activeChatId;
		if (chatId === undefined) return undefined;
		return this.telegramConfirm(chatId, this.activeUserId ?? chatId, title, message);
	}

	/** Point the session's confirm callback at the combined TUI+Telegram flow. */
	attachConfirm(session: {
		setConfirmCallback(callback: ((title: string, message: string) => Promise<boolean>) | undefined): void;
	}): void {
		session.setConfirmCallback((title, message) => this.confirm(title, message));
	}

	/**
	 * ask_question options: Telegram inline buttons race the TUI selector.
	 * The resolved value is the FULL option string (button text is truncated
	 * for display only; callback data carries an index, not the text).
	 */
	async select(
		title: string,
		options: string[],
		tui: (title: string, options: string[]) => Promise<string | undefined>,
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		const chatId = this.activeChatId;
		const userId = this.activeUserId ?? chatId;
		const tuiPromise = tui(title, options);
		if (chatId === undefined || userId === undefined || options.length === 0) return tuiPromise;

		const requestId = randomUUID();
		const rows = chunk(
			options.map((option, index) => ({
				text: truncateForButton(option),
				callback_data: `select:${requestId}:${index}`,
			})),
			2,
		);
		// Register before sending. The polling loop can receive an immediate tap
		// as soon as Telegram accepts the button message.
		const selection = new Promise<string | undefined>((resolve) => {
			let settled = false;
			const finish = (value: string | undefined) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.pendingSelects.delete(requestId);
				resolve(value);
			};
			const timer = setTimeout(() => finish(undefined), this.options.dialogTimeoutMs ?? 10 * 60 * 1000);
			this.pendingSelects.set(requestId, { chatId, userId, options, resolve: finish });
			opts?.signal?.addEventListener("abort", () => finish(undefined), { once: true });
			void tuiPromise.then((value) => finish(value));
		});
		await this.api("sendMessage", {
			chat_id: String(chatId),
			text: `❓ ${title}`,
			reply_markup: JSON.stringify({ inline_keyboard: rows }),
		}).catch(() => {});
		return selection;
	}

	/**
	 * ask_question free text: "reply with your answer" — the next message from
	 * the active chat answers it (it is NOT treated as a new prompt).
	 */
	async input(
		title: string,
		tui: (title: string) => Promise<string | undefined>,
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		const chatId = this.activeChatId;
		const userId = this.activeUserId ?? chatId;
		const tuiPromise = tui(title);
		if (chatId === undefined || userId === undefined) return tuiPromise;
		// Register the pending request BEFORE the prompt message so a reply that
		// arrives immediately (or is already queued in the poll) is not missed.
		const pending = new Promise<string | undefined>((resolve) => {
			let settled = false;
			const finish = (value: string | undefined) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (this.pendingTextRequest?.resolve === finish) this.pendingTextRequest = undefined;
				resolve(value);
			};
			const timer = setTimeout(() => finish(undefined), this.options.dialogTimeoutMs ?? 10 * 60 * 1000);
			this.pendingTextRequest = { chatId, userId, resolve: finish };
			opts?.signal?.addEventListener("abort", () => finish(undefined), { once: true });
			void tuiPromise.then((value) => finish(value));
		});
		await this.api("sendMessage", {
			chat_id: String(chatId),
			text: `⌨️ ${title}\n\nReply with your answer.`,
		}).catch(() => {});
		return pending;
	}

	private telegramConfirm(chatId: number, userId: number, title: string, message: string): Promise<boolean> {
		return new Promise((resolve) => {
			// Each confirm gets its own request id; callback data carries it so a
			// late tap on an OLD button can never resolve a NEWER confirmation.
			const requestId = randomUUID();
			const finish = (ok: boolean) => {
				const current = this.confirmWaiters.get(requestId);
				if (!current) return;
				clearTimeout(current.timer);
				this.confirmWaiters.delete(requestId);
				resolve(ok);
			};
			const timeout = this.options.confirmTimeoutMs ?? 5 * 60 * 1000;
			const timer = setTimeout(() => finish(false), timeout);
			this.confirmWaiters.set(requestId, { chatId, userId, resolve: finish, timer });
			const body = `${title}\n\n${message}`.slice(0, 3800);
			void this.api("sendMessage", {
				chat_id: String(chatId),
				text: `❓ ${body}`,
				reply_markup: JSON.stringify({
					inline_keyboard: [
						[
							{ text: "✅ Approve", callback_data: `confirm:${requestId}:approve` },
							{ text: "⛔ Deny", callback_data: `confirm:${requestId}:deny` },
						],
					],
				}),
			}).catch(() => finish(false));
		});
	}

	/** Bind confirmations/dialogs to the authorized actor whose queued turn actually started. */
	handleTurnStart(message: AgentMessage): void {
		const text = lastUserMessageText([message]);
		const entry = this.pendingTelegram.find((candidate) => text !== undefined && textsMatch(candidate.text, text));
		this.activeChatId = entry?.chatId;
		this.activeUserId = entry ? (entry.userId ?? entry.chatId) : undefined;
	}

	/** Called from the session event stream. */
	async handleAgentEnd(messages: readonly AgentMessage[], willRetry: boolean): Promise<void> {
		if (willRetry) return; // a retry follows; forward only the terminal response

		// Only forward when the turn that just ended was started by a Telegram
		// prompt. Match the turn's LAST USER message against the pending prompts
		// — a plain counter would forward the wrong response when a Telegram
		// message is queued (followUp) behind a TUI turn, and would never forward
		// the Telegram response at all (its agent_end finds the counter spent).
		const lastUserText = lastUserMessageText(messages);
		const index = this.pendingTelegram.findIndex(
			(entry) => lastUserText !== undefined && textsMatch(entry.text, lastUserText),
		);
		if (index === -1) return; // TUI-originated turn → stays in the TUI
		const entry = this.pendingTelegram[index]!;
		this.pendingTelegram.splice(index, 1);

		try {
			const raw = extractAssistantText(messages);
			const { clean, paths } = extractMediaMarkers(raw);
			const tools = summarizeToolCalls(messages);
			const body = [clean, tools ? `\n${tools}` : ""].join("").trim();
			if (body) {
				await this.sendText(entry.chatId, body);
			} else if (paths.length === 0) {
				await this.sendText(entry.chatId, "Done.");
			}
			for (const path of paths) {
				await this.sendDocument(entry.chatId, path).catch(() => {});
			}
		} catch (error) {
			// Never drop a response silently: log the failure so it can be fixed.
			console.warn(
				`[telegram] failed to forward response: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/** Start long-polling. Idempotent. */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.startedAt = Date.now();
		await Promise.all([this.registerCommands(), this.setPresence("🟢 Online")]).catch(() => {});
		// Drain updates that accumulated while we were offline (e.g. after a
		// restart, offset resets to 0). Replaying them would re-prompt the agent
		// with old messages and re-answer stale buttons — so consume without
		// processing and continue polling from the newest update id.
		await this.drainPendingUpdates().catch(() => {});
		this.pollPromise = this.pollLoop();
	}

	/** Consume (without processing) any updates already queued server-side. */
	private async drainPendingUpdates(): Promise<void> {
		const raw = await this.api("getUpdates", { timeout: "1" });
		let newest = this.offset;
		for (const update of parseUpdate(raw)) {
			newest = Math.max(newest, update.update_id + 1);
		}
		this.offset = newest;
	}

	async stop(): Promise<void> {
		this.running = false;
		await this.setPresence("🔴 Offline").catch(() => {});
		await this.pollPromise;
		this.startedAt = undefined;
		for (const pending of [...this.confirmWaiters.values()]) pending.resolve(false);
		for (const pending of [...this.pendingSelects.values()]) pending.resolve(undefined);
		this.pendingTextRequest?.resolve(undefined);
		this.pendingTextRequest = undefined;
	}

	/** Register the bot's / command menu from the live command catalog (Hermes-style). */
	private async registerCommands(): Promise<void> {
		this.catalog = this.buildCatalog();
		const commands = this.registrationEntries();
		await this.api("setMyCommands", {
			commands: JSON.stringify(commands),
		});
	}

	/**
	 * Rebuild the remote catalog and re-register the Telegram menu. Called at
	 * start() and after a session /reload so new extensions/skills/templates
	 * become discoverable without a bridge restart.
	 */
	async refreshCommands(): Promise<void> {
		await this.registerCommands().catch((error: unknown) => {
			console.warn(
				`[telegram] command registration failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	}

	private buildCatalog(): RemoteCatalog | undefined {
		const descriptors = this.options.getCommands?.() ?? [];
		if (descriptors.length === 0) return undefined;
		return buildRemoteCatalog(descriptors, "telegram");
	}

	/**
	 * Top-100 Telegram menu entries: bridge controls first, then commands by
	 * source rank (builtin < prompt < extension < skill), stable by name.
	 */
	private registrationEntries(): Array<{ command: string; description: string }> {
		const controls = [
			{ command: "start", description: "Connect this chat" },
			{ command: "status", description: "Session state" },
			{ command: "help", description: "How to use the agent" },
			{ command: "commands", description: "List all remote commands" },
		];
		const catalog = this.catalog;
		if (!catalog) return controls;
		const rank: Record<string, number> = { builtin: 0, prompt: 1, extension: 2, skill: 3 };
		const rest = catalog.commands
			.map((entry) => ({ command: entry.alias, description: entry.description.slice(0, 256) }))
			.sort((a, b) => {
				const rankA = rank[catalog.commands.find((c) => c.alias === a.command)?.kind ?? "builtin"] ?? 0;
				const rankB = rank[catalog.commands.find((c) => c.alias === b.command)?.kind ?? "builtin"] ?? 0;
				return rankA - rankB || a.command.localeCompare(b.command);
			});
		return [...controls, ...rest].slice(0, 100);
	}

	/** Online/offline indicator on the bot's profile (setMyDescription). */
	private async setPresence(status: string): Promise<void> {
		await this.api("setMyDescription", { description: `${status} — Porcupine agent bridge` });
	}

	private async pollLoop(): Promise<void> {
		while (this.running) {
			const started = Date.now();
			try {
				await this.pollOnce();
			} catch {
				// Network hiccup or timeout — back off and continue polling.
				await new Promise((resolve) => setTimeout(resolve, 3000));
				continue;
			}
			// Throttle to at most one request per second even when the API
			// responds instantly (empty queues), avoiding hot loops and rate limits.
			const remaining = 1000 - (Date.now() - started);
			if (remaining > 0) {
				await new Promise((resolve) => setTimeout(resolve, remaining));
			}
		}
	}

	private async pollOnce(): Promise<void> {
		const raw = await this.api("getUpdates", {
			offset: String(this.offset),
			timeout: "30",
			allowed_updates: JSON.stringify(["message", "callback_query"]),
		});
		// Advance the offset only past successfully processed updates. If an
		// update fails to handle, the next poll retries it instead of dropping it.
		let nextOffset = this.offset;
		const DEAD_LETTER_CAP = 3;
		for (const update of parseUpdate(raw)) {
			try {
				if (update.callback_query) {
					await this.handleCallbackQuery(update.callback_query);
				} else if (update.message) {
					await this.handleMessage(update.message);
				}
				this.consecutiveFailures = 0;
				nextOffset = Math.max(nextOffset, update.update_id + 1);
			} catch (error) {
				this.consecutiveFailures++;
				// Retry transient failures (kept within the offset), but dead-letter a
				// persistently failing update so it can't stall every update behind it.
				if (this.consecutiveFailures >= DEAD_LETTER_CAP) {
					this.consecutiveFailures = 0;
					console.warn(
						`[telegram] update ${update.update_id} failed ${DEAD_LETTER_CAP} times; skipping (dead-lettered): ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
					nextOffset = Math.max(nextOffset, update.update_id + 1);
				} else {
					console.warn(
						`[telegram] update ${update.update_id} failed (will retry): ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
				break;
			}
		}
		this.offset = nextOffset;
	}

	private isAllowedChat(chatId: number): boolean {
		return this.options.allowlist.includes(chatId);
	}

	private isAuthorizedActor(chatId: number, userId: number | undefined, chatType?: string): boolean {
		if (!this.isAllowedChat(chatId) || userId === undefined) return false;
		if (chatType === "private") return userId === chatId;
		return (this.options.userAllowlist ?? []).includes(userId);
	}

	private async handleCallbackQuery(query: {
		id: string;
		from?: { id: number };
		message?: { chat: { id: number } };
		data?: string;
	}): Promise<void> {
		const chatId = query.message?.chat.id;
		const userId = query.from?.id;
		const actorAllowed =
			chatId !== undefined &&
			this.isAllowedChat(chatId) &&
			userId !== undefined &&
			(userId === chatId || (this.options.userAllowlist ?? []).includes(userId));
		if (!actorAllowed) return;
		const data = query.data ?? "";
		if (data.startsWith("select:")) {
			const [, requestId, indexRaw] = data.split(":");
			const pending = requestId ? this.pendingSelects.get(requestId) : undefined;
			const index = Number(indexRaw);
			if (
				pending &&
				pending.chatId === chatId &&
				pending.userId === userId &&
				Number.isInteger(index) &&
				index >= 0 &&
				index < pending.options.length
			) {
				pending.resolve(pending.options[index]);
			}
		} else if (data.startsWith("confirm:")) {
			// Scoped: only the matching confirmation waiter may be resolved — a
			// late tap on an OLD button can never approve a NEWER confirmation.
			const [, requestId, verdict] = data.split(":");
			const waiter = requestId ? this.confirmWaiters.get(requestId) : undefined;
			if (waiter && waiter.chatId === chatId && waiter.userId === userId) waiter.resolve(verdict === "approve");
		} else {
			// Legacy bare approve/deny (pre-request-id buttons): resolve all waiters.
			if (data === "approve" || data === "deny") {
				const ok = data === "approve";
				for (const waiter of [...this.confirmWaiters.values()]) {
					if (waiter.chatId === chatId && waiter.userId === userId) waiter.resolve(ok);
				}
			}
		}
		await this.api("answerCallbackQuery", { callback_query_id: query.id });
	}

	/**
	 * Resolve a '!' control command and reply to the sender chat through the
	 * notifyTaskResult send path (the bridge is already restricted to the owner
	 * allowlist by the caller here). Returns undefined when the text is not a
	 * command so the message falls through to normal prompt handling.
	 */
	private replyToCommand(chatId: number, text: string): string | undefined {
		const parsed = parseBridgeCommand(text);
		if (parsed === null) return undefined;
		const context: BridgeCommandContext = {
			uptimeSeconds: this.uptimeSeconds,
			sessionActive: this.running,
			statusText: this.options.getStatus?.() ?? "",
		};
		const reply = handleBridgeCommand(parsed, { context });
		void this.sendText(chatId, reply).catch(() => {});
		return reply;
	}

	private async handleMessage(message: TelegramMessage): Promise<void> {
		const chatId = message.chat.id;
		const userId = message.from?.id;
		if (!this.isAuthorizedActor(chatId, userId, message.chat.type)) {
			if (message.text?.trim() === "/start") {
				await this.sendText(
					chatId,
					`⚠️ This chat (${chatId}) is not authorized. Add it to PORCUPINE_TELEGRAM_ALLOW and restart the session.`,
				);
			}
			return;
		}
		const text = message.text?.trim();
		if (!text) {
			// A voice/audio attachment is transcribed and submitted as a prompt;
			// other attachment-only messages (photos, files, stickers) are ignored.
			if (isVoiceMessage(message)) {
				await this.handleVoiceMessage(chatId, userId, message);
			}
			return;
		}

		// A pending free-text answer (ask_question input) consumes this message.
		// The pending request is bound to the chat that asked — a reply from a
		// different chat must NOT answer it (or leak into it).
		if (
			this.pendingTextRequest &&
			this.pendingTextRequest.chatId === chatId &&
			this.pendingTextRequest.userId === userId
		) {
			const request = this.pendingTextRequest;
			this.pendingTextRequest = undefined;
			request.resolve(text);
			return;
		}

		// '!' control commands (owner chat only, already enforced above).
		if (text.startsWith("!")) {
			if (this.replyToCommand(chatId, text) !== undefined) return;
		}

		if (text === "/start") {
			await this.sendText(chatId, this.welcomeText());
			return;
		}
		if (text === "/status") {
			await this.sendText(chatId, this.statusText());
			return;
		}
		if (text === "/help") {
			await this.sendText(
				chatId,
				"Send any message and the agent works on the shared session (shown in the TUI too).\n\nCommands: /status — session state · /help — this message · /commands — list all remote commands.\nAsk-mode confirmations arrive as Approve/Deny buttons; questions arrive as option buttons.",
			);
			return;
		}
		if (text === "/commands" || text.startsWith("/commands ")) {
			await this.sendText(chatId, this.commandsText(text)).catch(() => {});
			return;
		}

		// Any other /command runs through the shared remote dispatcher (after
		// authorization). Only actual prompts update the confirmation target.
		if (text.startsWith("/")) {
			await this.dispatchSlash(chatId, userId, text);
			return;
		}

		// Only actual prompts update the confirmation target chat — /status and
		// /help must not reroute an in-flight confirmation to a different chat.
		this.pendingTelegram.push({ chatId, userId, text });
		void this.api("sendChatAction", { chat_id: String(chatId), action: "typing" }).catch(() => {});
		try {
			// Queue as a follow-up when the agent is mid-turn: the message is never
			// lost to a "already processing" throw, and its response still comes
			// back to Telegram after the current turn finishes.
			await this.options.prompt(text, { streamingBehavior: "followUp" });
		} catch (error) {
			// Roll back the pending entry and tell the user — otherwise every later
			// TUI-originated response would leak to Telegram via the stuck entry.
			const index = this.pendingTelegram.findIndex(
				(entry) => entry.chatId === chatId && entry.userId === userId && entry.text === text,
			);
			if (index !== -1) this.pendingTelegram.splice(index, 1);
			await this.sendText(
				chatId,
				`⚠️ Could not start the task: ${error instanceof Error ? error.message : String(error)}`,
			).catch(() => {});
		}
	}

	/**
	 * Transcribe an incoming Telegram voice/audio note and submit the result as
	 * a session prompt through the same path typed messages use (same contract:
	 * pending-turn record + followUp prompt). Never throws: transcription or
	 * download failures reply with a clear error instead of crashing the poll.
	 */
	private async handleVoiceMessage(
		chatId: number,
		userId: number | undefined,
		message: TelegramMessage,
	): Promise<void> {
		const fileId = extractVoiceFileId(message);
		if (!fileId) return; // malformed attachment; nothing to transcribe
		void this.api("sendChatAction", { chat_id: String(chatId), action: "typing" }).catch(() => {});

		let text: string | undefined;
		try {
			const bytes = await this.downloadVoiceFile(fileId);
			const transcribe = this.options.transcribeAudio ?? transcribeTelegramAudio;
			text = (await transcribe(bytes)).trim();
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			await this.sendText(chatId, `⚠️ Voice transcription failed: ${reason}`).catch(() => {});
			return;
		}

		// Transcription was a no-op (silence / unrecognized speech): do not inject
		// an empty prompt into the session — tell the user instead.
		if (!text) {
			await this.sendText(
				chatId,
				"⚠️ I could not hear any speech in that voice note. Please retry or type your message.",
			).catch(() => {});
			return;
		}

		this.pendingTelegram.push({ chatId, userId, text });
		try {
			await this.options.prompt(text, { streamingBehavior: "followUp" });
		} catch (error) {
			const index = this.pendingTelegram.findIndex(
				(entry) => entry.chatId === chatId && entry.userId === userId && entry.text === text,
			);
			if (index !== -1) this.pendingTelegram.splice(index, 1);
			await this.sendText(
				chatId,
				`⚠️ Could not start the task: ${error instanceof Error ? error.message : String(error)}`,
			).catch(() => {});
		}
	}

	/** Reply with the discoverable /commands listing (searchable, paginated). */
	private commandsText(text: string): string {
		const query = text.replace(/^\/commands\b/i, "").trim();
		const catalog = this.catalog ?? this.buildCatalog();
		if (!catalog) {
			return "/commands — remote command list\nNo commands available. Type /status or /help for the bridge controls.";
		}
		return formatRemoteCommandList(catalog, query || undefined);
	}

	/** Run one remote slash command line through the shared dispatcher. */
	private async dispatchSlash(chatId: number, userId: number | undefined, text: string): Promise<void> {
		const dispatch = this.options.dispatch;
		if (!dispatch) {
			await this.sendText(chatId, "Remote slash commands are not available in this build.").catch(() => {});
			return;
		}
		let commandLine = text;
		const catalog = this.catalog ?? this.buildCatalog();
		if (catalog) {
			const spaceIndex = text.indexOf(" ");
			const alias = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
			const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
			const resolved = resolveRemoteCommand(catalog, alias, args);
			if (resolved) commandLine = resolved.commandLine;
		}
		const result = await dispatch(commandLine).catch(() => ({ kind: "not-found" as const, text: "Command failed." }));
		if (result.kind === "text") {
			if (result.notificationTarget && userId !== undefined) {
				// A queued task run's completion should be reported back here.
				this.activeChatId = chatId;
				this.activeUserId = userId;
			}
			await this.sendText(chatId, result.text).catch(() => {});
			return;
		}
		if (result.kind === "declined" || result.kind === "not-found") {
			await this.sendText(chatId, result.text).catch(() => {});
		}
	}

	private welcomeText(): string {
		return `🤖 Porcupine Telegram bridge connected.\n\nMessages you send run on the shared session — they appear in the TUI, and responses come back here.\n\n${this.statusText()}`;
	}

	private statusText(): string {
		const status = this.options.getStatus?.() ?? "";
		return `📡 status: ${this.running ? "polling" : "stopped"}\n${status}`.trim();
	}
}

/** Build the /status line content for the current session. */
export function formatBridgeStatus(sessionId: string, cwd: string, mode: string): string {
	return `session: ${sessionId}\ncwd: ${cwd}\nmode: ${mode}`;
}

/** Split into rows of up to `size` items (Telegram inline keyboards). */
function chunk<T>(items: T[], size: number): T[][] {
	const rows: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		rows.push(items.slice(i, i + size));
	}
	return rows;
}

/** Keep button labels readable; callback data carries the real index. */
function truncateForButton(text: string): string {
	const single = text.replace(/\s+/g, " ").trim();
	return single.length > 32 ? `${single.slice(0, 29)}…` : single;
}

export type { AssistantMessage };
