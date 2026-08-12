/**
 * iMessage bridge for Porcupine (macOS only) — the Messages app becomes a
 * remote control for the SAME session (Telegram-bridge contract: provenance
 * matching, TUI↔phone racing, agent_end forwarding).
 *
 * No API: sending and polling go through AppleScript (`osascript`) against the
 * signed-in Messages.app. Confirmation and option selection are text-based
 * (reply APPROVE/DENY or a number).
 *
 * Requirements: macOS + Messages.app signed in (iMessage enabled).
 *
 * Env:
 *   PORCUPINE_IMESSAGE_ALLOW        — comma-separated chat ids (e.g.
 *                                     "iMessage;-;+1234567890") or phone/email
 *                                     handles (resolved at startup when possible)
 *   PORCUPINE_IMESSAGE_SENDER_ALLOW — senders authorized inside group chats
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@porcupineai/agent-core";
import { type BridgeCommandContext, handleBridgeCommand, parseBridgeCommand } from "./bridge-commands.ts";
import type { RemoteSlashResult } from "./remote-command-dispatcher.ts";
import {
	buildRemoteCatalog,
	formatRemoteCommandList,
	type RemoteCatalog,
	type RemoteCommandDescriptor,
	resolveRemoteCommand,
} from "./remote-slash-commands.ts";
import { extractAssistantText, lastUserMessageText, summarizeToolCalls, textsMatch } from "./telegram-bridge.ts";

const POLL_INTERVAL_MS = 3000;
const SEND_CHUNK = 1500;
const SEP = "\u0001";

function appleScriptEscape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeIMessageIdentity(value: string): string {
	const trimmed = value.trim().toLowerCase();
	return trimmed.includes("@") ? trimmed : trimmed.replace(/[^0-9+]/g, "").replace(/^00/, "+");
}

export interface IMessageBridgeOptions {
	/** Chat ids (or phone/email handles) in which the bridge may operate. */
	allowlist: string[];
	/** Senders allowed inside group chats. Direct chats infer their sole participant. */
	senderAllowlist?: string[];
	prompt: (text: string, options?: { streamingBehavior?: "followUp" | "steer" }) => Promise<void>;
	getStatus?: () => string;
	dialogTimeoutMs?: number;
	confirmTimeoutMs?: number;
	/** Canonical slash-command descriptors used for the /commands listing. */
	getCommands?: () => RemoteCommandDescriptor[];
	/** Runs a canonical remote command line and returns the reply to send back. */
	dispatch?: (commandLine: string) => Promise<RemoteSlashResult>;
}

export class IMessageBridge {
	private readonly options: IMessageBridgeOptions;
	private running = false;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	/** Resolved chat ids to poll (handles resolved at startup when possible). */
	private pollChats: string[] = [];
	private lastSeenIdByChat = new Map<string, string>();

	/** iMessage-originated prompts awaiting their response turn (provenance match). */
	private pendingMessages: Array<{ chatId: string; sender?: string; text: string }> = [];
	/** Most recent authorized actor that sent a real prompt; confirmations go only to that actor. */
	private activeChatId: string | undefined;
	private activeSender: string | undefined;
	private pendingConfirms = new Map<string, { chatId: string; sender: string; resolve: (ok: boolean) => void }>();
	private pendingSelects = new Map<
		string,
		{ chatId: string; sender: string; options: string[]; resolve: (value: string | undefined) => void }
	>();
	private pendingTextRequest:
		| { chatId: string; sender: string; resolve: (value: string | undefined) => void }
		| undefined;
	/** Epoch ms when the bridge started polling; drives the !status uptime line. */
	private startedAt: number | undefined;
	/** Materialized remote slash catalog (rebuilt on demand). */
	private catalog: RemoteCatalog | undefined;

	constructor(options: IMessageBridgeOptions) {
		this.options = options;
	}

	get isRunning(): boolean {
		return this.running;
	}

	get pendingTurns(): number {
		return this.pendingMessages.length;
	}

	/** Seconds the bridge has been polling (used by the !status command). */
	get uptimeSeconds(): number | undefined {
		return this.startedAt === undefined ? undefined : (Date.now() - this.startedAt) / 1000;
	}

