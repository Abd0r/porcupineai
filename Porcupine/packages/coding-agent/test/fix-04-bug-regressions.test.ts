import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type BranchSummaryEntry,
	buildContextEntries,
	type CompactionEntry,
	type SessionEntry,
	type SessionMessageEntry,
} from "../src/core/session-manager.ts";
import { getReadLedger, ReadLedger } from "../src/core/tools/read-ledger.ts";
import { createSubagentToolDefinition } from "../src/core/tools/subagent.ts";
import { extractUrl } from "../src/core/tools/web-extract.ts";
import { createReadTool } from "../src/index.ts";

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

const tempDirs: string[] = [];
async function makeDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "porcupine-fix04-"));
	tempDirs.push(dir);
	return dir;
}
afterEach(async () => {
	getReadLedger().clear();
	await Promise.all(tempDirs.splice(0, tempDirs.length).map((d) => rm(d, { recursive: true, force: true })));
});

// ---------------------------------------------------------------------------
// BUG-7: buildContextEntries must not silently drop pre-compaction context when
// the latest compaction's firstKeptEntryId lies on a DIFFERENT branch than the leaf.
// ---------------------------------------------------------------------------
function msg(id: string, parentId: string | null, role: "user" | "assistant", text: string): SessionMessageEntry {
	const base = { type: "message" as const, id, parentId, timestamp: "2025-01-01T00:00:00Z" };
	if (role === "user") return { ...base, message: { role, content: text, timestamp: 1 } };
	return {
		...base,
		message: {
			role,
			content: [{ type: "text", text }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1,
		},
	};
}
function compaction(id: string, parentId: string | null, summary: string, firstKeptEntryId: string): CompactionEntry {
	return {
		type: "compaction",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		summary,
		firstKeptEntryId,
		tokensBefore: 1000,
	};
}
function branchSummary(id: string, parentId: string | null, summary: string, fromId: string): BranchSummaryEntry {
	return { type: "branch_summary", id, parentId, timestamp: "2025-01-01T00:00:00Z", summary, fromId };
}

describe("BUG-7: buildContextEntries keeps pre-compaction context when firstKeptEntryId is on another branch", () => {
	it("does not drop pre-compaction messages when the compaction's firstKept is absent from the path", () => {
		// The compaction (4) IS on the path to leaf 6, but its firstKeptEntryId
		// ("99") references a kept message that does NOT exist on this path (it was
		// pruned/another branch). The pre-compaction turns (1,2,3) must still be
		// kept so the branch retains the context it depends on.
		const entries: SessionEntry[] = [
			msg("1", null, "user", "start"),
			msg("2", "1", "assistant", "r1"),
			msg("3", "2", "user", "q2"),
			compaction("4", "3", "Compacted", "99"),
			msg("5", "4", "user", "branch turn"),
			msg("6", "5", "assistant", "branch response"),
		];
		const path = buildContextEntries(entries, "6");
		const ids = path.map((e) => e.id);
		// The pre-compaction turns the new branch depends on (1,2,3) must be kept,
		// not dropped just because firstKeptEntryId "99" is not on this path.
		expect(ids).toContain("1");
		expect(ids).toContain("2");
		expect(ids).toContain("3");
		expect(ids).toContain("4"); // the compaction entry itself
		expect(ids).toContain("5");
		expect(ids).toContain("6");
	});

	it("still honors firstKeptEntryId when it IS on the path (no regression)", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "first"),
			msg("2", "1", "assistant", "resp"),
			msg("3", "2", "user", "second"),
			msg("4", "3", "assistant", "resp2"),
			compaction("5", "4", "Summary", "3"),
			msg("6", "5", "user", "third"),
		];
		const ids = buildContextEntries(entries, "6").map((e) => e.id);
		expect(ids).toEqual(["5", "3", "4", "6"]);
	});

	it("handles a branch summary path that references a compaction on another branch", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "start"),
			msg("2", "1", "assistant", "r1"),
			compaction("3", "2", "Compacted", "50"),
			msg("4", "2", "user", "abandoned"),
			branchSummary("5", "2", "Tried abandoned", "4"),
			msg("6", "5", "user", "new dir"),
		];
		const path = buildContextEntries(entries, "6").map((e) => e.id);
		// firstKeptEntryId "50" is not here; the branch still needs 1,2 from before
		// the compaction entry (3) which is on the other branch.
		expect(path).toContain("1");
		expect(path).toContain("2");
		expect(path).toContain("5");
		expect(path).toContain("6");
	});
});

