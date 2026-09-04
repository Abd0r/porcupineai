/**
 * Agent-facing catalog for discovering Porcupine tools and skills.
 *
 * This is deliberately read-only. Searching identifies a capability; it does
 * not mutate the session toolset (which would rebuild the prompt mid-session).
 */

import { existsSync, readFileSync } from "node:fs";
import type { AgentTool } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { getAgentDir, getBundledSkillsDir } from "../../config.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { buildCapabilityTreeFromSession } from "../../porcupine/session-capabilities.ts";
import { formatStacksCommandOutput, searchStacks } from "../../porcupine/stacks.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { loadSkills, type Skill } from "../skills.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const capabilitySearchSchema = Type.Object({
	action: Type.Optional(
		Type.Union([Type.Literal("list"), Type.Literal("search"), Type.Literal("view")], {
			description: "list = catalog overview; search = match tools/skills; view = show one skill's full instructions",
		}),
	),
	query: Type.Optional(
		Type.String({
			description: "For search: words, stack:vcs, or a tool/skill name. For view: exact skill name.",
		}),
	),
	kind: Type.Optional(
		Type.Union([Type.Literal("all"), Type.Literal("tool"), Type.Literal("skill")], {
			description: "Optional filter for list/search. Default all.",
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Max search results (default 20; max 50)." })),
});

export type CapabilitySearchToolInput = Static<typeof capabilitySearchSchema>;

export interface CapabilitySearchToolDetails {
	action: "list" | "search" | "view";
	count: number;
}

export interface CapabilityCatalogTool {
	name: string;
	description?: string;
	promptSnippet?: string;
	available?: boolean;
}

export interface CapabilitySearchToolOptions {
	cwd?: string;
	agentDir?: string;
	/** Returns built-in and/or runtime-registered tools visible to this agent. */
	getTools?: () => CapabilityCatalogTool[];
}

function normalize(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/^skill:/, "");
}

function visibleSkills(cwd: string, agentDir: string): Skill[] {
	// Mirror the resource loader: bundled product skills are lowest-precedence
	// defaults, appended after user/project skills so collisions keep priority.
	const bundled = existsSync(getBundledSkillsDir()) ? [getBundledSkillsDir()] : [];
	return loadSkills({ cwd, agentDir, skillPaths: bundled, includeDefaults: true }).skills.filter(
		(skill) => !skill.disableModelInvocation,
	);
}

function formatSkillList(skills: Skill[]): string {
	if (skills.length === 0) return "No skills are loaded.";
	return skills
		.slice()
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(
			(skill) =>
				`• skill:${skill.name}\n  stack: ${skill.stack ?? "meta"}\n  ${skill.description}\n  location: ${skill.filePath}`,
		)
		.join("\n\n");
}

/**
 * Full catalog for the agent. Use this instead of guessing tool or skill names.
 * `view` intentionally loads only a selected skill, mirroring Hermes skill_view.
 */
export function createCapabilitySearchToolDefinition(
	options: CapabilitySearchToolOptions = {},
): ToolDefinition<typeof capabilitySearchSchema, CapabilitySearchToolDetails> {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();

	const catalog = () => {
		const tools = (options.getTools?.() ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description,
			promptSnippet: tool.promptSnippet,
			available: true,
		}));
		const skills = visibleSkills(cwd, agentDir);
		const tree = buildCapabilityTreeFromSession({ tools, skills });
		return { tools, skills, tree };
	};

	return {
		name: "capability_search",
		label: "capability_search",
		description:
			"Search the live catalog of Porcupine tools and skills. On real work, call this BEFORE web_search, bash, or read. Knowing a familiar tool is not a skip. action=search finds by task/name/stack; action=list shows every live tool and skill; action=view loads one SKILL.md.",
		promptSnippet: "Catalog first: search/list/view tools and skills",
		promptGuidelines: [
			"On real work, capability_search first. Knowing web_search, bash, or read is not a reason to skip the catalog.",
			"action=search for the task. If the match is not obvious, action=list. action=view loads one skill's SKILL.md.",
			"Do not guess a tool or skill name. A familiar generic tool is not the best tool.",
		],
		parameters: capabilitySearchSchema,
		async execute(_toolCallId, args) {
			const action = args.action ?? (args.query ? "search" : "list");
			const kind = args.kind ?? "all";
			const { tools, skills, tree } = catalog();
			const kinds = kind === "all" ? undefined : [kind];

			if (action === "view") {
				const name = normalize(args.query ?? "");
				if (!name) {
					return {
						content: [
							{
								type: "text",
								text: "view requires query: exact skill name. Run capability_search action=list first.",
							},
						],
						details: { action, count: 0 },
					};
				}
				const skill = skills.find((candidate) => normalize(candidate.name) === name);
				if (!skill) {
					return {
						content: [
							{
								type: "text",
								text: `No loaded skill named ${JSON.stringify(args.query)}. Use action=search to find it.`,
							},
						],
						details: { action, count: 0 },
					};
				}
				try {
					const body = readFileSync(skill.filePath, "utf8");
					return {
						content: [
							{
								type: "text",
								text: `<skill name="${skill.name}" stack="${skill.stack ?? "meta"}" location="${skill.filePath}">\n${body}\n</skill>`,
							},
						],
						details: { action, count: 1 },
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: `Could not load skill ${skill.name}: ${message}` }],
						details: { action, count: 0 },
					};
				}
			}

			if (action === "list") {
				const text = [
					"Porcupine capability catalog",
					`Tools: ${tools.length} | Skills: ${skills.length}`,
					"",
					formatStacksCommandOutput(tree),
					"",
					"Use action=search with task words, a name, or stack:vcs. Use action=view with an exact skill name to load it.",
				].join("\n");
				return { content: [{ type: "text", text }], details: { action, count: tools.length + skills.length } };
			}

			const query = args.query?.trim();
			if (!query) {
				return {
					content: [
						{ type: "text", text: "search requires query. Try task words, github, stack:vcs, or web_search." },
					],
					details: { action, count: 0 },
				};
			}
			const hits = searchStacks(tree, query, {
				kinds,
				limit: Math.max(1, Math.min(50, Math.floor(args.limit ?? 20))),
			});
			if (hits.length === 0 && kind !== "tool") {
				// Skill names are also useful as exact menu keys, independent of fuzzy tree scoring.
				const matchedSkills = skills.filter((skill) =>
					`${skill.name} ${skill.description} ${skill.stack ?? ""}`.toLowerCase().includes(query.toLowerCase()),
				);
				if (matchedSkills.length)
					return {
						content: [{ type: "text", text: formatSkillList(matchedSkills) }],
						details: { action, count: matchedSkills.length },
					};
			}
			if (hits.length === 0) {
				return {
					content: [
						{ type: "text", text: `No ${kind} capabilities matched ${JSON.stringify(query)}. Try action=list.` },
					],
					details: { action, count: 0 },
				};
			}
			const text = hits
				.map(({ capability, score, reasons }) => {
					const name = capability.id.replace(/^(tool|skill):/, "");
					const viewHint =
						capability.kind === "skill"
							? `\n  then: capability_search(action=view, query=${JSON.stringify(name)})`
							: "";
					return `• ${capability.kind}:${name}\n  path: ${capability.path.join("/")}\n  ${capability.description ?? ""}\n  why: ${(reasons ?? []).join(", ")} score=${score}${viewHint}`;
				})
				.join("\n\n");
			return {
				content: [{ type: "text", text: `Capability search: ${query}\n\n${text}` }],
				details: { action, count: hits.length },
			};
		},
		renderCall(args) {
			const action = args?.action ?? (args?.query ? "search" : "list");
			return new Text(
				`${theme.fg("toolTitle", theme.bold("capability_search"))} ${theme.fg("toolOutput", `${action}${args?.query ? `: ${args.query}` : ""}`)}`,
				0,
				0,
			);
		},
		renderResult(result, renderOptions) {
			const text = result.content
				.map((item) => (item.type === "text" ? item.text : ""))
				.join("")
				.trim();
			return new Text(
				`\n${theme.fg("toolOutput", renderOptions.expanded ? text : text.split("\n").slice(0, 18).join("\n"))}`,
				0,
				0,
			);
		},
	};
}

export function createCapabilitySearchTool(
	options?: CapabilitySearchToolOptions,
): AgentTool<typeof capabilitySearchSchema> {
	return wrapToolDefinition(createCapabilitySearchToolDefinition(options));
}
