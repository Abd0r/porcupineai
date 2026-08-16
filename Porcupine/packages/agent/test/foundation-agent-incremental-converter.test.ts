/**
 * Foundation pass 2 — incremental AgentMessage->Message conversion cache.
 *
 * SCOPE: packages/agent/src/agent-loop.ts (createIncrementalConverter),
 *        packages/agent/src/harness/messages.ts (convertToLlm).
 *
 * SAFETY CONTRACT (concatenation-homomorphism)
 * ------------------------------------------
 * The agent loop uses `createIncrementalConverter` to avoid re-running
 * convertToLlm over the WHOLE history on every assistant turn (that is O(n^2)
 * in message count). Such tail-only caching is only sound when `convertToLlm`
 * is element-local and composable — i.e. for every split index k,
 *
 *     convertToLlm(full) === convertToLlm(full[0..k)) ++ convertToLlm(full[k..n)).
 *
 * A converter with dedup, cross-message rewriting, or neighbor/global-state
 * dependence violates this and produces silently WRONG output under
 * tail-caching. `AgentLoopConfig.convertToLlm` is NOT contractually guaranteed
 * to be homomorphic, so incremental caching is GATED: it applies ONLY when the
 * exact built-in element-local converter (`messages.ts:convertToLlm`) is
 * passed. Any custom converter falls back to full conversion every call.
 *
 * The gating is opt-in via converter identity (the only production caller, the
 * harness, always passes the built-in converter). This file proves:
 *   (a) the built-in converter is concatenation-homomorphic (adjacency proof);
 *   (b) the incremental cache is active for the built-in converter and its
 *       invalidation/ordering/replay/hook/compaction invariants hold;
 *   (c) custom (non-built-in) converters fall back to full conversion.
 */
import { describe, expect, it } from "vitest";
import { createIncrementalConverter } from "../src/agent-loop.ts";
import { convertToLlm } from "../src/harness/messages.ts";
import type { AgentLoopConfig, AgentMessage } from "../src/types.ts";

