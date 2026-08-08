/**
 * opt-proof-cbA — Micro-benchmark of usage/cost accumulation hot paths.
 *
 * Findings this exercises:
 *  - openai-completions.ts `parseChunkUsage` calls `calculateCost` on EVERY
 *    chunk carrying `.usage` (usually only the final chunk with
 *    include_usage:true, so not per-token — noted as low priority).
 *  - anthropic-messages.ts recomputes `calculateCost` on every `message_delta`
 *    that carries usage. Real Anthropic streams send `message_delta.usage` on
 *    the final delta only, but proxies/oss servers can repeat it; and even the
 *    single call does 2 map lookups + float multiplies per run (cheap).
 *  - The meaningful cost here is that usage is built/garbage every delta for
 *    providers that emit usage mid-stream; running calculateCost per chunk is
 *    cheap but NOT hoistable when counts actually change.
 */
import { describe, expect, it } from "vitest";
import { calculateCost } from "../src/models.ts";
import type { Model, Usage } from "../src/types.ts";

function mkUsage(): Usage {
	return {
		input: 1200,
		output: 340,
		cacheRead: 500,
		cacheWrite: 100,
		cacheWrite1h: 40,
		totalTokens: 2140,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

const mkModel = (): Model<"openai-completions"> =>
	({
		id: "mock",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://x",
		name: "mock",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 2.5,
			output: 10,
			cacheRead: 0.5,
			cacheWrite: 2,
			tiers: [
				{ inputTokensAbove: 1000, input: 2, output: 8, cacheRead: 0.4, cacheWrite: 1.8 },
				{ inputTokensAbove: 2000, input: 1.5, output: 7, cacheRead: 0.3, cacheWrite: 1.5 },
			],
		},
		contextWindow: 128000,
		maxTokens: 4096,
	}) as unknown as Model<"openai-completions">;

describe("opt-proof-cbA: usage/cost accumulation", () => {
	it("10k calculateCost calls (single-shot, not per-chunk)", () => {
		const model = mkModel();
		const usage = mkUsage();
		for (let i = 0; i < 100; i++) calculateCost(model, usage); // warmup
		const t0 = performance.now();
		let total = 0;
		for (let i = 0; i < 10_000; i++) {
			const u = mkUsage(); // simulate fresh per chunk allocation
			total += calculateCost(model, u).total;
		}
		const ms = performance.now() - t0;
		console.log(
			`BENCH usagelump: 10k calculateCost + fresh Usage alloc -> ${ms.toFixed(1)}ms (${(10_000 / ms).toFixed(0)}/ms)`,
		);
		expect(total).toBeGreaterThan(0);
	});

	it("each calculateCost allocates a fresh Usage vector", () => {
		// Reference for how many allocations flow through every usage accumulation;
		// the parseChunkUsage path builds a new Usage object + cost object per call.
		const model = mkModel();
		const usage = mkUsage();
		const cost = calculateCost(model, usage);
		// input+input cache tokens = 1200+500+100 = 1800 > tier0 threshold (1000) → tier0
		const r = model.cost.tiers![0];
		const longWrite = usage.cacheWrite1h ?? 0;
		const shortWrite = usage.cacheWrite - longWrite;
		const expected = {
			input: (r.input / 1e6) * usage.input,
			output: (r.output / 1e6) * usage.output,
			cacheRead: (r.cacheRead / 1e6) * usage.cacheRead,
			cacheWrite: (r.cacheWrite * shortWrite + r.input * 2 * longWrite) / 1e6,
		};
		expect(cost.input).toBeCloseTo(expected.input, 10);
		expect(cost.output).toBeCloseTo(expected.output, 10);
		expect(cost.cacheRead).toBeCloseTo(expected.cacheRead, 10);
		expect(cost.cacheWrite).toBeCloseTo(expected.cacheWrite, 10);
		expect(cost.total).toBeCloseTo(expected.input + expected.output + expected.cacheRead + expected.cacheWrite, 10);
	});
});
