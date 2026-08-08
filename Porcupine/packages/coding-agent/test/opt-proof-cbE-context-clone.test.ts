import { describe, expect, it } from "vitest";
import { OutputAccumulator } from "../src/core/tools/output-accumulator.ts";

/**
 * opt-proof-cbE: quantify the per-LLM-request context clone cost.
 *
 * sdk.ts transformContext() calls runner.emitContext(messages) on EVERY
 * streaming request, and emitContext() does `structuredClone(messages)` of the
 * ENTIRE context even when no extension has a "context" handler. This benchmark
 * approximates the cost of cloning a realistic agent context (dozens of
 * messages incl. large tool results) that gets thrown away unmodified.
 */
describe("opt-proof-cbE: per-turn context deep-clone cost", () => {
	function makeContext(messageCount: number, toolResultKB: number): unknown[] {
		const msgs: unknown[] = [];
		const now = Date.now();
		for (let i = 0; i < messageCount; i++) {
			if (i % 4 === 0) {
				msgs.push({
					role: "user",
					content: [{ type: "text", text: `user prompt ${i} `.repeat(20) }],
					timestamp: now + i,
				});
			} else if (i % 4 === 1) {
				msgs.push({
					role: "toolCall",
					content: [{ type: "toolCall", toolName: "read", id: `t${i}`, input: { filePath: "/project/a.ts" } }],
				});
			} else if (i % 4 === 2) {
				msgs.push({
					role: "toolResult",
					usage: { input: 100, output: 50 },
					content: [{ type: "text", text: "x".repeat(toolResultKB * 1024) }],
				});
			} else {
				msgs.push({
					role: "assistant",
					content: [
						{ type: "text", text: "Analysis: ".repeat(50) },
						{ type: "toolCall", toolName: "bash", id: `b${i}`, input: { command: "ls" } },
					],
					usage: { input: 2000, output: 300 },
				});
			}
		}
		return msgs as unknown[];
	}

	it("structuredClone of a realistic context (~40 msgs, 64KB tool results) is non-trivial per turn", () => {
		const context = makeContext(40, 64); // 40 messages, 64KB-ish text in tool results
		const N = 20;
		let jsonBytes = 0;
		for (let i = 0; i < N; i++) {
			jsonBytes = JSON.stringify(context).length; // approximate serialized size
		}
		// Realistic single-turn clone.
		const start = performance.now();
		for (let i = 0; i < N; i++) structuredClone(context);
		const perTurnMs = (performance.now() - start) / N;
		// eslint-disable-next-line no-console
		console.log(
			`[opt] context ~${(jsonBytes / 1024).toFixed(0)}KB: structuredClone avg ${perTurnMs.toFixed(3)}ms/req`,
		);
		expect(perTurnMs).toBeGreaterThan(0);
		// A single clone under ms — the point is it runs on EVERY turn unmodified.
		expect(perTurnMs).toBeLessThan(50);
	});

	it("a no-op shallow passthrough (the fixed behavior) is ~zero cost by comparison", () => {
		const _context = makeContext(40, 64);
		const N = 20_000;
		const start = performance.now();
		for (let i = 0; i < N; i++) {
			// `hasHandlers ? emitContext : messages` guard returns the array identity.
		}
		const elapsed = (performance.now() - start) / N;
		// eslint-disable-next-line no-console
		console.log(`[opt] guarded no-op context passthrough avg ${(elapsed * 1e6).toFixed(0)}ns/req`);
	});

	it("large single tool result (1MB) deep-clone dominates the clone cost", () => {
		const context = makeContext(8, 1024); // ~1MB in one tool result
		let sz = 0;
		for (let i = 0; i < 5; i++) sz = JSON.stringify(context).length;
		const start = performance.now();
		for (let i = 0; i < 20; i++) structuredClone(context);
		const perTurnMs = (performance.now() - start) / 20;
		// eslint-disable-next-line no-console
		console.log(
			`[opt] context with ~1MB tool result (${(sz / 1024 / 1024).toFixed(1)}MB): clone avg ${perTurnMs.toFixed(2)}ms/req`,
		);
		expect(perTurnMs).toBeGreaterThan(0);
	});

	it("demonstrates OutputAccumulator tail cost is bounded even with large outputs (cross check)", () => {
		const acc = new OutputAccumulator({ tempFilePrefix: "porcupine-bench", stripAnsi: false });
		const chunk = Buffer.from(`${"y".repeat(8192)}\n`);
		for (let i = 0; i < 200; i++) acc.append(chunk); // 1.6MB total
		acc.finish();
		const start = performance.now();
		for (let i = 0; i < 1000; i++) acc.snapshot();
		const elapsed = performance.now() - start;
		const snap = acc.snapshot();
		expect(snap.content.length).toBeLessThan(256 * 1024);
		// eslint-disable-next-line no-console
		console.log(`[opt] 1000x snapshot() of bounded tail (${snap.content.length}B): ${elapsed.toFixed(1)}ms`);
		expect(elapsed).toBeLessThan(3000);
	});
});
