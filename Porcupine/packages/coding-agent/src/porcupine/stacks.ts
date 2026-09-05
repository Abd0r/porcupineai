/**
 * Porcupine Skills/Tools Stack tree.
 *
 * Everything the agent can use is hung under a stable stack path so search is
 * hierarchical and predictable:
 *
 *   stacks/<stackId>/<lane>/<name>
 *
 * Example:
 *   stacks/web/search/web_search
 *   stacks/web/fetch/web_extract
 *   stacks/web/playbook/free-web-search   (skill)
 */

import type { CapabilityDescriptor, CapabilityKind, CapabilityTree } from "@porcupineai/agent-core";

/** Top-level stack (product area). */
export interface StackDefinition {
	id: string;
	label: string;
	description: string;
	/** Extra search tags / aliases. */
	tags: string[];
	/** Display order (lower first). */
	order: number;
}

/** Where a concrete tool lives inside a stack. */
export interface ToolStackPlacement {
	stack: string;
	/** Sub-path under the stack, e.g. ["search"] or ["mutate"]. */
	lane: string[];
	tags: string[];
}

export const PORCUPINE_STACKS: readonly StackDefinition[] = [
	{
		id: "filesystem",
		label: "Filesystem",
		description: "Read and write local files.",
		tags: ["file", "fs", "path", "disk", "io"],
		order: 10,
	},
	{
		id: "discovery",
		label: "Discovery",
		description: "List, find, and search inside the codebase.",
		tags: ["search", "find", "grep", "list", "navigate", "codebase"],
		order: 20,
	},
	{
		id: "coding",
		label: "Coding Workflow",
		description: "Plan, implement, test, review, and harden software changes.",
		tags: ["coding", "code", "implementation", "tdd", "review", "security", "refactor", "planning"],
		order: 25,
	},
	{
		id: "shell",
		label: "Shell",
		description: "Run shell/bash commands, builds, git, package managers.",
		tags: ["bash", "terminal", "command", "cli", "process", "npm", "git"],
		order: 30,
	},
	{
		id: "web",
		label: "Web & Search",
		description: "Free internet search cascade and page extraction.",
		tags: ["internet", "http", "url", "browser", "docs", "lookup", "searxng", "brave", "ddg"],
		order: 40,
	},
	{
		id: "webdev",
		label: "Web Development",
		description: "Build, inspect, test, secure, and ship production web applications.",
		tags: [
			"webdev",
			"frontend",
			"backend",
			"fullstack",
			"html",
			"css",
			"javascript",
			"typescript",
			"api",
			"accessibility",
			"responsive",
			"browser",
		],
		order: 43,
	},
	{
		id: "computer",
		label: "Computer Use",
		description: "Observe and operate the local macOS GUI with explicit approval.",
		tags: ["computer", "desktop", "gui", "screen", "screenshot", "accessibility", "mouse", "keyboard"],
		order: 45,
	},
	{
		id: "vcs",
		label: "Version Control",
		description: "Git workflows, branches, diffs, PRs (usually via shell + skills).",
		tags: ["git", "github", "pr", "commit", "branch", "diff", "merge"],
		order: 50,
	},
	{
		id: "build",
		label: "Build & Test",
		description: "Compile, test, lint, typecheck, CI loops.",
		tags: ["test", "vitest", "jest", "pytest", "lint", "tsc", "ci", "build"],
		order: 60,
	},
	{
		id: "debug",
		label: "Debug",
		description: "Diagnose failures, logs, stack traces, regressions.",
		tags: ["bug", "error", "trace", "fix", "diagnose", "repro"],
		order: 70,
	},
	{
		id: "reasoning",
		label: "Reasoning",
		description: "Thinking depth, adaptive effort, plan/no-plan personality.",
		tags: ["think", "adaptive", "plan", "effort", "depth"],
		order: 80,
	},
	{
		id: "safety",
		label: "Safety",
		description: "Auto Mode bash gate, destructive-command caution, trust.",
		tags: ["auto", "approve", "danger", "guard", "trust", "secure"],
		order: 90,
	},
	{
		id: "docs",
		label: "Docs & Writing",
		description: "README, guides, comments, release notes.",
		tags: ["readme", "markdown", "document", "writeup", "changelog"],
		order: 100,
	},
	{
		id: "data",
		label: "Data & Formats",
		description: "JSON, CSV, YAML, tables, parsing, transforms.",
		tags: ["json", "csv", "yaml", "xml", "table", "parse", "transform"],
		order: 110,
	},
	{
		id: "sci",
		label: "Scientific Research",
		description: "Literature review, reproducible experiments, data analysis, research writing, and fair evals.",
		tags: [
			"research",
			"paper",
			"literature",
			"citation",
			"experiment",
			"reproducible",
			"dataset",
			"analysis",
			"eval",
			"doi",
		],
		order: 115,
	},
	{
		id: "ml",
		label: "ML & Research",
		description: "Models, training, evals, papers, datasets.",
		tags: ["model", "train", "eval", "dataset", "paper", "research", "gpu"],
		order: 120,
	},
	{
		id: "orchestration",
		label: "Orchestration",
		description: "Multi-step plans, capability routing, session prepare.",
		tags: ["plan", "route", "workflow", "pipeline", "steps"],
		order: 130,
	},
	{
		id: "meta",
		label: "Meta",
		description: "Agent self-config, skills authoring, stack inspection.",
		tags: ["skill", "stack", "config", "agent", "extension", "theme"],
		order: 140,
	},
] as const;

