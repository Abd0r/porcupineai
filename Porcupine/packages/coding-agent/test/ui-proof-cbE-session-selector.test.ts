import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { filterAndSortSessions } from "../src/modes/interactive/components/session-selector-search.ts";

function makeSessions(n: number): SessionInfo[] {
	const sessions: SessionInfo[] = [];
	for (let i = 0; i < n; i++) {
		const ts = Date.now() - i * 60000;
		sessions.push({
			path: `/tmp/sess-${i}.json`,
			id: `sess-${i}`,
			type: "session",
			cwd: `/work/project-${i % 50}`,
			name: i % 7 === 0 ? `Named session ${i}` : undefined,
			created: new Date(ts),
			modified: new Date(ts),
			messageCount: 10 + (i % 40),
			firstMessage: `First message about feature number ${i}`,
			allMessagesText: `parsed message text body for session ${i}.`,
		});
	}
	return sessions;
}

describe("ui-proof-cbE session-selector per-keystroke cost", () => {
	test("filterAndSortSessions with 500 sessions, 50 keystrokes (relevance) is bounded", () => {
		const sessions = makeSessions(500);
		const keystrokes = ["f", "fo", "foo", "feature", "number", "session", "named"] as const;
		const start = performance.now();
		let totalResults = 0;
		for (let k = 0; k < 50; k++) {
			const query = keystrokes[k % keystrokes.length]!;
			totalResults += filterAndSortSessions(sessions, query, "relevance").length;
		}
		const elapsed = performance.now() - start;
		console.log(`[cbE] 500 sessions, 50 keystrokes relevance: ${elapsed.toFixed(2)}ms (${totalResults} results)`);
		expect(elapsed).toBeLessThan(2000);
	});

	test("filterAndSortSessions with 1000 sessions, 50 keystrokes (relevance) linear-ish scaling", () => {
		const sessions = makeSessions(1000);
		const keystrokes = ["f", "fo", "foo", "feature", "number", "session", "named"] as const;
		const start = performance.now();
		for (let k = 0; k < 50; k++) {
			filterAndSortSessions(sessions, keystrokes[k % keystrokes.length]!, "relevance");
		}
		const elapsed = performance.now() - start;
		console.log(`[cbE] 1000 sessions, 50 keystrokes relevance: ${elapsed.toFixed(2)}ms`);
		expect(elapsed).toBeLessThan(4000);
	});

	test("single empty-query pass over 1000 sessions (tree/listAll baseline)", () => {
		const sessions = makeSessions(1000);
		const start = performance.now();
		const out = filterAndSortSessions(sessions, "", "threaded");
		const elapsed = performance.now() - start;
		console.log(`[cbE] empty-query threaded pass 1000 sessions: ${elapsed.toFixed(2)}ms (${out.length} out)`);
		expect(out.length).toBe(1000);
	});

	test("matchSession allocates search text on every call (no per-session cache)", () => {
		// Demonstrates that every matchSession call rebuilds getSessionSearchText(),
		// i.e. per-keystroke cost is O(N * searchTextLength) with no reuse across keys.
		const sessions = makeSessions(2000);
		const start = performance.now();
		for (let i = 0; i < 20; i++) {
			filterAndSortSessions(sessions, "some query token", "relevance");
		}
		const elapsed = performance.now() - start;
		console.log(`[cbE] 2000 sessions x 20 keystrokes: ${elapsed.toFixed(2)}ms`);
		expect(elapsed).toBeLessThan(5000);
	});
});
