import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/api/transform-messages.ts";
import type { AssistantMessage, Message, Model, ToolCall } from "../src/types.ts";

// A provider rejects the whole request when a `tool` message does not directly follow the assistant message
// carrying the matching `tool_calls`. These tests pin the adjacency guarantee for the cases that used to break
// it: a message of another role injected mid-exchange, and a tool result whose parent turn was dropped.

function makeModel(): Model<"openai-completions"> {
	return {
		id: "deepseek-v4.1-flash",
		name: "DeepSeek V4.1 Flash",
		api: "openai-completions",
		provider: "opencode-go",
		baseUrl: "https://api.example.test",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

function assistantWithCall(id: string, name = "bash"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: { command: "ls" } }] as ToolCall[],
		api: "openai-completions",
		provider: "opencode-go",
		model: "deepseek-v4.1-flash",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function user(text: string): Message {
	return { role: "user", content: text, timestamp: Date.now() };
}

/** Assert the invariant every provider enforces: each tool result directly follows its assistant call. */
function expectAdjacency(messages: Message[]): void {
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role !== "toolResult") continue;
		let previous = i - 1;
		// Consecutive results for a multi-call turn are fine as long as the run starts after the assistant.
		while (previous >= 0 && messages[previous].role === "toolResult") previous--;
		expect(previous).toBeGreaterThanOrEqual(0);
		const parent = messages[previous];
		expect(parent.role).toBe("assistant");
		if (parent.role !== "assistant" || !Array.isArray(parent.content)) return;
		const ids = new Set(
			parent.content.filter((block): block is ToolCall => block.type === "toolCall").map((call) => call.id),
		);
		// The whole run of results must belong to that assistant message.
		for (let j = previous + 1; j <= i; j++) {
			const result = messages[j];
			if (result.role !== "toolResult") continue;
			expect(ids.has(result.toolCallId)).toBe(true);
		}
	}
}

describe("tool call and result adjacency", () => {
	it("keeps a result attached when a custom message is injected mid-exchange", () => {
		const messages: Message[] = [
			user("go"),
			assistantWithCall("call_1"),
			{ role: "user", content: "[surface switch] web -> none", timestamp: Date.now() },
			{
				role: "toolResult",
				toolCallId: "call_1",
				toolName: "bash",
				content: [{ type: "text", text: "ok" }],
				isError: false,
				timestamp: Date.now(),
			},
		];
		const output = transformMessages(messages, makeModel());
		expectAdjacency(output);
		// The real result survives; it is not replaced by a synthesized placeholder.
		const result = output.find((message) => message.role === "toolResult");
		expect(result && result.role === "toolResult" ? result.isError : true).toBe(false);
	});

	it("drops a result whose parent assistant turn was dropped", () => {
		const aborted: AssistantMessage = { ...assistantWithCall("call_2"), stopReason: "aborted" };
		const messages: Message[] = [
			user("go"),
			aborted,
			{
				role: "toolResult",
				toolCallId: "call_2",
				toolName: "bash",
				content: [{ type: "text", text: "late" }],
				isError: false,
				timestamp: Date.now(),
			},
			user("again"),
		];
		const output = transformMessages(messages, makeModel());
		expectAdjacency(output);
		expect(output.some((message) => message.role === "toolResult")).toBe(false);
	});

	it("synthesizes a missing result before a following exchange", () => {
		const messages: Message[] = [user("go"), assistantWithCall("call_3"), assistantWithCall("call_4")];
		const output = transformMessages(messages, makeModel());
		expectAdjacency(output);
		const synthetic = output.filter((message) => message.role === "toolResult");
		// one placeholder closes call_3 before the next turn, one closes the trailing call_4
		expect(synthetic.length).toBe(2);
		const ids = synthetic.map((message) => (message.role === "toolResult" ? message.toolCallId : null));
		expect(ids).toEqual(["call_3", "call_4"]);
		expect(synthetic.every((message) => message.role === "toolResult" && message.isError)).toBe(true);
		// the placeholder sits before the next assistant turn, so that turn keeps its own calls
		const lastAssistant = output.findIndex(
			(message) =>
				message.role === "assistant" &&
				Array.isArray(message.content) &&
				message.content.some((block) => block.type === "toolCall" && block.id === "call_4"),
		);
		expect(lastAssistant).toBeGreaterThan(output.indexOf(synthetic[0]));
	});

	it("holds an injected message until the exchange closes, then releases it", () => {
		const messages: Message[] = [
			user("go"),
			assistantWithCall("call_5"),
			{ role: "user", content: "[hook] note", timestamp: Date.now() },
			{
				role: "toolResult",
				toolCallId: "call_5",
				toolName: "bash",
				content: [{ type: "text", text: "done" }],
				isError: false,
				timestamp: Date.now(),
			},
			user("next"),
		];
		const output = transformMessages(messages, makeModel());
		expectAdjacency(output);
		const noteIndex = output.findIndex(
			(message) => message.role === "user" && String(message.content).includes("[hook] note"),
		);
		const resultIndex = output.findIndex((message) => message.role === "toolResult");
		expect(resultIndex).toBeGreaterThan(-1);
		expect(noteIndex).toBeGreaterThan(resultIndex);
	});
});
