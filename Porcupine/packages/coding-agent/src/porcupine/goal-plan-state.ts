/**
 * Plan session state and the inspection-only plan turn.
 *
 * Goals are no longer a user command or a judged loop. The agent declares and
 * tracks its own goal through the `goal` tool (see `goal-record.ts`). What
 * remains here is the `/plan` artifact workflow: prepare an inspection-only turn,
 * fence mutating tools, and save the resulting Markdown into the workspace.
 */

import type { TaskGraphView } from "./session-orchestrator.ts";

export const GOAL_PLAN_SESSION_ENTRY = "porcupine.goal-plan-state";
export const PLAN_PROMPT_PREFIX = "[Plan mode: do not implement yet]";

export interface SavedPlan {
	objective: string;
	path: string;
	status: TaskGraphView["status"];
	steps: TaskGraphView["steps"];
	routeSummary: string[];
	updatedAt: string;
}

export interface GoalPlanState {
	plan?: SavedPlan;
}

export type PlanCommand =
	| { kind: "status" }
	| { kind: "create"; text: string }
	| { kind: "clear" }
	| { kind: "invalid"; message: string };

const PLAN_USAGE = "Usage: /plan <text> | /plan [status|clear]";

function parseSlashArgument(text: string, command: string): string[] | null {
	const match = new RegExp(`^\\/${command}(?:\\s+(.*))?\\s*$`, "i").exec(text.trim());
	if (!match) return null;
	return match[1]?.trim().split(/\s+/).filter(Boolean) ?? [];
}

export function parsePlanCommand(text: string): PlanCommand | null {
	const args = parseSlashArgument(text, "plan");
	if (args === null) return null;
	if (!args.length || args[0] === "status") return { kind: "status" };
	if (args.length === 1 && args[0] === "clear") return { kind: "clear" };
	const value = text
		.trim()
		.replace(/^\/plan\s+/i, "")
		.trim();
	if (!value) return { kind: "invalid", message: PLAN_USAGE };
	return { kind: "create", text: value };
}

/** A normal agent turn that plans but explicitly prohibits implementation. */
export function buildPlanPrompt(objective: string, artifactPath: string): string {
	return [
		PLAN_PROMPT_PREFIX,
		`Objective: ${objective}`,
		"Inspect the relevant codebase and return an implementation-ready Markdown plan.",
		"Include: current behavior and evidence, exact files/symbols to change, numbered implementation steps, verification commands, compatibility or safety risks, and any blocking questions.",
		`Your response will be saved verbatim to ${artifactPath} by Porcupine after this turn.`,
		"Do not edit source files, run mutating commands, commit, or begin implementation. End after the plan.",
	].join("\n\n");
}

export function isPlanPrompt(text: string): boolean {
	return text.trimStart().startsWith(PLAN_PROMPT_PREFIX);
}

/**
 * True when this turn is the queued /plan draft and its prepared graph must be
 * preserved. Uses an explicit in-memory token, not prompt-text inference, so
 * generated plan prompts cannot fall into the ordinary-turn reset path.
 */
export function shouldPreservePlanGraphForTurn(text: string, planTurnInFlight: boolean): boolean {
	return planTurnInFlight && isPlanPrompt(text);
}

/** Remove queued plan drafts when leaving a session. */
export function filterOutGoalPlanQueue(inputs: string[]): string[] {
	return inputs.filter((input) => !isPlanPrompt(input));
}

export type PlanSettleOutcome = "interrupted" | "no-metadata" | "empty" | "save";

/** Pure decision for plan-turn settle, mirroring processSettledPlanTurn branches. */
export function classifyPlanSettle(input: {
	planExists: boolean;
	hasMarkdown: boolean;
	interrupted: boolean;
}): PlanSettleOutcome {
	if (input.interrupted) return "interrupted";
	if (!input.planExists) return "no-metadata";
	if (!input.hasMarkdown) return "empty";
	return "save";
}

export function isGoalPlanState(value: unknown): value is GoalPlanState {
	if (!value || typeof value !== "object") return false;
	const state = value as GoalPlanState;
	return (
		state.plan === undefined ||
		(typeof state.plan.objective === "string" &&
			Array.isArray(state.plan.steps) &&
			Array.isArray(state.plan.routeSummary) &&
			typeof state.plan.updatedAt === "string")
	);
}

export function formatPlanStatus(plan?: SavedPlan): string {
	if (!plan) return "No saved plan. Use /plan <text> to generate one.";
	const lines = [`Plan (${plan.status}): ${plan.objective}`, `Artifact: ${plan.path}`];
	for (const [index, step] of plan.steps.entries()) {
		lines.push(`${index + 1}. [${step.status}] ${step.objective}`);
	}
	return lines.join("\n");
}
