import { describe, expect, it } from "vitest";
import { IMessageBridge } from "../src/porcupine/imessage-bridge.ts";

function makeBridge(overrides: Partial<ConstructorParameters<typeof IMessageBridge>[0]> = {}) {
	const prompts: string[] = [];
	const bridge = new IMessageBridge({
		allowlist: ["iMessage;-;+15551234567"],
		prompt: async (text) => {
			prompts.push(text);
		},
		...overrides,
	});
	return { bridge, prompts };
}

function internals(bridge: IMessageBridge): {
	handleIncoming(chatId: string, text: string, sender: string): Promise<void>;
	pollChatInner(chatId: string): Promise<void>;
	fetchChatMessages(chatId: string): Promise<Array<{ id: string; text: string; sender: string; fromMe: boolean }>>;
	activeChatId?: string;
	activeSender?: string;
} {
	return bridge as unknown as ReturnType<typeof internals>;
}

describe("IMessageBridge actor authorization", () => {
	it("establishes a startup cursor and processes only newly arrived messages", async () => {
		const { bridge, prompts } = makeBridge();
		const state = internals(bridge);
		let messages = [
			{ id: "old-1", text: "old task", sender: "+15551234567", fromMe: false },
			{ id: "old-2", text: "old task 2", sender: "+15551234567", fromMe: false },
		];
		state.fetchChatMessages = async () => messages;
		await state.pollChatInner("iMessage;-;+15551234567");
		expect(prompts).toEqual([]);

		messages = [...messages, { id: "new-1", text: "new task", sender: "+15551234567", fromMe: false }];
		await state.pollChatInner("iMessage;-;+15551234567");
		expect(prompts).toEqual(["new task"]);
	});

	it("infers the authorized sender for a direct iMessage chat", async () => {
		const { bridge, prompts } = makeBridge();
		await internals(bridge).handleIncoming("iMessage;-;+15551234567", "hello", "+15551234567");
		expect(prompts).toEqual(["hello"]);
	});

	it("requires an explicit sender allowlist for group chats", async () => {
		const groupChat = "iMessage;+;chat123456";
		const denied = makeBridge({ allowlist: [groupChat] });
		await internals(denied.bridge).handleIncoming(groupChat, "run this", "+15559876543");
		expect(denied.prompts).toEqual([]);

		const allowed = makeBridge({ allowlist: [groupChat], senderAllowlist: ["+15559876543"] });
		await internals(allowed.bridge).handleIncoming(groupChat, "run this", "+15559876543");
		expect(allowed.prompts).toEqual(["run this"]);
	});

	it("does not let another group participant answer a confirmation", async () => {
		const groupChat = "iMessage;+;chat123456";
		const { bridge } = makeBridge({ allowlist: [groupChat], senderAllowlist: ["+15559876543"] });
		internals(bridge).activeChatId = groupChat;
		internals(bridge).activeSender = "+15559876543";
		const confirmation = bridge.remoteConfirm("Run", "npm test");
		if (!confirmation) throw new Error("confirmation was not created");

		await internals(bridge).handleIncoming(groupChat, "APPROVE", "+15550000000");
		const settled = await Promise.race([
			confirmation.then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
		]);
		expect(settled).toBe(false);

		await internals(bridge).handleIncoming(groupChat, "APPROVE", "+15559876543");
		expect(await confirmation).toBe(true);
	});

	it("cancels a remote confirmation when its signal aborts", async () => {
		const { bridge } = makeBridge({ confirmTimeoutMs: 60_000 });
		const state = internals(bridge);
		state.activeChatId = "iMessage;-;+15551234567";
		state.activeSender = "+15551234567";
		(bridge as unknown as { sendText: (chatId: string, text: string) => Promise<void> }).sendText = async () => {};
		const controller = new AbortController();
		const confirmation = bridge.remoteConfirm("Run", "npm test", { signal: controller.signal });
		if (!confirmation) throw new Error("confirmation was not created");
		controller.abort();
		expect(await confirmation).toBe(false);
	});

	it("does not re-ingest its own sent texts as new prompts", async () => {
		const chat = "iMessage;-;+15551234567";
		const sender = "+15551234567";
		const { bridge, prompts } = makeBridge();
		// A real send records the chunk for the echo guard even when osascript
		// itself is unavailable (send failure is caught inside sendText).
		await bridge.sendText(chat, "bridge reply");
		await internals(bridge).handleIncoming(chat, "bridge reply", sender);
		expect(prompts).toEqual([]);
		// Consume-once: a later identical user message still prompts.
		await internals(bridge).handleIncoming(chat, "bridge reply", sender);
		expect(prompts).toEqual(["bridge reply"]);
	});

	it("names media files instead of dropping them silently", async () => {
		const { bridge } = makeBridge();
		const sent: string[] = [];
		(bridge as unknown as { sendText: (chat: string, text: string) => Promise<void> }).sendText = async (
			_chat,
			text,
		) => {
			sent.push(text);
		};
		const state = internals(bridge) as unknown as {
			pendingMessages: Array<{ chatId: string; sender?: string; text: string }>;
			handleAgentEnd(messages: unknown[], willRetry: boolean): Promise<void>;
		};
		state.pendingMessages.push({ chatId: "iMessage;-;+15551234567", sender: "+15551234567", text: "send report" });
		await state.handleAgentEnd(
			[
				{ role: "user", content: [{ type: "text", text: "send report" }] },
				{ role: "assistant", content: [{ type: "text", text: "Here it is:\nMEDIA:/tmp/report.txt" }] },
			] as never,
			false,
		);
		expect(sent).toContain("Here it is:");
		expect(sent).toContain("📎 File ready: /tmp/report.txt");
	});

	it("dispatches remote slash commands without starting a prompt turn", async () => {
		const dispatch = async (commandLine: string) => ({ kind: "text" as const, text: `EXEC:${commandLine}` });
		const { bridge, prompts } = makeBridge({ dispatch });
		const sent: string[] = [];
		(bridge as unknown as { sendText: (chat: string, text: string) => Promise<void> }).sendText = async (
			_chat,
			text,
		) => {
			sent.push(text);
		};
		await internals(bridge).handleIncoming("iMessage;-;+15551234567", "/task list", "+15551234567");
		expect(prompts).toEqual([]);
		expect(sent).toEqual(["EXEC:/task list"]);
	});

	it("declines lifecycle slash commands with a terminal pointer", async () => {
		const dispatch = async () => ({
			kind: "declined" as const,
			text: "/refresh is not available remotely — run it in the Porcupine terminal.",
		});
		const { bridge } = makeBridge({ dispatch });
		const sent: string[] = [];
		(bridge as unknown as { sendText: (chat: string, text: string) => Promise<void> }).sendText = async (
			_chat,
			text,
		) => {
			sent.push(text);
		};
		await internals(bridge).handleIncoming("iMessage;-;+15551234567", "/refresh", "+15551234567");
		expect(sent.join("\n")).toContain("terminal");
	});
});
