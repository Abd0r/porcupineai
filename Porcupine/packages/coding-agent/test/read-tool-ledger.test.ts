import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { getReadLedger, ReadLedger } from "../src/core/tools/read-ledger.ts";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "porcupine-ledger-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	// Do not let a denial or a prior edit leak into later tests.
	getReadLedger().clear();
	await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ReadLedger (pure ledger logic)", () => {
	it("never-read file edits freely (backward compat)", () => {
		const ledger = new ReadLedger();
		expect(ledger.canEdit("/x", { mtimeMs: 1, size: 10 })).toEqual({ allowed: true });
		expect(ledger.isFullySeen("/x", 1, 10)).toBe(false);
	});

	it("partial read then canEdit denies with the actionable window", () => {
		const ledger = new ReadLedger();
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 1, seenToLine: 10, totalLines: 100 });
		expect(ledger.canEdit("/a", { mtimeMs: 100, size: 500 })).toEqual({
			allowed: false,
			seenLines: "1-10",
			totalLines: 100,
		});
	});

	it("consecutive partial reads merge coverage but still deny until full", () => {
		const ledger = new ReadLedger();
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 1, seenToLine: 40, totalLines: 100 });
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 41, seenToLine: 90, totalLines: 100 });
		expect(ledger.canEdit("/a", { mtimeMs: 100, size: 500 })).toEqual({
			allowed: false,
			seenLines: "1-90",
			totalLines: 100,
		});
	});

	it("full read allows edit (deadlock resolved)", () => {
		const ledger = new ReadLedger();
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 1, seenToLine: 100, totalLines: 100 });
		expect(ledger.canEdit("/a", { mtimeMs: 100, size: 500 })).toEqual({ allowed: true });
		expect(ledger.isFullySeen("/a", 100, 500)).toBe(true);
	});

	it("partial -> full re-read clears the partial flag (no loop)", () => {
		const ledger = new ReadLedger();
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 1, seenToLine: 10, totalLines: 100 });
		expect(ledger.canEdit("/a", { mtimeMs: 100, size: 500 }).allowed).toBe(false);
		// Model re-reads the full file; the window is widened to the whole file.
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 1, seenToLine: 100, totalLines: 100 });
		expect(ledger.canEdit("/a", { mtimeMs: 100, size: 500 })).toEqual({ allowed: true });
	});

	it("file changed after a partial read is stale -> allowed, not denied (with a note)", () => {
		const ledger = new ReadLedger();
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 1, seenToLine: 10, totalLines: 100 });
		const result = ledger.canEdit("/a", { mtimeMs: 200, size: 600 });
		expect(result).toMatchObject({ allowed: true });
		if (result.allowed) {
			expect(typeof result.note).toBe("string");
		}
	});

	it("a denial does not poison the ledger for a future edit", () => {
		const ledger = new ReadLedger();
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 1, seenToLine: 5, totalLines: 100 });
		// Deny once.
		expect(ledger.canEdit("/a", { mtimeMs: 100, size: 500 }).allowed).toBe(false);
		// The ledger state is unchanged: same denial persists until a full read.
		expect(ledger.canEdit("/a", { mtimeMs: 100, size: 500 }).allowed).toBe(false);
		ledger.recordRead("/a", { mtimeMs: 100, size: 500, seenFromLine: 1, seenToLine: 100, totalLines: 100 });
		expect(ledger.canEdit("/a", { mtimeMs: 100, size: 500 }).allowed).toBe(true);
	});
});

