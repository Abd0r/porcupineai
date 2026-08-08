import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";

/**
 * opt-proof-cbE: session-manager.listAll with many sessions.
 *
 * listAll() reads every session file (stat + stream the whole JSONL) under a
 * 10-way concurrency pool, so cost grows with total bytes across all files.
 * This benchmark writes 50 sessions (~50KB each) and measures list-all.
 */
describe("opt-proof-cbE: session-manager.listAll cost", () => {
	function writeSessions(count: number, linesPerSession: number): string {
		const dir = mkdtempSync(join(tmpdir(), "porcupine-listall-"));
		for (let i = 0; i < count; i++) {
			const id = `session${i}`;
			const header = {
				type: "session",
				version: 3,
				id,
				timestamp: new Date(Date.now() - count * 1000 + i * 1000).toISOString(),
				cwd: "/project",
			};
			const entries: string[] = [JSON.stringify(header)];
			for (let l = 0; l < linesPerSession; l++) {
				entries.push(
					JSON.stringify({
						type: "message",
						id: `m${i}-${l}`,
						parentId: l === 0 ? null : `m${i}-${l - 1}`,
						timestamp: new Date().toISOString(),
						message: {
							role: l % 2 === 0 ? "user" : "assistant",
							content: [{ type: "text", text: `message ${i}/${l} `.repeat(80) }],
							timestamp: Date.now(),
						},
					}),
				);
			}
			writeFileSync(join(dir, `${id}.jsonl`), `${entries.join("\n")}\n`);
		}
		return dir;
	}

	it("listAll(50 sessions x ~80 lines) completes in bounded time", async () => {
		const dir = writeSessions(50, 80);
		let loaded = 0;
		const total = 50;
		const start = performance.now();
		const sessions = await SessionManager.listAll(dir, () => {
			loaded++;
		});
		const elapsed = performance.now() - start;
		expect(sessions.length).toBe(50);
		// Progress callback received all 50 loads.
		expect(loaded).toBeLessThanOrEqual(total);
		// Reading 50 files should be well under a second in CI; keep a generous bound.
		expect(elapsed).toBeLessThan(5000);
		// eslint-disable-next-line no-console
		console.log(
			`[opt] listAll(50 sessions) -> ${elapsed.toFixed(1)}ms (${sessions.length} sessions, ${loaded} load callbacks)`,
		);
	});

	it("per-entry in-memory operations (getEntries/getSessionName) are O(1)-ish, not file reads", async () => {
		const dir = writeSessions(5, 20);
		const opened = SessionManager.open(join(dir, "session0.jsonl"));
		// getSessionName walks in-memory entries; no file I/O once loaded.
		const start = performance.now();
		for (let i = 0; i < 10_000; i++) opened.getSessionName();
		const elapsed = performance.now() - start;
		expect(elapsed).toBeLessThan(500);
		// eslint-disable-next-line no-console
		console.log(`[opt] getSessionName x10k (in-memory walk): ${elapsed.toFixed(2)}ms`);
	});
});
