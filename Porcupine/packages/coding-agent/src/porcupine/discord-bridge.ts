/**
 * Discord bridge for Porcupine — a bot token turns allowed Discord channels
 * into a remote control for the SAME session (mirroring the Telegram bridge
 * contract: pending-prompt provenance, TUI↔phone racing, agent_end forwarding).
 *
 * Zero dependencies: Node's built-in WebSocket (>= 22.4, also present on Bun)
 * for the gateway, fetch() for REST. Approve/Deny and option selection use
 * message reactions (✅ / ❌ / 1️⃣…), so no slash-command registration or
 * interaction callbacks are needed.
 *
 * Env:
 *   PORCUPINE_DISCORD_TOKEN       — bot token
 *   PORCUPINE_DISCORD_ALLOW       — comma-separated channel ids allowed to talk
 *   PORCUPINE_DISCORD_USER_ALLOW  — comma-separated user ids allowed to act
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
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
import {
	extractAssistantText,
	extractMediaMarkers,
	lastUserMessageText,
	summarizeToolCalls,
	textsMatch,
} from "./telegram-bridge.ts";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const REST_BASE = "https://discord.com/api/v10";
const CHUNK = 2000;

// Gateway intents: guild messages, guild message reactions, direct messages,
// direct message reactions, message content.
const INTENTS = (1 << 9) | (1 << 10) | (1 << 12) | (1 << 13) | (1 << 15);

const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"] as const;

/** Minimal shape of the global WebSocket (typed locally; @types/node has no DOM lib). */
interface GatewaySocket {
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: { code: number; reason: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	send(data: string): void;
	close(code?: number, reason?: string): void;
}

interface DiscordGatewayPayload {
	op: number;
	d?: unknown;
	s?: number | null;
	t?: string | null;
}

interface DiscordMessage {
	id: string;
	channel_id: string;
	author?: { id: string; bot?: boolean };
	content?: string;
}

interface DiscordReaction {
	user_id: string;
	message_id: string;
	channel_id: string;
	emoji?: { name?: string };
}

export interface DiscordBridgeOptions {
	token: string;
	/** Channel ids (PORCUPINE_DISCORD_ALLOW) in which the bridge may operate. */
	allowlist: string[];
	/** User ids (PORCUPINE_DISCORD_USER_ALLOW) allowed to drive or approve work. */
	userAllowlist: string[];
	prompt: (text: string, options?: { streamingBehavior?: "followUp" | "steer" }) => Promise<void>;
	getStatus?: () => string;
	dialogTimeoutMs?: number;
	confirmTimeoutMs?: number;
	/** Canonical slash-command descriptors used for the /commands listing. */
	getCommands?: () => RemoteCommandDescriptor[];
	/** Runs a canonical remote command line and returns the reply to send back. */
	dispatch?: (commandLine: string) => Promise<RemoteSlashResult>;
}

export class DiscordBridge {
	private readonly options: DiscordBridgeOptions;
	private running = false;
	private ws: GatewaySocket | undefined;
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private reconnectAttempts = 0;
	private sequence: number | null = null;
	private sessionId: string | undefined;
	private resumeGatewayUrl: string | undefined;
	private selfId: string | undefined;
	private heartbeatIntervalMs = 0;
	private heartbeatAwaitingAck = false;
	/** Epoch ms when the bridge connected; drives the !status uptime line. */
	private startedAt: number | undefined;
	/** Materialized remote slash catalog (rebuilt on demand). */
	private catalog: RemoteCatalog | undefined;

