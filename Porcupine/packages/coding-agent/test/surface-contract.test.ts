import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import {
	COMMAND_SURFACE_REQUIREMENTS,
	getSurfaceParityReport,
	RUNTIME_SURFACE_REQUIREMENTS,
} from "../src/core/surface-contract.ts";
import { createWorkbenchCommands } from "../src/server/workbench-commands.ts";
import { createHarness } from "./test-harness.ts";

describe("TUI <-> GUI contract", () => {
	it("requires an explicit GUI implementation and acceptance rule for every TUI builtin", () => {
		for (const command of BUILTIN_SLASH_COMMANDS) {
			const rules = COMMAND_SURFACE_REQUIREMENTS.filter((rule) => rule.name === command.name);
			expect(rules, `/${command.name} needs a surface contract`).toHaveLength(1);
			expect(rules[0]?.acceptance.trim().length).toBeGreaterThan(20);
		}
		expect(new Set(COMMAND_SURFACE_REQUIREMENTS.map((rule) => rule.name)).size).toBe(
			COMMAND_SURFACE_REQUIREMENTS.length,
		);
	});

	it("also covers TUI dispatch entries absent from slash completion", () => {
		const source = readFileSync(new URL("../src/modes/interactive/interactive-mode.ts", import.meta.url), "utf8");
		const start = source.indexOf("private setupEditorSubmitHandler()");
		const end = source.indexOf("private subscribeToSubagents()", start);
		expect(start).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(start);
		const dispatched = [
			...source.slice(start, end).matchAll(/text\s*(?:===\s*|\.startsWith\(\s*)"\/([a-z][a-z0-9-]*)/g),
		];
		const names = new Set(COMMAND_SURFACE_REQUIREMENTS.map((rule) => rule.name));
		for (const match of dispatched)
			expect(names.has(match[1]!), `TUI dispatch /${match[1]} is unclassified`).toBe(true);
	});

	it("never calls a partial or missing GUI implementation parity-ready", () => {
		const report = getSurfaceParityReport();
		expect(report.ready).toBe(false);
		expect(report.gaps).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "command:login", parity: "missing" }),
				expect.objectContaining({ id: "runtime:extension-ui", parity: "partial" }),
			]),
		);
		for (const rule of [...report.commands, ...report.runtime])
			if (rule.parity !== "implemented") expect(rule.gap?.trim().length).toBeGreaterThan(20);
		expect(new Set(RUNTIME_SURFACE_REQUIREMENTS.map((rule) => rule.id)).size).toBe(
			RUNTIME_SURFACE_REQUIREMENTS.length,
		);
	});

	it("drives GUI discovery from the contract and exposes its unfinished requirements", async () => {
		const h = await createHarness();
		try {
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			for (const rule of COMMAND_SURFACE_REQUIREMENTS) {
				const entry = commands.catalog().find((item) => item.name === rule.name);
				expect(entry, rule.name).toMatchObject({ parity: rule.parity, acceptance: rule.acceptance });
			}
			expect((await commands.execute("/parity")).text).toContain("not complete");
			expect(h.faux.callCount).toBe(0);
		} finally {
			h.cleanup();
		}
	});

	it("rejects every unwired GUI command explicitly without model calls or success history", async () => {
		const h = await createHarness();
		try {
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			const missing = COMMAND_SURFACE_REQUIREMENTS.filter((rule) => rule.implementation === "missing");
			expect(missing.length).toBeGreaterThan(0);
			for (const rule of missing)
				await expect(commands.execute(`/${rule.name}`), rule.name).rejects.toMatchObject({ statusCode: 501 });
			expect(h.faux.callCount).toBe(0);
			expect(
				h.session.sessionManager
					.getEntries()
					.filter((entry) => entry.type === "custom" && entry.customType === "workbench.command"),
			).toEqual([]);
		} finally {
			h.cleanup();
		}
	});
});
