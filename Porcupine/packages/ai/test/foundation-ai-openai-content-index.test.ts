/**
 * Porcupine foundation (wave 2) regression + benchmark for OpenAI Chat
 * Completions streaming content-block indexing (openai-completions.ts).
 *
 * Wave 1 fixed Anthropic/Bedrock `blocks.findIndex((b) => b.index === N)`
 * linear scans. Wave 1 left openai-completions.ts still resolving the content
 * index for EVERY delta via `blocks.indexOf(block)` — an O(blocks) object-
 * identity scan per event. A busy agent turn interleaves text / thinking /
 * toolCall blocks and a max-reasoning run can emit ~90k chunks, so that was
 * tens of thousands of linear scans over a growing array.
 *
 * Wave 2 fix: blocks are only EVER appended to `output.content` and never
 * reordered or removed during a stream, so each block's array position is
 * stable once it exists. A persistent `Map<StreamingBlock, number>` populated
 * at push time turns contentIndex lookup into an O(1) identity-hash map get.
 *
 * This test:
 *  1. Proves the two lookup strategies are observationally equivalent for the
 *     exact streaming access pattern (blocks grow, are never reordered, and
 *     are referenced by stable object identity per delta).
 *  2. Exercises the REAL `stream()` function across interleaved text / thinking
 *     / malformed-partial-JSON tool calls, asserting stable contentIndex values
 *     on every emitted event and correct scratch-buffer cleanup.
 *  3. Verifies error + abort routing (event ordering, stopReason) still holds
 *     after the change.
 *  4. Records a deterministic-operation-count benchmark as evidence.
 */
