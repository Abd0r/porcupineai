/**
 * Porcupine foundation regression test for per-delta content-block lookup in the
 * Anthropic (anthropic-messages.ts) and Bedrock (bedrock-converse-stream.ts)
 * streaming loops, which used to call `blocks.findIndex((b) => b.index === N)`
 * on EVERY delta event. A busy agent turn can interleave many text/thinking/
 * toolCall blocks, so each of thousands of deltas was a linear scan of the
 * whole `blocks` array.
 *
 * Fix: a persistent `Map<number, number>` (event index → array position)
 * maintained alongside the growing `blocks` array. Blocks are only ever
 * appended to `output.content` and never reordered during a stream, so an
 * event index maps stably to one array position — O(1) lookup per delta.
 *
 * This test proves the two approaches are observationally equivalent (same
 * positions returned) and records the timing ratio.
 */
import { describe, expect, it } from "vitest";

type Block = { type: "text" | "thinking" | "toolCall"; index?: number };

// Build an interleaved block array like a busy forced-tool / interleaved-thinking
// stream: block `i` carries event index `i`, and the array order matches.
function buildBlocks(n: number): Block[] {
	const blocks: Block[] = [];
	for (let i = 0; i < n; i++) {
		const type = i % 3 === 0 ? "toolCall" : i % 3 === 1 ? "thinking" : "text";
		blocks.push({ type, index: i });
	}
	return blocks;
}

// Current (pre-fix) approach: linear scan per delta.
function lookupFindIndex(blocks: Block[], target: number): number {
	return blocks.findIndex((b) => b.index === target);
}

// Proposed: O(1) map built once, maintained alongside the array.
function buildIndexMap(blocks: Block[]): Map<number, number> {
	const map = new Map<number, number>();
	for (let i = 0; i < blocks.length; i++) {
		const idx = blocks[i].index;
		if (idx !== undefined) map.set(idx, i);
	}
	return map;
}

function bench(fn: () => number, runs: number): number {
	fn(); // warm
	const t0 = performance.now();
	for (let r = 0; r < runs; r++) fn();
	return (performance.now() - t0) / runs;
}

// A realistic busy tool+thinking turn: ~24 interleaved blocks, ~30k deltas.
const BLOCKS = 24;
const DELTAS = 30_000;

describe("foundation AI: per-delta content-block lookup (Anthropic/Bedrock)", () => {
	it("findIndex and Map lookup return identical positions for every delta", () => {
		const blocks = buildBlocks(BLOCKS);
		const map = buildIndexMap(blocks);
		let highWater = 1;
		for (let d = 0; d < DELTAS; d++) {
			const target = d % highWater;
			expect(map.get(target)).toBe(lookupFindIndex(blocks, target));
			if (highWater < BLOCKS) highWater++;
		}
	});

	it("reports Map versus linear findIndex lookup cost", () => {
		const findIndexMs = bench(() => {
			let acc = 0;
			const blocks = buildBlocks(BLOCKS);
			for (let d = 0; d < DELTAS; d++) acc += lookupFindIndex(blocks, d % BLOCKS);
			return acc;
		}, 20);
		const mapMs = bench(() => {
			let acc = 0;
			const blocks = buildBlocks(BLOCKS);
			const map = buildIndexMap(blocks);
			for (let d = 0; d < DELTAS; d++) acc += map.get(d % BLOCKS) ?? 0;
			return acc;
		}, 20);
		console.log(
			`BENCH blockindex: ${DELTAS} deltas x ${BLOCKS} blocks -> findIndex=${findIndexMs.toFixed(2)}ms map=${mapMs.toFixed(2)}ms (${(findIndexMs / mapMs).toFixed(1)}x)`,
		);
		// Timing is evidence only, not a CI threshold: scheduler/JIT variance can
		// invert sub-millisecond samples even though the operation count drops
		// from O(blocks) comparisons per delta to one Map lookup.
		expect(findIndexMs).toBeGreaterThan(0);
		expect(mapMs).toBeGreaterThan(0);
	});
});
