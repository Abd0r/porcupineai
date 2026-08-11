/**
 * Tests for the shared truncation utilities in src/core/tools/truncate.ts.
 *
 * Part 1 (file-owned) hardening: verifies logMode raises the byte ceiling for
 * line-bounded content, truncateBytePrefix never splits a multi-byte UTF-8
 * codepoint, and that existing truncateHead callers are byte-identical when the
 * new opt-in options are absent.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BYTES, LOG_MODE_MAX_BYTES, truncateBytePrefix, truncateHead } from "../src/core/tools/truncate.ts";

describe("truncateBytePrefix", () => {
	it("returns the full string when it fits within maxBytes", () => {
		const content = "hello world";
		expect(truncateBytePrefix(content, 1000)).toBe(content);
	});

	it("returns empty for a non-positive budget", () => {
		expect(truncateBytePrefix("abc", 0)).toBe("");
		expect(truncateBytePrefix("abc", -5)).toBe("");
	});

	it("gives an ASCII-safe prefix without splitting ASCII", () => {
		expect(truncateBytePrefix("hello world", 6)).toBe("hello ");
		expect(truncateBytePrefix("hello world", 7)).toBe("hello w");
		expect(truncateBytePrefix("hello world", 5)).toBe("hello");
	});

	it("never splits a multi-byte emoji codepoint", () => {
		// '🚀' is 4 bytes in UTF-8; '🔥' is 4 bytes.
		const content = "ab🚀cd";
		const bytes = Buffer.byteLength(content, "utf-8");
		expect(bytes).toBe(8); // 1*2 + 4 + 1*2
		// Asking for 3 bytes (which would cut inside the 4-byte 🚀) must drop it.
		expect(truncateBytePrefix(content, 3)).toBe("ab");
		// Asking for 6 bytes lands exactly at the end of 🚀 (before 'c').
		expect(truncateBytePrefix(content, 6)).toBe("ab🚀");
	});

	it("never splits a 3-byte emoji codepoint", () => {
		const content = "💻x"; // 💻 is 4 bytes
		expect(truncateBytePrefix(content, 4)).toBe("💻");
		expect(truncateBytePrefix(content, 2)).toBe("");
		const three = "☕"; // U+2615 is 3 bytes
		expect(truncateBytePrefix(three, 1)).toBe("");
		expect(truncateBytePrefix(three, 2)).toBe("");
		expect(truncateBytePrefix(three, 3)).toBe(three);
	});

	it("never splits South Asian (Devanagari) multi-byte text", () => {
		// 'नमस्ते' is Devanagari; each Devanagari letter is 3 bytes in UTF-8.
		const content = "नमस्ते";
		expect(Buffer.byteLength(content, "utf-8")).toBe(18); // 6 glyphs * 3 bytes
		for (let budget = 0; budget < 20; budget++) {
			const prefix = truncateBytePrefix(content, budget);
			const resultBytes = Buffer.byteLength(prefix, "utf-8");
			// Never exceeds the budget and the unit never splits a codepoint
			// (every non-empty prefix byte length is a multiple of 3).
			expect(resultBytes).toBeLessThanOrEqual(budget);
			expect(resultBytes % 3).toBe(0);
		}
	});

	it("never splits a multi-byte char (round-trip validity check)", () => {
		const content = "aनमः🚀b𝄞c"; // mixed ASCII + Devanagari + emoji + music (4-byte)
		for (let budget = 1; budget <= Buffer.byteLength(content, "utf-8"); budget++) {
			const prefix = truncateBytePrefix(content, budget);
			const prefixBytes = Buffer.byteLength(prefix, "utf-8");
			expect(prefixBytes).toBeLessThanOrEqual(budget);
			// Re-decoding the prefix never yields U+FFFD replacement chars, which
			// would indicate a split codepoint / corrupted prefix.
			expect(prefix).not.toContain("\uFFFD");
		}
	});
});

describe("truncateHead logMode", () => {
	const logLine = (len: number) => "x".repeat(len);

	it("is byte-identical to a no-op passthrough when no options are passed (regression guard)", () => {
		const content = Array.from({ length: 5 }, (_v, i) => `line ${i}`).join("\n");
		const withDefault = truncateHead(content, {});
		expect(withDefault.content).toBe(content);
		expect(withDefault.truncated).toBe(false);
		expect(withDefault.truncatedBy).toBeNull();
		expect(withDefault.maxBytes).toBe(DEFAULT_MAX_BYTES);
	});

	it("keeps default byte behavior when logMode is absent (matches old byte cap)", () => {
		// A single line that is larger than the default 50KB byte cap but small
		// enough that logMode would still only keep whole lines.
		const line = logLine(DEFAULT_MAX_BYTES + 1000);
		const normal = truncateHead(line, {});
		const log = truncateHead(line, { logMode: true });
		// Without logMode the first line alone exceeds the cap -> empty.
		expect(normal.content).toBe("");
		expect(normal.firstLineExceedsLimit).toBe(true);
		expect(normal.truncatedBy).toBe("bytes");
		// With logMode the effective byte cap rises so the line now fits whole.
		expect(log.firstLineExceedsLimit).toBe(false);
		expect(log.content).toBe(line);
		expect(log.truncated).toBe(false);
	});

	it("raises the effective byte ceiling for many line-bounded log lines", () => {
		// 200 lines * 2KB = ~400KB of log lines. Without logMode the byte cap
		// (50KB) cuts many lines, well short of the 2000-line limit.
		const content = Array.from({ length: 200 }, () => logLine(2000)).join("\n");
		const normal = truncateHead(content);
		const log = truncateHead(content, { logMode: true });
		// Default: ~50KB cap => roughly 25 lines.
		expect(normal.outputLines).toBeLessThan(30);
		expect(normal.truncatedBy).toBe("bytes");
		// logMode: 128KB cap with 2KB lines => ~64 lines.
		expect(log.outputLines).toBeGreaterThan(60);
		expect(log.outputBytes).toBeLessThanOrEqual(LOG_MODE_MAX_BYTES);
		expect(log.truncatedBy).toBe("bytes");
	});

	it("logMode takes effect even when an explicit smaller maxBytes is passed", () => {
		const content = Array.from({ length: 10 }, () => logLine(100)).join("\n");
		const log = truncateHead(content, { logMode: true, maxBytes: 500 });
		// Under logMode the effective ceiling is the max of the explicit
		// maxBytes and LOG_MODE_MAX_BYTES, so a tiny explicit cap cannot shrink
		// the generous log budget.
		expect(log.maxBytes).toBe(LOG_MODE_MAX_BYTES);
		expect(Buffer.byteLength(content, "utf-8")).toBe(1009);
		expect(log.content).toBe(content);
	});

	it("surfaces the effective logMode byte cap in maxBytes", () => {
		const small = truncateHead("abc\n", { logMode: true });
		expect(small.maxBytes).toBe(LOG_MODE_MAX_BYTES);
		const without = truncateHead("abc\n", {});
		expect(without.maxBytes).toBe(DEFAULT_MAX_BYTES);
	});
});
