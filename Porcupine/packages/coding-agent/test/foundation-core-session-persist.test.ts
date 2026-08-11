import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";

/**
 * foundation-core-session-persist.test.ts
 *
 * Core-owned regression guards for the session-persistence hot path that long
 * agent / sub-agent / max-reasoning streams hammer: every append flows through
 * SessionManager._appendEntry -> _persist.
 *
 * Invariants under test:
 *  1. Once a session has seen an assistant message (and the file is materialized),
 *     appending more entries must NOT rescan the entire fileEntries array to
 *     rediscover the "has assistant" fact. The scan must happen at most once
 *     (cached), so a long stream stays O(n) total, not O(n^2).
 *  2. Message appends must stay readable-immediately (synchronous disk write)
 *     while NOT churning a pointless debounce timer (setTimeout/clearTimeout)
 *     for every message — the read-after-write message path must not schedule
 *     a timer it is about to cancel.
 *  3. Ordering + crash-recovery contract: every appended entry is present on
 *     disk, in order, after the debounced flush.
 */

const hasOwn = <T>(o: object, k: PropertyKey): k is keyof T => Object.hasOwn(o, k);

/** Read the private runtime internals of a SessionManager (test-only). */
function internals(m: SessionManager): {
	fileEntries: Array<{ type: string; message?: { role?: string } }>;
	persistTimer: ReturnType<typeof setTimeout> | null;
	persistBuffer: string[];
	flushed: boolean;
} {
	return m as unknown as {
		fileEntries: Array<{ type: string; message?: { role?: string } }>;
		persistTimer: ReturnType<typeof setTimeout> | null;
		persistBuffer: string[];
		flushed: boolean;
	};
}

function assistantMessage(content: string) {
	return {
		role: "assistant",
		content: [{ type: "text", text: content }],
		timestamp: Date.now(),
		api: "openai-responses",
		provider: "mock",
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
	} as never;
}

function userMessage(content: string) {
	return {
		role: "user",
		content: [{ type: "text", text: content }],
		timestamp: Date.now(),
	} as never;
}

describe("foundation-core session persistence hot path", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	it("does not rescan fileEntries for hasAssistant on every append after materialization", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "foundation-core-batch-"));
		const manager = SessionManager.create(tempDir, tempDir);
		const file = manager.newSession({ id: "fcore-e2" }) as string;
		expect(file).toBeTruthy();

		// Materialize the file with a first assistant message (the initial full write).
		manager.appendMessage(assistantMessage("start"));

		const state = internals(manager);
		expect(state.flushed).toBe(true);

		// Instrument: count every `.some(...)` scan of fileEntries from here on.
		// We don't want to mutate the real array identity (SessionManager holds it),
		// so wrap the SAME array in a counting Proxy.
		const original = state.fileEntries;
		let someCalls = 0;
		const counted = new Proxy(original, {
			get(target, prop, receiver) {
				if (typeof prop === "string" && (prop === "some" || prop === "find" || prop === "filter")) {
					return (...args: unknown[]) => {
						someCalls += 1;
						return Reflect.apply(
							target[prop as keyof typeof target] as (...a: unknown[]) => unknown,
							receiver,
							args,
						);
					};
				}
				return Reflect.get(target, prop, receiver);
			},
		});
		Object.defineProperty(manager, "fileEntries", { configurable: true, value: counted });

		// A long burst of transient + message entries after the file is materialized.
		const N = 500;
		for (let i = 0; i < N; i++) {
			manager.appendThinkingLevelChange(i % 2 === 0 ? "medium" : "high");
			manager.appendModelChange("mock", "model");
			manager.appendMessage(userMessage(`msg ${i}`));
		}

		// Accept a warm-up scan during the ordinary append work (the cached flag is
		// consulted, not an array scan). The key invariant: it must be FAR below N*3.
		expect(someCalls).toBeLessThan(N);
	});

	it("message appends do not schedule a debounce timer that is immediately cancelled", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "foundation-core-batch-"));
		const manager = SessionManager.create(tempDir, tempDir);
		const file = manager.newSession({ id: "fcore-e1" }) as string;
		manager.appendMessage(assistantMessage("start"));

		// Count timer creations/suppressions around a burst of message appends.
		const timersCreated: string[] = [];
		const origSetTimeout = globalThis.setTimeout;
		const origClearTimeout = globalThis.clearTimeout;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).setTimeout = ((cb: () => void, ms: number, ...a: unknown[]) => {
			timersCreated.push(`timeout:${ms}`);
			return origSetTimeout(cb, ms, ...a);
		}) as typeof globalThis.setTimeout;
		(globalThis as any).clearTimeout = ((t?: unknown) => {
			timersCreated.push("clear");
			return origClearTimeout(t as ReturnType<typeof setTimeout>);
		}) as typeof globalThis.clearTimeout;
		try {
			for (let i = 0; i < 200; i++) {
				manager.appendMessage(userMessage(`m ${i}`));
			}
		} finally {
			(globalThis as any).setTimeout = origSetTimeout;
			(globalThis as any).clearTimeout = origClearTimeout;
		}

		// The read-after-write message path must NOT schedule a debounce timer that
		// it is about to cancel. The immediate flush writes synchronously without the
		// setTimeout/clearTimeout dance, so no timeout should be created for the burst.
		expect(timersCreated.filter((t) => t.startsWith("timeout")).length).toBe(0);

		// Synchronous, readable-immediately writes are preserved: after the burst
		// (before any debounce) everything is already on disk, in order.
		const lines = readFileSync(file, "utf8").trim().split("\n");
		expect(lines.length).toBe(202); // header + "start" + 200
		expect(lines[201]).toContain("m 199");

		if (hasOwn<{ fileEntries?: unknown }>(internals(manager), "fileEntries")) {
			// There must be no lingering pending flush timer after the burst.
			expect(internals(manager).persistTimer).toBeNull();
		}
	});

	it("preserves ordering and crash-recovery across a debounced transient flush", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "foundation-core-batch-"));
		const manager = SessionManager.create(tempDir, tempDir);
		const file = manager.newSession({ id: "fcore-e3" }) as string;
		manager.appendMessage(assistantMessage("start"));
		for (let i = 0; i < 40; i++) {
			manager.appendModelChange("mock", `m${i}`);
			manager.appendThinkingLevelChange(i % 2 ? "high" : "low");
		}
		await new Promise((r) => setTimeout(r, 150));
		const lines = readFileSync(file, "utf8").trim().split("\n");
		expect(lines.length).toBe(82); // header + start + 80 transients
		expect(lines[1]).toContain("start");
		expect(lines[81]).toContain("thinking_level");
	});
});