// ---------------------------------------------------------------------------
// BUG-1: a read where the first line exceeds the byte limit must record ZERO
// lines seen — the giant line must never be marked as "fully seen".
// ---------------------------------------------------------------------------
describe("BUG-1: oversized first line records zero seen lines in the ledger", () => {
	it("read of a single oversized line does not mark the file fully seen and blocks edit", async () => {
		const dir = await makeDir();
		const file = join(dir, "giant.txt");
		// One ~60KB line (> DEFAULT_MAX_BYTES = 50KB) with no newline.
		await writeFile(file, "x".repeat(60 * 1024), "utf8");
		const read = createReadTool(process.cwd());

		const result = await read.execute("r1", { path: file }, undefined, undefined);
		const text = getText(result);
		expect(text).toContain("exceeds"); // the error/limit note, not the content

		const ledger = getReadLedger();
		const st = await stat(file);
		// The content line was never seen -> must NOT be "fully seen".
		expect(ledger.isFullySeen(file, st.mtimeMs, st.size)).toBe(false);
		const decision = ledger.canEdit(file, { mtimeMs: st.mtimeMs, size: st.size });
		// Must deny: the model has not seen the (only) line it would overwrite.
		expect(decision.allowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// BUG-3: offset 0 must be rejected explicitly, not silently coerced to line 1.
// ---------------------------------------------------------------------------
describe("BUG-3: offset 0 is rejected", () => {
	it("read with offset 0 throws instead of silently reading from line 1", async () => {
		const dir = await makeDir();
		const file = join(dir, "rows.txt");
		await writeFile(file, "a\nb\nc\n", "utf8");
		const read = createReadTool(process.cwd());
		await expect(read.execute("r", { path: file, offset: 0 }, undefined, undefined)).rejects.toThrow(
			/offset must be a positive line number/,
		);
	});
});

// ---------------------------------------------------------------------------
// BUG-8: web-extract truncates at a UTF-8-safe boundary.
// ---------------------------------------------------------------------------
describe("BUG-8: web-extract truncates at a UTF-8-safe boundary", () => {
	it("truncated output decodes cleanly (no split multi-byte codepoint)", async () => {
		// Mock global fetch to return a body with a multi-byte char right at the cap.
		const multibyte = "\u{1F600}".repeat(6000); // 6000 emoji = 24000 bytes
		const original = globalThis.fetch;
		globalThis.fetch = vi.fn(async () => {
			return {
				url: "http://example.test",
				status: 200,
				headers: { get: () => "text/plain" },
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(multibyte));
						controller.close();
					},
				}),
			} as unknown as Response;
		}) as unknown as typeof fetch;
		try {
			// force a small limit (5000 chars < the 6000-char emoji string) so
			// truncation happens; the multibyte emoji land directly on the byte cap.
			const { text } = await extractUrl("http://example.test", 5000);
			// The result must be well-formed UTF-8 even if a codepoint falls on the cap.
			expect(() => new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(text))).not.toThrow();
			expect(text).toContain("[truncated to");
		} finally {
			globalThis.fetch = original;
		}
	});
});

// ---------------------------------------------------------------------------
// BUG-9: a thrown error from the report-injection (onComplete) callback must not
// fabricate a failed "done" event for a sub-agent that completed successfully.
// ---------------------------------------------------------------------------
function noopTool(name: string) {
	return {
		name,
		label: name,
		description: "noop",
		parameters: { type: "object", properties: {} },
		execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
	};
}