const STACK_BY_ID = new Map(PORCUPINE_STACKS.map((s) => [s.id, s]));

/** Built-in tool → stack placement. */
export const TOOL_STACK_MAP: Readonly<Record<string, ToolStackPlacement>> = {
	read: { stack: "filesystem", lane: ["read"], tags: ["read", "open", "cat", "inspect"] },
	write: { stack: "filesystem", lane: ["write"], tags: ["create", "save", "overwrite"] },
	edit: { stack: "filesystem", lane: ["edit"], tags: ["patch", "modify", "change", "update"] },
	ls: { stack: "discovery", lane: ["list"], tags: ["ls", "dir", "tree", "browse"] },
	find: { stack: "discovery", lane: ["find"], tags: ["glob", "locate", "filename"] },
	grep: { stack: "discovery", lane: ["search"], tags: ["rg", "content", "regex", "match"] },
	bash: { stack: "shell", lane: ["exec"], tags: ["shell", "run", "command", "terminal"] },
	web_search: {
		stack: "web",
		lane: ["search"],
		tags: ["search", "searxng", "brave", "duckduckgo", "wikipedia", "mojeek", "lookup"],
	},
	web_extract: {
		stack: "web",
		lane: ["fetch"],
		tags: ["extract", "fetch", "url", "page", "html", "scrape"],
	},
	browser_navigate: {
		stack: "webdev",
		lane: ["browser", "navigate"],
		tags: ["browser", "playwright", "page", "open", "url"],
	},
	browser_click: {
		stack: "webdev",
		lane: ["browser", "interact"],
		tags: ["browser", "playwright", "click", "selector", "aria-ref"],
	},
	browser_type: {
		stack: "webdev",
		lane: ["browser", "interact"],
		tags: ["browser", "playwright", "type", "fill", "form", "input"],
	},
	browser_extract: {
		stack: "webdev",
		lane: ["browser", "inspect"],
		tags: ["browser", "playwright", "text", "dom", "extract"],
	},
	browser_screenshot: {
		stack: "webdev",
		lane: ["browser", "visual"],
		tags: ["browser", "playwright", "screenshot", "visual", "responsive"],
	},
	browser_evaluate: {
		stack: "webdev",
		lane: ["browser", "script"],
		tags: ["browser", "playwright", "javascript", "evaluate", "dom"],
	},
	browser_snapshot: {
		stack: "webdev",
		lane: ["browser", "semantic"],
		tags: ["browser", "playwright", "aria", "accessibility", "snapshot", "role", "semantic"],
	},
	browser_resize: {
		stack: "webdev",
		lane: ["browser", "responsive"],
		tags: ["browser", "playwright", "viewport", "mobile", "tablet", "desktop", "responsive"],
	},
	browser_wait: {
		stack: "webdev",
		lane: ["browser", "sync"],
		tags: ["browser", "playwright", "wait", "selector", "async", "state"],
	},
	browser_diagnostics: {
		stack: "webdev",
		lane: ["browser", "diagnostics"],
		tags: ["browser", "playwright", "console", "pageerror", "network", "request", "diagnostics"],
	},
	computer_use: {
		stack: "computer",
		lane: ["native", "desktop"],
		tags: [
			"computer",
			"desktop",
			"gui",
			"screen",
			"screenshot",
			"click",
			"type",
			"keyboard",
			"macos",
			"linux",
			"windows",
			"wayland",
			"x11",
		],
	},
	memory: {
		stack: "meta",
		lane: ["memory"],
		tags: ["memory", "remember", "user", "profile", "durable", "note"],
	},
	plan: {
		stack: "orchestration",
		lane: ["plan"],
		tags: ["plan", "todo", "milestone", "steps", "verify", "evidence", "multi-step"],
	},
	session_search: {
		stack: "meta",
		lane: ["history"],
		tags: ["session", "history", "search", "recall", "past", "transcript"],
	},
};

