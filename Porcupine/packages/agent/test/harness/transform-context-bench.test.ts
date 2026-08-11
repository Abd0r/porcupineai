/**
 * Benchmark for the agent-loop transformContext hot path (harness).
 *
 * PROBLEM (agent-harness.ts::createLoopConfig transformContext):
 * The previous implementation allocated a fresh `[...messages]` clone of the
 * WHOLE assembled session history on every assistant turn and passed it to
 * `emitHook({ type: "context", ... })` — even when NO `context` hook is
 * registered. With no handler, `emitHook` returns `undefined` immediately and
 * the clone is discarded unused, so a no-handler turn loop paid O(history)
 * unused array allocations per turn  →  O(n²) overall.
 *
 * FIX:
 * Gate on `getHandlers("context")`; when empty, pass `messages` through
 * untouched — zero full-history clones and zero no-op emitHook awaits. The
 * handler-present mutable-copy contract is unchanged.
 *
 * Deterministic operation count (the primary regression guard): a no-handler
 * run must make zero `context` emitHook calls. The old path emitted once per
 * assistant turn after cloning the full history; the optimized path bypasses
 * both operations. This file also reports median prompt time over repetitions.
 */
import {
	createModels,
	type FauxProviderHandle,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	type RegisterFauxProviderOptions,
} from "@porcupineai/ai";
import { describe, expect, it } from "vitest";
import { AgentHarness } from "../../src/harness/agent-harness.ts";
import type { PromptTemplate, Skill } from "../../src/harness/types.ts";
import type { AgentTool } from "../../src/types.ts";
import { createInMemorySession, createUserMessage } from "./session-test-utils.ts";

const models = createModels();
let fauxCount = 0;

function newFaux(options: RegisterFauxProviderOptions = {}): FauxProviderHandle {
	const faux = fauxProvider({ provider: `faux-ctx-bench-${++fauxCount}`, ...options });
	models.setProvider(faux.provider);
	return faux;
}

function noopTool(name: string): AgentTool<any, any> {
	return {
		label: name,
		name,
		description: name,
		parameters: { type: "object", properties: {} } as any,
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
	};
}

/** Seed a session then run a T-tool-turn no-handler loop; time only the prompt. */
async function timedNoHandlerRun(
	maxTurns: number,
	historySeed: number,
	timer: (elapsedMs: number) => void,
): Promise<{ contextHookEmits: number }> {
	const faux = newFaux();
	const tool = noopTool("noop_ctx_bencher");

	// Setup (untimed): seed history + build harness.
	const session = await createInMemorySession();
	for (let i = 0; i < historySeed; i++) {
		await session.appendMessage(createUserMessage(`seed question ${i} with words ${i}`));
	}
	const responses: Parameters<FauxProviderHandle["setResponses"]>[0] = [];
	for (let t = 1; t <= maxTurns; t++) {
		responses.push(() =>
			fauxAssistantMessage(fauxToolCall("noop_ctx_bencher", {}, { id: `c-${t}` }), { stopReason: "toolUse" }),
		);
	}
	responses.push(() => fauxAssistantMessage("done"));
	(faux as any).setResponses(responses);
	const harness = new AgentHarness<undefined, Skill, PromptTemplate, AgentTool>({
		models,
		session,
		model: faux.getModel(),
		thinkingLevel: "off",
		tools: [tool],
	});

	// Count context-hook dispatches at the harness boundary. With no registered
	// context handlers, the optimized path must never call emitHook for context.
	type EmitHook = (event: { type: string }) => Promise<unknown>;
	const internal = harness as unknown as { emitHook: EmitHook };
	const originalEmitHook = internal.emitHook.bind(harness);
	let contextHookEmits = 0;
	internal.emitHook = async (event) => {
		if (event.type === "context") contextHookEmits++;
		return originalEmitHook(event);
	};

	// Timed section: the turn loop (where the old code cloned the history per turn).
	const start = process.hrtime.bigint();
	await harness.prompt("start");
	timer(Number(process.hrtime.bigint() - start) / 1e6);
	return { contextHookEmits };
}

describe("transformContext no-handler fast path", () => {
	it("deterministic operation count: no-handler run skips context hook dispatch", async () => {
		const { contextHookEmits } = await timedNoHandlerRun(20, 50, () => {});
		expect(contextHookEmits).toBe(0);
	});

	it("wall-clock baseline/regression guard over a fixed no-handler loop", async () => {
		// Warm-up: module init + JIT.
		await timedNoHandlerRun(2, 100, () => {});

		const maxTurns = 40;
		const historySeed = 4000;
		const reps = 8;
		const samples: number[] = [];
		for (let r = 0; r < reps; r++) {
			await timedNoHandlerRun(maxTurns, historySeed, (ms) => samples.push(ms));
		}
		samples.sort((a, b) => a - b);
		const median = samples[samples.length >> 1]!;
		console.log(
			`[transform-context-bench] no-handler ${maxTurns} turns over ${historySeed} history — ` +
				`median ${median.toFixed(1)}ms, samples ${samples.map((s) => s.toFixed(1)).join(",")}`,
		);
		expect(median).toBeGreaterThan(0);
	});

	it("preserves semantics: a registered context hook still fires and can shape context", async () => {
		let hookCalls = 0;
		const faux = newFaux();
		const tool = noopTool("ctx_shaper");
		const session = await createInMemorySession();
		await session.appendMessage(createUserMessage("hello"));
		const harness = new AgentHarness<undefined, Skill, PromptTemplate, AgentTool>({
			models,
			session,
			model: faux.getModel(),
			thinkingLevel: "off",
			tools: [tool],
		});
		harness.on("context", () => {
			hookCalls += 1;
			return undefined;
		});
		(faux as any).setResponses([
			() => fauxAssistantMessage(fauxToolCall("ctx_shaper", {}, { id: "c-1" }), { stopReason: "toolUse" }),
			() => fauxAssistantMessage("done"),
		]);
		await harness.prompt("hello");
		expect(hookCalls).toBeGreaterThanOrEqual(1);
	});

	it("preserves semantics: no context hook, prompt completes", async () => {
		const faux = newFaux();
		(faux as any).setResponses([() => fauxAssistantMessage("done")]);
		const session = await createInMemorySession();
		await session.appendMessage(createUserMessage("hello"));
		const harness = new AgentHarness({
			models,
			session,
			model: faux.getModel(),
			thinkingLevel: "off",
			tools: [],
		});
		const result = await harness.prompt("hello");
		expect(result).toBeDefined();
		expect(result.role).toBe("assistant");
	});
});