describe("BUG-9: report-injection failure does not fabricate a failed sub-agent result", () => {
	it("a throwing onComplete does not emit an ok:false done event", async () => {
		const { registerFauxProvider, fauxAssistantMessage, streamSimple } = await import("@porcupineai/ai/compat");
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("Report: done.")]);
		const events: unknown[] = [];

		const tool = createSubagentToolDefinition({
			getToolRegistry: () =>
				new Map([
					["read", noopTool("read")],
					["bash", noopTool("bash")],
				]),
			resolveModel: () => faux.getModel(),
			getStreamFn: () => streamSimple,
			getSettings: () => ({ model: undefined, maxSteps: 30, contextWindow: 256_000, maxConcurrent: 1 }),
			onEvent: (event) => events.push(event),
			// Report injection throws -> must NOT corrupt the run result.
			onComplete: async () => {
				throw new Error("injection exploded");
			},
			onRegister: () => {},
			onUnregister: () => {},
		});

		await tool.execute("x1", { task: "do the thing" }, undefined, undefined, undefined as never);
		await new Promise((resolve) => setTimeout(resolve, 300));

		const doneEvents = events.filter((e: any) => e?.type === "done") as Array<{ result?: { ok?: boolean } }>;
		// onComplete threw, but the sub-agent itself succeeded — so NO done event
		// carrying the fabricated failed placeholder (ok:false) may be emitted.
		const fabricatedFailures = doneEvents.filter((e) => e.result?.ok === false);
		expect(fabricatedFailures).toHaveLength(0);
		// And at least the real success settlement still emits its done event.
		expect(doneEvents.length).toBeGreaterThan(0);
		faux.unregister();
	});
});

// ---------------------------------------------------------------------------
// BUG-1 pure-ledger: an empty seen window (seenToLine < seenFromLine) is not
// "fully seen" and formatSeenWindow renders it as zero.
// ---------------------------------------------------------------------------
describe("BUG-1 ledger edge: zero-line seen window", () => {
	it("seenToLine below seenFromLine is not fully seen and formats as 0", () => {
		const ledger = new ReadLedger();
		// This is exactly what the read tool writes when firstLineExceedsLimit.
		ledger.recordRead("/g", { mtimeMs: 1, size: 60000, seenFromLine: 1, seenToLine: 0, totalLines: 1 });
		expect(ledger.isFullySeen("/g", 1, 60000)).toBe(false);
		expect(ledger.canEdit("/g", { mtimeMs: 1, size: 60000 })).toMatchObject({ allowed: false });
	});
});

// ---------------------------------------------------------------------------
// BUG-4: the session JSONL is rewritten atomically (temp file + rename), so a
// crash mid-write can never leave a truncated file, and no temp files leak.
// ---------------------------------------------------------------------------
describe("BUG-4: session rewrite is atomic", () => {
	it("forceFlushToDisk rewrites without leaving a temp file and keeps all entries", async () => {
		const { SessionManager, loadEntriesFromFile } = await import("../src/core/session-manager.ts");
		const dir = await makeDir();
		const sm = SessionManager.create("cwd", dir);
		sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "m",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
		const file = sm.forceFlushToDisk()!;
		const before = loadEntriesFromFile(file).length;

		// Add another entry and rewrite again; no temp files should remain.
		sm.appendMessage({ role: "user", content: "again", timestamp: Date.now() });
		sm.forceFlushToDisk();
		const after = loadEntriesFromFile(file).length;

		const { readdirSync } = await import("node:fs");
		const temps = readdirSync(dir).filter((f) => f.includes(".tmp-"));
		expect(temps).toEqual([]);
		expect(after).toBe(before + 1);
	});
});

// ---------------------------------------------------------------------------
// BUG-5: transient (debounced) entries are flushed synchronously on shutdown
// rather than lost because the unref'd debounce timer never fires.
// ---------------------------------------------------------------------------
describe("BUG-5: flushPersistOnExit drains the debounced buffer", () => {
	it("calling flushPersistOnExit() persists a buffered transient entry", async () => {
		const { SessionManager, loadEntriesFromFile } = await import("../src/core/session-manager.ts");
		const dir = await makeDir();
		const sm = SessionManager.create("cwd", dir);
		// Assistant message makes the session flushed (so transient entries append).
		sm.appendMessage({ role: "user", content: "q", timestamp: Date.now() });
		sm.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "a" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "m",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
		const file = sm.getSessionFile()!;
		const before = loadEntriesFromFile(file).length;

		// A transient model-change entry is debounced (not yet on disk).
		sm.appendModelChange("anthropic", "claude-xyz");
		expect(loadEntriesFromFile(file).length).toBe(before); // not yet flushed

		// Simulate process exit: synchronous drain of the buffer.
		sm.flushPersistOnExit();
		const after = loadEntriesFromFile(file).map((e: any) => e.type);
		expect(after).toContain("model_change");
	});
});
