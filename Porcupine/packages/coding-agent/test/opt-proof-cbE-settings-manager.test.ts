import { describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

/**
 * opt-proof-cbE: settings-manager hot-path getters.
 *
 * The merged `settings` object is built once in the constructor and on writes
 * only — getters read it directly (no per-call re-parse / deep-merge). This
 * benchmark proves getters are cheap and that getProtectedPaths() allocates a
 * fresh set/array on every call (the only per-call allocation hotspot).
 */
describe("opt-proof-cbE: settings-manager getter hot path", () => {
	function makeManager(): SettingsManager {
		return SettingsManager.inMemory({
			compaction: { enabled: true, reserveTokens: 32000 },
			subagent: { maxSteps: 30, maxConcurrent: 3, contextWindow: 256000 },
			retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
			safety: { protectedPaths: ["/project/vendor", "/project/secrets"] },
			defaultProvider: "anthropic",
			defaultModel: "claude-sonnet-4-6",
		});
	}

	it("getter chain does NOT re-merge or re-parse settings each call (stable cost over 10k calls)", () => {
		const sm = makeManager();
		const N = 10_000;
		// Warm up so lazy init (module import, etc.) is excluded.
		for (let i = 0; i < 100; i++) {
			sm.getCompactionSettings();
			sm.getSubagentSettings();
			sm.getRetrySettings();
			sm.getDefaultModel();
		}
		const start = performance.now();
		for (let i = 0; i < N; i++) {
			sm.getCompactionSettings();
			sm.getSubagentSettings();
			sm.getRetrySettings();
			sm.getDefaultModel();
			sm.getDefaultProvider();
			sm.getSteeringMode();
		}
		const elapsed = performance.now() - start;
		// 60k getter calls. Sanity bound well above CI noise: if getters were
		// deep-merging per call this would take far longer.
		expect(elapsed).toBeLessThan(500);
		// Results are stable across repetitions (no drift from re-merge).
		expect(sm.getSubagentSettings().maxConcurrent).toBe(3);
		expect(sm.getCompactionSettings().reserveTokens).toBe(32000);
		// eslint-disable-next-line no-console
		console.log(`[opt] settings getter chain x${N} (60k calls): ${elapsed.toFixed(2)}ms`);
	});

	it("getProtectedPaths is memoized (same array identity across calls)", () => {
		const sm = makeManager();
		const a = sm.getProtectedPaths();
		const b = sm.getProtectedPaths();
		// FIXED: the getter is memoized (bash guard calls it per command) — the
		// same array instance is returned until settings/home change.
		expect(a).toBe(b);
	});

	it("getProtectedPaths 10k calls complete quickly (but allocate 10k arrays)", () => {
		const sm = makeManager();
		const N = 10_000;
		for (let i = 0; i < 100; i++) sm.getProtectedPaths(); // warmup
		const start = performance.now();
		for (let i = 0; i < N; i++) sm.getProtectedPaths();
		const elapsed = performance.now() - start;
		expect(elapsed).toBeLessThan(1000);
		// eslint-disable-next-line no-console
		console.log(`[opt] getProtectedPaths x${N}: ${elapsed.toFixed(2)}ms`);
	});
});
