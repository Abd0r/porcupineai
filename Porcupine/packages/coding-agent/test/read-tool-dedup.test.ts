import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReadTool } from "../src/core/tools/read.ts";

async function readText(
	tool: ReturnType<typeof createReadTool>,
	args: { path: string; offset?: number; limit?: number },
) {
	const res = await tool.execute("call-1", args as never);
	const text = (res.content ?? []).map((c) => (c.type === "text" ? (c as { text: string }).text : "")).join("");
	return text;
}

describe("read tool: self-expiring dedup stub", () => {
	it("returns a cached stub for an immediate repeat read of the same unchanged window", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dedup-"));
		const file = join(dir, "a.txt");
		writeFileSync(file, "line1\nline2\nline3\nline4\nline5\n");
		const tool = createReadTool(dir);
		const first = await readText(tool, { path: file, offset: 1, limit: 2 });
		expect(first).toContain("line1");
		expect(first).toContain("line2");
		// Same window, unchanged file -> stub naming the recovery.
		const second = await readText(tool, { path: file, offset: 1, limit: 2 });
		expect(second).toContain("[Cached:");
		expect(second).toMatch(/lines 1-2/);
		// Self-expiring: a THIRD read of the same window returns the content again.
		const third = await readText(tool, { path: file, offset: 1, limit: 2 });
		expect(third).toContain("line1");
		expect(third).not.toContain("[Cached:");
	});

	it("serves a different window with full content (the key includes the window)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dedup-"));
		const file = join(dir, "b.txt");
		writeFileSync(file, "a\nb\nc\nd\ne\n");
		const tool = createReadTool(dir);
		const w1 = await readText(tool, { path: file, offset: 1, limit: 1 });
		expect(w1).toContain("a");
		const w2 = await readText(tool, { path: file, offset: 3, limit: 1 });
		expect(w2).toContain("c"); // different window -> full content, no stub
		expect(w2).not.toContain("[Cached:");
	});

	it("re-reads when the file changed (mtime/size differ) — no stale stub", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dedup-"));
		const file = join(dir, "c.txt");
		writeFileSync(file, "old\n");
		const tool = createReadTool(dir);
		await readText(tool, { path: file });
		// Change the content (size changes) — the next read must NOT be a stub.
		writeFileSync(file, "new longer content\n");
		const changed = await readText(tool, { path: file });
		expect(changed).toContain("new longer content");
		expect(changed).not.toContain("[Cached:");
	});

	it("different paths never collide in the dedup cache", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dedup-"));
		const f1 = join(dir, "x.txt");
		const f2 = join(dir, "y.txt");
		writeFileSync(f1, "one\n");
		writeFileSync(f2, "two\n");
		const tool = createReadTool(dir);
		await readText(tool, { path: f1 });
		const r2 = await readText(tool, { path: f2 });
		expect(r2).toContain("two");
		expect(r2).not.toContain("[Cached:");
	});
});
