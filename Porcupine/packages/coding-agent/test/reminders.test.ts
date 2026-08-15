import { describe, expect, it } from "vitest";
import { createRemindMeTool } from "../src/porcupine/remind-me-tool.ts";
import {
	formatDuration,
	parseDuration,
	parseGoalRemindCommand,
	parseRemindCommand,
	ReminderEngine,
	type ReminderNotification,
} from "../src/porcupine/reminders.ts";

function idleState(over: Partial<Parameters<ReminderEngine["tick"]>[0]> = {}) {
	return { activeTaskRun: false, streaming: false, compacting: false, bashRunning: false, ...over };
}

describe("reminder parsing", () => {
	it("parses human durations into milliseconds", () => {
		expect(parseDuration("45s")).toBe(45_000);
		expect(parseDuration("5m")).toBe(300_000);
		expect(parseDuration("2h")).toBe(7_200_000);
		expect(parseDuration("1d")).toBe(86_400_000);
		expect(parseDuration("2w")).toBe(1_209_600_000);
		expect(parseDuration("30")).toBe(30_000);
		expect(parseDuration("banana")).toBeUndefined();
	});

	it("parses /remind <duration> <text>", () => {
		expect(parseRemindCommand("/remind 5m circle back on the blocker")).toEqual({
			kind: "set",
			durationMs: 300_000,
			text: "circle back on the blocker",
		});
		expect(parseRemindCommand("/remind")).toEqual({ kind: "invalid", message: expect.any(String) });
		expect(parseRemindCommand("/remind 5m")).toEqual({ kind: "invalid", message: expect.any(String) });
		expect(parseRemindCommand("/reminder")).toBeNull();
		expect(parseRemindCommand("/remind soon do it")).toEqual({ kind: "invalid", message: expect.any(String) });
	});

	it("parses /goal remind <duration>", () => {
		expect(parseGoalRemindCommand("/goal remind 10m")).toEqual({ kind: "set", durationMs: 600_000 });
		expect(parseGoalRemindCommand("/goal remind")).toBeNull();
		expect(parseGoalRemindCommand("/goal remind nope")).toEqual({ kind: "invalid", message: expect.any(String) });
		expect(parseGoalRemindCommand("/goal status")).toBeNull();
	});

	it("formats durations for display", () => {
		expect(formatDuration(86_400_000)).toBe("1d");
		expect(formatDuration(7_200_000)).toBe("2h");
		expect(formatDuration(300_000)).toBe("5m");
		expect(formatDuration(45_000)).toBe("45s");
	});
});

describe("ReminderEngine scheduling + idle-drain firing", () => {
	it("schedules a reminder and fires it through the idle drain after the delay (mocked clock)", () => {
		let fakeNow = 1_000_000;
		const fired: ReminderNotification[] = [];
		const engine = new ReminderEngine({ now: () => fakeNow, notify: (n) => fired.push(n) });

		engine.schedule({ text: "Eat lunch", durationMs: 300_000, source: "user" });
		// Before due, no fire even when idle.
		fakeNow += 100_000;
		expect(engine.tick(idleState())).toBe(0);
		expect(fired).toHaveLength(0);

		// After due, while idle, it fires exactly once.
		fakeNow += 200_000;
		expect(engine.tick(idleState())).toBe(1);
		expect(fired).toHaveLength(1);
		expect(fired[0]!.summary).toContain("Reminder: Eat lunch");
		expect(fired[0]!.trigger).toEqual({ type: "manual" });

		// Fired reminders are gone; a later tick won't re-fire.
		fakeNow += 60_000;
		expect(engine.tick(idleState())).toBe(0);
		expect(fired).toHaveLength(1);
	});

	it("delivers the reminder through the task-completion notification shape", () => {
		let fakeNow = 0;
		let firedSummary = "";
		const engine = new ReminderEngine({
			now: () => fakeNow,
			notify: (n) => {
				firedSummary = n.summary;
			},
		});
		engine.schedule({ text: "ship the PR", durationMs: 5000, source: "model" });
		fakeNow = 6000;
		expect(engine.tick(idleState())).toBe(1);
		expect(firedSummary).toBe("Reminder: ship the PR");
	});

	it("never fires while the session is busy (not drain-eligible)", () => {
		let fakeNow = 0;
		const fired: ReminderNotification[] = [];
		const engine = new ReminderEngine({ now: () => fakeNow, notify: (n) => fired.push(n) });
		engine.schedule({ text: "backup", durationMs: 1000, source: "user" });
		fakeNow = 10_000;

		// Busy in every dimension — still no fire.
		expect(engine.tick(idleState({ streaming: true }))).toBe(0);
		expect(engine.tick(idleState({ compacting: true }))).toBe(0);
		expect(engine.tick(idleState({ bashRunning: true }))).toBe(0);
		expect(engine.tick(idleState({ activeTaskRun: true }))).toBe(0);
		expect(fired).toHaveLength(0);

		// Once idle again, it is delivered (the reminder survives busy ticks).
		expect(engine.tick(idleState())).toBe(1);
		expect(fired).toHaveLength(1);
	});

	it("a goal nudge re-fires through the same fan-out after the delay", () => {
		let fakeNow = 0;
		const fired: ReminderNotification[] = [];
		const engine = new ReminderEngine({ now: () => fakeNow, notify: (n) => fired.push(n) });
		engine.scheduleGoalNudge({
			durationMs: 600_000,
			goal: { text: "Ship the release", status: "paused", lastVerdict: "blocked" },
		});
		fakeNow = 600_000 + 1;
		expect(engine.tick(idleState())).toBe(1);
		expect(fired).toHaveLength(1);
		expect(fired[0]!.summary).toContain("Ship the release");
		expect(fired[0]!.summary).toContain("paused");
	});
});

