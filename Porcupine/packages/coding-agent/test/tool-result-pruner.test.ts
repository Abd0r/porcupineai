import { describe, expect, test } from "vitest";
import {
	DEFAULT_PRUNE_HEAD_CHARS,
	DEFAULT_PRUNE_TAIL_CHARS,
	DEFAULT_PRUNE_THRESHOLD_CHARS,
	pruneToolResultContent,
} from "../src/porcupine/tool-result-pruner.ts";

function textBlock(text: string) {
	return { type: "text", text };
}

describe("tool result pruner (dsh lesson 11)", () => {
	test("no-op below threshold", () => {
		const content = [textBlock("short result")];
		const result = pruneToolResultContent(content);
		expect(result.pruned).toBe(false);
		expect(content[0]).toEqual(textBlock("short result"));
	});

	test("single block over threshold becomes head + marker + tail", () => {
		const big = "a".repeat(DEFAULT_PRUNE_THRESHOLD_CHARS + 100);
		const content = [textBlock(big)];
		const result = pruneToolResultContent(content);
		expect(result.pruned).toBe(true);
		const text = (content[0] as { text: string }).text;
		expect(text.startsWith("a".repeat(DEFAULT_PRUNE_HEAD_CHARS))).toBe(true);
		expect(text.endsWith("a".repeat(DEFAULT_PRUNE_TAIL_CHARS))).toBe(true);
		expect(text).toContain("truncated:");
		expect(result.removedChars).toBeGreaterThan(0);
	});

	test("deterministic: same input, same output", () => {
		const big = "b".repeat(DEFAULT_PRUNE_THRESHOLD_CHARS + 50);
		const a = [textBlock(big)];
		const b = [textBlock(big)];
		pruneToolResultContent(a);
		pruneToolResultContent(b);
		expect((a[0] as { text: string }).text).toBe((b[0] as { text: string }).text);
	});

	test("non-text blocks are preserved", () => {
		const image = { type: "image", url: "x" };
		const big = "c".repeat(DEFAULT_PRUNE_THRESHOLD_CHARS + 10);
		const content = [image, textBlock(big)];
		const result = pruneToolResultContent(content);
		expect(result.pruned).toBe(true);
		expect(content[0]).toEqual(image);
	});

	test("multi-block content keeps head window, marker, tail window", () => {
		const half = DEFAULT_PRUNE_THRESHOLD_CHARS; // each block alone is under threshold
		const content = [textBlock("h".repeat(half)), textBlock("m".repeat(half)), textBlock("t".repeat(half))];
		const result = pruneToolResultContent(content);
		expect(result.pruned).toBe(true);
		const joined = content.map((b) => (b as { text?: string }).text ?? "").join("");
		expect(joined).toContain("truncated:");
		expect(joined.startsWith("h".repeat(DEFAULT_PRUNE_HEAD_CHARS))).toBe(true);
		expect(joined.endsWith("t".repeat(DEFAULT_PRUNE_TAIL_CHARS))).toBe(true);
		// The middle block was dropped.
		expect(joined).not.toContain("m".repeat(100));
	});

	test("custom budgets are honored", () => {
		const big = "d".repeat(1000);
		const content = [textBlock(big)];
		pruneToolResultContent(content, { thresholdChars: 100, headChars: 50, tailChars: 20 });
		const text = (content[0] as { text: string }).text;
		expect(text.startsWith("d".repeat(50))).toBe(true);
		expect(text.endsWith("d".repeat(20))).toBe(true);
	});

	test("empty content is a no-op", () => {
		const result = pruneToolResultContent([]);
		expect(result.pruned).toBe(false);
	});

	test("pruning never marks an error: result has no isError", () => {
		const big = "e".repeat(DEFAULT_PRUNE_THRESHOLD_CHARS + 5);
		const content = [textBlock(big)];
		const result = pruneToolResultContent(content);
		expect(result.pruned).toBe(true);
		expect("isError" in result).toBe(false);
	});
});
