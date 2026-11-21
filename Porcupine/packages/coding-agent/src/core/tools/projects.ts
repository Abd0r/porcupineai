/**
 * Project workspaces tool — shared project and sticky note access to Project/<name>/ workspaces.
 *
 * Workspaces follow the project-hygiene skill: a canonical Project/<project-name>/
 * directory with README.md (why it exists) and STATUS.md (verified state, blockers,
 * next verified action). This tool lists, searches, and views them so the agent can
 * resume cross-session work instead of guessing.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool, ArtifactChange } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { formatProjectsCommandOutput, searchProjects } from "../../porcupine/project-search.ts";
import { ProjectNoteStore } from "../../server/workbench-project-notes.ts";
import { WorkbenchProjectStore } from "../../server/workbench-projects.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const projectsSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Note ID from action=notes; required for update_note/delete_note" })),
	revision: Type.Optional(
		Type.String({
			description:
				"Current revision from action=notes; required for update_note/delete_note to prevent overwriting someone else's changes",
		}),
	),
	title: Type.Optional(Type.String({ maxLength: 120, description: "Sticky note title (add_note/update_note)" })),
	text: Type.Optional(
		Type.String({
			maxLength: 8000,
			description:
				"Note Markdown, including ![image](uploads/image.png) and [PDF](uploads/paper.pdf). Paths are relative to the project; upload/write files first.",
		}),
	),
	color: Type.Optional(
		Type.Union([Type.Literal("amber"), Type.Literal("blue"), Type.Literal("sage"), Type.Literal("rose")]),
	),

	action: Type.Optional(
		Type.Union(
			[
				Type.Literal("list"),
				Type.Literal("search"),
				Type.Literal("view"),
				Type.Literal("notes"),
				Type.Literal("add_note"),
				Type.Literal("update_note"),
				Type.Literal("delete_note"),
			],
			{
				description: "list (default) | search | view | notes | add_note | update_note | delete_note",
			},
		),
	),
	query: Type.Optional(
		Type.String({
			description:
				"Search text (search) or exact project directory name under Project/ (view and all note actions). Default list shows everything.",
		}),
	),
});

export type ProjectsToolInput = Static<typeof projectsSchema>;

export interface ProjectsToolDetails {
	action: string;
	query?: string;
	count: number;
	artifactChange?: ArtifactChange;
}

export interface ProjectsToolOptions {
	/** Working directory that owns the Project/ root. Defaults to process.cwd(). */
	cwd?: string;
	confirmMutation?: (title: string, message: string) => Promise<boolean>;
	readOnly?: boolean;
}

const MAX_DOCUMENT_BYTES = 64 * 1024;

/** Read a workspace document, bounded and silent on failure. */
function readBounded(filePath: string): string | undefined {
	try {
		const stat = statSync(filePath);
		if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) return undefined;
		return readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}
}

/** Resolve a workspace path, refusing traversal outside Project/<name>. */
function resolveWorkspace(cwd: string, name: string): string | undefined {
	const trimmed = name.trim();
	if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
		return undefined;
	}
	const path = join(cwd, "Project", trimmed);
	return existsSync(path) ? path : undefined;
}

function formatProjectDetail(cwd: string, name: string): string {
	const path = resolveWorkspace(cwd, name);
	if (!path) {
		return `No project workspace named ${JSON.stringify(name)} under Project/. Run action=list to see what exists.`;
	}
	const readme = readBounded(join(path, "README.md"));
	const status = readBounded(join(path, "STATUS.md"));
	const sections: string[] = [];
	if (status) sections.push(status.trim());
	if (readme) sections.push(readme.trim());
	if (sections.length === 0) {
		return `Project/${name} exists but has no README.md or STATUS.md yet.\nCreate them with the project-hygiene skill.`;
	}
	return `Project/${name}\n\n${sections.join("\n\n---\n\n")}`;
}

