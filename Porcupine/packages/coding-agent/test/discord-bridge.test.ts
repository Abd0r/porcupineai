import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordBridge } from "../src/porcupine/discord-bridge.ts";

/**
 * Discord bridge smoke tests — no real gateway. REST is served by a fetch mock;
 * handleMessage / handleAgentEnd are exercised directly (private via `any`).
 */
function createFetchMock() {
	const calls: Array<{ path: string; method: string; body?: string }> = [];
	const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const path = url.replace("https://discord.com/api/v10", "");
		calls.push({ path, method: init?.method ?? "GET", body: String(init?.body ?? "") });
		return {
			ok: true,
			status: 200,
			json: async () => ({ id: "sent-message-1" }),
		} as Response;
	};
	return { fetchImpl, calls };
}

afterEach(() => {
	vi.restoreAllMocks();
});

function makeBridge(overrides: Partial<ConstructorParameters<typeof DiscordBridge>[0]> = {}) {
	const { fetchImpl, calls } = createFetchMock();
	const prompts: string[] = [];
	const bridge = new DiscordBridge({
		token: "test-token",
		allowlist: ["channel-1"],
		userAllowlist: ["user-1"],
		prompt: async (text) => {
			prompts.push(text);
		},
		...overrides,
	});
	// Swap the global fetch used by rest().
	(globalThis as { fetch: typeof fetch }).fetch = fetchImpl as unknown as typeof fetch;
	return { bridge, calls, prompts, fetchImpl };
}

function assistantMessage(text: string, userPrompt: string) {
	return [
		{ role: "user" as const, content: [{ type: "text" as const, text: userPrompt }] },
		{
			role: "assistant" as const,
			content: [{ type: "text" as const, text }],
			stopReason: "end_turn",
		},
	];
}