/** Keyword → preferred stack for skill classification. */
const SKILL_STACK_RULES: Array<{ stack: string; lane: string; pattern: RegExp }> = [
	{
		stack: "webdev",
		lane: "playbook",
		pattern:
			/\b(web.?dev|frontend|backend|full.?stack|html|css|responsive|design.?system|accessibility|wcag|aria|http.?api|openapi|seo|lighthouse|web.?vitals)\b/i,
	},
	{
		stack: "computer",
		lane: "playbook",
		pattern: /\b(computer|desktop|gui|screen|screenshot|click|keyboard|mouse|accessibility)\b/i,
	},
	{ stack: "web", lane: "playbook", pattern: /\b(web|search|internet|http|url|browser|fetch|scrap)/i },
	{ stack: "vcs", lane: "playbook", pattern: /\b(git|github|pr|pull.?request|commit|branch|merge)/i },
	{ stack: "build", lane: "playbook", pattern: /\b(test|vitest|jest|pytest|lint|ci|build|compile)/i },
	{ stack: "debug", lane: "playbook", pattern: /\b(debug|bug|error|trace|diagnose|repro)/i },
	{ stack: "docs", lane: "playbook", pattern: /\b(doc|readme|markdown|changelog|writing)/i },
	{ stack: "data", lane: "playbook", pattern: /\b(json|csv|yaml|data|parse|transform|table)/i },
	{ stack: "ml", lane: "playbook", pattern: /\b(ml|model|train|eval|dataset|paper|research|gpu)/i },
	{ stack: "safety", lane: "playbook", pattern: /\b(safe|security|trust|approv|danger|guard)/i },
	{ stack: "reasoning", lane: "playbook", pattern: /\b(reason|think|adaptive|plan.?mode)/i },
	{ stack: "orchestration", lane: "playbook", pattern: /\b(orchestr|workflow|pipeline|multi.?step)/i },
	{ stack: "shell", lane: "playbook", pattern: /\b(shell|bash|terminal|cli|command)/i },
	{ stack: "filesystem", lane: "playbook", pattern: /\b(file|fs|edit|write|read)/i },
	{ stack: "meta", lane: "playbook", pattern: /\b(skill|stack|agent|extension|config)/i },
];

export function getStack(id: string): StackDefinition | undefined {
	return STACK_BY_ID.get(id);
}

export function listStacks(): StackDefinition[] {
	return [...PORCUPINE_STACKS].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function resolveToolPlacement(toolName: string): ToolStackPlacement {
	const known = TOOL_STACK_MAP[toolName];
	if (known) return known;
	return {
		stack: "meta",
		lane: ["tool"],
		tags: [toolName, "tool"],
	};
}

export interface SkillStackHint {
	/** Explicit stack id from frontmatter / caller / path. */
	stack?: string;
	name: string;
	description?: string;
	/** Absolute or relative skill file path (used to infer stack from skills/<stack>/...). */
	filePath?: string;
	/** Extra tags from skill metadata. */
	tags?: string[];
}

/** Known stack ids for path inference. */
export function isKnownStackId(id: string | undefined | null): boolean {
	return Boolean(id && STACK_BY_ID.has(id.toLowerCase()));
}

/**
 * Infer stack id from a skill path under .../skills/<stack>/<name>/SKILL.md
 * or .../skills/<name>/SKILL.md (no stack folder).
 */
export function inferStackFromSkillPath(filePath: string | undefined): string | undefined {
	if (!filePath) return undefined;
	const posix = filePath.replace(/\\/g, "/");
	const parts = posix.split("/");
	const skillsIdx = parts.lastIndexOf("skills");
	if (skillsIdx < 0 || skillsIdx + 1 >= parts.length) return undefined;
	const after = parts[skillsIdx + 1]!;
	if (isKnownStackId(after)) return after.toLowerCase();
	return undefined;
}

export function classifySkillStack(skill: SkillStackHint): { stack: string; lane: string[]; tags: string[] } {
	const pathStack = inferStackFromSkillPath(skill.filePath);
	const explicit = (skill.stack?.trim() || pathStack || "").toLowerCase();
	if (explicit && STACK_BY_ID.has(explicit)) {
		const learned = skill.name.startsWith("learned-") || /\/learned-/.test(skill.filePath ?? "");
		return {
			stack: explicit,
			lane: [learned ? "learned" : "playbook"],
			tags: uniqueTags([explicit, skill.name, ...(skill.tags ?? [])]),
		};
	}

	const haystack = `${skill.name} ${skill.description ?? ""}`;
	for (const rule of SKILL_STACK_RULES) {
		if (rule.pattern.test(haystack)) {
			return {
				stack: rule.stack,
				lane: [rule.lane],
				tags: uniqueTags([rule.stack, rule.lane, skill.name, ...(skill.tags ?? [])]),
			};
		}
	}

	return {
		stack: "meta",
		lane: ["playbook"],
		tags: uniqueTags(["meta", "skill", skill.name, ...(skill.tags ?? [])]),
	};
}

function uniqueTags(tags: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of tags) {
		for (const part of raw.toLowerCase().split(/[^a-z0-9]+/)) {
			if (!part || part.length < 2) continue;
			if (seen.has(part)) continue;
			seen.add(part);
			out.push(part);
		}
	}
	return out;
}

