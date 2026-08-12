import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	extractAssistantText,
	extractMediaMarkers,
	summarizeToolCalls,
	TelegramBridge,
} from "../src/porcupine/telegram-bridge.ts";

/** Mock fetch recording API calls; getUpdates is served from its own queue. */
function createFetchMock(batches: unknown[][]) {
	const calls: Array<{ method: string; body: string }> = [];
	const queue = batches.slice();
	const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
		const method = String(url).split("/").pop() ?? "";
		const body = String(init?.body ?? "");
		calls.push({ method, body });
		// Only getUpdates consumes the canned queue; other API calls just succeed.
		const result = method === "getUpdates" ? (queue.shift() ?? []) : [];
		return {
			json: async () => ({ ok: true, result }),
		} as Response;
	};
	return { fetchImpl, calls };
}

function update(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { update_id: id, ...overrides };
}

function textMessage(messageId: number, chatId: number, text: string): Record<string, unknown> {
	return update(messageId * 10 + 1, {
		message: { message_id: messageId, chat: { id: chatId, type: "private" }, from: { id: chatId }, text },
	});
}

const ALLOWED = 111;
const BLOCKED = 222;

function makeBridge(batches: unknown[][], overrides: Partial<ConstructorParameters<typeof TelegramBridge>[0]> = {}) {
	const { fetchImpl, calls } = createFetchMock(batches);
	const prompts: string[] = [];
	const bridge = new TelegramBridge({
		token: "test-token",
		allowlist: [ALLOWED],
		prompt: async (text) => {
			prompts.push(text);
		},
		confirmTui: async () => false,
		getStatus: () => "session: s1",
		...overrides,
		fetchImpl,
	});
	return { bridge, calls, prompts };
}

/** Type-escape for touching private bridge state in tests. */
function internals(bridge: TelegramBridge): {
	pendingTelegram: Array<{ chatId: number; text: string }>;
	activeChatId: number | undefined;
	activeUserId: number | undefined;
	offset: number;
	handleMessage(message: unknown): Promise<void>;
	handleCallbackQuery(query: {
		id: string;
		from?: { id: number };
		message?: { chat: { id: number } };
		data?: string;
	}): Promise<void>;
} {
	return bridge as unknown as ReturnType<typeof internals>;
}

describe("TelegramBridge message routing", () => {
	afterEach(() => {});

	it("prompts the shared session for messages from allowed chats and records the turn", async () => {
		const { bridge, calls, prompts } = makeBridge([[], [textMessage(1, ALLOWED, "build the repo please")]]);
		await bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bridge.stop();

		expect(prompts).toEqual(["build the repo please"]);
		expect(bridge.pendingTurns).toBe(1);
		expect(calls.some((call) => call.method === "getUpdates")).toBe(true);
	});

	it("ignores messages from chats not in the allowlist", async () => {
		const { bridge, prompts } = makeBridge([[], [textMessage(2, BLOCKED, "rm -rf everything")]]);
		await bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bridge.stop();

		expect(prompts).toEqual([]);
		expect(bridge.pendingTurns).toBe(0);
	});

	it("keeps private-chat identity authorization independent of the group user allowlist", async () => {
		const privateMessage = {
			message_id: 7,
			chat: { id: ALLOWED, type: "private" },
			from: { id: ALLOWED },
			text: "private task",
		};
		const { bridge, prompts } = makeBridge([], { userAllowlist: [999] });
		await internals(bridge).handleMessage(privateMessage);
		expect(prompts).toEqual(["private task"]);
	});

	it("requires an explicit user allowlist before group chats can drive the session", async () => {
		const groupMessage = update(25, {
			message: {
				message_id: 25,
				chat: { id: ALLOWED, type: "group" },
				from: { id: 999 },
				text: "run a command",
			},
		});
		const denied = makeBridge([[], [groupMessage]]);
		await denied.bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await denied.bridge.stop();
		expect(denied.prompts).toEqual([]);

		const allowed = makeBridge([[], [groupMessage]], { userAllowlist: [999] });
		await allowed.bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await allowed.bridge.stop();
		expect(allowed.prompts).toEqual(["run a command"]);
	});

	it("answers /start and /status without starting a turn", async () => {
		const { bridge, calls, prompts } = makeBridge([
			[],
			[textMessage(3, ALLOWED, "/start"), textMessage(4, ALLOWED, "/status")],
		]);
		await bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bridge.stop();

		expect(prompts).toEqual([]);
		const sendMessages = calls.filter((call) => call.method === "sendMessage");
		expect(sendMessages.length).toBe(2);
		const decoded = (body: string) => decodeURIComponent(body).replace(/\+/g, " ");
		expect(decoded(sendMessages[0]?.body ?? "")).toContain("Porcupine Telegram bridge connected");
		expect(decoded(sendMessages[1]?.body ?? "")).toContain("session:");
	});
});