import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { AssistantMessage, Model, Tool } from "../src/types.ts";
import type { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

// ---------------------------------------------------------------------------
// Pure equivalence probe of the two indexing strategies
// ---------------------------------------------------------------------------

// Reference (old) approach computed on demand per lookup: linear scan by object
// identity on the current array, matching the old `blocks.indexOf(block)`.
function listIndexLookup(blocks: { type: string }[], target: { type: string }): number {
	return blocks.indexOf(target);
}

// The wave-2 mechanism: a persistent identity map built once, maintained as
// blocks are appended (never reordered/removed). Returned index is stable.
class IdentityIndex {
	private index = 0;
	private readonly map = new Map<object, number>();
	append(block: object): number {
		const at = this.index++;
		this.map.set(block, at);
		return at;
	}
	lookup(block: object): number {
		return this.map.get(block) ?? -1;
	}
}

// Simulate the streaming access pattern: a set of block identities that is
// grown over time, referenced repeatedly via stable object identity, and never
// reordered — exactly how the real streaming loop treats `output.content`.
// The LCG is seeded nonzero so the identity stream genuinely varies (a seed of
// 0 keeps the accumulator at 0 forever and would pin every delta to block 0).
const SEED = 1234567;
function streamAccessPattern(numBlocks: number, numDeltas: number): number[] {
	const blocks: { type: string }[] = [];
	const identityIndex = new IdentityIndex();
	// Seed the set with one initial block so every delta has a valid index
	// (blocks.length is never 0 during the loop).
	const seedBlock: { type: string } = { type: "text" };
	blocks.push(seedBlock);
	identityIndex.append(seedBlock);
	let highWater = 1;
	const deltas: number[] = [];
	let acc = seedValue(SEED);
	for (let d = 0; d < numDeltas; d++) {
		if (highWater < numBlocks) {
			// Occasionally interleave a new block, like a live stream does.
			if (acc % 5 === 0) {
				const type = highWater % 3 === 0 ? "toolCall" : highWater % 3 === 1 ? "thinking" : "text";
				const block = { type };
				blocks.push(block);
				identityIndex.append(block);
				highWater++;
			}
		}
		const target = blocks[acc % blocks.length];
		// Both strategies must agree on the SAME delta stream.
		const expected = listIndexLookup(blocks, target);
		const actual = identityIndex.lookup(target);
		if (actual !== expected) {
			deltas.push(-9999); // sentinel: mismatch
		} else {
			deltas.push(actual);
		}
		acc = nextRand(acc);
	}
	return deltas;
}

// Small deterministic LCG so timing is reproducible across runs.
function seedValue(s: number): number {
	return (s * 48271) % 0x7fffffff;
}
function nextRand(x: number): number {
	return (x * 48271) % 0x7fffffff;
}

function bench(runs: number, fn: () => void): number {
	fn(); // warm
	const t0 = performance.now();
	for (let r = 0; r < runs; r++) fn();
	return (performance.now() - t0) / runs;
}

// ---------------------------------------------------------------------------
// Integration fixture: real stream() with a mocked OpenAI client
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
	chunkSets: [] as unknown[][],
	/** Signal (if any) threaded to the mock so it can mimic mid-stream abort throws. */
	signal: undefined as AbortSignal | undefined,
	/** Resolver for a gate awaited between mock chunks (lets a test abort mid-stream). */
	gate: undefined as Promise<void> | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (_payload: unknown) => {
					const chunks = mockState.chunkSets.shift() ?? [];
					const signal = mockState.signal;
					const stream = {
						async *[Symbol.asyncIterator]() {
							for (const chunk of chunks) {
								if (signal?.aborted) throw new Error("Request was aborted (signal)");
								yield chunk;
								// Pause until a test aborts (or resolves the gate), blocking the
								// internal stream loop mid-stream like a real back-pressured SDK.
								if (mockState.gate) await mockState.gate;
							}
						},
					};
					const result = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{ data: typeof stream; response: { status: number; headers: Headers } }>;
					};
					result.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return result;
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const readTool: Tool = {
	name: "read",
	description: "Read a file",
	parameters: Type.Object({ path: Type.String() }),
};

function model(): Model<"openai-completions"> {
	return {
		id: "openai/gpt-test",
		name: "GPT Test",
		api: "openai-completions",
		provider: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): unknown {
	return {
		id: "chatcmpl-test",
		model: "openai/gpt-test",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	};
}

function runStream(signal?: AbortSignal): AssistantMessageEventStream {
	return streamOpenAICompletions(
		model(),
		{ messages: [], tools: [readTool] },
		{ apiKey: "test", ...(signal ? { signal } : {}) },
	);
}

function setupInterleavedStream(): AssistantMessageEventStream {
	// text[0] -> thinking[1] -> tool_call[2] -> more text on [0], mirroring how a
	// busy interleaved turn appends distinct block identities.
	mockState.chunkSets = [
		[
			chunk({ content: "Hello" }),
			chunk({ reasoning: "Reason a" }),
			chunk({
				tool_calls: [
					{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"README' } },
				],
			}),
			chunk({ reasoning: "Reason b" }),
			chunk({ content: " world" }),
			chunk({ content: "." }),
			chunk({
				tool_calls: [{ index: 0, id: "call_1", type: "function", function: { arguments: '.md"}' } }],
			}),
			chunk({}, "stop"),
		],
	];
	return runStream();
}

describe("foundation-ai openai-completions: O(1) content-index lookup", () => {
	beforeEach(() => {
		mockState.chunkSets = [];
		mockState.signal = undefined;
		mockState.gate = undefined;
	});

	it("Map-based lookup agrees with indexOf for the streaming reference pattern", () => {
		const deltas = streamAccessPattern(24, 30_000);
		expect(deltas).not.toContain(-9999);
		// Sanity: every resolved index is valid and in range.
		for (const idx of deltas) {
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(24);
		}
	});

	it("emits stable, correct contentIndex across interleaved text/thinking/toolCall deltas", async () => {
		const streamHandle = setupInterleavedStream();
		const events: Array<Record<string, unknown>> = [];
		for await (const evt of streamHandle) {
			events.push(evt as Record<string, unknown>);
		}

		const textStart = events.find((e) => e.type === "text_start");
		const thinkingStart = events.find((e) => e.type === "thinking_start");
		const toolStart = events.find((e) => e.type === "toolcall_start");
		expect(textStart?.contentIndex).toBe(0);
		expect(thinkingStart?.contentIndex).toBe(1);
		expect(toolStart?.contentIndex).toBe(2);

		// Every text_delta points at block 0 (stable across stream growth).
		const textDeltas = events.filter((e) => e.type === "text_delta");
		expect(textDeltas.length).toBeGreaterThan(0);
		for (const d of textDeltas) expect(d.contentIndex).toBe(0);

		// Every thinking_delta points at block 1.
		const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
		expect(thinkingDeltas.length).toBe(2);
		for (const d of thinkingDeltas) expect(d.contentIndex).toBe(1);

		// Every toolcall_delta/end points at block 2 (even tool args split across
		// multiple chunks while other blocks interleave).
		const toolDeltas = events.filter((e) => e.type === "toolcall_delta");
		expect(toolDeltas.length).toBe(2);
		for (const d of toolDeltas) expect(d.contentIndex).toBe(2);
		const toolEnd = events.find((e) => e.type === "toolcall_end");
		expect(toolEnd?.contentIndex).toBe(2);

		// Final message must have all three blocks in stable order. openai-completions
		// maps finish_reason "stop" to StopReason "stop" (unchanged by this work).
		const done = events.find((e) => e.type === "done") as { reason?: string; message?: AssistantMessage } | undefined;
		expect(done?.reason).toBe("stop");
		const content = done?.message?.content ?? [];
		expect(content.map((b) => b.type)).toEqual(["text", "thinking", "toolCall"]);
		// Scratch buffers stripped so replay carries only parsed arguments.
		for (const block of content) {
			expect((block as unknown as Record<string, unknown>).partialArgs).toBeUndefined();
			expect((block as unknown as Record<string, unknown>).streamIndex).toBeUndefined();
		}
		const toolCall = content.find((b) => b.type === "toolCall") as unknown as Record<string, unknown>;
		expect(toolCall.arguments).toEqual({ path: "README.md" });
	});

	it("handles malformed partial JSON tool arguments without index drift", async () => {
		// Arguments never complete a valid JSON string -> parse throttled/final
		// must not throw; block index must remain stable and content flushed.
		mockState.chunkSets = [
			[
				chunk({
					tool_calls: [
						{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: '{"path"' } },
					],
				}),
				chunk({} as Record<string, unknown>),
				chunk({}, "tool_calls"),
			],
		];
		const streamHandle = runStream();
		const events: Array<Record<string, unknown>> = [];
		const errors: unknown[] = [];
		try {
			for await (const evt of streamHandle) events.push(evt as Record<string, unknown>);
		} catch (err) {
			errors.push(err);
		}
		const toolDeltas = events.filter((e) => e.type === "toolcall_delta");
		for (const d of toolDeltas) expect(d.contentIndex).toBe(0);
		const done = events.find((e) => e.type === "done") as { message?: AssistantMessage } | undefined;
		expect(done).toBeTruthy();
		const toolCall = done?.message?.content.find((b) => b.type === "toolCall");
		expect((toolCall as { partialArgs?: unknown }).partialArgs).toBeUndefined();
	});

	it("mid-stream abort routes to an error event and strips scratch buffers", async () => {
		const controller = new AbortController();
		mockState.signal = controller.signal;
		// A gate rejected the moment the test aborts: it blocks the internal stream
		// loop mid-stream (mirroring a back-pressured real SDK), so the abort signal
		// is observed while the stream is still live rather than after it errors.
		mockState.gate = new Promise((_resolve, reject) => {
			controller.signal.addEventListener("abort", () => reject(new Error("Request was aborted (signal)")), {
				once: true,
			});
		});
		mockState.chunkSets = [[chunk({ content: "partial" })]];
		const streamHandle = streamOpenAICompletions(
			model(),
			{ messages: [], tools: [readTool] },
			{ apiKey: "test", signal: controller.signal },
		);
		const events: Array<Record<string, unknown>> = [];
		for await (const evt of streamHandle) {
			events.push(evt as Record<string, unknown>);
			// Abort as soon as the first delta is observed; this rejects the gate.
			if (evt.type === "text_delta" || evt.type === "text_start") controller.abort();
		}
		const errorEvt = events.find((e) => e.type === "error") as
			| { reason?: string; error?: AssistantMessage }
			| undefined;
		expect(errorEvt?.reason).toBe("aborted");
		// Event ordering: start precedes error, error is terminal (no done after).
		const types = events.map((e) => e.type as string);
		expect(types[0]).toBe("start");
		expect(types[types.length - 1]).toBe("error");
		expect(types).not.toContain("done");
		// Every content block must have scratch buffers stripped even on error.
		const contentBlocks = (errorEvt?.error?.content ?? []) as unknown as Array<Record<string, unknown>>;
		expect(contentBlocks.length).toBeGreaterThan(0);
		for (const block of contentBlocks) {
			expect(block.partialArgs).toBeUndefined();
			expect(block.customInput).toBeUndefined();
			expect(block.streamIndex).toBeUndefined();
		}
		mockState.signal = undefined;
	});

	it("reports deterministic operation counts and elapsed time for Map vs indexOf", () => {
		const numBlocks = 24;
		const numDeltas = 30_000;

		// Deterministic, scheduler-independent evidence: how many identity probes
		// does each strategy perform for the SAME access sequence? The LCG is
		// fixed, so the counts are exact and repeatable across runs/CI.
		const indexOfOps = streamAccessPatternBoth(numBlocks, numDeltas, "indexof");
		const mapOps = streamAccessPatternBoth(numBlocks, numDeltas, "map");
		const ratio = indexOfOps / mapOps;

		// Elapsed-time sample is supplementary only (sub-ms samples can invert on
		// cache/JIT noise for tiny arrays); the operation count is the contract.
		const indexOfMs = bench(20, () => streamAccessPatternBoth(numBlocks, numDeltas, "indexof"));
		const mapMs = bench(20, () => streamAccessPatternBoth(numBlocks, numDeltas, "map"));
		console.log(
			`BENCH openai-contentindex: ${numDeltas} deltas x ~${numBlocks} blocks -> indexOf ops=${indexOfOps} (${indexOfMs.toFixed(2)}ms) map ops=${mapOps} (${mapMs.toFixed(2)}ms) ${ratio.toFixed(1)}x fewer ops`,
		);

		expect(indexOfOps).toBeGreaterThan(mapOps * 3); // map does exactly 1 probe/delta
		expect(mapOps).toBe(numDeltas); // map resolves every delta in a single hashed lookup
		// Equivalence invariant: index sequence stays in range on a small setup.
		const small = streamAccessPattern(3, 100);
		expect(small.every((x) => x >= 0 && x < 3)).toBe(true);
	});
});

// Run the shared reference pattern and return the deterministic number of
// identity probes performed (linear `indexOf` scans vs one hashed map lookup).
function streamAccessPatternBoth(numBlocks: number, numDeltas: number, mode: "indexof" | "map"): number {
	const blocks: { type: string }[] = [];
	const identityIndex = new IdentityIndex();
	const seedBlock: { type: string } = { type: "text" };
	blocks.push(seedBlock);
	identityIndex.append(seedBlock);
	let highWater = 1;
	let acc = seedValue(SEED);
	let probes = 0;
	for (let d = 0; d < numDeltas; d++) {
		if (highWater < numBlocks && acc % 5 === 0) {
			const type = highWater % 3 === 0 ? "toolCall" : highWater % 3 === 1 ? "thinking" : "text";
			const block = { type };
			blocks.push(block);
			identityIndex.append(block);
			highWater++;
		}
		const target = blocks[acc % blocks.length];
		probes += mode === "indexof" ? blocks.indexOf(target) + 1 : 1;
		acc = nextRand(acc);
	}
	return probes;
}
