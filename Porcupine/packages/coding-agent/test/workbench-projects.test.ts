import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchProjectStore } from "../src/server/workbench-projects.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const cwd = mkdtempSync(join(tmpdir(), "workbench-projects-"));
	roots.push(cwd);
	return { cwd, store: new WorkbenchProjectStore(cwd) };
}
const pdf = Buffer.from("%PDF-1.7\nsynthetic test document\n");

describe("workbench project workspaces", () => {
	it("keeps office documents available as downloadable project resources", () => {
		const { store } = fixture();
		store.create("paper");
		for (const filename of ["notes.docx", "results.xlsx", "slides.pptx"]) {
			const file = store.upload("paper", filename, Buffer.from("synthetic document"));
			expect(store.read("paper", file.path).kind).toBe("binary");
		}
		expect(store.files("paper")).toHaveLength(5);
	});

	it("refuses to create a project through a symlinked Project root", () => {
		const { cwd, store } = fixture(),
			outside = mkdtempSync(join(tmpdir(), "outside-project-root-"));
		roots.push(outside);
		symlinkSync(outside, join(cwd, "Project"));
		expect(() => store.create("escape")).toThrow();
		expect(existsSync(join(outside, "escape"))).toBe(false);
	});
	it("limits text previews by bytes rather than UTF-16 character count", () => {
		const { cwd, store } = fixture();
		store.create("bounded");
		writeFileSync(join(cwd, "Project", "bounded", "large.md"), "界".repeat(100000));
		const document = store.read("bounded", "large.md");
		expect(document.truncated).toBe(true);
		expect(Buffer.byteLength(document.content!)).toBeLessThanOrEqual(256 * 1024);
		expect(document.content).not.toContain("�");
	});
	it("keeps project pins across store restarts and describes the README objective", () => {
		const { cwd, store } = fixture();
		store.create("paper", "Paper");
		writeFileSync(
			join(cwd, "Project", "paper", "README.md"),
			"# Paper\n\n## Objective\nCompare measured results.\nTrack uncertainty.\n\n## Scope\nOther details.",
		);
		store.setPinned("paper", true);
		const reopened = new WorkbenchProjectStore(cwd);
		expect(reopened.list()[0]).toMatchObject({
			title: "Paper",
			description: "Compare measured results. Track uncertainty.",
			pinned: true,
		});
		reopened.setPinned("paper", false);
		expect(new WorkbenchProjectStore(cwd).list()[0]?.pinned).toBe(false);
		expect(reopened.files("paper").map((file) => file.path)).toEqual(["README.md", "STATUS.md"]);
	});
	it("uses the agent project index and moves deleted projects into recoverable trash", () => {
		const { cwd, store } = fixture();
		store.create("Study");
		writeFileSync(
			join(cwd, "Project", "study", "STATUS.md"),
			"# Status\n\n## State\n`blocked`\n\n## Current position\nWaiting for observations.\n",
		);
		expect(store.list()[0]).toMatchObject({
			name: "study",
			state: "blocked",
			statusSummary: "Waiting for observations.",
		});
		const deleted = store.remove("study");
		expect(store.list()).toEqual([]);
		expect(readFileSync(join(deleted.trashPath, "STATUS.md"), "utf8")).toContain("Waiting for observations");
	});
	it("discovers existing projects with original names and rescans additions", () => {
		const { cwd, store } = fixture();
		expect(store.list()).toEqual([]);
		mkdirSync(join(cwd, "Project", "Porcupine AI"), { recursive: true });
		writeFileSync(join(cwd, "Project", "Porcupine AI", "README.md"), "# Existing work");
		expect(store.list()).toContainEqual(expect.objectContaining({ name: "Porcupine AI", title: "Existing work" }));
		expect(store.read("Porcupine AI", "README.md").content).toBe("# Existing work");
	});
	it("refuses symlink ancestors when reading project documents", () => {
		const { cwd, store } = fixture();
		store.create("safe");
		const outside = mkdtempSync(join(tmpdir(), "project-outside-"));
		roots.push(outside);
		writeFileSync(join(outside, "secret.md"), "private");
		symlinkSync(outside, join(cwd, "Project", "safe", "linked"));
		expect(() => store.read("safe", "linked/secret.md")).toThrow();
	});
	it("creates canonical project documents and lists verified workspace state", () => {
		const { cwd, store } = fixture();
		expect(store.list()).toEqual([]);
		const created = store.create("Solar Cell Study", "Solar Cell Study");
		expect(created.name).toBe("solar-cell-study");
		expect(readFileSync(join(cwd, "Project", "solar-cell-study", "README.md"), "utf8")).toContain(
			"# Solar Cell Study",
		);
		expect(store.list()).toEqual([
			expect.objectContaining({ name: "solar-cell-study", state: "planning", files: 2 }),
		]);
		expect(() => store.create("solar-cell-study")).toThrow(/already exists/);
	});
	it("uploads PDFs and Markdown into uploads/ without overwriting, and reads them back", () => {
		const { store } = fixture();
		store.create("paper");
		const first = store.upload("paper", "Measurements.pdf", pdf);
		const second = store.upload("paper", "Measurements.pdf", pdf);
		expect(first.path).toBe(join("uploads", "Measurements.pdf"));
		expect(second.path).toBe(join("uploads", "Measurements-2.pdf"));
		expect(
			store
				.files("paper")
				.map((file) => file.kind)
				.sort(),
		).toEqual(["binary", "binary", "text", "text"]);
		store.upload("paper", "notes.md", Buffer.from("# Notes\nVerified measurement table.\n"));
		const document = store.read("paper", join("uploads", "notes.md"));
		expect(document.content).toContain("Verified measurement table");
		expect(() => store.read("paper", join("uploads", "Measurements.pdf"))).not.toThrow();
	});
	it("refuses traversal, symlinked projects, unsupported files and oversized uploads", () => {
		const { cwd, store } = fixture();
		store.create("safe");
		const outside = mkdtempSync(join(tmpdir(), "outside-"));
		roots.push(outside);
		writeFileSync(join(outside, "secret.md"), "private");
		symlinkSync(outside, join(cwd, "Project", "linked"));
		for (const input of ["../secret.md", "/etc/passwd", join("uploads", "..", "..", "escape.md")])
			expect(() => store.read("safe", input)).toThrow();
		expect(() => store.files("linked")).toThrow(/symbolic-link/);
		expect(() => store.upload("safe", "payload.exe", Buffer.from("x"))).toThrow(/Unsupported/);
		expect(() => store.upload("safe", "../escape.md", Buffer.from("x"))).toThrow(/plain filename/);
		expect(() => store.upload("safe", "huge.pdf", Buffer.alloc(12 * 1024 * 1024 + 1))).toThrow(/12 MiB/);
		expect(readFileSync(join(outside, "secret.md"), "utf8")).toBe("private");
	});
	it("ignores unsupported and hidden files when listing", () => {
		const { cwd, store } = fixture();
		store.create("clean");
		const directory = join(cwd, "Project", "clean");
		writeFileSync(join(directory, ".secret.md"), "hidden");
		writeFileSync(join(directory, "run.sh"), "#!/bin/sh");
		expect(store.files("clean").map((file) => file.path)).toEqual(["README.md", "STATUS.md"]);
	});
});
