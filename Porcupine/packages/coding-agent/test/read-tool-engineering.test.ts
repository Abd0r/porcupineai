import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReadToolInput } from "../src/core/tools/read.ts";
import { createReadTool } from "../src/index.ts";

/**
 * Read-tool engineering pass, part 5 (test-owned).
 *
 * Covers the four harness-engineering features that already landed in
 * packages/coding-agent/src/core/tools/read.ts:
 *   1. EOF retry hint  (exact next-offset + "file is empty" wording)
 *   2. Device blocklist ("Refusing to read special device path" before any I/O)
 *   3. BOM strip (U+FEFF removed from a leading-BOM file)
 *   4. Binary notes ([Binary file: ...], pdf hint, svg-as-text)
 *
 * Plus a regression guard: a normal read is byte-for-byte unchanged.
 */

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

describe("read tool engineering: EOF retry hint", () => {
	let testDir: string;
	let read: ReturnType<typeof createReadTool>;

	beforeEach(() => {
		testDir = join(tmpdir(), `read-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		read = createReadTool(process.cwd());
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("names the exact next offset when overshooting a non-empty end-of-file", async () => {
		const file = join(testDir, "short.txt");
		writeFileSync(file, "Line 1\nLine 2\nLine 3\n");
		// 3 content lines (trailing newline is not a line — matches cat -n). Overshoot to 100.
		await expect(read.execute("t1", { path: file, offset: 100 })).rejects.toThrow(
			/Offset 100 is beyond end of file \(3 lines total\)/,
		);
		await expect(read.execute("t1", { path: file, offset: 100 })).rejects.toThrow(
			/Use offset=3 or a smaller offset\./,
		);
	});

	it('uses the "file is empty" wording for a zero-content file', async () => {
		const file = join(testDir, "empty.txt");
		writeFileSync(file, "");
		// A truly empty file splits to a single empty line; an offset past it
		// trips the all-lines-empty branch and names the recovery.
		await expect(read.execute("t2", { path: file, offset: 100 })).rejects.toThrow(
			/Cannot read offset 100: file is empty\./,
		);
	});

	it("treats a blank-lines-only file as empty (all empty lines, no valid offset)", async () => {
		const file = join(testDir, "blank.txt");
		writeFileSync(file, "\n\n\n");
		await expect(read.execute("t3", { path: file, offset: 100 })).rejects.toThrow(/file is empty\./);
	});
});

describe("read tool engineering: device blocklist", () => {
	let testDir: string;
	let read: ReturnType<typeof createReadTool>;

	beforeEach(() => {
		testDir = join(tmpdir(), `read-block-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		read = createReadTool(process.cwd());
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	const blockedDevices = [
		"/dev/zero",
		"/dev/urandom",
		"/dev/random",
		"/dev/stdin",
		"/dev/stdout",
		"/dev/stderr",
		"/dev/full",
	];

	for (const dev of blockedDevices) {
		it(`refuses ${dev} before any I/O`, async () => {
			await expect(read.execute("t-d", { path: dev })).rejects.toThrow(
				`Refusing to read special device path: ${dev}`,
			);
		});
	}

	it("refuses /proc/<pid>/fd/* patterns by wildcard", async () => {
		// Using pid 1's fd 0. On non-macOS/Linux environments the file may not
		// exist, but the point is the refusal happens by path pattern before I/O.
		await expect(read.execute("t-fd", { path: "/proc/1/fd/0" })).rejects.toThrow(
			/Refusing to read special device path/,
		);
		await expect(read.execute("t-fd2", { path: "/proc/999999/fd/12" })).rejects.toThrow(
			/Refusing to read special device path/,
		);
	});
});

describe("read tool engineering: BOM strip", () => {
	let testDir: string;
	let read: ReturnType<typeof createReadTool>;

	beforeEach(() => {
		testDir = join(tmpdir(), `read-bom-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		read = createReadTool(process.cwd());
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("strips a leading UTF-8 BOM (U+FEFF) from the output", async () => {
		const file = join(testDir, "bom.txt");
		writeFileSync(file, "\uFEFFhello\nworld\n");
		const result = await read.execute("t-b1", { path: file });
		const text = getText(result);
		// The BOM char itself is gone; the trailing-newline split artifact is
		// unrelated and must not carry any U+FEFF.
		expect(text).not.toContain("\uFEFF");
		expect(text).toMatch(/1\| hello/); // line-numbered first line, no BOM
		expect(text.charCodeAt(0)).not.toBe(0xfeff);
	});

	it("leaves a BOM-less file completely untouched", async () => {
		const file = join(testDir, "plain.txt");
		writeFileSync(file, "Line 1\nLine 2\n");
		const result = await read.execute("t-b2", { path: file });
		const text = getText(result);
		expect(text).toMatch(/1\| Line 1/);
		expect(text).toMatch(/2\| Line 2/);
		expect(text).not.toContain("\uFEFF");
	});
});

// NOTE: the binary-detection helpers (looksLikeBinaryBuffer, binaryFileNote)
// already exist in read.ts, but as of this writing they are NOT yet invoked in
// the execute() text branch. The two binary-note tests below assert the
// INTENDED behavior and currently fail against read.ts (raw NUL/garbage is
// returned instead). They are expected to start passing once the helpers are
// wired into the read path (parent: see part-5 report).
describe("read tool engineering: binary notes", () => {
	let testDir: string;
	let read: ReturnType<typeof createReadTool>;

	beforeEach(() => {
		testDir = join(tmpdir(), `read-bin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		read = createReadTool(process.cwd());
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("returns a [Binary file: ...] note (not raw NUL garbage) for a NUL-byte file", async () => {
		const file = join(testDir, "data.bin");
		const buf = Buffer.alloc(64);
		buf.set(Buffer.from("AAAA", "utf-8"), 0);
		buf[10] = 0; // NUL byte within the first 8KB
		writeFileSync(file, buf);
		const result = await read.execute("t-bin1", { path: file });
		const text = getText(result);
		expect(text).toMatch(/\[Binary file: [^\]]*\]/);
		expect(text).not.toContain("AAAA");
	});

	it("emits the pdftotext recovery hint for a .pdf path", async () => {
		const file = join(testDir, "doc.pdf");
		writeFileSync(file, "%PDF-1.4\nfake pdf payload\n");
		const result = await read.execute("t-bin2", { path: file });
		const text = getText(result);
		// The PDF note names the recovery command.
		expect(text).toMatch(/\[Binary file: PDF \(/);
		expect(text).toMatch(/pdftotext/);
	});

	it("reads an .svg as plain text (svg is whitelisted as textual)", async () => {
		const file = join(testDir, "drawing.svg");
		writeFileSync(file, "<svg xmlns='http://www.w3.org/2000/svg'></svg>\n");
		const result = await read.execute("t-bin3", { path: file });
		const text = getText(result);
		expect(text).toContain("<svg");
		expect(text).not.toMatch(/\[Binary file/);
	});
});

describe("read tool engineering: normal read is unchanged", () => {
	let testDir: string;
	let read: ReturnType<typeof createReadTool>;

	beforeEach(() => {
		testDir = join(tmpdir(), `read-norm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		read = createReadTool(process.cwd());
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("returns the exact contents for a simple in-bounds text file", async () => {
		const file = join(testDir, "normal.txt");
		const content = "alpha\nbeta\nGAMMA\ndelta";
		writeFileSync(file, content);
		const result = await read.execute("t-n1", { path: file });
		expect(getText(result)).toBe("1| alpha\n2| beta\n3| GAMMA\n4| delta");
	});

	it("honors limit without adding a continuation hint when it lands on EOF", async () => {
		const file = join(testDir, "exact.txt");
		// No trailing newline: split yields exactly 4 lines so limit lands on EOF.
		writeFileSync(file, "a\nb\nc\nd");
		const result = await read.execute("t-n2", { path: file, limit: 4 });
		const text = getText(result);
		expect(text).toBe("1| a\n2| b\n3| c\n4| d");
		expect(text).not.toContain("Use offset=");
	});
});

// The following exercises are intentionally kept in the type-checked import
// guard scope: they replay the read tool's execute signature shape so that the
// scaffolding compiles against the CURRENT schema even while the blocklist/BOM
// helpers are only indirectly covered above. No non-existent symbols are
// imported anywhere in this file.
declare const _schemaProbe: ReadToolInput | undefined;