describe("ReminderEngine persistence across resume", () => {
	it("round-trips reminders through the session custom-entry payload", () => {
		let fakeNow = 1_000;
		const engine = new ReminderEngine({ now: () => fakeNow, notify: () => {} });
		engine.schedule({ text: "revisit TODO", durationMs: 10 * 60_000, source: "user" });

		const serialized = engine.toEntries();
		// A fresh engine after resume rehydrates and still recognizes the due time.
		const restored = new ReminderEngine({ now: () => fakeNow, notify: () => {} });
		restored.fromEntries(serialized);
		expect(restored.remindersSnapshot).toHaveLength(1);
		expect(restored.remindersSnapshot[0]!.text).toBe("revisit TODO");

		// A due restored reminder fires on the next idle tick.
		fakeNow = 1_000 + 10 * 60_000 + 1;
		expect(restored.isDue(new Date(fakeNow))).toBe(true);
		expect(restored.tick(idleState())).toBe(1);
	});

	it("ignores malformed persisted payloads", () => {
		const engine = new ReminderEngine({ now: () => Date.now(), notify: () => {} });
		engine.fromEntries({ version: 99, reminders: [] });
		expect(engine.remindersSnapshot).toHaveLength(0);
		engine.fromEntries({ reminders: [{ id: "x" }] });
		expect(engine.remindersSnapshot).toHaveLength(0);
	});
});

describe("remind_me model tool", () => {
	it("schedules into the injected engine via the model-facing tool", async () => {
		let fakeNow = 5_000_000;
		const fired: ReminderNotification[] = [];
		const engine = new ReminderEngine({ now: () => fakeNow, notify: (n) => fired.push(n) });
		const tool = createRemindMeTool({ engine });

		const result = (await tool.execute("call-1", { text: "circle back on todos", duration: "45s" })) as {
			content: Array<{ type: string; text?: string }>;
		};
		expect(result.content.some((b) => (b.text ?? "").includes("Reminder set"))).toBe(true);
		expect(engine.remindersSnapshot).toHaveLength(1);
		expect(engine.remindersSnapshot[0]!.source).toBe("model");
		expect(engine.remindersSnapshot[0]!.text).toBe("circle back on todos");

		// It fires through the same idle-drain fan-out after the delay.
		fakeNow += 45_000 + 1;
		expect(engine.tick({ activeTaskRun: false, streaming: false, compacting: false, bashRunning: false })).toBe(1);
		expect(fired).toHaveLength(1);
		expect(fired[0]!.summary).toContain("circle back on todos");
	});

	it("rejects a missing duration with a clear instruction", async () => {
		const tool = createRemindMeTool();
		const result = (await tool.execute("call-1", { text: "x", duration: "nope" })) as {
			content: Array<{ type: string; text?: string }>;
		};
		expect(result.content.some((b) => (b.text ?? "").includes("requires a duration"))).toBe(true);
	});
});
