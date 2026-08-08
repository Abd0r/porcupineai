import { describe, expect, it } from "vitest";
import { OutputAccumulator } from "../src/core/tools/output-accumulator.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

/**
 * opt-proof-cbE: output-accumulator append cost on a ~1MB streamed output
 * (the bash tool hot path) and stripAnsi cost on large inputs.
 */
describe("opt-proof-cbE: output-accumulator append cost", () => {
	/** Simulate ~1MB of streamed process output arriving in 4KB chunks. */
	function makeChunks(totalBytes = 1 << 20, _chunkSize = 4096): Buffer[] {
		const chunks: Buffer[] = [];
		let written = 0;
		let n = 0;
		while (written < totalBytes) {
			const line = `line ${n} ${"x".repeat(Math.min(1024, totalBytes - written))}\n`;
			const buf = Buffer.from(line, "utf-8");
			chunks.push(buf);
			written += buf.length;
			n++;
		}
		return chunks;
	}

	it("appending 1MB in 4KB chunks stays within bounded memory and is fast", () => {
		const chunks = makeChunks();
		const acc = new OutputAccumulator({ tempFilePrefix: "porcupine-bench", stripAnsi: true });
		const start = performance.now();
		for (const chunk of chunks) acc.append(chunk);
		acc.finish();
		const elapsed = performance.now() - start;
		const snap = acc.snapshot();
		// Bounded tail memory: output is 1MB but only a rolling tail is kept.
		expect(snap.content.length).toBeLessThan(256 * 1024);
		expect(snap.truncation.truncated).toBe(true);
		// 1MB append should not exceed a few ms.
		expect(elapsed).toBeLessThan(1000);
		// eslint-disable-next-line no-console
		console.log(`[opt] 1MB OutputAccumulator append+snapshot: ${elapsed.toFixed(2)}ms, tail=${snap.content.length}B`);
	});

	it("stripAnsi fast-paths (no ESC/CSI) with no regex allocation on plain output", () => {
		// 1MB of plain text with no ANSI introducers: stripAnsi must return the
		// string unchanged via the includes() fast path, not run the regex.
		const plain = "x".repeat(1_100_000);
		expect(plain.length).toBeGreaterThan(1_000_000);
		const start = performance.now();
		const out = stripAnsi(plain);
		const elapsed = performance.now() - start;
		expect(out).toBe(plain);
		expect(elapsed).toBeLessThan(100);
		// eslint-disable-next-line no-console
		console.log(`[opt] stripAnsi 1MB plain-text fast path: ${elapsed.toFixed(2)}ms`);
	});

	it("stripAnsi strips 50k ANSI sequences in a large string in bounded time", () => {
		// Worst case: many CSI sequences interleaved with text (~200KB).
		const seq = "\u001b[31m";
		const corpus = seq + "text".repeat(10_000) + seq; // ~90k chars with CSI
		const start = performance.now();
		const out = stripAnsi(corpus);
		const elapsed = performance.now() - start;
		expect(out).not.toContain("\u001b");
		expect(elapsed).toBeLessThan(500);
		// eslint-disable-next-line no-console
		console.log(`[opt] stripAnsi CSI-heavy ~90KB: ${elapsed.toFixed(2)}ms`);
	});
});
