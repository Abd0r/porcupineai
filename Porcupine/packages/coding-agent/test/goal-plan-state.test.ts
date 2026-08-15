import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import {
	buildGoalContinuation,
	buildPlanPrompt,
	DEFAULT_GOAL_MAX_TURNS,
	formatGoalStatus,
	formatPlanStatus,
	GOAL_PLAN_SESSION_ENTRY,
	isGoalPlanState,
	isPlanPrompt,
	judgeGoalResponse,
	parseGoalCommand,
	parseGoalJudgeResponse,
	parsePlanCommand,
} from "../src/porcupine/goal-plan-state.ts";

describe("goal and plan command state", () => {
	it("parses the standing-goal lifecycle", () => {
		expect(parseGoalCommand("/goal ship the release safely")).toEqual({
			kind: "set",
			text: "ship the release safely",
		});
		expect(parseGoalCommand("/goal")).toEqual({ kind: "status" });
		expect(parseGoalCommand("/goal pause")).toEqual({ kind: "pause" });
		expect(parseGoalCommand("/goal resume")).toEqual({ kind: "resume" });
		expect(parseGoalCommand("/goal clear")).toEqual({ kind: "clear" });
		expect(parseGoalCommand("/goal show")).toEqual({ kind: "status" });
		expect(parseGoalCommand("/goal stop")).toEqual({ kind: "clear" });
		expect(parseGoalCommand("/goal remind 10m")).toEqual({ kind: "remind", durationMs: 600_000 });
		expect(parseGoalCommand("/goal remind 2h")).toEqual({ kind: "remind", durationMs: 7_200_000 });
		expect(parseGoalCommand("/goal remind nope")).toEqual({ kind: "invalid", message: expect.any(String) });
	});

	it("parses non-executing plan commands", () => {
		expect(parsePlanCommand("/plan inspect, patch, then verify")).toEqual({
			kind: "create",
			text: "inspect, patch, then verify",
		});
		expect(parsePlanCommand("/plan status")).toEqual({ kind: "status" });
		expect(parsePlanCommand("/plan clear")).toEqual({ kind: "clear" });
		expect(parsePlanCommand("/planning")).toBeNull();
	});

	it("validates durable snapshots and formats their user-facing state", () => {
		const state = {
			goal: {
				text: "Finish the feature with tests",
				status: "active" as const,
				turnsUsed: 2,
				maxTurns: DEFAULT_GOAL_MAX_TURNS,
				createdAt: "2026-08-03T00:00:00.000Z",
				updatedAt: "2026-08-03T00:00:00.000Z",
			},
			plan: {
				objective: "Finish the feature",
				path: ".porcupine/plans/finish-the-feature.md",
				status: "ready" as const,
				steps: [
					{
						id: "test-1",
						objective: "Run focused tests",
						capabilityIds: ["tool:bash"],
						status: "pending" as const,
					},
				],
				routeSummary: ["tool:bash"],
				updatedAt: "2026-08-03T00:00:00.000Z",
			},
		};
		expect(GOAL_PLAN_SESSION_ENTRY).toBe("porcupine.goal-plan-state");
		expect(isGoalPlanState(state)).toBe(true);
		expect(formatGoalStatus(state.goal)).toContain("active");
		expect(formatGoalStatus(state.goal)).toContain("2/20");
		expect(formatPlanStatus(state.plan)).toContain("Run focused tests");
		expect(formatPlanStatus(state.plan)).toContain(".porcupine/plans/finish-the-feature.md");
		expect(isGoalPlanState({ goal: { text: 3 } })).toBe(false);
	});

	it("builds bounded, non-mutating goal and plan turns", () => {
		const goal = {
			text: "Ship the feature safely",
			status: "active" as const,
			turnsUsed: 1,
			maxTurns: DEFAULT_GOAL_MAX_TURNS,
			createdAt: "2026-08-03T00:00:00.000Z",
			updatedAt: "2026-08-03T00:00:00.000Z",
		};
		expect(buildGoalContinuation(goal)).toContain("Turn budget: 1/20");
		const plan = buildPlanPrompt("Ship the feature safely", ".porcupine/plans/ship-the-feature.md");
		expect(plan).toContain("do not implement yet");
		expect(plan).toContain(".porcupine/plans/ship-the-feature.md");
		expect(plan).toContain("Do not edit source files");
		expect(isPlanPrompt(plan)).toBe(true);
	});

	it("accepts only strict JSON judge verdicts", () => {
		expect(parseGoalJudgeResponse('{"verdict":"done","reason":"Tests passed."}')).toEqual({
			kind: "done",
			reason: "Tests passed.",
		});
		expect(parseGoalJudgeResponse("The task is complete.")).toBeUndefined();
		expect(parseGoalJudgeResponse('{"verdict":"maybe"}')).toBeUndefined();
	});

	it("fails open when the goal judge returns no valid verdict", async () => {
		const verdict = await judgeGoalResponse({
			modelRuntime: {
				completeSimple: async () => undefined,
			} as never,
			model: {} as never,
			goal: {
				text: "Ship the feature safely",
				status: "active",
				turnsUsed: 0,
				maxTurns: DEFAULT_GOAL_MAX_TURNS,
				createdAt: "2026-08-03T00:00:00.000Z",
				updatedAt: "2026-08-03T00:00:00.000Z",
			},
			response: "I inspected the files.",
		});
		expect(verdict.kind).toBe("continue");
		expect(verdict.reason).toContain("continuing safely");
	});

	it("registers both commands for help and autocomplete", () => {
		const names = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
		expect(names.has("goal")).toBe(true);
		expect(names.has("plan")).toBe(true);
	});
});
