import { type AssistantMessage, EventStream, type Message, type Model } from "@porcupineai/ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.ts";

class MockAssistantStream extends EventStream<import("@porcupineai/ai").AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

function lazyTool(): AgentTool<typeof lazySchema, { value: string }> {
	return {
		name: "lazy_tool",
		label: "Lazy",
		description: "Lazily activated tool",
		parameters: lazySchema,
		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text", text: `lazy:${params.value}` }],
				details: { value: params.value },
			};
		},
	};
}

const lazySchema = Type.Object({ value: Type.String() });

function singleToolCallStream(toolName: string) {
	let callIndex = 0;
	return () => {
		const stream = new MockAssistantStream();
		queueMicrotask(() => {
			if (callIndex === 0) {
				stream.push({
					type: "done",
					reason: "toolUse",
					message: createAssistantMessage(
						[{ type: "toolCall", id: "tool-1", name: toolName, arguments: { value: "hello" } }],
						"toolUse",
					),
				});
			} else {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "done" }]),
				});
			}
			callIndex++;
		});
		return stream;
	};
}

function toolResultText(messages: AgentMessage[]): string {
	return messages
		.filter((m) => m.role === "toolResult")
		.flatMap((m) => {
			const content = (m as { content: Array<{ type: string; text?: string }> }).content ?? [];
			return content.filter((c) => c.type === "text").map((c) => c.text ?? "");
		})
		.join("\n");
}

describe("lazy unknown-tool resolution", () => {
	it("executes a tool returned by resolveUnknownTool", async () => {
		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			resolveUnknownTool: async () => ({ tool: lazyTool() }),
		};
		const events: AgentEvent[] = [];
		const stream = agentLoop(
			[createUserMessage("go")],
			context,
			config,
			undefined,
			singleToolCallStream("lazy_tool"),
		);
		for await (const event of stream) {
			events.push(event);
		}
		const messages = await stream.result();
		expect(toolResultText(messages)).toContain("lazy:hello");
		const end = events.find((e) => e.type === "tool_execution_end");
		expect(end?.type === "tool_execution_end" ? end.isError : undefined).toBe(false);
	});

	it("surfaces a resolver error message instead of executing", async () => {
		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			resolveUnknownTool: async () => ({ error: "Tool plan exists but needs explicit enablement." }),
		};
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, singleToolCallStream("plan"));
		for await (const _event of stream) {
			// drain
		}
		const messages = await stream.result();
		expect(toolResultText(messages)).toContain("needs explicit enablement");
	});

	it("keeps the generic not-found message when the resolver returns undefined", async () => {
		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			resolveUnknownTool: async () => undefined,
		};
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, singleToolCallStream("nope"));
		for await (const _event of stream) {
			// drain
		}
		const messages = await stream.result();
		expect(toolResultText(messages)).toContain("Tool nope not found");
	});

	it("fails closed to not-found when the resolver throws", async () => {
		const context: AgentContext = { systemPrompt: "", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			resolveUnknownTool: async () => {
				throw new Error("boom");
			},
		};
		const stream = agentLoop(
			[createUserMessage("go")],
			context,
			config,
			undefined,
			singleToolCallStream("lazy_tool"),
		);
		for await (const _event of stream) {
			// drain
		}
		const messages = await stream.result();
		expect(toolResultText(messages)).toContain("Tool lazy_tool not found");
	});
});
