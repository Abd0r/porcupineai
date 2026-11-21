import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAllToolDefinitions, createReadOnlyToolDefinitions } from "../src/core/tools/index.ts";
import { createProjectsToolDefinition, type ProjectsToolInput } from "../src/core/tools/projects.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function createWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "porcupine-projects-tool-"));
	roots.push(root);
	return root;
}

function createProject(root: string, name: string, readme: string, status?: string): string {
	const dir = join(root, "Project", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "README.md"), readme);
	if (status) writeFileSync(join(dir, "STATUS.md"), status);
	return dir;
}

function makeTool(root: string) {
	return createProjectsToolDefinition({ cwd: root });
}

async function run(tool: ReturnType<typeof createProjectsToolDefinition>, args: ProjectsToolInput): Promise<string> {
	const result = await tool.execute("t1", args, undefined, undefined, undefined as never);
	return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

describe("projects tool", () => {
	it("uses the configured cwd and mutation gate through the real tool registry", async () => {
		const root = createWorkspace();
		createProject(root, "lab", "# Lab");
		const tool = createAllToolDefinitions(root, { write: { confirmMutation: async () => false } }).projects;
		await expect(
			tool.execute(
				"t",
				{ action: "add_note", query: "lab", title: "No", text: "" },
				undefined,
				undefined,
				undefined as never,
			),
		).rejects.toThrow(/denied/);
		const readonly = createReadOnlyToolDefinitions(root).find((item) => item.name === "projects")!;
		await expect(
			readonly.execute(
				"t",
				{ action: "add_note", query: "lab", title: "No", text: "" },
				undefined,
				undefined,
				undefined as never,
			),
		).rejects.toThrow(/read-only/);
	});

	it("lets the agent read, add, edit and delete the same project notes", async () => {
		const root = createWorkspace();
		createProject(root, "lab", "# Lab");
		const tool = makeTool(root);
		const added = JSON.parse(
			await run(tool, {
				action: "add_note",
				query: "lab",
				title: "Check",
				text: "[Paper](uploads/paper.pdf)",
				color: "blue",
			}),
		);
		expect(added.author).toBe("agent");
		expect(await run(tool, { action: "notes", query: "lab" })).toContain(added.id);
		const updated = JSON.parse(
			await run(tool, {
				action: "update_note",
				query: "lab",
				id: added.id,
				revision: added.revision,
				title: "Verified",
				text: "**Done**",
				color: "sage",
			}),
		);
		expect(updated.text).toBe("**Done**");
		await run(tool, { action: "delete_note", query: "lab", id: updated.id, revision: updated.revision });
		expect(JSON.parse(await run(tool, { action: "notes", query: "lab" })).notes).toEqual([]);
	});
	it("keeps note content and color when the agent only edits the title", async () => {
		const root = createWorkspace();
		createProject(root, "lab", "# Lab");
		const tool = makeTool(root);
		const added = JSON.parse(
			await run(tool, { action: "add_note", query: "lab", title: "First", text: "Keep this", color: "blue" }),
		);
		const updated = JSON.parse(
			await run(tool, {
				action: "update_note",
				query: "lab",
				id: added.id,
				revision: added.revision,
				title: "Second",
			}),
		);
		expect(updated).toMatchObject({ title: "Second", text: "Keep this", color: "blue" });
	});
	it("honors the file mutation gate for agent note changes", async () => {
		const root = createWorkspace();
		createProject(root, "lab", "# Lab");
		const tool = createProjectsToolDefinition({ cwd: root, confirmMutation: async () => false });
		await expect(
			run(tool, { action: "add_note", query: "lab", title: "Blocked", text: "No", color: "amber" }),
		).rejects.toThrow(/denied/i);
	});

	it("lists workspaces with state and hygiene hints", async () => {
		const root = createWorkspace();
		createProject(
			root,
			"cell-atlas",
			"# Cell Atlas\n\n## Objective\nMap cell types.\n",
			"## State\n`active`\n\n## Last verified\n- commit abc\n",
		);
		createProject(root, "incomplete", "# Incomplete\n\nNo status file.\n");

		const tool = makeTool(root);
		const list = await run(tool, { action: "list" });
		expect(list).toContain("Projects (2)");
		expect(list).toContain("Cell Atlas");
		expect(list).toContain("[active]");
		expect(list).toContain("hygiene: missing STATUS.md");
	});

	it("searches workspaces by objective or status text", async () => {
		const root = createWorkspace();
		createProject(
			root,
			"cell-atlas",
			"# Cell Atlas\n\n## Objective\nMap cell types.\n",
			"## State\n`active`\n\n## Next verified action\nValidate manifest against 10x.\n",
		);
		createProject(root, "other", "# Other\n\n## Objective\nUnrelated.\n");

		const tool = makeTool(root);
		const hits = await run(tool, { action: "search", query: "manifest 10x" });
		expect(hits).toContain("cell-atlas");
		expect(hits).not.toContain("Unrelated");
	});

	it("views a workspace README + STATUS for resuming work", async () => {
		const root = createWorkspace();
		createProject(
			root,
			"cell-atlas",
			"# Cell Atlas\n\n## Objective\nMap cell types.\n",
			"## State\n`blocked`\n\n## Blockers\n- Missing 10x matrix.\n\n## Next verified action\nDownload matrix and rerun validate.\n",
		);

		const tool = makeTool(root);
		const view = await run(tool, { action: "view", query: "cell-atlas" });
		expect(view).toContain("Map cell types");
		expect(view).toContain("Missing 10x matrix");
		expect(view).toContain("Download matrix");
	});

	it("rejects path traversal and unknown names safely", async () => {
		const root = createWorkspace();
		createProject(root, "cell-atlas", "# Cell Atlas\n");

		const tool = makeTool(root);
		expect(await run(tool, { action: "view", query: "../secret" })).toContain("No project workspace named");
		expect(await run(tool, { action: "view", query: "does-not-exist" })).toContain("No project workspace named");
	});

	it("gives creation guidance when no workspaces exist", async () => {
		const root = createWorkspace();
		const tool = makeTool(root);
		const list = await run(tool, { action: "list" });
		expect(list).toContain("No project workspaces found");
		expect(list).toContain("project-hygiene");
	});
});