export function toolCapabilityPath(toolName: string): string[] {
	const place = resolveToolPlacement(toolName);
	return ["stacks", place.stack, ...place.lane, toolName];
}

export function skillCapabilityPath(skill: SkillStackHint): string[] {
	const place = classifySkillStack(skill);
	return ["stacks", place.stack, ...place.lane, skill.name];
}

export function describeToolCapability(options: {
	name: string;
	description?: string;
	promptSnippet?: string;
	available?: boolean;
}): CapabilityDescriptor {
	const place = resolveToolPlacement(options.name);
	const stack = getStack(place.stack);
	return {
		id: `tool:${options.name}`,
		kind: "tool",
		path: toolCapabilityPath(options.name),
		description: options.description || options.promptSnippet || `Tool ${options.name}`,
		tags: uniqueTags(["tool", options.name, place.stack, ...(stack?.tags ?? []), ...place.tags, ...place.lane]),
		available: options.available !== false,
	};
}

export function describeSkillCapability(options: {
	name: string;
	description?: string;
	stack?: string;
	tags?: string[];
	filePath?: string;
	available?: boolean;
}): CapabilityDescriptor {
	const place = classifySkillStack(options);
	const stack = getStack(place.stack);
	return {
		id: `skill:${options.name}`,
		kind: "skill",
		path: skillCapabilityPath(options),
		description: options.description || `Skill ${options.name}`,
		tags: uniqueTags([
			"skill",
			options.name,
			place.stack,
			...(stack?.tags ?? []),
			...place.tags,
			...(options.tags ?? []),
		]),
		available: options.available !== false,
	};
}

/** Render nested CapabilityTree.project() as a readable ASCII tree. */
export function formatCapabilityProjection(
	projection: ReturnType<CapabilityTree["project"]>,
	options: { maxDepth?: number; indent?: string } = {},
): string {
	const maxDepth = options.maxDepth ?? 8;
	const lines: string[] = [];

	const walk = (node: ReturnType<CapabilityTree["project"]>, prefix: string, depth: number) => {
		if (depth > maxDepth) return;
		const caps = node.capabilities ?? [];
		for (const id of caps) {
			lines.push(`${prefix}• ${id}`);
		}
		const children = node.children ?? {};
		const keys = Object.keys(children).sort();
		for (const key of keys) {
			lines.push(`${prefix}${key}/`);
			walk(children[key]!, `${prefix}  `, depth + 1);
		}
	};

	walk(projection, "", 0);
	return lines.join("\n");
}