describe("TelegramBridge visibility matrix", () => {
	it("does not let a later queued chat steal the current turn's confirmation target", async () => {
		const SECOND_CHAT = 333;
		const { bridge } = makeBridge([], { allowlist: [ALLOWED, SECOND_CHAT] });
		await internals(bridge).handleMessage({
			message_id: 1,
			chat: { id: ALLOWED, type: "private" },
			from: { id: ALLOWED },
			text: "first task",
		});
		bridge.handleTurnStart({ role: "user", content: [{ type: "text", text: "first task" }] } as never);
		expect(internals(bridge).activeChatId).toBe(ALLOWED);

		await internals(bridge).handleMessage({
			message_id: 2,
			chat: { id: SECOND_CHAT, type: "private" },
			from: { id: SECOND_CHAT },
			text: "queued task",
		});
		expect(internals(bridge).activeChatId).toBe(ALLOWED);

		bridge.handleTurnStart({ role: "user", content: [{ type: "text", text: "queued task" }] } as never);
		expect(internals(bridge).activeChatId).toBe(SECOND_CHAT);
	});

	it("clears the remote approval target when a TUI turn starts", async () => {
		const { bridge } = makeBridge([]);
		const state = internals(bridge) as ReturnType<typeof internals> & { activeChatId?: number; activeUserId?: number };
		state.activeChatId = ALLOWED;
		state.activeUserId = ALLOWED;
		bridge.handleTurnStart({ role: "user", content: [{ type: "text", text: "terminal task" }] } as never);
		expect(state.activeChatId).toBeUndefined();
		expect(state.activeUserId).toBeUndefined();
	});

	it("forwards the agent response to Telegram only for Telegram-originated turns", async () => {
		const { bridge, calls } = makeBridge([]);
		const messages = [
			{ role: "user", content: [{ type: "text", text: "hi" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "done." },
					{ type: "toolCall", name: "bash" },
				],
			},
		] as never;

		// TUI-originated turn: no matching pending prompt → nothing is sent.
		await bridge.handleAgentEnd(messages, false);
		expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(0);

		// Telegram-originated turn: the bridge queued a prompt first; the turn's
		// last user message matches it → response forwards to Telegram.
		internals(bridge).pendingTelegram.push({ chatId: ALLOWED, text: "hi" });
		internals(bridge).activeChatId = ALLOWED;
		await bridge.handleAgentEnd(messages, false);
		const sent = calls.filter((call) => call.method === "sendMessage");
		expect(sent).toHaveLength(1);
		expect(sent[0]?.body).toContain("done.");
		expect(sent[0]?.body).toContain("bash");
		expect(bridge.pendingTurns).toBe(0);
	});

	it("does not forward when the run will retry", async () => {
		const { bridge, calls } = makeBridge([]);
		internals(bridge).pendingTelegram.push({ chatId: ALLOWED, text: "hi" });
		internals(bridge).activeChatId = ALLOWED;
		await bridge.handleAgentEnd(
			[
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{ role: "assistant", content: [{ type: "text", text: "partial" }] },
			] as never,
			true,
		);
		expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(0);
		expect(bridge.pendingTurns).toBe(1);
	});
});

