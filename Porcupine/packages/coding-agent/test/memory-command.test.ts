import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { processPostTurnLearning } from "../src/porcupine/learning-store.ts";
import { formatMemoryReport, parseMemoryCommand } from "../src/porcupine/memory-command.ts";
import { mutateMemory } from "../src/porcupine/memory-store.ts";

describe("/memory command", () => {
	it("parses the viewer command and rejects nothing meaningful", () => {
		expect(parseMemoryCommand("/memory")).toEqual({ kind: "show" });
		expect(parseMemoryCommand("/memory anywhere")).toEqual({ kind: "show" });
		expect(parseMemoryCommand("/memorying")).toBeNull();
		expect(parseMemoryCommand("not a command")).toBeNull();
	});

	it("renders stored USER.md and MEMORY.md entries with their source paths", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-command-"));
		mutateMemory(agentDir, "add", "user", { content: "Prefers pnpm over npm." });
		mutateMemory(agentDir, "add", "memory", { content: "Repo uses a pnpm workspace." });

		const report = formatMemoryReport(agentDir);
		expect(report).toContain("USER.md");
		expect(report).toContain(join(agentDir, "USER.md"));
		expect(report).toContain("Prefers pnpm over npm.");
		expect(report).toContain("MEMORY.md");
		expect(report).toContain(join(agentDir, "MEMORY.md"));
		expect(report).toContain("Repo uses a pnpm workspace.");
	});

	it("renders relative empty-state when nothing is stored yet", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-empty-"));
		const report = formatMemoryReport(agentDir);
		expect(report).toContain("(nothing stored yet)");
		expect(report).toContain("no autonomous improvements recorded yet");
	});

	it("renders recent learning evidence with status when records exist", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-evidence-"));
		await processPostTurnLearning(
			agentDir,
			{
				userText: "Fix the build.",
				tools: [{ name: "bash", isError: true }],
				sessionId: "s-mem",
			},
			{ enableCapabilityLearning: true },
		);

		const report = formatMemoryReport(agentDir);
		expect(report).toContain("Learning evidence");
		expect(report).toContain("[activated]");
		expect(report).toContain("[skill]");
		expect(report).toContain("recovery guidance for failed bash calls");
	});

	it("is a read-only viewer: reading never mutates USER.md or MEMORY.md", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-readonly-"));
		writeFileSync(join(agentDir, "USER.md"), "# USER\n- Existing entry\n", "utf8");
		const before = readFileSync(join(agentDir, "USER.md"), "utf8");
		formatMemoryReport(agentDir);
		expect(readFileSync(join(agentDir, "USER.md"), "utf8")).toBe(before);
	});

	it("registers the command for help and autocomplete", () => {
		expect(BUILTIN_SLASH_COMMANDS).toContainEqual({
			name: "memory",
			description: "Show what Porcupine has stored about you and the environment",
		});
	});
});
