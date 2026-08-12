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
});
