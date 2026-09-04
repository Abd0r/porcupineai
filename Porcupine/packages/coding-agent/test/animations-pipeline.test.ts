import type { TUI } from "@porcupineai/tui";
import { describe, expect, it, vi } from "vitest";
import { WorkingStatusIndicator } from "../src/modes/interactive/components/status-indicator.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import {
	animationLoaderOptions,
	buildDotFrames,
	getAnimation,
	resolveToolActivity,
} from "../src/porcupine/animations.ts";

function fakeTui() {
	const renders = { n: 0 };
	const tui = {
		requestRender: () => {
			renders.n++;
		},
	} as unknown as TUI;
	return { tui, renders };
}

describe("animation pipeline (live integration proof)", () => {
	it("read of SKILL.md → 'Reading skill' chip", () => {
		const a = resolveToolActivity("read", { path: "/x/skills/meta/subagent/SKILL.md" });
		expect(a?.id).toBe("reading-skill");
		expect(a?.name).toBe("subagent");
	});

	it("capability_search view → reading-skill; search skill → searching-skills", () => {
		expect(resolveToolActivity("capability_search", { action: "view", query: "git-basics" })?.id).toBe(
			"reading-skill",
		);
		expect(resolveToolActivity("capability_search", { action: "search", kind: "skill" })?.id).toBe(
			"searching-skills",
		);
	});

	it("capability_search without kind infers skill/tool chips from the query", () => {
		expect(resolveToolActivity("capability_search", { action: "search", query: "skill:subagent" })?.id).toBe(
			"searching-skills",
		);
		expect(resolveToolActivity("capability_search", { action: "search", query: "find a skill for git" })?.id).toBe(
			"searching-skills",
		);
		expect(resolveToolActivity("capability_search", { action: "search", query: "which tool reads files" })?.id).toBe(
			"searching-tools",
		);
		expect(resolveToolActivity("capability_search", { action: "search", query: "stacks" })?.id).toBe("searching");
	});

	it("WorkingStatusIndicator renders animated frames + ticks", () => {
		initTheme();
		vi.useFakeTimers();
		const { tui, renders } = fakeTui();
		const indicator = new WorkingStatusIndicator(tui, "", animationLoaderOptions("reading", "git-basics"));
		indicator.start();
		const lines1 = indicator.render(80);
		expect(lines1.join("\n")).toContain("📖 Reading: git-basics");
		expect(renders.n).toBeGreaterThan(0);
		vi.advanceTimersByTime(700);
		const lines2 = indicator.render(80);
		expect(lines2.join("\n")).not.toBe(lines1.join("\n")); // frames advance
		indicator.dispose();
		vi.useRealTimers();
	});

	it("frames contain the emoji + label + animated dots", () => {
		const frames = buildDotFrames("🔎", "Searching for skills");
		expect(frames.length).toBeGreaterThan(1);
		expect(frames[0]).toContain("🔎 Searching for skills");
	});

	it("labels terminal tool failure as failed, never as recovering", () => {
		expect(getAnimation("error").label).toBe("Failed");
		expect(animationLoaderOptions("error").frames[0]).toContain("Failed");
	});
});