describe("TelegramBridge confirmations", () => {
	it("answers approve buttons and races the TUI dialog", async () => {
		// TUI side never answers (stays open), so the Telegram button decides.
		const { bridge, calls } = makeBridge([], {
			confirmTui: () => new Promise<boolean>(() => {}),
		});
		internals(bridge).activeChatId = ALLOWED;
		internals(bridge).activeUserId = ALLOWED;
		const confirmPromise = bridge.confirm("Run command", "sudo apt update");

		await new Promise((resolve) => setTimeout(resolve, 10));
		const sent = calls.filter((call) => call.method === "sendMessage");
		expect(sent).toHaveLength(1);
		expect(sent[0]?.body).toContain("inline_keyboard");
		expect(sent[0]?.body).toContain("Approve");

		const query = update(50, {
			callback_query: {
				id: "cq1",
				from: { id: ALLOWED },
				message: { chat: { id: ALLOWED } },
				data: "approve",
			},
		});
		await internals(bridge).handleCallbackQuery(query.callback_query as never);
		expect(await confirmPromise).toBe(true);
		expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
	});

	it("rejects confirmation callbacks from another user in an allowed group", async () => {
		const { bridge, calls } = makeBridge([], {
			userAllowlist: [999],
			confirmTui: () => new Promise<boolean>(() => {}),
		});
		internals(bridge).activeChatId = ALLOWED;
		internals(bridge).activeUserId = 999;
		const confirmPromise = bridge.confirm("Run command", "npm test");
		await new Promise((resolve) => setTimeout(resolve, 5));
		const sent = calls.find((call) => call.method === "sendMessage");
		const decoded = decodeURIComponent(sent?.body ?? "");
		const requestId = /confirm:([a-f0-9-]+):approve/.exec(decoded)?.[1];
		if (!requestId) throw new Error("no confirmation request id");

		await internals(bridge).handleCallbackQuery({
			id: "forged",
			from: { id: 1234 },
			message: { chat: { id: ALLOWED } },
			data: `confirm:${requestId}:approve`,
		});
		const settled = await Promise.race([
			confirmPromise.then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
		]);
		expect(settled).toBe(false);

		await internals(bridge).handleCallbackQuery({
			id: "owner",
			from: { id: 999 },
			message: { chat: { id: ALLOWED } },
			data: `confirm:${requestId}:approve`,
		});
		expect(await confirmPromise).toBe(true);
	});

	it("fails closed when neither TUI nor Telegram can answer", async () => {
		const { bridge } = makeBridge([]);
		// No confirmTui (overridden), no active chat.
		const bridge2 = new TelegramBridge({
			token: "t",
			allowlist: [],
			prompt: async () => {},
			fetchImpl: createFetchMock([]).fetchImpl,
		});
		expect(await bridge2.confirm("x", "y")).toBe(false);
		expect(await bridge.confirm("x", "y")).toBe(false);
	});
});

