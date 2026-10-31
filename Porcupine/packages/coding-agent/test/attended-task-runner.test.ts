import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { PorcupineTaskStore } from "../src/porcupine/task-scheduler.ts";
import { AttendedTaskRunner } from "../src/server/attended-task-runner.ts";
import { createHarness, type FauxResponseInput, type Harness } from "./test-harness.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()?.();
	vi.useRealTimers();
});

async function fixture(responses: FauxResponseInput[] = ["Verified result"]) {
	const h = await createHarness({ responses, settings: { retry: { enabled: false } } });
	cleanups.push(h.cleanup);
	const store = new PorcupineTaskStore(h.tempDir);
	const runner = new AttendedTaskRunner(h.tempDir);
	cleanups.push(() => runner.close());
	const api = runner.register(h.session, adaptSessionToServeApi(h.session, h.tempDir));
	const task = store.createTask({ title: "Shared task", prompt: "Verify the requested work." });
	return { h, store, runner, api, task };
}

describe("attended GUI task execution", () => {
	it("executes due Cron exactly once in the open conversation and preserves shared history", async () => {
		const { h, store, runner, api, task } = await fixture();
		const schedule = store.createSchedule({ taskId: task.id, expression: "* * * * *" });
		api.setClientSurface?.("web");
		await Promise.all([runner.tick(new Date(schedule.nextRunAt)), runner.tick(new Date(schedule.nextRunAt))]);
		expect(h.faux.callCount).toBe(1);
		expect(store.listRuns()).toEqual([
			expect.objectContaining({
				status: "completed",
				result: "Verified result",
				trigger: { type: "cron", scheduleId: schedule.id },
			}),
		]);
		expect(store.getTask(task.id)?.status).toBe("ready");
		const tui = new PorcupineTaskStore(h.tempDir);
		expect(tui.listRuns()).toEqual(store.listRuns());
		expect(JSON.stringify(api.getTimeline?.())).toContain("Shared task");
	});

	it("does not claim work without a browser or while the selected session is busy", async () => {
		const { store, runner, api, task } = await fixture([{ text: "User work", delayMs: 20 }, "Scheduled work"]);
		const schedule = store.createSchedule({ taskId: task.id, expression: "* * * * *" });
		await runner.tick(new Date(schedule.nextRunAt));
		expect(store.listRuns()).toEqual([]);
		api.setClientSurface?.("web");
		const prompt = api.sendUserMessage("User request");
		await runner.tick(new Date(schedule.nextRunAt));
		expect(store.listRuns()).toEqual([]);
		await prompt;
		await runner.tick(new Date(schedule.nextRunAt));
		expect(store.listRuns()[0]?.status).toBe("completed");
	});

	it("drains a TUI-queued manual run using the GUI session's model and mode", async () => {
		const { h, store, runner, api, task } = await fixture();
		const queued = store.queueTaskRun(task.id);
		h.session.setInteractionMode("ask");
		const model = h.session.model;
		api.setClientSurface?.("web");
		await runner.tick();
		expect(store.listRuns()).toEqual([expect.objectContaining({ id: queued.id, status: "completed" })]);
		expect(h.session.model).toBe(model);
		expect(h.session.interactionMode).toBe("ask");
		expect(h.eventsOfType("message_end").length).toBeGreaterThan(0);
	});

	it.each<FauxResponseInput>([{ error: "Provider failed" }, { text: "Stopped", stopReason: "aborted" }, { text: "" }])(
		"never reports failed, aborted or empty output as completed (%j)",
		async (response) => {
			const { store, runner, api, task } = await fixture([response]);
			store.queueTaskRun(task.id);
			api.setClientSurface?.("web");
			await runner.tick();
			expect(store.listRuns()[0]?.status).toBe("failed");
		},
	);

	it("uses the last attached conversation, waits if it is busy, and stops after disconnect", async () => {
		const { h, store, runner, api, task } = await fixture();
		const second: Harness = await createHarness();
		cleanups.push(second.cleanup);
		const secondApi = runner.register(second.session, adaptSessionToServeApi(second.session, h.tempDir));
		api.setClientSurface?.("web");
		secondApi.setClientSurface?.("web");
		store.queueTaskRun(task.id);
		await runner.tick();
		expect(h.faux.callCount).toBe(0);
		expect(second.faux.callCount).toBe(1);
		secondApi.setClientSurface?.("none");
		store.queueTaskRun(task.id);
		await runner.tick();
		expect(second.faux.callCount).toBe(1);
		expect(h.faux.callCount).toBe(0);
	});

	it("runs from the host timer and removes it on shutdown", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
		const { h, store, runner, api, task } = await fixture();
		api.setClientSurface?.("web");
		await vi.advanceTimersByTimeAsync(0);
		store.queueTaskRun(task.id);
		await vi.advanceTimersByTimeAsync(14_999);
		expect(h.faux.callCount).toBe(0);
		await vi.advanceTimersByTimeAsync(2);
		expect(h.faux.callCount).toBe(1);
		await runner.close();
		store.queueTaskRun(task.id);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(h.faux.callCount).toBe(1);
	});

	it("drains a task queued during a user turn immediately after the turn settles", async () => {
		const { h, store, api, task } = await fixture([{ text: "User result", delayMs: 20 }, "Task result"]);
		api.setClientSurface?.("web");
		const prompt = api.sendUserMessage("User work");
		store.queueTaskRun(task.id);
		await prompt;
		await expect.poll(() => store.listRuns()[0]?.status).toBe("completed");
		expect(h.faux.callCount).toBe(2);
		expect(store.listRuns()[0]?.result).toBe("Task result");
	});

	it("retains a paused queued task and runs it after resume without evaluating script triggers", async () => {
		const { h, store, runner, api, task } = await fixture();
		store.queueTaskRun(task.id);
		store.setTaskStatus(task.id, "paused");
		store.createTask({
			title: "TUI event",
			prompt: "Unused",
			trigger: { type: "script", command: "exit 0", exitCode: 0 },
		});
		api.setClientSurface?.("web");
		await runner.tick();
		expect(h.faux.callCount).toBe(0);
		expect(store.listRuns()).toHaveLength(1);
		store.setTaskStatus(task.id, "ready");
		await runner.tick();
		expect(store.listRuns()).toHaveLength(1);
		expect(store.listRuns()[0]?.status).toBe("completed");
	});

	it("cannot execute an already adopted TUI run or a deleted GUI conversation", async () => {
		const { h, store, runner, api, task } = await fixture();
		const queued = store.queueTaskRun(task.id);
		store.startRun(task.id, { type: "manual", claimRunId: queued.id });
		api.setClientSurface?.("web");
		await runner.tick();
		expect(h.faux.callCount).toBe(0);
		store.completeRun(queued.id, "TUI result");
		store.queueTaskRun(task.id);
		runner.unregister(h.session);
		await runner.tick();
		expect(h.faux.callCount).toBe(0);
	});

	it("aborts an active run on shutdown without marking it completed", async () => {
		const { h, store, runner, api, task } = await fixture([{ text: "Late result", delayMs: 100 }]);
		store.queueTaskRun(task.id);
		api.setClientSurface?.("web");
		const running = runner.tick();
		await expect.poll(() => h.faux.callCount).toBe(1);
		await runner.close();
		await running;
		expect(store.listRuns()[0]?.status).toBe("failed");
		expect(store.listRuns()[0]?.error).toContain("stopped");
	});

	it("allows only one GUI host to execute a shared manual claim", async () => {
		const { h, store, runner, api, task } = await fixture([{ text: "First host", delayMs: 20 }]);
		const other = await createHarness({ responses: ["Second host"] });
		cleanups.push(other.cleanup);
		const otherRunner = new AttendedTaskRunner(h.tempDir);
		cleanups.push(() => otherRunner.close());
		const otherApi = otherRunner.register(other.session, adaptSessionToServeApi(other.session, h.tempDir));
		store.queueTaskRun(task.id);
		api.setClientSurface?.("web");
		otherApi.setClientSurface?.("web");
		await Promise.all([runner.tick(), otherRunner.tick()]);
		expect(h.faux.callCount + other.faux.callCount).toBe(1);
		expect(store.listRuns()).toHaveLength(1);
		expect(store.listRuns()[0]?.status).toBe("completed");
	});

	it("preserves FIFO when runs have the same timestamp and drains chained work", async () => {
		const { h, store, runner, api, task } = await fixture(["First result", "Second result", "Chained result"]);
		const next = store.createTask({ title: "Next", prompt: "Continue after verification" });
		store.patchTask({ id: task.id, next: next.id });
		const first = store.queueTaskRun(task.id);
		const second = store.queueTaskRun(next.id);
		api.setClientSurface?.("web");
		await runner.tick();
		expect(store.listRuns().find((run) => run.id === first.id)?.result).toBe("First result");
		await runner.tick();
		expect(store.listRuns().find((run) => run.id === second.id)?.result).toBe("Second result");
		await runner.tick();
		expect(store.listRuns()).toHaveLength(3);
		expect(h.faux.callCount).toBe(3);
	});

	it("holds the session reservation during prompt preparation and honours Stop before agent start", async () => {
		const { h, store, runner, task } = await fixture();
		runner.unregister(h.session);
		let release = () => {};
		const preparation = new Promise<void>((resolve) => {
			release = resolve;
		});
		const base = adaptSessionToServeApi(h.session, h.tempDir);
		const api = runner.register(h.session, {
			...base,
			sendUserMessage: async (text) => {
				await preparation;
				await base.sendUserMessage(text);
			},
		});
		api.setClientSurface?.("web");
		store.queueTaskRun(task.id);
		const running = runner.tick();
		expect(api.isStreaming()).toBe(true);
		expect(api.getControls?.().busy).toBe(true);
		expect(() => api.configure?.({ interactionMode: "auto" })).toThrow(/finish/);
		await api.abort();
		release();
		await running;
		expect(store.listRuns()[0]?.status).toBe("failed");
		expect(h.session.interactionMode).toBe("normal");
	});
});
