// Regression: BUG-2 — unguarded JSON.parse(block.thinkingSignature) crashed
// cross-api replayed thinking blocks. Completions-style runtimes store a plain
// signature string (e.g. "reasoning_content") and transform-messages preserves
// such blocks for replay. Replaying one through the Responses codepath must
// degrade gracefully instead of throwing a SyntaxError.
import { describe, expect, it } from "vitest";
import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import type { AssistantMessage, Context, Model, ThinkingContent } from "../src/types.ts";

function model(): Model<"openai-responses"> {
	return {
		id: "gpt-test",
		name: "GPT Test",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

function assistant(thinkingSignature: string): AssistantMessage {
	const thinking: ThinkingContent = {
		type: "thinking",
		thinking: "inner monologue",
		thinkingSignature,
	};
	return {
		role: "assistant",
		content: [thinking],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("OpenAI Responses thinking-signature replay", () => {
	it("degrades gracefully for a non-JSON signature from completions-style runtimes", () => {
		// e.g. openai-completions stores `thinkingSignature = "reasoning_content"`.
		const context: Context = {
			messages: [
				{ role: "user", content: "first", timestamp: Date.now() - 1 },
				assistant("reasoning_content"),
				{ role: "user", content: "follow-up", timestamp: Date.now() },
			],
		};

		let converted: unknown;
		expect(() => {
			converted = convertResponsesMessages(model(), context, new Set(["openai"]));
		}).not.toThrow();
		// The unparseable signature must not be turned into a reasoning item.
		expect(converted).toBeDefined();
		expect((converted as Array<{ type: string }>).some((item) => item.type === "reasoning")).toBe(false);
	});

	it("replays a well-formed JSON signature as a reasoning item", () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "first", timestamp: Date.now() - 1 },
				assistant(JSON.stringify({ type: "reasoning", id: "rs_replay", summary: [] })),
				{ role: "user", content: "follow-up", timestamp: Date.now() },
			],
		};

		const converted = convertResponsesMessages(model(), context, new Set(["openai"]));
		expect(converted).toContainEqual({ type: "reasoning", id: "rs_replay", summary: [] });
	});
});