describe("TelegramBridge questions (ask_question)", () => {
	function firstSelectRequestId(calls: Array<{ method: string; body: string }>): { requestId: string; index: number } {
		const message = calls.find((call) => call.method === "sendMessage");
		const decoded = decodeURIComponent(message?.body ?? "");
		const match = /select:([a-f0-9-]+):(\d+)/.exec(decoded);
		if (!match) throw new Error("no select button found");
		return { requestId: match[1]!, index: Number(match[2]) };
	}

	it("sends option buttons and resolves a tap to the FULL option string", async () => {
		const { bridge, calls } = makeBridge([]);
		internals(bridge).activeChatId = ALLOWED;
		internals(bridge).activeUserId = ALLOWED;
		const options = ["Use SQLite", "Use Postgres"];
		const promise = bridge.select("Which database?", options, () => new Promise<string | undefined>(() => {}));

		await new Promise((resolve) => setTimeout(resolve, 5));
		const sent = calls.find((call) => call.method === "sendMessage");
		const decoded = decodeURIComponent(sent?.body ?? "").replace(/\+/g, " ");
		expect(decoded).toContain("inline_keyboard");
		expect(decoded).toContain("Use SQLite");

		const { requestId, index } = firstSelectRequestId(calls);
		await internals(bridge).handleCallbackQuery({
			id: "cq-select",
			from: { id: ALLOWED },
			message: { chat: { id: ALLOWED } },
			data: `select:${requestId}:${index}`,
		});
		expect(await promise).toBe("Use SQLite");
	});

	it("lets the TUI selector win the race when it answers first", async () => {
		const { bridge, calls } = makeBridge([]);
		internals(bridge).activeChatId = ALLOWED;
		const result = await bridge.select("Which database?", ["Use SQLite", "Use Postgres"], async () => "Use Postgres");
		expect(result).toBe("Use Postgres");
		// The Telegram buttons were still offered (best-effort), but the TUI answer wins.
		expect(calls.some((call) => call.method === "sendMessage")).toBe(true);
	});

	it("consumes the next reply as the free-text answer instead of a prompt", async () => {
		const { bridge, prompts } = makeBridge([[], [textMessage(9, ALLOWED, "42")]]);
		internals(bridge).activeChatId = ALLOWED;
		const promise = bridge.input("How many?", () => new Promise<string | undefined>(() => {}));

		await bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bridge.stop();

		expect(await promise).toBe("42");
		expect(prompts).toEqual([]); // the reply answered the question, not a new turn
		expect(bridge.pendingTurns).toBe(0);
	});

	it("resolves undefined when the dialog is aborted", async () => {
		const { bridge } = makeBridge([]);
		internals(bridge).activeChatId = ALLOWED;
		const controller = new AbortController();
		const promise = bridge.select("Proceed?", ["Yes", "No"], async () => undefined, {
			signal: controller.signal,
		});
		controller.abort();
		expect(await promise).toBeUndefined();
	});
});

describe("TelegramBridge text extraction", () => {
	it("joins text blocks of the last assistant message, skipping thinking and tool calls", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "hello" }] },
			{
				role: "assistant",
				content: [
					{ type: "thinking", text: "hmm" },
					{ type: "text", text: "result " },
					{ type: "text", text: "here" },
					{ type: "toolCall", name: "bash" },
				],
			},
		] as never;
		expect(extractAssistantText(messages)).toBe("result \nhere");
	});

	it("summarizes unique tool calls", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "toolCall", name: "bash" },
					{ type: "toolCall", name: "bash" },
					{ type: "toolCall", name: "edit" },
				],
			},
		] as never;
		expect(summarizeToolCalls(messages)).toBe("⚙️ used bash, edit");
	});
});

