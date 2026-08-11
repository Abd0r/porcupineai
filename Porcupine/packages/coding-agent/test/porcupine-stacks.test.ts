import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/core/skills.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import {
	buildCapabilityTreeFromSession,
	classifySkillStack,
	createAutonomousCapabilityLearner,
	formatStacksCommandOutput,
	formatStacksCompact,
	inferStackFromSkillPath,
	listStacks,
	resolveToolPlacement,
	searchStacks,
	TOOL_STACK_MAP,
	toolCapabilityPath,
} from "../src/porcupine/index.ts";

describe("tools/skills stacks", () => {
	it("maps every default tool to a known stack", () => {
		const stackIds = new Set(listStacks().map((s) => s.id));
		const defaults = ["read", "bash", "edit", "write", "web_search", "web_extract", "memory", "session_search"];
		for (const name of defaults) {
			const place = resolveToolPlacement(name);
			expect(stackIds.has(place.stack), `${name} → ${place.stack}`).toBe(true);
			expect(TOOL_STACK_MAP[name] || place.stack).toBeTruthy();
			const path = toolCapabilityPath(name);
			expect(path[0]).toBe("stacks");
			expect(path[1]).toBe(place.stack);
			expect(path.at(-1)).toBe(name);
		}
	});

	it("registers the webdev stack and places every browser tool under it", () => {
		const webdev = listStacks().find((stack) => stack.id === "webdev");
		expect(webdev?.label).toBe("Web Development");
		const browserTools = [
			"browser_navigate",
			"browser_snapshot",
			"browser_click",
			"browser_type",
			"browser_wait",
			"browser_extract",
			"browser_resize",
			"browser_diagnostics",
			"browser_screenshot",
			"browser_evaluate",
		];
		for (const name of browserTools) {
			expect(resolveToolPlacement(name).stack, name).toBe("webdev");
			expect(toolCapabilityPath(name).slice(0, 3), name).toEqual(["stacks", "webdev", "browser"]);
		}
	});

	it("searchStacks finds web tools", () => {
		const tree = buildCapabilityTreeFromSession({
			tools: [
				{ name: "web_search", description: "Search the web" },
				{ name: "web_extract", description: "Extract a URL" },
				{ name: "read", description: "Read a file" },
			],
			skills: [
				{
					name: "free-web-search",
					description: "Free cascade search",
					stack: "web",
					filePath: "/x/skills/web/free-web-search/SKILL.md",
				},
			],
		});
		const hits = searchStacks(tree, "web");
		const ids = hits.map((h) => h.capability.id);
		expect(ids.some((id) => id.includes("web_search"))).toBe(true);
		expect(formatStacksCommandOutput(tree, "web")).toContain("web_search");
		expect(formatStacksCommandOutput(tree, "")).toContain("Web & Search");
	});

	it("infers stack from skills/<stack>/ path and frontmatter", () => {
		expect(inferStackFromSkillPath("/a/skills/vcs/git-basics/SKILL.md")).toBe("vcs");
		expect(inferStackFromSkillPath("/a/skills/git-basics/SKILL.md")).toBeUndefined();

		const classified = classifySkillStack({
			name: "git-basics",
			description: "git stuff",
			filePath: "/a/skills/vcs/git-basics/SKILL.md",
		});
		expect(classified.stack).toBe("vcs");
		expect(classified.lane[0]).toBe("playbook");

		const coding = classifySkillStack({
			name: "test-driven-development",
			description: "Prove behavior with tests",
			filePath: "/a/skills/coding/test-driven-development/SKILL.md",
			stack: "coding",
		});
		expect(coding.stack).toBe("coding");
		expect(coding.lane[0]).toBe("playbook");

		const learned = classifySkillStack({
			name: "learned-foo",
			filePath: "/a/skills/build/learned-foo/SKILL.md",
			stack: "build",
		});
		expect(learned.lane[0]).toBe("learned");
	});

	it("loads all shipped webdev skills into the webdev stack", () => {
		const result = loadSkillsFromDir({ dir: join(process.cwd(), "skills", "webdev"), source: "package" });
		expect(result.diagnostics.filter((diagnostic) => diagnostic.type === "error")).toEqual([]);
		expect(result.skills).toHaveLength(12);
		expect(new Set(result.skills.map((skill) => skill.stack))).toEqual(new Set(["webdev"]));
	});

	it("loads nested stack skills with stack field", () => {
		const dir = mkdtempSync(join(tmpdir(), "porcupine-skills-"));
		const skillDir = join(dir, "debug", "repro-fix");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: repro-fix
description: Reproduce bugs then fix.
stack: debug
---

# Repro
`,
		);
		const result = loadSkillsFromDir({ dir, source: "user" });
		expect(result.skills.length).toBe(1);
		expect(result.skills[0]!.stack).toBe("debug");
		expect(result.skills[0]!.name).toBe("repro-fix");
	});

	it("capability learning writes under skills/<stack>/learned-*", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-learn-stack-"));
		const learner = createAutonomousCapabilityLearner(agentDir);
		const result = await learner.learn({
			type: "missing-capability",
			description: "No capability for git PR workflow",
			evidence: ["unmatched query: open pull request"],
		});
		expect(result.status).toBe("activated");
		const id = result.proposal!.id;
		const path = join(agentDir, "skills", "vcs", id, "SKILL.md");
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf8")).toContain("stack: vcs");
	});

	it("system prompt includes compact stacks block", () => {
		const prompt = buildSystemPrompt({
			cwd: "/tmp",
			skipMemory: true,
			selectedTools: ["read"],
			toolSnippets: { read: "Read files" },
		});
		expect(prompt).toContain("<porcupine_stacks>");
		expect(prompt).toContain("stacks/<stack>/<lane>/<name>");
		expect(formatStacksCompact()).toContain("web:");
		expect(formatStacksCompact()).toContain("webdev:");
	});

	it("registers /stacks builtin slash command", () => {
		expect(BUILTIN_SLASH_COMMANDS.some((c) => c.name === "stacks")).toBe(true);
	});

	it("projects skills into stack paths on the capability tree", () => {
		const tree = buildCapabilityTreeFromSession({
			tools: [{ name: "memory", description: "Durable memory" }],
			skills: [
				{
					name: "memory-hygiene",
					description: "memory hygiene",
					stack: "meta",
					filePath: "/skills/meta/memory-hygiene/SKILL.md",
				},
			],
		});
		const caps = tree.list();
		const skill = caps.find((c) => c.kind === "skill" && c.id.includes("memory-hygiene"));
		expect(skill).toBeTruthy();
		expect(skill!.path.slice(0, 3)).toEqual(["stacks", "meta", "playbook"]);
	});
});
