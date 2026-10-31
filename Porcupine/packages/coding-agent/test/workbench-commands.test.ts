import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { PorcupineTaskStore } from "../src/porcupine/task-scheduler.ts";
import { createWorkbenchCommands } from "../src/server/workbench-commands.ts";
import { createHarness } from "./test-harness.ts";

describe("GUI slash commands", () => {
	it("retains per-turn accounting and hierarchical stack queries", async () => {
		const h = await createHarness();
		try {
			await h.session.prompt("Check accounting");
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			expect((await commands.execute("/usage")).text).toBe(h.session.renderUsageCommand());
			expect((await commands.execute("/cost")).text).toBe(h.session.renderCostCommand());
			expect((await commands.execute("/stacks stack:shell")).text).toContain("stacks/shell/");
		} finally {
			h.cleanup();
		}
	});
	it("exports actual JSONL and uses the shared per-turn usage and stack engines", async () => {
		const h = await createHarness({ responses: ["First result", "Second result"] });
		try {
			await h.session.prompt("First request");
			await h.session.prompt("Second request");
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			const output = join(h.tempDir, "session snapshot.jsonl");
			await commands.execute(`/export "${output}"`);
			const lines = readFileSync(output, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { type: string });
			expect(lines[0]?.type).toBe("session");
			expect(lines.some((line) => line.type === "message")).toBe(true);
			expect((await commands.execute("/usage")).text).toBe(h.session.renderUsageCommand());
			expect((await commands.execute("/cost")).text).toBe(h.session.renderCostCommand());
			expect((await commands.execute("/stacks stack:shell")).text).toContain("stacks/shell/");
			expect(h.faux.callCount).toBe(2);
		} finally {
			h.cleanup();
		}
	});

	it("recalls a saved subagent by id instead of ignoring the argument", async () => {
		const h = await createHarness();
		const spy = vi.spyOn(h.session.sessionManager, "getSessionDir").mockReturnValue(join(h.tempDir, "sessions"));
		try {
			const manager = SessionManager.create(h.tempDir, join(h.tempDir, "sessions"), {
				type: "subagent",
				subagentId: "sa-review",
				task: "Verify the parser",
				parentSessionId: h.session.sessionId,
			});
			manager.appendCustomEntry("subagent_meta", { ok: true, steps: 1, budgetExhausted: false });
			manager.appendMessage({ role: "user", content: "Verify parser", timestamp: Date.now() });
			manager.forceFlushToDisk();
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			expect((await commands.execute(`/subagents ${manager.getSessionId()}`)).text).toContain("Verify the parser");
			expect((await commands.execute("/subagents")).text).toContain(manager.getSessionId());
		} finally {
			spy.mockRestore();
			h.cleanup();
		}
	});
	it("manages shared TUI tasks and Cron without starting a model turn", async () => {
		const h = await createHarness();
		try {
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			expect(commands.catalog().find((item) => item.name === "cron")?.availability).toBe("browser");
			await commands.execute("/task add Review :: Verify the project.");
			const tui = new PorcupineTaskStore(h.tempDir);
			const [task] = tui.listTasks();
			expect(task?.prompt).toBe("Verify the project.");
			await commands.execute(`/cron add ${task!.id} :: */15 * * * *`);
			const [schedule] = tui.listSchedules();
			expect((await commands.execute("/cron list")).text).toContain(schedule!.id);
			await commands.execute(`/task run ${task!.id}`);
			expect(tui.listRuns()[0]?.status).toBe("claimed");
			await commands.execute(`/task pause ${task!.id}`);
			expect(tui.listSchedules()[0]?.enabled).toBe(false);
			await commands.execute(`/task resume ${task!.id}`);
			await commands.execute(`/cron resume ${schedule!.id}`);
			expect(tui.listSchedules()[0]?.enabled).toBe(true);
			await commands.execute(`/cron remove ${schedule!.id}`);
			expect(tui.listSchedules()).toEqual([]);
			expect((await commands.execute(`/task show ${task!.id}`)).text).toContain("Verify the project.");
			expect(h.faux.callCount).toBe(0);
		} finally {
			h.cleanup();
		}
	});
	it("lists actual commands and changes real session settings without a model turn", async () => {
		const h = await createHarness();
		try {
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			expect((await commands.execute("/commands")).text).toContain("/reasoning");
			await commands.execute("/name Research");
			expect(h.session.sessionName).toBe("Research");
			await commands.execute("/reasoning adaptive");
			expect(h.session.getReasoningMode()).toBe("adaptive");
			expect((await commands.execute("/session")).text).toContain(h.session.sessionId);
			await expect(commands.execute("/login")).rejects.toMatchObject({ statusCode: 501 });
			expect(h.faux.callCount).toBe(0);
		} finally {
			h.cleanup();
		}
	});
});