describe("TelegramBridge Hermes-style upgrades", () => {
	it("extracts MEDIA: markers and strips them from the response text", () => {
		expect(extractMediaMarkers("See the plot:\nMEDIA:./plot.png\nDone.")).toEqual({
			clean: "See the plot:\nDone.",
			paths: ["./plot.png"],
		});
		expect(extractMediaMarkers("no media here")).toEqual({ clean: "no media here", paths: [] });
	});

	it("registers the command menu and presence on start", async () => {
		const { bridge, calls } = makeBridge([]);
		await bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bridge.stop();

		const methods = calls.map((call) => call.method);
		expect(methods).toContain("setMyCommands");
		expect(methods).toContain("setMyDescription");
		expect(methods).toContain("getUpdates");
		expect(calls.find((call) => call.method === "setMyDescription")?.body).toContain("Online");
	});

	it("surfaces Bot API failures without leaking the bot token", async () => {
		const bridge = new TelegramBridge({
			token: "super-secret-token",
			allowlist: [ALLOWED],
			prompt: async () => {},
			fetchImpl: (async () => ({
				ok: true,
				status: 200,
				json: async () => ({ ok: false, description: "chat not found" }),
			})) as unknown as typeof fetch,
		});
		await expect(bridge.sendText(ALLOWED, "hello")).rejects.toThrow(
			"Telegram API sendMessage failed: chat not found",
		);
		await expect(bridge.sendText(ALLOWED, "hello")).rejects.not.toThrow("super-secret-token");
	});

	it("chunks long responses into 4000-char messages", async () => {
		const { bridge, calls } = makeBridge([]);
		const long = "x".repeat(9000);
		await bridge.sendText(ALLOWED, long);
		const sends = calls.filter((call) => call.method === "sendMessage");
		expect(sends.length).toBe(3);
	});

	it("sends MEDIA files as documents and survives missing files", async () => {
		const { bridge, calls } = makeBridge([]);
		internals(bridge).activeChatId = ALLOWED;
		const dir = mkdtempSync(join(tmpdir(), "porcupine-tg-media-"));
		writeFileSync(join(dir, "report.txt"), "results");
		const messages = [
			{ role: "user", content: [{ type: "text", text: "send me the report" }] },
			{ role: "assistant", content: [{ type: "text", text: `Here it is:\nMEDIA:${join(dir, "report.txt")}` }] },
		] as never;
		internals(bridge).pendingTelegram.push({ chatId: ALLOWED, text: "send me the report" });
		await bridge.handleAgentEnd(messages, false);
		expect(calls.some((call) => call.method === "sendDocument")).toBe(true);

		// A missing file must not crash forwarding; the document attempt is best-effort.
		const missing = [
			{ role: "user", content: [{ type: "text", text: "missing" }] },
			{ role: "assistant", content: [{ type: "text", text: "MEDIA:/nonexistent/missing.png" }] },
		] as never;
		internals(bridge).pendingTelegram.push({ chatId: ALLOWED, text: "missing" });
		await bridge.handleAgentEnd(missing, false);
		await bridge.stop();
		rmSync(dir, { recursive: true, force: true });
	});

	it("forwards long responses despite the 4096-char Telegram limit", async () => {
		const { bridge, calls } = makeBridge([]);
		internals(bridge).activeChatId = ALLOWED;
		internals(bridge).pendingTelegram.push({ chatId: ALLOWED, text: "long" });
		const messages = [
			{ role: "user", content: [{ type: "text", text: "long" }] },
			{ role: "assistant", content: [{ type: "text", text: "R".repeat(8000) }] },
		] as never;
		await bridge.handleAgentEnd(messages, false);
		const sends = calls.filter((call) => call.method === "sendMessage");
		expect(sends.length).toBe(2);
		expect(bridge.pendingTurns).toBe(0);
	});
});

