import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";

describe("session persistence batching", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	async function wait(ms: number) {
		return new Promise((r) => setTimeout(r, ms));
	}

	it("persists all entries in order after the debounced flush", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "porcupine-session-batch-"));
		const manager = SessionManager.create(tempDir, tempDir);
		const file = manager.newSession({ id: "batch-test" }) as string;
		expect(file).toBeTruthy();

		// First assistant entry materializes the file (existing behavior), then
		// the burst streams in (the batched-append path).
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "start" }],
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
		} as never);
		for (let i = 0; i < 50; i++) {
			manager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `msg ${i}` }],
				timestamp: Date.now() + i,
				// user messages route through this type in the session format
				type: "message",
			} as never);
		}
		// Before the debounce window, the file may be empty or partial — that's fine.
		// After the flush, EVERY entry must be present, in order.
		await wait(150);
		const lines = readFileSync(file, "utf8").trim().split("\n");
		expect(lines.length).toBe(52); // session header + 51 entries
		expect(lines[0]).toContain('"type":"session"');
		expect(lines[1]).toContain("start");
		expect(lines[2]).toContain("msg 0");
		expect(lines[51]).toContain("msg 49");
		// content identical to a per-append writer
		const parsed = lines.map((l) => JSON.parse(l));
		expect(parsed.filter((e) => e.type === "message").length).toBe(51);
	});

	it("flush is durable across a rewrite (source of truth is fileEntries)", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "porcupine-session-batch-"));
		const manager = SessionManager.create(tempDir, tempDir);
		const file = manager.newSession({ id: "batch-test2" }) as string;
		expect(file).toBeTruthy();

		manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "start" }],
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
		} as never);
		for (let i = 0; i < 10; i++) {
			manager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `m${i}` }],
				timestamp: Date.now() + i,
			} as never);
		}
		// Force a rewrite (what session save/compaction paths do) BEFORE the
		// debounce fires: the rewrite must include the buffered entries.
		(manager as unknown as { _rewriteFile(): void })._rewriteFile();
		const lines = readFileSync(file, "utf8").trim().split("\n");
		expect(lines.length).toBe(12); // header + 11 entries
		expect(lines[11]).toContain("m9");
	});
});
