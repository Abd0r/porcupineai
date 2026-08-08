import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isValidThinkingLevel } from "../src/cli/args.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { loadThemeFromPath } from "../src/modes/interactive/theme/theme.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("max thinking level", () => {
	it("is accepted by CLI and settings", async () => {
		expect(isValidThinkingLevel("max")).toBe(true);

		const settings = SettingsManager.inMemory();
		settings.setDefaultThinkingLevel("max");
		await settings.flush();
		expect(settings.getDefaultThinkingLevel()).toBe("max");
	});

	it("falls back to thinkingXhigh for legacy themes", () => {
		const testDir = mkdtempSync(join(tmpdir(), "porcupine-max-theme-"));
		tempDirs.push(testDir);
		const currentDir = dirname(fileURLToPath(import.meta.url));
		const darkTheme = JSON.parse(
			readFileSync(join(currentDir, "../src/modes/interactive/theme/dark.json"), "utf8"),
		) as { name: string; colors: Record<string, unknown> };
		darkTheme.name = "legacy-theme";
		delete darkTheme.colors.thinkingMax;
		const themePath = join(testDir, "legacy-theme.json");
		writeFileSync(themePath, JSON.stringify(darkTheme));

		const legacyTheme = loadThemeFromPath(themePath);
		expect(legacyTheme.getThinkingBorderColor("max")("border")).toBe(
			legacyTheme.getThinkingBorderColor("xhigh")("border"),
		);
	});

	it("uses a distinct adaptive border while preserving legacy-theme fallback", () => {
		const testDir = mkdtempSync(join(tmpdir(), "porcupine-adaptive-theme-"));
		tempDirs.push(testDir);
		const currentDir = dirname(fileURLToPath(import.meta.url));
		const darkThemePath = join(currentDir, "../src/modes/interactive/theme/dark.json");
		const darkTheme = loadThemeFromPath(darkThemePath, "truecolor");
		expect(darkTheme.getAdaptiveThinkingBorderColor()("border")).not.toBe(
			darkTheme.getThinkingBorderColor("max")("border"),
		);
		const darkThemeJson = JSON.parse(readFileSync(darkThemePath, "utf8")) as {
			colors: Record<string, unknown>;
		};
		expect(darkThemeJson.colors.thinkingAdaptive).toBe("#00F5D4");

		const legacyThemeJson = JSON.parse(readFileSync(darkThemePath, "utf8")) as {
			name: string;
			colors: Record<string, unknown>;
		};
		legacyThemeJson.name = "legacy-adaptive-theme";
		delete legacyThemeJson.colors.thinkingAdaptive;
		const legacyThemePath = join(testDir, "legacy-adaptive-theme.json");
		writeFileSync(legacyThemePath, JSON.stringify(legacyThemeJson));
		const legacyTheme = loadThemeFromPath(legacyThemePath, "truecolor");
		expect(legacyTheme.getAdaptiveThinkingBorderColor()("border")).toBe(
			legacyTheme.getThinkingBorderColor("high")("border"),
		);
	});
});