describe("TelegramBridge bug-hunt regressions", () => {
	it("drains pre-start updates instead of re-prompting the agent (restart replay fix)", async () => {
		// Old message queued while the bridge was offline; after start it must be
		// consumed WITHOUT prompting — otherwise every restart re-runs old work.
		const { bridge, prompts } = makeBridge([[textMessage(50, ALLOWED, "old replayed task")]]);
		await bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bridge.stop();
		expect(prompts).toEqual([]);
		expect(bridge.pendingTurns).toBe(0);
	});

	it("scopes confirm buttons per-request: a non-matching tap resolves nothing", async () => {
		// TUI never answers so both confirms stay pending on their Telegram waiters.
		const { bridge } = makeBridge([], {
			confirmTui: () => new Promise<boolean>(() => {}),
		});
		internals(bridge).activeChatId = ALLOWED;
		const confirm1 = bridge.confirm("Q1", "first");
		const confirm2 = bridge.confirm("Q2", "second");

		// A stale/forged button whose request id matches NO waiter must not resolve
		// either confirmation (pre-fix, ANY approve button resolved ALL waiters).
		await internals(bridge).handleCallbackQuery({
			id: "cq-stale",
			from: { id: ALLOWED },
			message: { chat: { id: ALLOWED } },
			data: "confirm:stale-request:approve",
		});
		const unsettled = async (promise: Promise<boolean>) =>
			Promise.race([promise.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 50))]);
		expect(await unsettled(confirm1)).toBe(false);
		expect(await unsettled(confirm2)).toBe(false);
	});

	it("rolls back the turn counter and notifies the user when the prompt fails", async () => {
		const { bridge } = makeBridge([[], [textMessage(60, ALLOWED, "trigger")]], {
			prompt: async () => {
				throw new Error("agent busy");
			},
		});
		// capture sendText by reading the fetch calls after the poll
		await bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bridge.stop();
		expect(bridge.pendingTurns).toBe(0);
	});

	it("advances the offset only past successfully processed updates", async () => {
		const { bridge } = makeBridge([[], [textMessage(70, BLOCKED, "ignored")]]);
		internals(bridge).offset = 0;
		await bridge.start();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await bridge.stop();
		// The BLOCKED message was skipped (not allowed) but must still advance the
		// offset so the poll loop does not fetch it again forever.
		expect((internals(bridge) as unknown as { offset: number }).offset).toBeGreaterThan(0);
	});
});

describe("TelegramBridge follow-up turn routing (the visibility bug)", () => {
	it("forwards only the Telegram turn's response, never the TUI turn it queued behind", async () => {
		const { bridge, calls } = makeBridge([]);

		// 1. A TUI turn is already running (its user message is NOT a Telegram prompt).
		const tuiTurnMessages = [
			{ role: "user", content: [{ type: "text", text: "fix the bug" }] },
			{ role: "assistant", content: [{ type: "text", text: "TUI response — must stay in TUI" }] },
		] as never;

		// 2. Telegram message queues behind it (followUp), pending entry created.
		internals(bridge).pendingTelegram.push({ chatId: ALLOWED, text: "whats the status" });

		// 3. The CURRENT (TUI) turn ends FIRST — must NOT forward to Telegram.
		await bridge.handleAgentEnd(tuiTurnMessages, false);
		expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(0);
		expect(bridge.pendingTurns).toBe(1); // still waiting for the follow-up

		// 4. The follow-up (Telegram) turn ends — its last user message matches.
		const telegramTurnMessages = [
			{ role: "user", content: [{ type: "text", text: "whats the status" }] },
			{ role: "assistant", content: [{ type: "text", text: "Telegram response — must go to Telegram" }] },
		] as never;
		await bridge.handleAgentEnd(telegramTurnMessages, false);

		const decoded = (body: string) => decodeURIComponent(body).replace(/\+/g, " ");
		const sent = calls.filter((call) => call.method === "sendMessage");
		expect(sent).toHaveLength(1);
		expect(decoded(sent[0]?.body ?? "")).toContain("Telegram response");
		expect(decoded(sent[0]?.body ?? "")).not.toContain("TUI response");
		expect(bridge.pendingTurns).toBe(0);
	});

	it("matches a skill-expanded follow-up (prompt embedded as its own line)", async () => {
		const { bridge, calls } = makeBridge([]);
		internals(bridge).pendingTelegram.push({ chatId: ALLOWED, text: "explain compaction" });
		// The follow-up ran the /skill template: the raw prompt is one line inside.
		const expandedTurnMessages = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "# Compaction skill\n\nexplain compaction\n\nRead the docs first.",
					},
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "Compaction explained." }] },
		] as never;
		await bridge.handleAgentEnd(expandedTurnMessages, false);
		const decoded = (body: string) => decodeURIComponent(body).replace(/\+/g, " ");
		const sent = calls.filter((call) => call.method === "sendMessage");
		expect(sent).toHaveLength(1);
		expect(decoded(sent[0]?.body ?? "")).toContain("Compaction explained.");
		expect(bridge.pendingTurns).toBe(0);
	});
});
