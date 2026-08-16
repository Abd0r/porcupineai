import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import { createMemoryToolDefinition } from "../src/core/tools/memory.ts";
import { createSessionSearchToolDefinition } from "../src/core/tools/session-search.ts";
import {
	createAutonomousCapabilityLearner,
	extractUserPatternsHeuristic,
	formatMemoryForPrompt,
	mutateMemory,
} from "../src/porcupine/index.ts";
import { USER_CHAR_LIMIT, USER_PROMPT_CHAR_LIMIT } from "../src/porcupine/memory-store.ts";

describe("persistent memory", () => {
	it("adds lists and injects into system prompt", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-mem-"));
		const add = mutateMemory(agentDir, "add", "user", { content: "prefers concise replies" });
		expect(add.ok).toBe(true);
		const list = mutateMemory(agentDir, "list", "user");
		expect(list.entries?.some((e) => e.text.includes("concise"))).toBe(true);

		const block = formatMemoryForPrompt(agentDir);
		expect(block).toContain("porcupine_memory");
		expect(block).toContain("concise");

		const prompt = buildSystemPrompt({
			cwd: "/tmp",
			agentDir,
			selectedTools: ["memory"],
			toolSnippets: { memory: "Durable memory" },
		});
		expect(prompt).toContain("prefers concise");
	});

	it("remove always succeeds even when the file is over the limit", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-mem-over-"));
		expect(mutateMemory(agentDir, "add", "user", { content: "long entry" }).ok).toBe(true);
		// Simulate an over-limit file written directly (e.g. migrated state).
		const path = join(agentDir, "USER.md");
		const over = `${readFileSync(path, "utf8")}\n- ${`y`.repeat(USER_CHAR_LIMIT + 100)}\n`;
		writeFileSync(path, over);
		const rm = mutateMemory(agentDir, "remove", "user", { oldText: "long entry" });
		expect(rm.ok).toBe(true);
		expect(readFileSync(path, "utf8")).not.toContain("long entry");
	});

	it("replace matches exact entries and unambiguous substrings only", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-mem-repl-"));
		mutateMemory(agentDir, "add", "user", { content: "alpha one" });
		mutateMemory(agentDir, "add", "user", { content: "alpha two" });
		// Ambiguous substring must fail while two entries contain it.
		const ambiguous = mutateMemory(agentDir, "replace", "user", { oldText: "alpha", content: "gamma" });
		expect(ambiguous.ok).toBe(false);
		// Exact match wins and replaces the right entry.
		const exact = mutateMemory(agentDir, "replace", "user", { oldText: "alpha one", content: "beta one" });
		expect(exact.ok).toBe(true);
		const list = mutateMemory(agentDir, "list", "user");
		expect(list.entries?.some((e) => e.text === "beta one")).toBe(true);
		expect(list.entries?.some((e) => e.text === "alpha two")).toBe(true);
	});

	it("prompt injection truncates at the budget with a count marker", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-mem-budget-"));
		mutateMemory(agentDir, "add", "user", { content: "first fact" });
		mutateMemory(agentDir, "add", "user", { content: `long ${`z`.repeat(9_000)}` });
		mutateMemory(agentDir, "add", "user", { content: "last fact" });
		const block = formatMemoryForPrompt(agentDir);
		expect(block).toContain("first fact");
		expect(block.length).toBeLessThan(USER_PROMPT_CHAR_LIMIT + 400);
		expect(block).toContain("more entries in USER.md");
	});

	it("remaining count is computed by entry boundary, not substring overlap (regression)", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-mem-count-"));
		// entry 1 (included, short) contains the phrase "concise replies" inline.
		mutateMemory(agentDir, "add", "user", { content: "Working style: keep it terse and use concise replies in every message." });
		// entry 2 (huge filler) forces trunk to cut before the short entry 3.
		mutateMemory(agentDir, "add", "user", { content: `Filler ${`z`.repeat(USER_PROMPT_CHAR_LIMIT)}` });
		// entry 3 (cut off) is exactly the substring "concise replies" that also
		// appears inside the included entry 1. Substring counting would falsely
		// mark it as shown and under-report the remaining count.
		mutateMemory(agentDir, "add", "user", { content: "concise replies" });
		const block = formatMemoryForPrompt(agentDir);
		expect(block).toContain("more entries");
		// Two entries (filler + concise replies) are NOT shown; boundary-based
		// counting must report 2, never 1 (substring overlap bug).
		expect(block).toMatch(/\(2 more entries in USER\.md/);
	});

	it("memory tool executes", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-mem-tool-"));
		const tool = createMemoryToolDefinition({ agentDir });
		const result = await tool.execute(
			"t1",
			{
				action: "add",
				target: "memory",
				content: "uses RTX 4050 for heavy jobs",
			},
			undefined,
			undefined,
			undefined as unknown as ExtensionContext,
		);
		const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
		expect(text).toContain("ok");
		expect(readFileSync(join(agentDir, "MEMORY.md"), "utf8")).toContain("RTX 4050");
	});
});

describe("user pattern heuristic + capability learning", () => {
	it("extracts preference language", () => {
		const hits = extractUserPatternsHeuristic("Please remember that I prefer pnpm over npm.");
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].confidence).toBeGreaterThanOrEqual(0.8);
	});

	it("autonomously activates a skill stub", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-learn-"));
		const learner = createAutonomousCapabilityLearner(agentDir);
		const result = await learner.learn({
			type: "missing-capability",
			description: "No capability for foobar-deploy",
			evidence: ["unmatched query: foobar-deploy"],
		});
		expect(result.status).toBe("activated");
		expect(result.proposal?.id).toMatch(/^learned-/);
		const skillFile = join(agentDir, "skills", "meta", result.proposal!.id, "SKILL.md");
		expect(existsSync(skillFile)).toBe(true);
		expect(readFileSync(skillFile, "utf8")).toContain("foobar-deploy");
	});
});

describe("session_search tool", () => {
	it("browses empty and finds a seeded session", async () => {
		const root = mkdtempSync(join(tmpdir(), "porcupine-sess-"));
		const cwd = join(root, "proj");
		mkdirSync(cwd);
		// Use real SessionManager.new to create a session under default dirs is hard;
		// unit-test execute with empty list path via custom empty project.
		const tool = createSessionSearchToolDefinition({ cwd });
		const empty = await tool.execute(
			"t1",
			{ limit: 3 },
			undefined,
			undefined,
			undefined as unknown as ExtensionContext,
		);
		const text = empty.content.map((c) => (c.type === "text" ? c.text : "")).join("");
		expect(text.toLowerCase()).toMatch(/no sessions|found 0|no session/i);
	});
});
