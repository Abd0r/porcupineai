import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextFileStore } from "../src/server/workbench-context-files.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "workbench-context-"));
	roots.push(root);
	const cwd = join(root, "workspace"),
		agentDir = join(root, "agent");
	mkdirSync(cwd);
	mkdirSync(agentDir);
	return { root, cwd, agentDir, store: new ContextFileStore(cwd, agentDir) };
}
describe("workbench context files", () => {
	it("exposes an explicit allowlist, never settings/auth or arbitrary paths", () => {
		const { store } = fixture();
		expect(store.list().map((file) => file.id)).toContain("global:MEMORY.md");
		expect(store.list().map((file) => file.id)).toContain("workspace:AGENTS.md");
		for (const id of ["../auth.json", "global:auth.json", "global:../USER.md", "workspace:settings.json"])
			expect(() => store.read(id)).toThrow(/Unknown/);
	});
	it("creates and edits Markdown with stale-view conflict protection", () => {
		const { store, agentDir } = fixture();
		const empty = store.read("global:USER.md");
		expect(empty.exists).toBe(false);
		const saved = store.write("global:USER.md", "# USER\nA deliberate preference.\n", empty.revision);
		expect(saved.content).toContain("deliberate");
		expect(readFileSync(join(agentDir, "USER.md"), "utf8")).toBe(saved.content);
		expect(() => store.write("global:USER.md", "stale overwrite", empty.revision)).toThrow(/changed/);
		expect(store.read("global:USER.md").content).toBe(saved.content);
	});
	it("detects an agent edit made after the UI loaded", () => {
		const { store, cwd } = fixture();
		writeFileSync(join(cwd, "AGENTS.md"), "first");
		const original = store.read("workspace:AGENTS.md");
		writeFileSync(join(cwd, "AGENTS.md"), "agent update");
		expect(() => store.write("workspace:AGENTS.md", "browser update", original.revision)).toThrow(/changed/);
	});
	it("rejects symlinks and excessive memory without touching outside files", () => {
		const { store, root, agentDir } = fixture();
		const outside = join(root, "outside.md");
		writeFileSync(outside, "private");
		symlinkSync(outside, join(agentDir, "MEMORY.md"));
		expect(() => store.read("global:MEMORY.md")).toThrow(/symbolic/);
		expect(() => store.write("global:MEMORY.md", "overwrite", "anything")).toThrow(/symbolic/);
		expect(readFileSync(outside, "utf8")).toBe("private");
		const user = store.read("global:USER.md");
		expect(() => store.write("global:USER.md", "x".repeat(12001), user.revision)).toThrow(/limit/);
	});
});
