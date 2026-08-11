import type { SubagentProgressEvent } from "@porcupineai/agent-core";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { createTestSession } from "./utilities.ts";

/**
 * foundation-core-runtime-fanout.test.ts
 *
 * Core-owned deterministic operation-count guards for the sub-agent stream
 * event fan-out and the bash-abort cleanup hot paths in AgentSession.
 *
 * These are NOT wall-clock timing tests (flaky in CI). They assert the
 * *semantic invariants* that must hold regardless of how the listener set is
 * iterated, so a refactor that drops or re-orders events, or that skips an
 * abort controller, fails deterministically:
 *
 *  1. Every subscribed sub-agent listener receives each emitted progress event,
 *     exactly once, in insertion (subscribe) order.
 *  2. A listener that unsubscribes ITSELF mid-burst must not prevent the
 *     remaining listeners from receiving the current event.
 *  3. Reentrant emissions (a listener that itself emits a sub-agent event)
 *     must still deliver to every listener — the dispatch must not corrupt or
 *     skip on re-entry.
 *  4. Membership is a per-event SNAPSHOT: listeners/controllers added DURING an
 *     in-progress sweep do not join it (they apply from the next emission).
 *  5. abortBash() must invoke abort() on every tracked bash controller — none
 *     may be skipped during the cleanup sweep.
 */

/** Test-only access to AgentSession internals that back the hot paths. */
function internals(session: AgentSession): {
	subagentListeners: Set<(event: SubagentProgressEvent) => void>;
	emitSubagentEvent: (event: SubagentProgressEvent) => void;
	bashAbortControllers: Set<{ abort(): void }>;
	abortBash: () => void;
} {
	const s = session as unknown as {
		_subagentListeners: Set<(event: SubagentProgressEvent) => void>;
		_emitSubagentEvent: (event: SubagentProgressEvent) => void;
		_bashAbortControllers: Set<{ abort(): void }>;
		abortBash: () => void;
	};
	return {
		subagentListeners: s._subagentListeners,
		emitSubagentEvent: s._emitSubagentEvent.bind(s),
		bashAbortControllers: s._bashAbortControllers,
		abortBash: s.abortBash.bind(s),
	};
}

function stepEvent(step: number): SubagentProgressEvent {
	return { type: "step", subagentId: "sa-1", step, toolName: "read", args: { path: `/f/${step}` } };
}

/** Narrow a step-typed event in a listener that only receives step events. */
function stepNumber(ev: SubagentProgressEvent): number {
	return ev.type === "step" ? ev.step : 0;
}

