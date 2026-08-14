import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("PROMPT.md / PERSONALITY.md loading", () => {
	it("appends PERSONALITY.md and PROMPT.md without replacing tools", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-agent-"));
		const cwd = mkdtempSync(join(tmpdir(), "porcupine-cwd-"));
		writeFileSync(join(agentDir, "PROMPT.md"), "PROMPT_IDENTITY_MARKER");
		writeFileSync(join(agentDir, "PERSONALITY.md"), "PERSONALITY_MARKER");

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();

		expect(loader.getSystemPrompt()).toBeUndefined();
		const append = loader.getAppendSystemPrompt().join("\n");
		expect(append).toContain("PERSONALITY_MARKER");
		expect(append).toContain("PROMPT_IDENTITY_MARKER");
		const sources = loader.getAppendSystemPromptSources().map((s) => s.path);
		expect(sources.some((p) => p.endsWith("PERSONALITY.md"))).toBe(true);
		expect(sources.some((p) => p.endsWith("PROMPT.md"))).toBe(true);
	});

	it("loads PERSONALITY.md and PROMPT.md once on a case-insensitive filesystem", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-agent-"));
		const cwd = mkdtempSync(join(tmpdir(), "porcupine-cwd-"));
		writeFileSync(join(agentDir, "PROMPT.md"), "PROMPT_ONCE");
		writeFileSync(join(agentDir, "PERSONALITY.md"), "PERSONALITY_ONCE");

		const settingsManager = SettingsManager.create(cwd, agentDir);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();

		const append = loader.getAppendSystemPrompt().join("\n\n");
		expect(append.split("PERSONALITY_ONCE").length - 1).toBe(1);
		expect(append.split("PROMPT_ONCE").length - 1).toBe(1);
		expect(loader.getAppendSystemPromptSources()).toHaveLength(2);
	});

	it("still accepts legacy mixed-case Prompt.md", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-agent-"));
		const cwd = mkdtempSync(join(tmpdir(), "porcupine-cwd-"));
		writeFileSync(join(agentDir, "Prompt.md"), "LEGACY_PROMPT");
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		expect(loader.getAppendSystemPrompt().join("\n")).toContain("LEGACY_PROMPT");
	});

	it("loads SYSTEM.md as full replace when present", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-agent-"));
		const cwd = mkdtempSync(join(tmpdir(), "porcupine-cwd-"));
		writeFileSync(join(agentDir, "SYSTEM.md"), "FULL_SYSTEM_REPLACE");
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		expect(loader.getSystemPrompt()).toBe("FULL_SYSTEM_REPLACE");
	});

	it("keeps code personality even with customPrompt", () => {
		const prompt = buildSystemPrompt({
			cwd: "/tmp",
			customPrompt: "Custom only.",
			selectedTools: ["read", "bash"],
			toolSnippets: { read: "Read files", bash: "Shell" },
		});
		expect(prompt).toContain("Custom only.");
		expect(prompt).toContain("porcupine_personality");
		expect(prompt).toContain("Chit-chat");
		expect(prompt).toContain("Use ask_question only for a genuine user-owned decision");
		expect(prompt).toContain("read the relevant shipped docs/ file before answering");
		expect(prompt).toContain("Plan mode is inspection-only and produces an implementation-ready artifact");
		expect(prompt).toContain("Cron only fires while the interactive session is open and idle");
	});
});
