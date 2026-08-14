/**
 * Keyless snapshot harness for model-visible output (the assembled system
 * prompt). Replays without API keys by pinning every input and the clock.
 *
 * SNAPSHOT GATE (dsh lesson 5): the committed fixtures are small (< 8KB) and
 * byte-compared. Drift in the assembled prompt (persona, tools, guidelines,
 * context framing, memory/stacks) fails the test without calling the network.
 *
 * Fixtures live in test/snapshot/fixtures/ and are only rewritten when
 * UPDATE_SNAPSHOT=1 is set (never by the normal test gate).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { type BuildSystemPromptOptions, buildSystemPrompt } from "../../src/core/system-prompt.ts";

/** Fixed clock used by every replay so the session-start datetime is byte-stable. */
export const SNAPSHOT_EPOCH = new Date("2026-08-09T03:15:00.000Z");

/** Fixed working directory so the "Current working directory" line is byte-stable. */
export const SNAPSHOT_CWD = "/work/repro/repro";

/** Fixed agent dir so the memory section cannot read machine/agent-home state. */
export const SNAPSHOT_AGENT_DIR = "/tmp/porcupine-snapshot-agent";

/** A fixed tool set with one-line snippets so "Available tools" is deterministic. */
export const SNAPSHOT_TOOL_SNIPPETS: Record<string, string> = {
	read: "Read file contents",
	bash: "Execute bash commands",
	edit: "Make surgical edits",
	write: "Create or overwrite files",
	grep: "Search file contents",
};

const FIXTURE_DIR = join(import.meta.dirname, "fixtures");

/** Map of case name to deterministic buildSystemPrompt options. */
export function fixedOptions(overrides: Partial<BuildSystemPromptOptions> = {}): BuildSystemPromptOptions {
	return {
		selectedTools: Object.keys(SNAPSHOT_TOOL_SNIPPETS),
		toolSnippets: SNAPSHOT_TOOL_SNIPPETS,
		cwd: SNAPSHOT_CWD,
		contextFiles: [],
		skills: [],
		includeSkillsCatalog: false,
		agentDir: SNAPSHOT_AGENT_DIR,
		skipMemory: true,
		autoMode: false,
		minimalPrompt: false,
		...overrides,
	};
}

/** The named replayed cases and their committed fixture file. */
export const SNAPSHOT_CASES = [
	{ name: "default", fixture: "default-prompt.snapshot.txt", options: fixedOptions() },
	{ name: "autoMode", fixture: "auto-mode-prompt.snapshot.txt", options: fixedOptions({ autoMode: true }) },
	{ name: "minimalPrompt", fixture: "minimal-prompt.snapshot.txt", options: fixedOptions({ minimalPrompt: true }) },
] as const;

export type SnapshotCaseName = (typeof SNAPSHOT_CASES)[number]["name"];

/** Rebuild the prompt for a named case and return its text. */
export function buildCasePrompt(name: SnapshotCaseName): string {
	const c = SNAPSHOT_CASES.find((x) => x.name === name);
	if (!c) throw new Error(`unknown snapshot case: ${name}`);
	return buildSystemPrompt(c.options);
}

/** Path to a committed snapshot fixture. */
export function fixturePath(name: string): string {
	return join(FIXTURE_DIR, name);
}

/** Read the committed snapshot bytes for a case name. */
export function savedSnapshot(name: SnapshotCaseName): string {
	const c = SNAPSHOT_CASES.find((x) => x.name === name);
	if (!c) throw new Error(`unknown snapshot case: ${name}`);
	return readFileSync(fixturePath(c.fixture), "utf-8");
}

/** Write/overwrite the committed snapshot bytes for a case name (record mode only). */
export function writeSnapshot(name: SnapshotCaseName, content: string): void {
	const c = SNAPSHOT_CASES.find((x) => x.name === name);
	if (!c) throw new Error(`unknown snapshot case: ${name}`);
	mkdirSync(FIXTURE_DIR, { recursive: true });
	writeFileSync(fixturePath(c.fixture), content, "utf-8");
}

export { buildCasePrompt as replayCase };

/**
 * Freeze the clock and timezone so the generated prompt is byte-stable across
 * runs and machines (UTC + a pinned instant). Call inside each test's
 * setup so both replay and record see identical session-start context.
 */
export function pinClockForSnapshot(): void {
	process.env.TZ = "UTC";
	vi.useFakeTimers();
	vi.setSystemTime(SNAPSHOT_EPOCH);
}

export function unpinClockForSnapshot(): void {
	vi.useRealTimers();
}

/** True only when the operator explicitly asked to refresh the fixtures. */
export function updateSnapshotsEnabled(): boolean {
	return process.env.UPDATE_SNAPSHOT === "1";
}

export function installClockLifecycle(): void {
	beforeEach(() => {
		pinClockForSnapshot();
	});
	afterEach(() => {
		unpinClockForSnapshot();
	});
}
