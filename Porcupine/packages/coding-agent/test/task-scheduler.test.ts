import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import {
	isTaskDrainEligible,
	nextCronTime,
	PorcupineTaskStore,
	parseCronCommand,
	parseTaskCommand,
} from "../src/porcupine/task-scheduler.ts";

const roots: string[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function createStore(): PorcupineTaskStore {
	const root = mkdtempSync(join(tmpdir(), "porcupine-tasks-"));
	roots.push(root);
	return new PorcupineTaskStore(root);
}

describe("PorcupineTaskStore", () => {
	it("persists tasks and their completed runs across store instances", () => {
		const store = createStore();
		const task = store.createTask({
			title: "Check tests",
			prompt: "Run the focused test suite and report failures.",
		});
		const run = store.startRun(task.id, { type: "manual" });
		store.completeRun(run.id, "All focused tests passed.");

		const restored = new PorcupineTaskStore(store.agentDir);
		expect(restored.getTask(task.id)).toMatchObject({
			id: task.id,
			status: "completed",
			runCount: 1,
		});
		expect(restored.listRuns(task.id)).toContainEqual(expect.objectContaining({ id: run.id, status: "completed" }));
	});

	it("queues a manual run and adopts it when the session is idle", () => {
		const store = createStore();
		const task = store.createTask({ title: "Review", prompt: "Review changes." });

		const queued = store.queueTaskRun(task.id);
		expect(queued).toMatchObject({ taskId: task.id, status: "claimed", trigger: { type: "manual" } });
		expect(store.claimQueuedRuns(1)).toHaveLength(1);

		// Idle drain adopts the claim and flips it to running.
		const adopted = store.startRun(task.id, { type: "manual", claimRunId: queued.id });
		expect(adopted.id).toBe(queued.id);
		expect(adopted.status).toBe("running");
		expect(store.claimQueuedRuns(1)).toHaveLength(0);
		expect(store.getTask(task.id)!.status).toBe("running");
	});

	it("queued runs are marked unknown on restart instead of replaying", () => {
		const store = createStore();
		const task = store.createTask({ title: "Review", prompt: "Review changes." });
		store.queueTaskRun(task.id);

		// Simulate the owning process having exited.
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("Exited"), { code: "ESRCH" });
		});
		const restored = new PorcupineTaskStore(store.agentDir);
		const runs = restored.listRuns(task.id);
		expect(runs).toHaveLength(1);
		expect(runs[0]!.status).toBe("unknown");
		expect(restored.getTask(task.id)!.status).toBe("ready");
		expect(restored.claimQueuedRuns(1)).toHaveLength(0);
	});

	it("refuses to queue a paused or cancelled task", () => {
		const store = createStore();
		const task = store.createTask({ title: "Review", prompt: "Review changes." });
		store.setTaskStatus(task.id, "paused");
		expect(() => store.queueTaskRun(task.id)).toThrow(/paused/);
	});

	it("releases a claimed run that could never be adopted (no schedule blockage)", () => {
		const store = createStore();
		const task = store.createTask({ title: "Review", prompt: "Review changes." });
		const schedule = store.createSchedule({ taskId: task.id, expression: "*/15 * * * *" });
		const now = new Date(schedule.nextRunAt);
		const [claimed] = store.claimDueSchedules(now);
		expect(claimed).toBeDefined();
		const claimRunId = claimed!.claimedRunId!;

		// Adoption with a claim id this process cannot see (already taken / stale)
		// fails the guard the idle drain relies on.
		expect(() =>
			store.startRun(task.id, { type: "cron", scheduleId: schedule.id, claimRunId: "run-does-not-exist" }),
		).toThrow(/Claimed run is no longer available/);

		// The idle drain releases the stale claim so it cannot block the schedule.
		expect(store.failClaimedRun(claimRunId, "Run never started: adoption failed")).toBe(true);
		const runs = store.listRuns(task.id);
		expect(runs[0]!.status).toBe("failed");
		expect(runs[0]!.error).toContain("adoption failed");
		// The next occurrence can be claimed again at its advanced fire time.
		expect(store.claimDueSchedules(new Date(claimed!.nextRunAt))).toHaveLength(1);
	});

	it("failClaimedRun is a no-op once the run was already adopted", () => {
		const store = createStore();
		const task = store.createTask({ title: "Review", prompt: "Review changes." });
		const run = store.queueTaskRun(task.id);
		store.startRun(task.id, { type: "manual", claimRunId: run.id });
		expect(store.failClaimedRun(run.id, "too late")).toBe(false);
		expect(store.listRuns(task.id)[0]!.status).toBe("running");
	});

	it("does not overwrite a mid-run cancel with the terminal state", () => {
		const store = createStore();
		const task = store.createTask({ title: "Review", prompt: "Review changes." });
		const run = store.startRun(task.id, { type: "manual" });
		store.setTaskStatus(task.id, "cancelled");

		store.completeRun(run.id, "Finished after cancel.");
		expect(store.getTask(task.id)!.status).toBe("cancelled");
		expect(store.listRuns(task.id)[0]!.status).toBe("completed");
	});

	it("does not overwrite a mid-run pause with the terminal state", () => {
		const store = createStore();
		const task = store.createTask({ title: "Review", prompt: "Review changes." });
		const run = store.startRun(task.id, { type: "manual" });
		store.setTaskStatus(task.id, "paused");

		store.failRun(run.id, "Timed out.");
		expect(store.getTask(task.id)!.status).toBe("paused");
	});

	it("task drain requires a fully idle session", () => {
		expect(
			isTaskDrainEligible({ activeTaskRun: false, streaming: false, compacting: false, bashRunning: false }),
		).toBe(true);
		expect(
			isTaskDrainEligible({ activeTaskRun: true, streaming: false, compacting: false, bashRunning: false }),
		).toBe(false);
		expect(
			isTaskDrainEligible({ activeTaskRun: false, streaming: true, compacting: false, bashRunning: false }),
		).toBe(false);
		expect(
			isTaskDrainEligible({ activeTaskRun: false, streaming: false, compacting: true, bashRunning: false }),
		).toBe(false);
		expect(
			isTaskDrainEligible({ activeTaskRun: false, streaming: false, compacting: false, bashRunning: true }),
		).toBe(false);
	});

	it("claims a due schedule once and advances it before the run starts", () => {
		const store = createStore();
		const task = store.createTask({
			title: "Review",
			prompt: "Review changes.",
		});
		const schedule = store.createSchedule({
			taskId: task.id,
			expression: "*/15 * * * *",
		});
		// The schedule was created against the real clock — claim it exactly when due.
		const now = new Date(schedule.nextRunAt);

		const claimed = store.claimDueSchedules(now);
		expect(claimed).toHaveLength(1);
		expect(claimed[0]).toMatchObject({ id: schedule.id, taskId: task.id });
		expect(claimed[0]!.claimedRunId).toMatch(/^run-/);
		expect(new Date(claimed[0]!.nextRunAt).getTime()).toBeGreaterThan(now.getTime());
		expect(store.listRuns(task.id)).toContainEqual(
			expect.objectContaining({
				id: claimed[0]!.claimedRunId,
				status: "claimed",
				trigger: { type: "cron", scheduleId: schedule.id },
			}),
		);
		expect(store.claimDueSchedules(now)).toHaveLength(0);
	});

	it("marks an abandoned Cron claim unknown instead of replaying it", () => {
		const store = createStore();
		const task = store.createTask({
			title: "Review",
			prompt: "Review changes.",
		});
		const schedule = store.createSchedule({
			taskId: task.id,
			expression: "*/15 * * * *",
		});
		const claimed = store.claimDueSchedules(new Date(schedule.nextRunAt));
		const runId = claimed[0]!.claimedRunId!;

		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("Exited"), { code: "ESRCH" });
		});
		const restored = new PorcupineTaskStore(store.agentDir);
		expect(restored.listRuns(task.id)).toContainEqual(expect.objectContaining({ id: runId, status: "unknown" }));
		expect(
			restored.listSchedules().find((candidate: { id: string }) => candidate.id === schedule.id),
		).not.toHaveProperty("claimedRunId");
	});

	it("preserves live TUI/GUI claims and permits only one adoption across store instances", () => {
		const store = createStore();
		const task = store.createTask({ title: "Shared", prompt: "Check shared state" });
		const queued = store.queueTaskRun(task.id);
		const gui = new PorcupineTaskStore(store.agentDir);
		expect(gui.listRuns()[0]).toMatchObject({ id: queued.id, status: "claimed", ownerPid: process.pid });
		gui.startRun(task.id, { type: "manual", claimRunId: queued.id });
		const tui = new PorcupineTaskStore(store.agentDir);
		expect(tui.listRuns()[0]?.status).toBe("running");
		expect(() => tui.startRun(task.id, { type: "manual", claimRunId: queued.id })).toThrow();
		gui.completeRun(queued.id, "Verified shared state");
		expect(tui.listRuns()[0]?.status).toBe("completed");
	});

	it("does not start another occurrence of a task while it is already running", () => {
		const store = createStore();
		const task = store.createTask({ title: "Shared", prompt: "Check shared state" });
		const schedule = store.createSchedule({ taskId: task.id, expression: "* * * * *" });
		store.startRun(task.id, { type: "manual" });
		expect(store.claimDueSchedules(new Date(schedule.nextRunAt))).toEqual([]);
		expect(() => store.startRun(task.id, { type: "manual" })).toThrow(/running/);
	});

	it("preserves live Cron claims across clients and marks dead running owners unknown", () => {
		const store = createStore();
		const task = store.createTask({ title: "Cron", prompt: "Verify state" });
		const schedule = store.createSchedule({ taskId: task.id, expression: "* * * * *" });
		const [claim] = store.claimDueSchedules(new Date(schedule.nextRunAt));
		const gui = new PorcupineTaskStore(store.agentDir);
		expect(gui.listRuns()[0]?.status).toBe("claimed");
		expect(gui.claimDueSchedules(new Date(schedule.nextRunAt))).toEqual([]);
		gui.startRun(task.id, { type: "cron", scheduleId: schedule.id, claimRunId: claim!.claimedRunId });
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("Exited"), { code: "ESRCH" });
		});
		const restored = new PorcupineTaskStore(store.agentDir);
		expect(restored.listRuns()[0]?.status).toBe("unknown");
		expect(restored.getTask(task.id)?.status).toBe("ready");
		expect(restored.listSchedules()[0]?.claimedRunId).toBeUndefined();
	});

	it("does not treat a denied process-liveness check as proof of exit", () => {
		const store = createStore();
		const task = store.createTask({ title: "Protected owner", prompt: "Verify state" });
		store.startRun(task.id, { type: "manual" });
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("Denied"), { code: "EPERM" });
		});
		expect(new PorcupineTaskStore(store.agentDir).listRuns()[0]?.status).toBe("running");
	});

	it("returns recurring tasks to ready after a completed claimed run", () => {
		const store = createStore();
		const task = store.createTask({
			title: "Review",
			prompt: "Review changes.",
		});
		const schedule = store.createSchedule({
			taskId: task.id,
			expression: "*/15 * * * *",
		});
		const [claimed] = store.claimDueSchedules(new Date(schedule.nextRunAt));
		const run = store.startRun(task.id, {
			type: "cron",
			scheduleId: schedule.id,
			claimRunId: claimed!.claimedRunId,
		});
		store.completeRun(run.id, "Done.");

		expect(store.getTask(task.id)).toMatchObject({
			status: "ready",
			runCount: 1,
		});
		expect(store.listRuns(task.id)[0]).toMatchObject({ status: "completed" });
	});

	it("computes the next UTC occurrence for standard cron fields", () => {
		expect(nextCronTime("*/15 * * * *", new Date("2026-08-04T10:00:00.000Z"))).toEqual(
			new Date("2026-08-04T10:15:00.000Z"),
		);
		expect(nextCronTime("30 9 * * 1-5", new Date("2026-08-07T10:00:00.000Z"))).toEqual(
			new Date("2026-08-10T09:30:00.000Z"),
		);
	});
});

describe("task and cron commands", () => {
	it("advertises task and cron in built-in slash completion", () => {
		expect(BUILTIN_SLASH_COMMANDS.map((command) => command.name)).toEqual(expect.arrayContaining(["task", "cron"]));
	});

	it("parses explicit task and cron definitions without ambiguity", () => {
		expect(parseTaskCommand("/task add Check tests :: Run the focused suite.")).toEqual({
			kind: "add",
			title: "Check tests",
			prompt: "Run the focused suite.",
		});
		expect(parseTaskCommand("/task show task-123")).toEqual({
			kind: "show",
			taskId: "task-123",
		});
		expect(parseCronCommand("/cron add task-123 :: 30 9 * * 1-5")).toEqual({
			kind: "add",
			taskId: "task-123",
			expression: "30 9 * * 1-5",
		});
	});

	it("rejects underspecified task and cron commands with usage guidance", () => {
		expect(parseTaskCommand("/task add Check tests")).toMatchObject({
			kind: "invalid",
		});
		expect(parseCronCommand("/cron add task-123")).toMatchObject({
			kind: "invalid",
		});
	});
});