	/** Discord-originated prompts awaiting their response turn (provenance match). */
	private pendingDiscord: Array<{ channelId: string; userId: string; text: string }> = [];
	/** Most recent authorized actor that sent a real prompt; confirmations go only to that actor. */
	private activeChannelId: string | undefined;
	private activeUserId: string | undefined;
	/** Approve/Deny waiters keyed by confirm request id, scoped to message and actor. */
	private confirmWaiters = new Map<
		string,
		{
			waiter: (ok: boolean) => void;
			messageId: string | undefined;
			channelId: string;
			userId: string;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	/** ask_question option selections scoped to their prompt message and actor. */
	private pendingSelects = new Map<
		string,
		{
			options: string[];
			resolve: (value: string | undefined) => void;
			messageId: string | undefined;
			channelId: string;
			userId: string;
		}
	>();
	/** ask_question free-text answer bound to one channel and authorized actor. */
	private pendingTextRequest:
		| { channelId: string; userId: string; resolve: (value: string | undefined) => void }
		| undefined;

	constructor(options: DiscordBridgeOptions) {
		this.options = options;
	}

	get isRunning(): boolean {
		return this.running;
	}

	get pendingTurns(): number {
		return this.pendingDiscord.length;
	}

	/** Seconds the bridge has been connected (used by the !status command). */
	get uptimeSeconds(): number | undefined {
		return this.startedAt === undefined ? undefined : (Date.now() - this.startedAt) / 1000;
	}

	// ---------------------------------------------------------------------
	// REST
	// ---------------------------------------------------------------------

	private async rest(path: string, init?: RequestInit, attempt = 0): Promise<unknown> {
		const headers = new Headers(init?.headers);
		headers.set("authorization", `Bot ${this.options.token}`);
		if (init?.body !== undefined && !(init.body instanceof FormData) && !headers.has("content-type")) {
			headers.set("content-type", "application/json");
		}
		const response = await fetch(`${REST_BASE}${path}`, {
			...init,
			headers,
			signal: AbortSignal.timeout(30_000),
		});
		if (response.status === 429 && attempt < 3) {
			const retryAfter = Math.max(0.25, Math.min(30, Number(response.headers.get("retry-after") ?? "1") || 1));
			await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000 + 250));
			return this.rest(path, init, attempt + 1);
		}
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`Discord REST ${response.status} ${path}: ${body.slice(0, 300)}`);
		}
		if (response.status === 204) return undefined;
		return response.json() as Promise<unknown>;
	}

	/** Send an outbound notification to the most recently active channel (if any). Attended-only; silently skipped when no channel has prompted yet. */
	async notifyTaskResult(text: string): Promise<void> {
		if (!text || this.activeChannelId === undefined) return;
		await this.sendText(this.activeChannelId, text).catch(() => {});
	}

	async sendText(channelId: string, text: string): Promise<string | undefined> {
		if (!text) return undefined;
		let lastId: string | undefined;
		for (let i = 0; i < text.length; i += CHUNK) {
			const result = await this.rest(`/channels/${channelId}/messages`, {
				method: "POST",
				body: JSON.stringify({ content: text.slice(i, i + CHUNK) }),
			}).catch((error: unknown) => {
				console.warn(`[discord] send failed: ${error instanceof Error ? error.message : String(error)}`);
				return undefined;
			});
			if (result && typeof result === "object") {
				const id = (result as { id?: unknown }).id;
				if (typeof id === "string") lastId = id;
			}
		}
		return lastId;
	}

	async sendDocument(channelId: string, filePath: string): Promise<void> {
		const resolved = filePath.startsWith("~") ? join(homedir(), filePath.slice(1)) : filePath;
		const buffer = await readFile(resolved);
		const form = new FormData();
		form.append("payload_json", JSON.stringify({ content: "" }));
		form.append("files[0]", new Blob([buffer]), basename(resolved));
		await this.rest(`/channels/${channelId}/messages`, { method: "POST", body: form });
	}

	private async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
		await this.rest(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {
			method: "PUT",
		}).catch(() => {});
	}

	// ---------------------------------------------------------------------
	// Confirmation / selection / input (same contract as Telegram)
	// ---------------------------------------------------------------------

	/** Remote-only confirm (no TUI): Approve/Deny reactions on the active channel. */
	remoteConfirm(title: string, message: string): Promise<boolean> | undefined {
		const channelId = this.activeChannelId;
		const userId = this.activeUserId;
		if (channelId === undefined || userId === undefined) return undefined;
		return new Promise<boolean>((resolve) => {
			const requestId = randomUUID();
			const timeout = this.options.confirmTimeoutMs ?? 5 * 60 * 1000;
			const entry = {
				waiter: (ok: boolean) => {
					const current = this.confirmWaiters.get(requestId);
					if (!current) return;
					clearTimeout(current.timer);
					this.confirmWaiters.delete(requestId);
					resolve(ok);
				},
				messageId: undefined as string | undefined,
				channelId,
				userId,
				timer: undefined as unknown as ReturnType<typeof setTimeout>,
			};
			entry.timer = setTimeout(() => entry.waiter(false), timeout);
			this.confirmWaiters.set(requestId, entry);
			void this.sendText(channelId, `❓ ${title}\n\n${message}\n\nReact ✅ to approve, ❌ to deny.`).then(
				(messageId) => {
					try {
						const current = this.confirmWaiters.get(requestId);
						if (current) {
							current.messageId = messageId ?? undefined;
						}
					} catch {}
					if (messageId && this.confirmWaiters.has(requestId)) {
						void this.addReaction(channelId, messageId, "✅");
						void this.addReaction(channelId, messageId, "❌");
					}
				},
				() => entry.waiter(false),
			);
		});
	}

	/** ask_question options: numbered reactions race the TUI selector. */
	async select(
		title: string,
		options: string[],
		tui: (title: string, options: string[]) => Promise<string | undefined>,
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		const channelId = this.activeChannelId;
		const userId = this.activeUserId;
		const tuiPromise = tui(title, options);
		if (channelId === undefined || userId === undefined || options.length === 0) return tuiPromise;
		if (options.length > NUMBER_EMOJI.length) return tuiPromise;

		const requestId = randomUUID();
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
			this.pendingSelects.set(requestId, {
				options,
				resolve: finish,
				messageId: undefined,
				channelId,
				userId,
			});
			opts?.signal?.addEventListener("abort", () => finish(undefined), { once: true });
			void tuiPromise.then((value) => finish(value));
		});
		const numbered = options.map((option, index) => `${NUMBER_EMOJI[index]} ${option}`).join("\n");
		const messageId = await this.sendText(channelId, `❓ ${title}\n\n${numbered}\n\nReact with a number.`).catch(
			() => undefined,
		);
		const pending = this.pendingSelects.get(requestId);
		if (pending) pending.messageId = messageId;
		return selection;
	}

	/** ask_question free text: the next message from the same channel answers it. */
	async input(
		title: string,
		tui: (title: string) => Promise<string | undefined>,
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		const channelId = this.activeChannelId;
		const userId = this.activeUserId;
		const tuiPromise = tui(title);
		if (channelId === undefined || userId === undefined) return tuiPromise;
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
			this.pendingTextRequest = { channelId, userId, resolve: finish };
			opts?.signal?.addEventListener("abort", () => finish(undefined), { once: true });
			void tuiPromise.then((value) => finish(value));
		});
		await this.sendText(channelId, `⌨️ ${title}\n\nReply with your answer.`).catch(() => {});
		return pending;
	}

	// ---------------------------------------------------------------------
	// Session events
	// ---------------------------------------------------------------------

	/** Bind confirmations/dialogs to the authorized actor whose queued turn actually started. */
	handleTurnStart(message: AgentMessage): void {
		const text = lastUserMessageText([message]);
		const entry = this.pendingDiscord.find((candidate) => text !== undefined && textsMatch(candidate.text, text));
		this.activeChannelId = entry?.channelId;
		this.activeUserId = entry?.userId;
	}

	/** Forward the terminal response to the channel that started the turn. */
	async handleAgentEnd(messages: readonly AgentMessage[], willRetry: boolean): Promise<void> {
		if (willRetry) return;
		const lastUserText = lastUserMessageText(messages);
		const index = this.pendingDiscord.findIndex(
			(entry) => lastUserText !== undefined && textsMatch(entry.text, lastUserText),
		);
		if (index === -1) return;
		const entry = this.pendingDiscord[index]!;
		this.pendingDiscord.splice(index, 1);
		try {
			const raw = extractAssistantText(messages);
			const { clean, paths } = extractMediaMarkers(raw);
			const tools = summarizeToolCalls(messages);
			const body = [clean, tools ? `\n${tools}` : ""].join("").trim();
			if (body) await this.sendText(entry.channelId, body);
			else if (paths.length === 0) await this.sendText(entry.channelId, "Done.");
			for (const path of paths) await this.sendDocument(entry.channelId, path).catch(() => {});
		} catch (error) {
			console.warn(
				`[discord] failed to forward response: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// ---------------------------------------------------------------------
	// Gateway
	// ---------------------------------------------------------------------

	private wsSocket(): GatewaySocket | undefined {
		return this.ws;
	}

	private connect(): void {
		if (!this.running) return;
		const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
		if (!WebSocketCtor) {
			console.warn("[discord] WebSocket is not available in this runtime (needs Node >= 22.4 or Bun).");
			this.running = false;
			return;
		}
		const gatewayUrl =
			this.sessionId && this.sequence !== null ? (this.resumeGatewayUrl ?? GATEWAY_URL) : GATEWAY_URL;
		const url = gatewayUrl.includes("?") ? gatewayUrl : `${gatewayUrl}/?v=10&encoding=json`;
		const ws = new WebSocketCtor(url) as unknown as GatewaySocket;
		this.ws = ws;

		ws.onopen = () => {
			// Discord requires IDENTIFY/RESUME after the server's HELLO payload.
			// Reconnect backoff resets only after READY/RESUMED, not a bare TCP open.
		};
		ws.onmessage = (event) => {
			if (typeof event.data !== "string") return;
			try {
				const payload = JSON.parse(event.data) as DiscordGatewayPayload;
				this.sequence = payload.s ?? this.sequence;
				void this.handlePayload(payload);
			} catch (error) {
				console.warn(`[discord] bad gateway payload: ${error instanceof Error ? error.message : String(error)}`);
			}
		};
		ws.onclose = (event) => {
			this.stopHeartbeat();
			if (this.ws === ws) this.ws = undefined;
			// Authentication, intent, and shard failures cannot recover by retrying.
			if ([4004, 4010, 4011, 4013, 4014].includes(event.code)) {
				this.running = false;
				console.warn(`[discord] gateway closed permanently (${event.code}): ${event.reason}`);
				return;
			}
			// Invalid sequence/session timeout requires a fresh IDENTIFY.
			if (event.code === 4007 || event.code === 4009) {
				this.sessionId = undefined;
				this.resumeGatewayUrl = undefined;
				this.sequence = null;
			}
			if (this.running) this.scheduleReconnect();
		};
		ws.onerror = () => {
			// close follows; handled in onclose
		};
	}

	private identifyPayload(): Record<string, unknown> {
		return {
			token: this.options.token,
			intents: INTENTS,
			properties: { os: process.platform, browser: "porcupine", device: "porcupine" },
			presence: {
				status: "online",
				activities: [{ name: "Porcupine agent bridge", type: 3 }],
				afk: false,
			},
		};
	}

	private resumePayload(): Record<string, unknown> {
		return {
			token: this.options.token,
			session_id: this.sessionId,
			seq: this.sequence,
		};
	}

	private sendGateway(payload: Record<string, unknown>): void {
		this.wsSocket()?.send(JSON.stringify(payload));
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
		this.heartbeatAwaitingAck = false;
	}

	private sendHeartbeat(): void {
		if (this.heartbeatAwaitingAck) {
			// A missed ACK means this connection is zombied. Reconnect and RESUME
			// instead of remaining visibly online while silently missing messages.
			this.wsSocket()?.close(4000, "heartbeat ACK timeout");
			return;
		}
		this.sendGateway({ op: 1, d: this.sequence });
		this.heartbeatAwaitingAck = true;
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return;
		const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
		this.reconnectAttempts++;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			if (!this.running) return;
			this.connect();
		}, delay);
	}

	private async handlePayload(payload: DiscordGatewayPayload): Promise<void> {
		switch (payload.op) {
			case 10: {
				const hello = payload.d as { heartbeat_interval: number } | undefined;
				this.heartbeatIntervalMs = hello?.heartbeat_interval ?? 41_250;
				this.stopHeartbeat();
				if (this.sessionId && this.sequence !== null) {
					this.sendGateway({ op: 6, d: this.resumePayload() });
				} else {
					this.sendGateway({ op: 2, d: this.identifyPayload() });
				}
				this.sendHeartbeat();
				this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.heartbeatIntervalMs);
				break;
			}
			case 11:
				this.heartbeatAwaitingAck = false;
				break;
			case 1:
				this.sendHeartbeat();
				break;
			case 9:
				if (payload.d !== true) {
					this.sessionId = undefined;
					this.resumeGatewayUrl = undefined;
					this.sequence = null;
				}
				this.wsSocket()?.close(4000, "invalid session");
				break;
			case 7:
				// Server requests a reconnect.
				this.wsSocket()?.close(4000);
				break;
			case 0:
				await this.handleDispatch(payload);
				break;
		}
	}

	private async handleDispatch(payload: DiscordGatewayPayload): Promise<void> {
		const eventName = payload.t;
		const data = payload.d as Record<string, unknown> | undefined;
		switch (eventName) {
			case "READY": {
				const ready = data as
					| { session_id?: string; resume_gateway_url?: string; user?: { id?: string } }
					| undefined;
				this.sessionId = ready?.session_id;
				this.resumeGatewayUrl = ready?.resume_gateway_url;
				this.selfId = ready?.user?.id;
				this.reconnectAttempts = 0;
				break;
			}
			case "RESUMED":
				this.reconnectAttempts = 0;
				break;
			case "MESSAGE_CREATE":
				await this.handleMessage(data as unknown as DiscordMessage);
				break;
			case "MESSAGE_REACTION_ADD":
				await this.handleReaction(data as unknown as DiscordReaction);
				break;
		}
	}

	private isAllowed(channelId: string, userId: string | undefined): boolean {
		return (
			userId !== undefined &&
			this.options.allowlist.includes(channelId) &&
			this.options.userAllowlist.includes(userId)
		);
	}

	/**
	 * Resolve a '!' control command and reply to the sender channel through the
	 * notifyTaskResult send path (the bridge is already restricted to the owner
	 * allowlist here). Returns undefined when the text is not a command so the
	 * message falls through to normal prompt handling.
	 */
	private replyToCommand(channelId: string, text: string): string | undefined {
		const parsed = parseBridgeCommand(text);
		if (parsed === null) return undefined;
		const context: BridgeCommandContext = {
			uptimeSeconds: this.uptimeSeconds,
			sessionActive: this.running,
			statusText: this.options.getStatus?.() ?? "",
		};
		const reply = handleBridgeCommand(parsed, { context });
		void this.sendText(channelId, reply).catch(() => {});
		return reply;
	}

	private async handleMessage(message: DiscordMessage): Promise<void> {
		if (message.author?.id === this.selfId || message.author?.bot) return;
		const channelId = message.channel_id;
		const userId = message.author?.id;
		if (userId === undefined || !this.isAllowed(channelId, userId)) return;
		const text = message.content?.trim();
		if (!text) return;

		// A pending free-text answer consumes this message (bound to its channel).
		if (
			this.pendingTextRequest &&
			this.pendingTextRequest.channelId === channelId &&
			this.pendingTextRequest.userId === userId
		) {
			const request = this.pendingTextRequest;
			this.pendingTextRequest = undefined;
			request.resolve(text);
			return;
		}

		// '!' control commands (owner-channel only, already enforced above).
		if (text.startsWith("!")) {
			if (this.replyToCommand(channelId, text) !== undefined) return;
		}

		if (text === "/status") {
			await this.sendText(channelId, this.statusText());
			return;
		}
		if (text === "/help") {
			await this.sendText(
				channelId,
				"Send any message and the agent works on the shared session (shown in the TUI too).\n\nCommands: /status · /help · /commands. Ask-mode confirmations arrive as ✅/❌ reactions; questions as numbered reactions.",
			);
			return;
		}
		if (text === "/commands" || text.startsWith("/commands ")) {
			await this.sendText(channelId, this.commandsText(text)).catch(() => {});
			return;
		}

		// Any other /command runs through the shared remote dispatcher.
		if (text.startsWith("/")) {
			await this.dispatchSlash(channelId, userId, text);
			return;
		}

		this.pendingDiscord.push({ channelId, userId, text });
		void this.rest(`/channels/${channelId}/typing`, { method: "POST" }).catch(() => {});
		try {
			await this.options.prompt(text, { streamingBehavior: "followUp" });
		} catch (error) {
			const index = this.pendingDiscord.findIndex(
				(entry) => entry.channelId === channelId && entry.userId === userId && entry.text === text,
			);
			if (index !== -1) this.pendingDiscord.splice(index, 1);
			await this.sendText(
				channelId,
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

	private buildCatalog(): RemoteCatalog | undefined {
		const descriptors = this.options.getCommands?.() ?? [];
		if (descriptors.length === 0) return undefined;
		return buildRemoteCatalog(descriptors, "discord");
	}

	/** Run one remote slash command line through the shared dispatcher. */
	private async dispatchSlash(channelId: string, userId: string | undefined, text: string): Promise<void> {
		const dispatch = this.options.dispatch;
		if (!dispatch) {
			await this.sendText(channelId, "Remote slash commands are not available in this build.").catch(() => {});
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
				this.activeChannelId = channelId;
				this.activeUserId = userId;
			}
			await this.sendText(channelId, result.text).catch(() => {});
			return;
		}
		if (result.kind === "declined" || result.kind === "not-found") {
			await this.sendText(channelId, result.text).catch(() => {});
		}
	}

	private async handleReaction(reaction: DiscordReaction): Promise<void> {
		if (reaction.user_id === this.selfId) return;
		if (!this.isAllowed(reaction.channel_id, reaction.user_id)) return;
		const emoji = reaction.emoji?.name;

		// Resolve an active option selection by reaction number.
		if (emoji) {
			const selectIndex = NUMBER_EMOJI.indexOf(emoji as (typeof NUMBER_EMOJI)[number]);
			if (selectIndex >= 0) {
				for (const [requestId, pending] of [...this.pendingSelects.entries()]) {
					if (
						pending.channelId === reaction.channel_id &&
						pending.userId === reaction.user_id &&
						pending.messageId === reaction.message_id &&
						selectIndex < pending.options.length
					) {
						pending.resolve(pending.options[selectIndex]);
						this.pendingSelects.delete(requestId);
						return;
					}
				}
			}
		}

		// Approve/Deny: message id scopes the waiter (stale reaction on an old
		// confirmation message can't approve a new/current one).
		if (emoji === "✅" || emoji === "❌") {
			for (const entry of [...this.confirmWaiters.values()]) {
				if (
					entry.channelId !== reaction.channel_id ||
					entry.userId !== reaction.user_id ||
					entry.messageId === undefined ||
					entry.messageId !== reaction.message_id
				) {
					continue;
				}
				entry.waiter(emoji === "✅");
			}
		}
	}

	private statusText(): string {
		const status = this.options.getStatus?.() ?? "";
		return `📡 Discord bridge: ${this.running ? "connected" : "stopped"}\n${status}`.trim();
	}

	/** Start the gateway. Idempotent. */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.startedAt = Date.now();
		this.connect();
	}

	async stop(): Promise<void> {
		this.running = false;
		this.stopHeartbeat();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		this.wsSocket()?.close(1000);
		this.ws = undefined;
		this.startedAt = undefined;
		for (const pending of [...this.confirmWaiters.values()]) pending.waiter(false);
		for (const pending of [...this.pendingSelects.values()]) pending.resolve(undefined);
		this.pendingTextRequest?.resolve(undefined);
		this.pendingTextRequest = undefined;
	}
}