	// ---------------------------------------------------------------------
	// AppleScript helpers
	// ---------------------------------------------------------------------

	private osascript(script: string): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile("osascript", ["-e", script], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout);
			});
		});
	}

	/** Send an outbound notification to the most recently active chat (if any). Attended-only; silently skipped when no chat has prompted yet. */
	async notifyTaskResult(text: string): Promise<void> {
		if (!text || this.activeChatId === undefined) return;
		await this.sendText(this.activeChatId, text).catch(() => {});
	}

	async sendText(chatId: string, text: string): Promise<void> {
		if (!text) return;
		for (let i = 0; i < text.length; i += SEND_CHUNK) {
			const chunk = text.slice(i, i + SEND_CHUNK);
			const script = `tell application "Messages"\nsend "${appleScriptEscape(chunk)}" to chat id "${appleScriptEscape(chatId)}"\nend tell`;
			try {
				await this.osascript(script);
			} catch (error) {
				console.warn(`[imessage] send failed: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
		}
	}

	private listChatIds(): Promise<string[]> {
		return this.osascript(
			'tell application "Messages"\nset out to ""\nrepeat with c in chats\nset out to out & (id of c) & linefeed\nend repeat\nreturn out\nend tell',
		).then((stdout) =>
			stdout
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean),
		);
	}

	private fetchChatMessages(
		chatId: string,
	): Promise<Array<{ id: string; text: string; sender: string; fromMe: boolean }>> {
		const script = [
			'tell application "Messages"',
			`\tset chatId to "${appleScriptEscape(chatId)}"`,
			"\tset sep to ASCII character 1",
			'\tset out to ""',
			"\trepeat with m in messages of chat id chatId",
			// ``is from me`` does not parse on modern macOS; compare the sender
			// handle against the chat handle instead (sender is a plain property).
			"\t\tset out to out & (id of m) & sep & (text of m) & sep & (sender of m) & linefeed",
			"\tend repeat",
			"\treturn out",
			"end tell",
		].join("\n");
		return this.osascript(script).then((stdout) => {
			const result: Array<{ id: string; text: string; sender: string; fromMe: boolean }> = [];
			for (const line of stdout.split("\n")) {
				const parts = line.split(SEP);
				if (parts.length !== 3) continue;
				const [id, text = "", sender] = parts;
				if (!id) continue;
				// Messages no longer exposes a portable `is from me` AppleScript
				// property. Authorization below identifies trusted remote senders;
				// messages sent by this Mac have a different, non-allowlisted sender.
				result.push({ id, text, sender: (sender ?? "").trim(), fromMe: false });
			}
			return result;
		});
	}

	/** Resolve a phone/email handle to a chat id when possible. */
	private async resolveAllowlist(entries: string[]): Promise<string[]> {
		const resolved: string[] = [];
		const needsResolve: string[] = [];
		for (const entry of entries) {
			if (entry.includes(";-;")) {
				resolved.push(entry);
			} else {
				needsResolve.push(entry);
			}
		}
		if (needsResolve.length === 0) return resolved;
		const chatIds = await this.listChatIds().catch(() => []);
		for (const entry of needsResolve) {
			const handle = entry.replace(/^\+/, "");
			const match = chatIds.find((id) => {
				const parts = id.split(";-;").slice(1);
				return parts.some((part) => part === entry || part === handle);
			});
			resolved.push(match ?? entry);
		}
		return resolved;
	}

	// ---------------------------------------------------------------------
	// Confirmation / selection / input (text-based, same contract as Telegram)
	// ---------------------------------------------------------------------

	remoteConfirm(title: string, message: string): Promise<boolean> | undefined {
		const chatId = this.activeChatId;
		const sender = this.activeSender;
		if (chatId === undefined || sender === undefined) return undefined;
		return new Promise<boolean>((resolve) => {
			const requestId = randomUUID();
			const waiter = (ok: boolean) => {
				if (!this.pendingConfirms.has(requestId)) return;
				clearTimeout(timer);
				this.pendingConfirms.delete(requestId);
				resolve(ok);
			};
			const timeout = this.options.confirmTimeoutMs ?? 5 * 60 * 1000;
			const timer = setTimeout(() => waiter(false), timeout);
			this.pendingConfirms.set(requestId, { chatId, sender, resolve: waiter });
			void this.sendText(chatId, `❓ ${title}\n\n${message}\n\nReply APPROVE to allow, DENY to block.`).catch(() =>
				waiter(false),
			);
		});
	}

	async select(
		title: string,
		options: string[],
		tui: (title: string, options: string[]) => Promise<string | undefined>,
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		const chatId = this.activeChatId;
		const sender = this.activeSender;
		const tuiPromise = tui(title, options);
		if (chatId === undefined || sender === undefined || options.length === 0) return tuiPromise;

		const requestId = randomUUID();
		const numbered = options.map((option, index) => `${index + 1}. ${option}`).join("\n");
		await this.sendText(chatId, `❓ ${title}\n\n${numbered}\n\nReply with a number.`).catch(() => {});

		return new Promise<string | undefined>((resolve) => {
			let settled = false;
			const finish = (value: string | undefined) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.pendingSelects.delete(requestId);
				resolve(value);
			};
			const timer = setTimeout(() => finish(undefined), this.options.dialogTimeoutMs ?? 10 * 60 * 1000);
			this.pendingSelects.set(requestId, { chatId, sender, options, resolve: finish });
			opts?.signal?.addEventListener("abort", () => finish(undefined), { once: true });
			void tuiPromise.then((value) => finish(value));
		});
	}

	async input(
		title: string,
		tui: (title: string) => Promise<string | undefined>,
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		const chatId = this.activeChatId;
		const sender = this.activeSender;
		const tuiPromise = tui(title);
		if (chatId === undefined || sender === undefined) return tuiPromise;
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
			this.pendingTextRequest = { chatId, sender, resolve: finish };
			opts?.signal?.addEventListener("abort", () => finish(undefined), { once: true });
			void tuiPromise.then((value) => finish(value));
		});
		await this.sendText(chatId, `⌨️ ${title}\n\nReply with your answer.`).catch(() => {});
		return pending;
	}

	// ---------------------------------------------------------------------
	// Session events
	// ---------------------------------------------------------------------

	handleTurnStart(message: AgentMessage): void {
		const text = lastUserMessageText([message]);
		const entry = this.pendingMessages.find((candidate) => text !== undefined && textsMatch(candidate.text, text));
		this.activeChatId = entry?.chatId;
		this.activeSender = entry?.sender;
	}

	async handleAgentEnd(messages: readonly AgentMessage[], willRetry: boolean): Promise<void> {
		if (willRetry) return;
		const lastUserText = lastUserMessageText(messages);
		const index = this.pendingMessages.findIndex(
			(entry) => lastUserText !== undefined && textsMatch(entry.text, lastUserText),
		);
		if (index === -1) return;
		const entry = this.pendingMessages[index]!;
		this.pendingMessages.splice(index, 1);
		try {
			const raw = extractAssistantText(messages);
			const tools = summarizeToolCalls(messages);
			const body = [raw, tools ? `\n${tools}` : ""].join("").trim();
			await this.sendText(entry.chatId, body || "Done.");
		} catch (error) {
			console.warn(
				`[imessage] failed to forward response: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ---------------------------------------------------------------------
	// Polling
	// ---------------------------------------------------------------------

	private pollInFlight = new Set<string>();

	private async pollChat(chatId: string): Promise<void> {
		// Never overlap polls for the same chat: AppleScript can be slow, and a
		// slow fetch would otherwise stack a new poll on every interval tick.
		if (this.pollInFlight.has(chatId)) return;
		this.pollInFlight.add(chatId);
		try {
			await this.pollChatInner(chatId);
		} finally {
			this.pollInFlight.delete(chatId);
		}
	}

	private async pollChatInner(chatId: string): Promise<void> {
		let messages: Array<{ id: string; text: string; sender: string; fromMe: boolean }>;
		try {
			messages = await this.fetchChatMessages(chatId);
		} catch (error) {
			// Chat may not exist / Messages not available — drop the chat quietly.
			console.warn(`[imessage] poll ${chatId} failed: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const previousLastId = this.lastSeenIdByChat.get(chatId);
		if (previousLastId === undefined) {
			// Establish a per-chat cursor without replaying the entire Messages
			// history when the attended bridge starts.
			const newest = messages.at(-1)?.id;
			if (newest !== undefined) this.lastSeenIdByChat.set(chatId, newest);
			return;
		}
		const previousIndex = messages.findIndex((message) => message.id === previousLastId);
		if (previousIndex === -1) {
			// If Messages no longer returns the prior cursor, rebase at the newest
			// item instead of replaying an ambiguous history window.
			const newest = messages.at(-1)?.id;
			if (newest !== undefined) this.lastSeenIdByChat.set(chatId, newest);
			return;
		}
		const unseen = messages.slice(previousIndex + 1);
		for (const message of unseen) {
			this.lastSeenIdByChat.set(chatId, message.id);
			if (message.fromMe) continue;
			const text = message.text?.trim();
			if (!text) continue;
			await this.handleIncoming(chatId, text, message.sender).catch((error: unknown) => {
				console.warn(`[imessage] handle failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		}
	}

	/**
	 * Resolve a '!' control command and reply to the sender chat through the
	 * notifyTaskResult send path (the bridge is already restricted to the owner
	 * allowlist by the caller here). Returns undefined when the text is not a
	 * command so the message falls through to normal prompt handling.
	 */
	private replyToCommand(chatId: string, text: string): string | undefined {
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

	private isAuthorizedSender(chatId: string, sender: string): boolean {
		const normalized = normalizeIMessageIdentity(sender);
		if (!normalized) return false;
		if (chatId.includes(";-;")) {
			return chatId.split(";-;").slice(1).map(normalizeIMessageIdentity).includes(normalized);
		}
		const explicit = (this.options.senderAllowlist ?? []).map(normalizeIMessageIdentity).filter(Boolean);
		return explicit.includes(normalized);
	}

	private async handleIncoming(chatId: string, text: string, sender: string): Promise<void> {
		if (!this.pollChats.includes(chatId) && !this.options.allowlist.includes(chatId)) return;
		if (!this.isAuthorizedSender(chatId, sender)) return;

		// A pending free-text answer consumes this message (bound to its actor).
		if (
			this.pendingTextRequest &&
			this.pendingTextRequest.chatId === chatId &&
			this.pendingTextRequest.sender === sender
		) {
			const request = this.pendingTextRequest;
			this.pendingTextRequest = undefined;
			request.resolve(text);
			return;
		}

		// Confirm verdicts.
		if (this.pendingConfirms.size > 0) {
			const verdict = text.toLowerCase();
			if (/^(approve|yes|y|allow|ok|1)\b/.test(verdict) || /^(deny|no|n|block|0)\b/.test(verdict)) {
				const ok = /^(approve|yes|y|allow|ok|1)\b/.test(verdict);
				for (const [requestId, pending] of [...this.pendingConfirms.entries()]) {
					if (pending.chatId === chatId && pending.sender === sender) {
						pending.resolve(ok);
						this.pendingConfirms.delete(requestId);
						return;
					}
				}
			}
		}

		// Option selections by number.
		if (this.pendingSelects.size > 0) {
			const number = Number(text.trim());
			if (Number.isInteger(number) && number >= 1) {
				for (const [requestId, pending] of [...this.pendingSelects.entries()]) {
					const index = number - 1;
					if (pending.chatId === chatId && pending.sender === sender && index < pending.options.length) {
						pending.resolve(pending.options[index]);
						this.pendingSelects.delete(requestId);
						return;
					}
				}
			}
		}

		// '!' control commands (owner chats only, allowlist enforced by caller).
		if (text.startsWith("!")) {
			if (this.replyToCommand(chatId, text) !== undefined) return;
		}

		if (text === "/status") {
			await this.sendText(chatId, this.statusText());
			return;
		}
		if (text === "/help") {
			await this.sendText(
				chatId,
				"Send any message and the agent works on the shared session (shown in the TUI too).\n\nCommands: /status · /help · /commands. Confirmations arrive as text (reply APPROVE/DENY); questions as numbered replies.",
			);
			return;
		}
		if (text === "/commands" || text.startsWith("/commands ")) {
			await this.sendText(chatId, this.commandsText(text)).catch(() => {});
			return;
		}

		// Any other /command runs through the shared remote dispatcher.
		if (text.startsWith("/")) {
			await this.dispatchSlash(chatId, sender, text);
			return;
		}

		this.pendingMessages.push({ chatId, sender, text });
		try {
			await this.options.prompt(text, { streamingBehavior: "followUp" });
		} catch (error) {
			const index = this.pendingMessages.findIndex(
				(entry) => entry.chatId === chatId && entry.sender === sender && entry.text === text,
			);
			if (index !== -1) this.pendingMessages.splice(index, 1);
			await this.sendText(
				chatId,
				`⚠️ Could not start the task: ${error instanceof Error ? error.message : String(error)}`,
			).catch(() => {});
		}
	}

	private statusText(): string {
		const status = this.options.getStatus?.() ?? "";
		return `📡 iMessage bridge: ${this.running ? "polling" : "stopped"}\n${status}`.trim();
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

	private buildCatalog(): RemoteCatalog | undefined {
		const descriptors = this.options.getCommands?.() ?? [];
		if (descriptors.length === 0) return undefined;
		return buildRemoteCatalog(descriptors, "imessage");
	}

	/** Run one remote slash command line through the shared dispatcher. */
	private async dispatchSlash(chatId: string, sender: string | undefined, text: string): Promise<void> {
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
			if (result.notificationTarget && sender !== undefined) {
				this.activeChatId = chatId;
				this.activeSender = sender;
			}
			await this.sendText(chatId, result.text).catch(() => {});
			return;
		}
		if (result.kind === "declined" || result.kind === "not-found") {
			await this.sendText(chatId, result.text).catch(() => {});
		}
	}

	/** Start polling allowed chats. Idempotent. */
	async start(): Promise<void> {
		if (this.running) return;
		if (process.platform !== "darwin") {
			throw new Error("iMessage bridge is macOS-only (Messages.app).");
		}
		this.running = true;
		this.startedAt = Date.now();
		this.pollChats = await this.resolveAllowlist(this.options.allowlist).catch(() => this.options.allowlist);
		if (this.pollChats.length === 0) {
			this.running = false;
			throw new Error("No allowed chats. Set PORCUPINE_IMESSAGE_ALLOW to chat ids or phone/email handles.");
		}
		// Modern macOS (AppleScript ``messages of chat`` / ``is from me`` no longer
		// parse or resolve) cannot be driven through Messages' scripting bridge.
		// Probe once so we fail fast with one clear message instead of spamming a
		// poll error every few seconds.
		const readable = await this.probeReadable(this.pollChats[0]!).catch(() => false);
		if (!readable) {
			this.running = false;
			throw new Error(
				"iMessage bridge is not supported on this macOS: Messages.app cannot be read via AppleScript. " +
					"Use the Telegram or Discord bridge instead (PORCUPINE_TELEGRAM_TOKEN / PORCUPINE_DISCORD_TOKEN).",
			);
		}
		this.pollTimer = setInterval(() => {
			for (const chatId of this.pollChats) {
				void this.pollChat(chatId).catch(() => {});
			}
		}, POLL_INTERVAL_MS);
		// Immediate first poll.
		for (const chatId of this.pollChats) {
			void this.pollChat(chatId).catch(() => {});
		}
	}

	/** One-shot read of a chat to detect whether Messages is scriptable on this macOS. */
	private async probeReadable(chatId: string): Promise<boolean> {
		const messages = await this.fetchChatMessages(chatId);
		return Array.isArray(messages);
	}

	async stop(): Promise<void> {
		this.running = false;
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
		for (const [requestId, pending] of [...this.pendingConfirms.entries()]) {
			pending.resolve(false);
			this.pendingConfirms.delete(requestId);
		}
		for (const [requestId, pending] of [...this.pendingSelects.entries()]) {
			pending.resolve(undefined);
			this.pendingSelects.delete(requestId);
		}
		if (this.pendingTextRequest) {
			this.pendingTextRequest.resolve(undefined);
			this.pendingTextRequest = undefined;
		}
	}
}