/** Human overview of stacks + how many capabilities hang under each. */
export function formatStacksOverview(
	tree: CapabilityTree,
	options: { kinds?: CapabilityKind[]; includeUnavailable?: boolean } = {},
): string {
	const caps = tree.list({ includeUnavailable: options.includeUnavailable });
	const filtered = options.kinds ? caps.filter((c) => options.kinds!.includes(c.kind)) : caps;
	const byStack = new Map<string, { tools: string[]; skills: string[] }>();

	for (const stack of listStacks()) {
		byStack.set(stack.id, { tools: [], skills: [] });
	}
	byStack.set("other", { tools: [], skills: [] });

	for (const cap of filtered) {
		const stackId = cap.path[0] === "stacks" && cap.path[1] ? cap.path[1]! : "other";
		if (!byStack.has(stackId)) byStack.set(stackId, { tools: [], skills: [] });
		const bucket = byStack.get(stackId)!;
		const short = cap.id.replace(/^(tool|skill):/, "");
		if (cap.kind === "tool") bucket.tools.push(short);
		else bucket.skills.push(short);
	}

	const lines: string[] = ["Porcupine stacks (tools + skills)", ""];
	for (const stack of listStacks()) {
		const bucket = byStack.get(stack.id)!;
		const n = bucket.tools.length + bucket.skills.length;
		if (n === 0) continue;
		lines.push(`${stack.label}  [${stack.id}]  — ${stack.description}`);
		if (bucket.tools.length) lines.push(`  tools:  ${bucket.tools.sort().join(", ")}`);
		if (bucket.skills.length) lines.push(`  skills: ${bucket.skills.sort().join(", ")}`);
		lines.push("");
	}

	const other = byStack.get("other")!;
	if (other.tools.length + other.skills.length > 0) {
		lines.push("Other");
		if (other.tools.length) lines.push(`  tools:  ${other.tools.sort().join(", ")}`);
		if (other.skills.length) lines.push(`  skills: ${other.skills.sort().join(", ")}`);
	}

	return lines.join("\n").trimEnd();
}

/**
 * Search the stack tree. Prefer stack id / path hits, then tags, then free text.
 * Thin wrapper that keeps stack-aware query sugar (e.g. "web/", "stack:vcs").
 */
export function searchStacks(
	tree: CapabilityTree,
	query: string,
	options: { kinds?: CapabilityKind[]; includeUnavailable?: boolean; limit?: number } = {},
) {
	const q = (query || "").trim();
	if (!q) {
		return tree
			.list({ includeUnavailable: options.includeUnavailable })
			.filter((c) => !options.kinds || options.kinds.includes(c.kind))
			.slice(0, options.limit ?? 50)
			.map((capability) => ({ capability, score: 1, reasons: ["list"] }));
	}

	// stack:<id> or trailing slash stack path
	const stackOnly = q.match(/^stack:([a-z0-9-]+)$/i) || q.match(/^([a-z0-9-]+)\/$/i);
	if (stackOnly) {
		const stackId = stackOnly[1]!.toLowerCase();
		return tree
			.list({ includeUnavailable: options.includeUnavailable })
			.filter((c) => (!options.kinds || options.kinds.includes(c.kind)) && c.path.includes(stackId))
			.map((capability) => ({
				capability,
				score: 50,
				reasons: [`stack:${stackId}`],
			}))
			.slice(0, options.limit ?? 50);
	}

	return tree.search(q, options);
}

/** Compact one-screen stack table for system prompts (no live counts). */
export function formatStacksCompact(): string {
	const lines = [
		"Porcupine capability stacks (routing labels — not separate executors):",
		"Path form: stacks/<stack>/<lane>/<name>",
	];
	for (const stack of listStacks()) {
		lines.push(`- ${stack.id}: ${stack.description}`);
	}
	lines.push("Use /stacks [query] to inspect live tools+skills. Prefer stack search over guessing tool names.");
	return lines.join("\n");
}

/** Format /stacks slash output. Empty query = overview; otherwise search. */
export function formatStacksCommandOutput(tree: CapabilityTree, query = ""): string {
	const q = query.trim();
	if (!q) {
		const overview = formatStacksOverview(tree);
		const projection = formatCapabilityProjection(tree.project(), { maxDepth: 5 });
		return `${overview}\n\n── search tree ──\n${projection}\n\nTip: /stacks web   /stacks stack:vcs   /stacks memory`;
	}

	const hits = searchStacks(tree, q, { limit: 30 });
	if (hits.length === 0) {
		return `No stack matches for ${JSON.stringify(q)}.\nTry a stack id (web, vcs, build, meta) or a tool/skill name.`;
	}

	const lines = [`Stack search: ${q}  (${hits.length} hit${hits.length === 1 ? "" : "s"})`, ""];
	for (const hit of hits) {
		const cap = hit.capability;
		const path = cap.path.join("/");
		lines.push(`• ${cap.kind}:${cap.id.replace(/^(tool|skill):/, "")}`);
		lines.push(`  path: ${path}`);
		if (cap.description) lines.push(`  ${cap.description.slice(0, 140)}`);
		if (hit.reasons?.length) lines.push(`  why: ${hit.reasons.join(", ")}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}