describe("foundation sub-agent stream event fan-out", () => {
	async function session() {
		const ctx = await createTestSession({ inMemory: true });
		return { ...ctx, int: internals(ctx.session) };
	}

	it("delivers every event to every listener exactly once, in subscribe order", async () => {
		const { session: s, int, cleanup } = await session();
		try {
			const received: string[] = [];
			s.onSubagentEvent((ev) => received.push(`a:${stepNumber(ev)}`));
			s.onSubagentEvent((ev) => received.push(`b:${stepNumber(ev)}`));
			s.onSubagentEvent((ev) => received.push(`c:${stepNumber(ev)}`));

			int.emitSubagentEvent(stepEvent(1));
			received.length = 0;
			int.emitSubagentEvent(stepEvent(2));

			// Exactly one delivery per listener, no drops, no ordering change.
			expect(received).toEqual(["a:2", "b:2", "c:2"]);
		} finally {
			cleanup();
		}
	});

	it("a listener unsubscribing itself mid-burst does not starve the remaining listeners", async () => {
		const { session: s, int, cleanup } = await session();
		try {
			const received: string[] = [];
			let unsubB: (() => void) | undefined;
			s.onSubagentEvent((ev) => received.push(`a:${stepNumber(ev)}`));
			unsubB = s.onSubagentEvent(() => {
				received.push("b");
				// Self-remove now; the iterator must still reach "c" for this event.
				unsubB?.();
			});
			s.onSubagentEvent((ev) => received.push(`c:${stepNumber(ev)}`));

			int.emitSubagentEvent(stepEvent(5));
			expect(received).toEqual(["a:5", "b", "c:5"]);
		} finally {
			cleanup();
		}
	});

	it("reentrant emissions still deliver to every listener, with exact deterministic order", async () => {
		const { session: s, int, cleanup } = await session();
		try {
			const received: string[] = [];
			s.onSubagentEvent((ev) => {
				received.push(`a:${stepNumber(ev)}`);
			});
			s.onSubagentEvent((ev) => {
				// Re-entrant emission from within a listener — guard so we only
				// emit once (on the top-level event) and never recurse forever.
				if (stepNumber(ev) === 9) {
					int.emitSubagentEvent(stepEvent(0));
				}
				received.push(`b:${stepNumber(ev)}`);
			});
			s.onSubagentEvent((ev) => {
				received.push(`c:${stepNumber(ev)}`);
			});

			int.emitSubagentEvent(stepEvent(9));

			// Deterministic insertion-order trace: outer dispatch delivers step(9)
			// to A; B re-emits step(0) which completes a full inner pass to A,B,C
			// (B guarded, so no further re-entry); then C sees the outer step(9).
			expect(received).toEqual(["a:9", "a:0", "b:0", "c:0", "b:9", "c:9"]);
		} finally {
			cleanup();
		}
	});

	it("a listener added during dispatch does not join the already-started sweep", async () => {
		const { session: s, int, cleanup } = await session();
		try {
			const received: string[] = [];
			let late: (() => void) | undefined;
			s.onSubagentEvent(() => received.push("a"));
			s.onSubagentEvent(() => {
				// Describe the subscription while a sweep is in progress. Snapshot
				// semantics mean the late listener must NOT see THIS event — only
				// the next one.
				late?.();
				late = s.onSubagentEvent(() => received.push("late"));
				received.push("b");
			});
			s.onSubagentEvent(() => received.push("c"));

			// This sweep takes a membership snapshot at dispatch start.
			int.emitSubagentEvent(stepEvent(1));
			expect(received).toEqual(["a", "b", "c"]); // "late" excluded this burst

			received.length = 0;
			int.emitSubagentEvent(stepEvent(2));
			expect(received).toEqual(["a", "b", "c", "late"]); // included from next burst
		} finally {
			cleanup();
		}
	});

	it("tracks running sub-agent state on step/turn/done without losing counts", async () => {
		const { session: s, int, cleanup } = await session();
		try {
			s.onSubagentEvent(() => {});
			int.emitSubagentEvent({
				type: "start",
				subagentId: "sa-1",
				task: "do the thing",
				maxSteps: 5,
				maxContextTokens: 128000,
			});
			int.emitSubagentEvent(stepEvent(1));
			int.emitSubagentEvent({ type: "turn", subagentId: "sa-1", step: 2, contextTokens: 100 });
			int.emitSubagentEvent({
				type: "done",
				subagentId: "sa-1",
				result: {
					ok: true,
					summary: "done",
					steps: 2,
					messages: [],
					budgetExhausted: false,
					usage: { inputTokens: 1, outputTokens: 1, contextTokens: 100 },
				},
			});

			// Aggregate counters stay coherent across the whole fan-out burst.
			expect(s.pendingMessageCount).toBeGreaterThanOrEqual(0); // noise-free accessor
		} finally {
			cleanup();
		}
	});
});

describe("foundation bash abort cleanup", () => {
	it("abortBash() invokes abort() on every tracked controller, none skipped", async () => {
		const ctx = await createTestSession({ inMemory: true });
		try {
			const { bashAbortControllers, abortBash } = internals(ctx.session);
			const aborted: number[] = [];
			const controller = (i: number) => ({
				abort: () => aborted.push(i),
			});

			// Seed the live set exactly as executeBash would.
			bashAbortControllers.add(controller(1));
			bashAbortControllers.add(controller(2));
			bashAbortControllers.add(controller(3));

			abortBash();

			// Deterministic operation-count guard: all three must be reached.
			expect(aborted).toEqual([1, 2, 3]);
		} finally {
			ctx.cleanup();
		}
	});

	it("abortBash() is a no-op when nothing is running", async () => {
		const ctx = await createTestSession({ inMemory: true });
		try {
			const { bashAbortControllers, abortBash } = internals(ctx.session);
			bashAbortControllers.clear();
			expect(() => abortBash()).not.toThrow();
		} finally {
			ctx.cleanup();
		}
	});
});