describe("edit tool: ledger consultation", () => {
	it("(a) partial read then edit -> DENIED with actionable message, file unchanged", async () => {
		const dir = await createTempDir();
		const filePath = join(dir, "partial.txt");
		const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
		await writeFile(filePath, content, "utf8");
		const { mtimeMs, size } = await stat(filePath);

		// Model has only seen lines 1-5 of a 20-line file.
		getReadLedger().recordRead(filePath, {
			mtimeMs,
			size,
			seenFromLine: 1,
			seenToLine: 5,
			totalLines: 20,
		});

		const definition = createEditToolDefinition(dir);
		await expect(
			definition.execute(
				"tool-1",
				{ path: "partial.txt", edits: [{ oldText: "line 1", newText: "line 0" }] },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
		).rejects.toThrow(
			/\[Edit not applied: you have only seen lines 1-5 of this file \(20 total\)\. Read the full file first, then retry\.\]/,
		);
		// The file must be untouched.
		expect(await readFile(filePath, "utf8")).toBe(content);
	});

	it("(b) full read then edit -> ALLOWED and applied", async () => {
		const dir = await createTempDir();
		const filePath = join(dir, "full.txt");
		await writeFile(filePath, "fullBefore\n", "utf8");
		const { mtimeMs, size } = await stat(filePath);

		getReadLedger().recordRead(filePath, {
			mtimeMs,
			size,
			seenFromLine: 1,
			seenToLine: 3,
			totalLines: 3,
		});

		const definition = createEditToolDefinition(dir);
		const result = await definition.execute(
			"tool-1",
			{ path: "full.txt", edits: [{ oldText: "fullBefore", newText: "fullAfter" }] },
			undefined,
			undefined,
			{} as ExtensionContext,
		);
		expect(result.content).toEqual([{ type: "text", text: "Successfully replaced 1 block(s) in full.txt." }]);
		expect(await readFile(filePath, "utf8")).toBe("fullAfter\n");
	});

	it("(c) file changed after read -> ALLOWED (stale view), edit applied", async () => {
		const dir = await createTempDir();
		const filePath = join(dir, "changed.txt");
		await writeFile(filePath, "old content\n", "utf8");
		const { mtimeMs: readMtime, size: readSize } = await stat(filePath);

		// Model read only a partial slice earlier.
		getReadLedger().recordRead(filePath, {
			mtimeMs: readMtime,
			size: readSize,
			seenFromLine: 1,
			seenToLine: 1,
			totalLines: 10,
		});

		// File is changed by an external process (different mtime/size).
		await writeFile(filePath, "new external content that changed the file\n", "utf8");

		const definition = createEditToolDefinition(dir);
		const result = await definition.execute(
			"tool-1",
			{ path: "changed.txt", edits: [{ oldText: "new external content that changed the file", newText: "edited" }] },
			undefined,
			undefined,
			{} as ExtensionContext,
		);
		expect(result.content).toEqual([{ type: "text", text: "Successfully replaced 1 block(s) in changed.txt." }]);
		expect(await readFile(filePath, "utf8")).toBe("edited\n");
	});

	it("(d) never-read file -> ALLOWED (existing behavior preserved)", async () => {
		const dir = await createTempDir();
		const filePath = join(dir, "never.txt");
		await writeFile(filePath, "neverBefore\n", "utf8");

		// No ledger record for this path.
		const definition = createEditToolDefinition(dir);
		const result = await definition.execute(
			"tool-1",
			{ path: "never.txt", edits: [{ oldText: "neverBefore", newText: "neverAfter" }] },
			undefined,
			undefined,
			{} as ExtensionContext,
		);
		expect(result.content).toEqual([{ type: "text", text: "Successfully replaced 1 block(s) in never.txt." }]);
		expect(await readFile(filePath, "utf8")).toBe("neverAfter\n");
	});

	it("(e) denial does NOT loop: partial -> denied -> full re-read -> edit proceeds", async () => {
		const dir = await createTempDir();
		const filePath = join(dir, "loop.txt");
		const content = [
			"alpha",
			"bravo",
			"charlie",
			"delta",
			"echo",
			"foxtrot",
			"golf",
			"hotel",
			"india",
			"juliet",
		].join("\n");
		await writeFile(filePath, content, "utf8");
		const { mtimeMs, size } = await stat(filePath);

		// 1. Partial read -> denied.
		getReadLedger().recordRead(filePath, {
			mtimeMs,
			size,
			seenFromLine: 1,
			seenToLine: 3,
			totalLines: 10,
		});
		const definition = createEditToolDefinition(dir);
		await expect(
			definition.execute(
				"tool-1",
				{ path: "loop.txt", edits: [{ oldText: "alpha", newText: "altered" }] },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
		).rejects.toThrow(/\[Edit not applied/);
		expect(await readFile(filePath, "utf8")).toBe(content);

		// 2. Model re-reads the FULL file (dedup may return unchanged, but the
		//    ledger records the full window), so the partial flag clears.
		getReadLedger().recordRead(filePath, {
			mtimeMs,
			size,
			seenFromLine: 1,
			seenToLine: 10,
			totalLines: 10,
		});

		// 3. Retry the same edit -> proceeds, never denied again.
		const result = await definition.execute(
			"tool-1",
			{ path: "loop.txt", edits: [{ oldText: "alpha", newText: "altered" }] },
			undefined,
			undefined,
			{} as ExtensionContext,
		);
		expect(result.content).toEqual([{ type: "text", text: "Successfully replaced 1 block(s) in loop.txt." }]);
		expect(await readFile(filePath, "utf8")).toContain("altered");
	});
});
