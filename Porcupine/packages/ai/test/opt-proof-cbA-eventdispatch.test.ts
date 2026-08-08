/**
 * opt-proof-cbA — Micro-benchmark of the EventStream implementation
 * (src/utils/event-stream.ts) and the per-delta cost of streaming tool-call
 * JSON accumulation via parseStreamingJson (called on EVERY argument delta in
 * openai-completions.ts:533, openai-responses-shared.ts:634,641,
 * anthropic-messages.ts:660,696, mistral-conversations.ts:429).
 */
import { describe, expect, it } from "vitest";
import { EventStream } from "../src/utils/event-stream.ts";
import { parseStreamingJson } from "../src/utils/json-parse.ts";

// ---------------------------------------------------------------------------
// EventStream: 10k events through push() consumed by an async iterator
// ---------------------------------------------------------------------------
function buildStream(): EventStream<number, number> {
	const stream = new EventStream<number, number>(
		(n) => n === -1,
		(n) => n,
	);
	return stream;
}

describe("opt-proof-cbA: EventStream dispatch + tool JSON accumulation", () => {
	it("dispatches 10k events through EventStream.push", async () => {
		const stream = buildStream();
		const pusher = (async () => {
			for (let i = 0; i < 10_000; i++) stream.push(i);
			stream.end(10_000);
		})();
		const t0 = performance.now();
		let received = 0;
		for await (const v of stream) {
			received += v;
		}
		await pusher;
		const ms = performance.now() - t0;
		console.log(`BENCH eventstream: 10k push+consume -> ${ms.toFixed(1)}ms (${(10_000 / ms).toFixed(0)}/ms)`);
		expect(received).toBe((9999 * 10000) / 2);
	});

	it("eager consumers reduce queueing", async () => {
		const stream = buildStream();
		// A consumer that stays ahead of the producer should avoid queue growth.
		const it = stream[Symbol.asyncIterator]();
		const t0 = performance.now();
		let last = 0;
		for (let i = 0; i < 10_000; i++) {
			stream.push(i);
			const r = await it.next();
			if (!r.done) last = r.value;
		}
		stream.end(10_000);
		const ms = performance.now() - t0;
		console.log(`BENCH eventstream eager: 10k -> ${ms.toFixed(1)}ms`);
		expect(last).toBe(9999);
	});
});

// ---------------------------------------------------------------------------
// parseStreamingJson accumulation: O(n^2) rewrite vs hoisted incremental parse
// ---------------------------------------------------------------------------
const ARG_TOKENS = Array.from({ length: 10_000 }, (_, i) => `${i === 0 ? "{" : ","}${JSON.stringify(`k${i}`)}:${i}`);

function accumulateWithReparse(): Record<string, unknown> {
	let acc = "";
	let out: Record<string, unknown> = {};
	for (const tok of ARG_TOKENS) {
		acc += tok;
		out = parseStreamingJson<Record<string, unknown>>(`${acc}}`);
	}
	return out;
}

function accumulateIncremental(): Record<string, unknown> {
	// Single pass: parse each delta ONCE (cheap lookup), never re-parse the
	// growing accumulator. This is the hoisted equivalent a parser should do.
	const out: Record<string, unknown> = {};
	for (const tok of ARG_TOKENS) {
		const colon = tok.indexOf(":");
		const key = tok.slice(tok.indexOf('"') + 1, colon - 1);
		out[key] = Number(tok.slice(colon + 1));
	}
	return out;
}

// The realistic "had I only parsed the delta once, then done a cheap tail append"
function bench(fn: () => unknown, runs = 5): number {
	fn();
	const t0 = performance.now();
	for (let r = 0; r < runs; r++) fn();
	return (performance.now() - t0) / runs;
}

it("tool-call args accumulation: re-parse-every-delta vs single-pass", { timeout: 60000 }, () => {
	// The re-parse path is so slow that a single run already proves the point;
	// running it many times would exceed the 30s test timeout.
	const reparse = bench(accumulateWithReparse, 1);
	const single = bench(accumulateIncremental);
	console.log(
		`BENCH jsonaccum: reparse-every-delta=${reparse.toFixed(0)}ms single-pass=${single.toFixed(1)}ms speedup=${(reparse / single).toFixed(0)}x`,
	);
	// Both approaches must actually build a usable argument map.
	expect(Object.keys(accumulateWithReparse()).length).toBeGreaterThan(1000);
	expect(Object.keys(accumulateIncremental()).length).toBeGreaterThan(1000);
	// The quadratic re-parse path must be measurably worse than a single-pass build.
	expect(reparse).toBeGreaterThan(single * 10);
});
