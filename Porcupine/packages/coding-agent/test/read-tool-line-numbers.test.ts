import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEditTool, createReadTool } from "../src/index.ts";

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

describe("read tool: line numbering + edit tolerance", () => {
	it("prefixes every delivered line with its 1-indexed number", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ln-"));
		const file = join(dir, "a.txt");
		writeFileSync(file, "one\ntwo\nthree\nfour\nfive\n");
		const read = createReadTool(dir);
		const text = getText(await read.execute("r1", { path: file, offset: 2, limit: 3 }));
		expect(text).toContain("2| two\n3| three\n4| four"); // the delivered window is numbered
		expect(text).toContain("1 more lines in file"); // and the continuation hint names the recovery
	});

	it("applies an edit whose oldText was copied verbatim from a line-numbered read", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ln-"));
		const file = join(dir, "b.txt");
		writeFileSync(file, "alpha\nbeta\ngamma\n");
		const read = createReadTool(dir);
		const view = getText(await read.execute("r2", { path: file }));
		expect(view).toContain("2| beta");
		// Simulate the model copying the prefixed line into oldText.
		const edit = createEditTool(dir);
		const res = await edit.execute("e1", {
			path: file,
			edits: [{ oldText: "2| beta", newText: "2| BETA-CHANGED" }],
		} as never);
		expect(getText(res)).toContain("Successfully replaced");
		const after = getText(await read.execute("r3", { path: file }));
		expect(after).toContain("BETA-CHANGED");
	});
});