export function createProjectsToolDefinition(
	options?: ProjectsToolOptions,
): ToolDefinition<typeof projectsSchema, ProjectsToolDetails | undefined> {
	const cwd = options?.cwd ?? process.cwd();

	return {
		name: "projects",
		label: "projects",
		description:
			"Access Project/<name>/ workspaces and their shared sticky notes (maximum 20). action=notes reads all notes; add_note/update_note/delete_note manage them using query=project name and title/text/color. Use id and revision from notes for updates/deletes. Note Markdown supports image and PDF links relative to the project. action=list (default) shows all workspaces with state + hygiene hints; action=search finds workspaces by objective, status, blocker, or next action; action=view shows one workspace's full README.md + STATUS.md so you can resume work with verified state instead of guessing.",
		promptSnippet: "List/search/view projects; read/add/edit/delete shared project sticky notes",
		promptGuidelines: [
			"Use action=search with objective/status/blocker/next-action words before resuming multi-session work.",
			"Use notes/add_note/update_note/delete_note to manage the same sticky notes as the GUI. Updates may specify only changed title, text or color; always supply the current id and revision. Local image/PDF links are relative to Project/<query>/.",
			"action=view loads one workspace's README + STATUS only; use the read tool for other files inside it.",
			"Workspaces live in Project/<name>/ with README.md (purpose) and STATUS.md (verified state, blockers, next action).",
			"If no workspace matches, the project-hygiene skill can create one — do not improvise a competing status document.",
		],
		parameters: projectsSchema,
		async execute(_toolCallId, args, signal) {
			const action = args.action ?? (args.query?.trim() ? "search" : "list");
			const query = args.query?.trim() ?? "";
			let text: string;
			let count = 0;
			let artifactChange: ArtifactChange | undefined;

			if (["notes", "add_note", "update_note", "delete_note"].includes(action)) {
				const store = new ProjectNoteStore(new WorkbenchProjectStore(cwd).path(query));
				if (action === "notes") text = JSON.stringify({ notes: store.list() });
				else {
					if (options?.readOnly) throw new Error("Project note mutations are disabled in read-only tools");
					if (
						options?.confirmMutation &&
						!(await options.confirmMutation(
							"Project sticky note",
							`${action} in Project/${query}: ${args.title || args.id || "note"}`,
						))
					)
						throw new Error("Project note mutation denied");
					if (signal?.aborted) throw new Error("Project note action aborted");
					const previous = action === "update_note" ? store.list().find((note) => note.id === args.id) : undefined;
					const result = store.mutate(
						action === "add_note" ? "add" : action === "update_note" ? "update" : "delete",
						{
							title: args.title ?? previous?.title,
							text: args.text ?? previous?.text ?? "",
							color: args.color ?? previous?.color ?? "amber",
						},
						"agent",
						args.id,
						args.revision,
					);
					text = JSON.stringify(result);
					artifactChange = store.lastChange;
				}
				count = store.list().length;
			} else if (action === "view") {
				text = formatProjectDetail(cwd, query);
				count = query ? 1 : 0;
			} else if (action === "search") {
				text = formatProjectsCommandOutput(cwd, query);
				count = searchProjects(cwd, query).length;
			} else {
				text = formatProjectsCommandOutput(cwd);
				count = searchProjects(cwd).length;
			}

			return {
				content: [{ type: "text", text }],
				details: { action, query, count, artifactChange } satisfies ProjectsToolDetails,
			};
		},
		renderCall(args) {
			const action = String(args?.action ?? (args?.query ? "search" : "list"));
			const target = String(args?.query ?? "");
			return new Text(
				`${theme.fg("toolTitle", theme.bold("projects"))} ${theme.fg("toolOutput", `${action} ${target}`.trim())}`,
				0,
				0,
			);
		},
		renderResult(result, options) {
			const text = (result.content ?? [])
				.map((c) => (c.type === "text" ? c.text : ""))
				.join("")
				.trim();
			const preview = options.expanded ? text : text.split("\n").slice(0, 12).join("\n");
			return new Text(`\n${theme.fg("toolOutput", preview || "(empty)")}`, 0, 0);
		},
	};
}

export function createProjectsTool(options?: ProjectsToolOptions): AgentTool<typeof projectsSchema> {
	return wrapToolDefinition(createProjectsToolDefinition(options));
}
