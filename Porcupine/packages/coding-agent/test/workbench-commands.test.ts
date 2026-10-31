import { describe, expect, it } from "vitest";
import { PorcupineTaskStore } from "../src/porcupine/task-scheduler.ts";
import { createWorkbenchCommands } from "../src/server/workbench-commands.ts";
import { createHarness } from "./test-harness.ts";

describe("GUI slash commands", () => {
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
			expect((await commands.execute("/login")).text).toContain("terminal");
			expect(h.faux.callCount).toBe(0);
		} finally {
			h.cleanup();
		}
	});
});
