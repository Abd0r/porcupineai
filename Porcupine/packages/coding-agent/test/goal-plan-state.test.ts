import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import {
	buildPlanPrompt,
	filterOutGoalPlanQueue,
	formatPlanStatus,
	GOAL_PLAN_SESSION_ENTRY,
	isGoalPlanState,
	isPlanPrompt,
	parsePlanCommand,
} from "../src/porcupine/goal-plan-state.ts";
import {
	addGoalStep,
	createGoalRecord,
	formatGoalStatus,
	goalProgress,
	isGoalRecord,
	setGoalStepStatus,
	validateGoalRecord,
} from "../src/porcupine/goal-record.ts";

describe("goal record", () => {
	it("creates a goal with identifiable steps and a progress view", () => {
		const goal = createGoalRecord("Ship the sweep", ["Measure baseline", "Quantise to 2.5 bits"]);
		expect(goal.status).toBe("active");
		expect(goal.steps.map((step) => step.id)).toEqual(["measure-baseline-1", "quantise-to-2-5-bits-2"]);
		expect(goalProgress(goal)).toMatchObject({ done: 0, total: 2 });
		expect(formatGoalStatus(goal)).toContain("Ship the sweep");
	});

	it("becomes done only when every step is done, and blocked when a step is blocked", () => {
		let goal = createGoalRecord("Finish", ["one", "two"]);
		goal = setGoalStepStatus(goal, "one-1", "active");
		goal = setGoalStepStatus(goal, "one-1", "blocked", "Waiting for data");
		expect(goal.status).toBe("blocked");
		goal = setGoalStepStatus(goal, "one-1", "done", "Verified");
		expect(goal.status).toBe("active");
		goal = setGoalStepStatus(goal, "two-2", "done", "Verified");
		expect(goal.status).toBe("done");
	});

	it("rejects empty objectives, empty steps, duplicate ids and unknown steps", () => {
		expect(() => createGoalRecord("  ", ["a"])).toThrow(/objective/);
		expect(() => createGoalRecord("g", [])).toThrow(/step/);
		const goal = createGoalRecord("g", ["a", "b"]);
		expect(() => setGoalStepStatus(goal, "missing-9", "done")).toThrow(/Unknown goal step/);
		expect(() => validateGoalRecord({ ...goal, steps: [goal.steps[0]!, goal.steps[0]!] })).toThrow(/Duplicate/);
	});

	it("adds steps without colliding ids and keeps the goal active", () => {
		let goal = createGoalRecord("g", ["one"]);
		goal = setGoalStepStatus(goal, "one-1", "done", "ok");
		expect(goal.status).toBe("done");
		goal = addGoalStep(goal, "one");
		expect(goal.steps).toHaveLength(2);
		expect(new Set(goal.steps.map((step) => step.id)).size).toBe(2);
		expect(goal.status).toBe("active");
	});

	it("validates durable snapshots", () => {
		const goal = createGoalRecord("g", ["a"]);
		expect(isGoalRecord(JSON.parse(JSON.stringify(goal)))).toBe(true);
		expect(isGoalRecord({ ...goal, steps: [{ id: 1 }] })).toBe(false);
		expect(isGoalRecord(null)).toBe(false);
	});
});

describe("plan command state", () => {
	it("parses non-executing plan commands", () => {
		expect(parsePlanCommand("/plan inspect, patch, then verify")).toEqual({
			kind: "create",
			text: "inspect, patch, then verify",
		});
		expect(parsePlanCommand("/plan status")).toEqual({ kind: "status" });
		expect(parsePlanCommand("/plan clear")).toEqual({ kind: "clear" });
		expect(parsePlanCommand("/plan")).toEqual({ kind: "status" });
		expect(parsePlanCommand("/plan   ")).toEqual({ kind: "status" });
		expect(parsePlanCommand("/plans")).toBeNull();
	});

	it("no longer exposes a /goal command", () => {
		expect(BUILTIN_SLASH_COMMANDS.some((command) => command.name === "goal")).toBe(false);
		expect(parsePlanCommand("/goal ship it")).toBeNull();
	});

	it("builds a fenced, non-mutating plan turn", () => {
		const prompt = buildPlanPrompt("do the work", ".porcupine/plans/x.md");
		expect(prompt).toContain("do not implement yet");
		expect(prompt).toContain(".porcupine/plans/x.md");
		expect(isPlanPrompt(prompt)).toBe(true);
		expect(filterOutGoalPlanQueue([prompt, "hello"])).toEqual(["hello"]);
	});

	it("validates durable plan snapshots and formats their state", () => {
		const plan = {
			objective: "Do work",
			path: ".porcupine/plans/x.md",
			status: "ready" as const,
			steps: [],
			routeSummary: [],
			updatedAt: "t",
		};
		expect(isGoalPlanState({ plan })).toBe(true);
		expect(isGoalPlanState({ plan: { objective: 1 } })).toBe(false);
		expect(formatPlanStatus(plan)).toContain("Do work");
		expect(formatPlanStatus()).toContain("No saved plan");
		expect(GOAL_PLAN_SESSION_ENTRY).toBe("porcupine.goal-plan-state");
	});
});