function user(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistant(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function toolResult(text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: "tc-1",
		toolName: "read",
		content: [{ type: "text", text }],
		details: {},
		isError: false,
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

/** A role that exercises the built-in converter's synthesized user-message path. */
function bashOut(text: string): AgentMessage {
	return {
		role: "bashExecution",
		command: "echo hello",
		output: text,
		exitCode: 0,
		cancelled: false,
		truncated: false,
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

/** A role the built-in converter drops entirely (never becomes an LLM message). */
function ignoredRole(text: string): AgentMessage {
	return {
		role: "custom",
		customType: "ui-only",
		content: text,
		display: false,
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

/** Config that passes the EXACT built-in converter reference (incremental gate ON). */
function builtInCfg(): AgentLoopConfig {
	return { convertToLlm } as unknown as AgentLoopConfig;
}

/** Serialize converted Message[] so cross-instance identity need not match. */
function key(messages: unknown[]): string {
	return JSON.stringify(
		messages.map((m) => ({ role: (m as { role: string }).role, content: (m as { content: unknown }).content })),
	);
}

describe("built-in convertToLlm is concatenation-homomorphic (adjacency proof)", () => {
	it("full conversion equals the concatenation of incremental segments", () => {
		// Covers every built-in role branch + one ignored role.
		const full: AgentMessage[] = [
			user("u0"),
			assistant("a0"),
			toolResult("r0"),
			bashOut("b0"),
			user("u1"),
			ignoredRole("nope"),
			assistant("a1"),
		];
		const expected = convertToLlm(full);

		// Incrementally fold, aligning with how the cache splits (append tail only),
		// and require element-for-element equality at every split point.
		let acc: unknown[] = [];
		const splitPoints = [1, 3, 4, 6, 7];
		for (let s = 0; s < splitPoints.length; s++) {
			const end = splitPoints[s]!;
			const start = s === 0 ? 0 : splitPoints[s - 1]!;
			acc = acc.concat(convertToLlm(full.slice(start, end)));
			expect(key(acc)).toBe(key(expected.slice(0, end)));
		}
		// Every split reproduced the exact full output (order preserved, ignored role
		// dropped, synthesized roles byte-identical).
		expect(key(acc)).toBe(key(expected));
	});

	it("re-converting the same history twice yields identical absolute output", () => {
		const full: AgentMessage[] = [user("u0"), assistant("a0"), toolResult("r0"), user("u1")];
		expect(key(convertToLlm(full))).toBe(key(convertToLlm(full)));
		expect(convertToLlm(full)).toHaveLength(4);
	});
});

describe("incremental cache across the built-in converter", () => {
	it("INVALIDATION/ORDERING: reuses the cached array instance across appends", async () => {
		const conv = createIncrementalConverter(builtInCfg());

		const history: AgentMessage[] = [user("u0"), assistant("a0"), toolResult("r0")];
		const out0 = await conv.convert(history);
		expect(out0).toHaveLength(3);

		history.push(assistant("a1"));
		const out1 = await conv.convert(history);
		expect(out1).toHaveLength(4);
		// Same array instance — proves the incremental cache (not a fresh full
		// conversion) handled the append. The fallback path never reuses.
		expect(out1).toBe(out0);

		history.push(toolResult("r1"), user("u1"));
		const out2 = await conv.convert(history);
		expect(out2).toHaveLength(6);
		expect(out2).toBe(out0);

		// Incremental output is byte-identical to a one-shot full conversion.
		expect(key(out2)).toBe(key(convertToLlm(history)));
	});

	it("REPLAY: same instance & length re-converts only the final element, head untouched", async () => {
		const conv = createIncrementalConverter(builtInCfg());

		const history: AgentMessage[] = [user("u0"), assistant("a0"), user("u1")];
		const initial = await conv.convert(history);

		// Streaming delta: replace the LAST element in place (same length).
		history[history.length - 1] = assistant("a1-delta");
		const replayed = await conv.convert(history);
		expect(replayed).toBe(initial);
		expect(replayed[replayed.length - 1]).toBe(history[history.length - 1]);
		expect(replayed[0]).toBe(initial[0]);
		expect(replayed[1]).toBe(initial[1]);

		expect(key(replayed)).toBe(key(convertToLlm(history)));
	});

	it("INVALIDATION: a fresh array instance forces a fresh, correct conversion", async () => {
		const conv = createIncrementalConverter(builtInCfg());

		const history: AgentMessage[] = [user("u0"), assistant("a0")];
		await conv.convert(history);

		const reshaped = history.slice(0, 1); // transformContext returned a pruned copy
		const out = await conv.convert(reshaped);
		expect(out).toHaveLength(1);
		expect(key(out)).toBe(key(convertToLlm(reshaped)));
	});

	it("COMPACTION/SHRINK: length dropping below the cached count forces a correct re-convert", async () => {
		const conv = createIncrementalConverter(builtInCfg());

		const history: AgentMessage[] = [user("u0"), assistant("a0"), toolResult("r0"), user("u1")];
		await conv.convert(history);

		history.length = 2; // compaction replaced the history with a shorter list
		const out = await conv.convert(history);
		expect(out).toHaveLength(2);
		expect(key(out)).toBe(key(convertToLlm(history)));
	});

	it("HOOK MUTABILITY: a transformed fresh array is never diffed against a stale cache", async () => {
		const conv = createIncrementalConverter(builtInCfg());

		const history: AgentMessage[] = [user("u0"), assistant("a0")];
		const base = await conv.convert(history);

		const pruned = history.slice(0, 1);
		const prunedOut = await conv.convert(pruned);
		expect(prunedOut).toHaveLength(1);
		expect(prunedOut).not.toBe(base);

		// Returning to a DIFFERENT array instance re-converts from scratch (staleness
		// is never assumed safe across instance boundaries); output stays correct.
		history.push(user("u2"));
		const again = await conv.convert(history);
		expect(again).toHaveLength(3);
		expect(key(again)).toBe(key(convertToLlm(history)));
	});

	it("FILTERED LAST MESSAGE: the final message converting to zero outputs never injects undefined", async () => {
		const conv = createIncrementalConverter(builtInCfg());

		// Two real outputs up front.
		const history: AgentMessage[] = [user("u0"), assistant("a0")];
		const before = await conv.convert(history);
		expect(before).toHaveLength(2);

		// Same length (only the last element changed), but the replacement converts
		// to ZERO outputs (a filtered bashExecution). The old code wrote `last[0]!`
		// which is `undefined` here; the fix must drop it and stay byte-identical to
		// a one-shot conversion of the same (shorter, filtered) input.
		history[history.length - 1] = {
			role: "bashExecution",
			command: "echo hi",
			output: "filtered output",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			excludeFromContext: true,
			timestamp: Date.now(),
		} as unknown as AgentMessage;
		const after = await conv.convert(history);
		const expected = convertToLlm(history);
		expect(after).toHaveLength(expected.length);
		expect(expected).toHaveLength(1); // only the user message survives
		for (const msg of after) {
			expect(msg).not.toBeUndefined();
		}
		expect(key(after)).toBe(key(expected));
	});
});

describe("rejection: custom converters fall back to full conversion", () => {
	it("non-built-in converters are never composed incrementally (operation counts)", async () => {
		const sizes: number[] = [];
		const customConvert = (messages: AgentMessage[]) => {
			if (messages.length > 0) sizes.push(messages.length);
			return messages.map((m) => ({ role: m.role, content: (m as { content?: unknown }).content }));
		};
		const conv = createIncrementalConverter({ convertToLlm: customConvert } as unknown as AgentLoopConfig);

		// Even though the SAME array instance is reused across turns (a prime caching
		// opportunity), the custom converter is not provably element-local, so it must
		// NOT be composed incrementally: every convert() re-processes the FULL array.
		const history: AgentMessage[] = [user("u0"), assistant("a0")];
		await conv.convert(history);
		history.push(user("u1"));
		await conv.convert(history);
		history.push(assistant("a2"));
		await conv.convert(history);

		// 2, 3, 4 — full history re-converted each call (no tail-only savings).
		expect(sizes).toEqual([2, 3, 4]);
	});

	it("a neighbor/global-dependent converter would be WRONG under incremental output", () => {
		// This converter is NOT element-local: its output for a message depends on the
		// total array length (a global cue). Tail-caching would reuse a stale prefix.
		const countingConvert = (msgs: AgentMessage[]) =>
			msgs.map((m) => ({ role: m.role, content: `${msgs.length}:${key([m])}` }));

		const full: AgentMessage[] = [user("u0"), assistant("a0"), user("u1")];
		const fullResult = countingConvert(full);
		const incrementalResult = [...countingConvert(full.slice(0, 2)), ...countingConvert(full.slice(2))];

		// The sub-batch (length 2) tags its content with 2, but the full-array pass tags
		// it with 3 — a stale prefix under incremental caching. This is why non-built-in
		// converters are gated to full conversion.
		expect(incrementalResult[0]).not.toEqual(fullResult[0]);
	});
});