describe("DiscordBridge", () => {
	it("prompts the session for allowed-channel messages and skips self/bots", async () => {
		const { bridge, calls, prompts } = makeBridge();
		const anyBridge = bridge as unknown as {
			handleMessage(message: unknown): Promise<void>;
			selfId?: string;
		};

		await anyBridge.handleMessage({
			id: "m1",
			channel_id: "channel-1",
			author: { id: "user-1", bot: false },
			content: "  hello there  ",
		});
		expect(prompts).toEqual(["hello there"]);
		expect(calls.some((call) => call.path === "/channels/channel-1/typing")).toBe(true);

		// Bot messages and messages from ourselves never prompt.
		await anyBridge.handleMessage({
			id: "m2",
			channel_id: "channel-1",
			author: { id: "bot-1", bot: true },
			content: "ignore me",
		});
		anyBridge.selfId = "me";
		await anyBridge.handleMessage({
			id: "m3",
			channel_id: "channel-1",
			author: { id: "me", bot: false },
			content: "ignore me too",
		});
		expect(prompts).toHaveLength(1);
	});

	it("requires both the channel and the sender to be allowlisted", async () => {
		const { bridge, prompts } = makeBridge();
		const anyBridge = bridge as unknown as { handleMessage(message: unknown): Promise<void> };
		await anyBridge.handleMessage({
			id: "m-unauthorized",
			channel_id: "channel-1",
			author: { id: "intruder" },
			content: "run a command",
		});
		expect(prompts).toHaveLength(0);
	});

	it("does not prompt for channels outside the allowlist", async () => {
		const { bridge, prompts } = makeBridge();
		const anyBridge = bridge as unknown as { handleMessage(message: unknown): Promise<void> };
		await anyBridge.handleMessage({
			id: "m1",
			channel_id: "channel-9",
			author: { id: "user-1" },
			content: "hello",
		});
		expect(prompts).toHaveLength(0);
	});

	it("forwards the response only to the channel whose turn just ended (provenance match)", async () => {
		const { bridge, calls, prompts } = makeBridge();
		const anyBridge = bridge as unknown as { handleMessage(message: unknown): Promise<void> };

		await anyBridge.handleMessage({
			id: "m1",
			channel_id: "channel-1",
			author: { id: "user-1" },
			content: "list the docs",
		});
		expect(prompts).toHaveLength(1);

		// Simulate the agent turn ending with the SAME last user text.
		await (
			bridge as unknown as { handleAgentEnd(messages: unknown[], willRetry: boolean): Promise<void> }
		).handleAgentEnd(assistantMessage("Here are the docs.", "list the docs"), false);

		const send = calls.find((call) => call.path.startsWith("/channels/channel-1/messages"));
		expect(send).toBeDefined();
		expect(JSON.parse(send!.body!).content).toContain("Here are the docs.");
	});

	it("delivers MEDIA markers as native Discord attachments", async () => {
		const { bridge, calls } = makeBridge();
		const dir = mkdtempSync(join(tmpdir(), "porcupine-discord-media-"));
		const file = join(dir, "report.txt");
		writeFileSync(file, "results");
		const anyBridge = bridge as unknown as {
			pendingDiscord: Array<{ channelId: string; userId: string; text: string }>;
		};
		anyBridge.pendingDiscord.push({ channelId: "channel-1", userId: "user-1", text: "send report" });
		await bridge.handleAgentEnd(assistantMessage(`Here it is\nMEDIA:${file}`, "send report") as never, false);
		expect(
			calls.some((call) => call.path === "/channels/channel-1/messages" && call.body === "[object FormData]"),
		).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});

	it("only accepts confirmation reactions from the active authorized user", async () => {
		const { bridge, calls } = makeBridge({ confirmTimeoutMs: 1_000 });
		const anyBridge = bridge as unknown as {
			activeChannelId?: string;
			activeUserId?: string;
			handleReaction(reaction: unknown): Promise<void>;
		};
		anyBridge.activeChannelId = "channel-1";
		anyBridge.activeUserId = "user-1";
		const confirmation = bridge.remoteConfirm("Run", "npm test");
		if (!confirmation) throw new Error("confirmation was not created");
		await new Promise((resolve) => setTimeout(resolve, 5));
		const confirmationMessage = calls.find(
			(call) => call.path === "/channels/channel-1/messages" && call.method === "POST",
		);
		expect(confirmationMessage).toBeDefined();

		await anyBridge.handleReaction({
			user_id: "intruder",
			message_id: "sent-message-1",
			channel_id: "channel-1",
			emoji: { name: "✅" },
		});
		const settled = await Promise.race([
			confirmation.then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
		]);
		expect(settled).toBe(false);

		await anyBridge.handleReaction({
			user_id: "user-1",
			message_id: "sent-message-1",
			channel_id: "channel-1",
			emoji: { name: "✅" },
		});
		expect(await confirmation).toBe(true);
	});

	it("scopes numbered selection reactions to the exact prompt message", async () => {
		let sentId = 0;
		const { bridge } = makeBridge();
		(globalThis as { fetch: typeof fetch }).fetch = (async () => {
			sentId++;
			return { ok: true, status: 200, json: async () => ({ id: `sent-${sentId}` }) } as Response;
		}) as typeof fetch;
		const anyBridge = bridge as unknown as {
			activeChannelId?: string;
			activeUserId?: string;
			handleReaction(reaction: unknown): Promise<void>;
		};
		anyBridge.activeChannelId = "channel-1";
		anyBridge.activeUserId = "user-1";
		const selection = bridge.select("Choose", ["One", "Two"], () => new Promise(() => {}));
		await new Promise((resolve) => setTimeout(resolve, 5));

		await anyBridge.handleReaction({
			user_id: "user-1",
			message_id: "some-other-message",
			channel_id: "channel-1",
			emoji: { name: "1️⃣" },
		});
		const settled = await Promise.race([
			selection.then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
		]);
		expect(settled).toBe(false);

		await anyBridge.handleReaction({
			user_id: "user-1",
			message_id: "sent-1",
			channel_id: "channel-1",
			emoji: { name: "1️⃣" },
		});
		expect(await selection).toBe("One");
	});

	it("uses Gateway RESUME after a reconnectable session instead of re-identifying", async () => {
		const { bridge } = makeBridge();
		const sent: Array<{ op: number; d: unknown }> = [];
		const anyBridge = bridge as unknown as {
			ws?: { send(data: string): void };
			sessionId?: string;
			sequence: number | null;
			handlePayload(payload: unknown): Promise<void>;
			stopHeartbeat(): void;
		};
		anyBridge.ws = {
			send(data) {
				sent.push(JSON.parse(data));
			},
		};

		await anyBridge.handlePayload({ op: 10, d: { heartbeat_interval: 60_000 } });
		expect(sent.some((payload) => payload.op === 2)).toBe(true);
		anyBridge.stopHeartbeat();

		sent.length = 0;
		anyBridge.sessionId = "gateway-session";
		anyBridge.sequence = 42;
		await anyBridge.handlePayload({ op: 10, d: { heartbeat_interval: 60_000 } });
		expect(sent.some((payload) => payload.op === 6)).toBe(true);
		expect(sent.some((payload) => payload.op === 2)).toBe(false);
		anyBridge.stopHeartbeat();
	});

	it("a retry turn is never forwarded", async () => {
		const { bridge, calls, prompts } = makeBridge();
		const anyBridge = bridge as unknown as { handleMessage(message: unknown): Promise<void> };
		await anyBridge.handleMessage({
			id: "m1",
			channel_id: "channel-1",
			author: { id: "user-1" },
			content: "fix the build",
		});
		expect(prompts).toHaveLength(1);

		await (
			bridge as unknown as { handleAgentEnd(messages: unknown[], willRetry: boolean): Promise<void> }
		).handleAgentEnd(assistantMessage("retrying…", "fix the build"), true);

		expect(calls.some((call) => call.path.startsWith("/channels/channel-1/messages"))).toBe(false);
	});
});
