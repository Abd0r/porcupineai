/**
 * keepRecentTail — a single message that alone exceeds the keep-recent budget
 * must be truncated (capped) to the budget rather than injected whole, so a
 * compacted sub-agent context cannot land above the compaction headroom.
 */
import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/harness/compaction/compaction.ts";
import { keepRecentTail } from "../src/porcupine/subagent.ts";
import type { AgentMessage } from "../src/types.ts";

function title() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function user(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistant(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "mock",
		provider: "mock",
		model: "mock",
		usage: title(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("keepRecentTail oversized single message", () => {
	it("truncates a single message that alone exceeds the budget", () => {
		const maxContextTokens = 256_000;
		// budget == headroom == 51_200 tokens, so ~204_800 chars fit. One message
		// well over that must be truncated, not returned whole.
		const huge = assistant("x".repeat(600_000)); // ~150k tokens
		const tail = keepRecentTail([user("small"), huge], maxContextTokens);
		expect(tail).toHaveLength(1);
		expect(tail[0]).not.toBe(huge); // a truncated copy, not the original
		const first = tail[0]!;
		const content = "content" in first ? first.content : [];
		const text = (Array.isArray(content) ? content : []).reduce(
			(acc: string, part) => acc + ((part as { text?: string }).text ?? ""),
			"",
		);
		expect(text.length).toBeGreaterThan(0);
		expect(estimateTokens(tail[0]!)).toBeLessThanOrEqual(51_200);
	});

	it("leaves an in-budget tail untouched", () => {
		const a = user("a");
		const b = assistant("b");
		const tail = keepRecentTail([a, b], 256_000);
		expect(tail).toEqual([a, b]);
	});
});
