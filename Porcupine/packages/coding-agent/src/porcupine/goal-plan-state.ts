import type { Model } from "@porcupineai/ai";
import type { ModelRuntime } from "../core/model-runtime.ts";
import { classifyWithSessionModel } from "./llm-classify.ts";
import { parseDuration } from "./reminders.ts";
import type { TaskGraphView } from "./session-orchestrator.ts";

export const GOAL_PLAN_SESSION_ENTRY = "porcupine.goal-plan-state";
export const DEFAULT_GOAL_MAX_TURNS = 20;
export const GOAL_CONTINUATION_PREFIX = "[Continuing toward your standing goal]";
export const PLAN_PROMPT_PREFIX = "[Plan mode: do not implement yet]";

export interface StandingGoal {
	text: string;
	status: "active" | "paused" | "done";
	turnsUsed: number;
	maxTurns: number;
	createdAt: string;
	updatedAt: string;
	lastVerdict?: "continue" | "done" | "blocked" | "budget-exhausted";
	lastReason?: string;
}

export interface SavedPlan {
	objective: string;
	path: string;
	status: TaskGraphView["status"];
	steps: TaskGraphView["steps"];
	routeSummary: string[];
	updatedAt: string;
}

export interface GoalPlanState {
	goal?: StandingGoal;
	plan?: SavedPlan;
}

export type GoalCommand =
	| { kind: "status" }
	| { kind: "set"; text: string }
	| { kind: "pause" }
	| { kind: "resume" }
	| { kind: "clear" }
	| { kind: "remind"; durationMs: number }
	| { kind: "invalid"; message: string };

export type PlanCommand =
	| { kind: "status" }
	| { kind: "create"; text: string }
	| { kind: "clear" }
	| { kind: "invalid"; message: string };

export type GoalVerdict =
	| { kind: "continue"; reason: string }
	| { kind: "done"; reason: string }
	| { kind: "blocked"; reason: string };

export interface GoalJudgeOptions {
	modelRuntime: ModelRuntime;
	model: Model<any> | undefined;
	goal: StandingGoal;
	response: string;
}

const GOAL_USAGE = "Usage: /goal <text> | /goal [status|pause|resume|clear]";
const PLAN_USAGE = "Usage: /plan <text> | /plan [status|clear]";

function parseSlashArgument(text: string, command: string): string[] | null {
	const match = new RegExp(`^\\/${command}(?:\\s+(.*))?\\s*$`, "i").exec(text.trim());
	if (!match) return null;
	return match[1]?.trim().split(/\s+/).filter(Boolean) ?? [];
}

export function parseGoalCommand(text: string): GoalCommand | null {
	const args = parseSlashArgument(text, "goal");
	if (args === null) return null;
	if (!args.length || args[0] === "status" || args[0] === "show") return { kind: "status" };
	if (args.length === 1 && ["pause", "resume", "clear", "stop", "done"].includes(args[0]!)) {
		return {
			kind: args[0] === "stop" || args[0] === "done" ? "clear" : (args[0] as "pause" | "resume" | "clear"),
		};
	}
	// `/goal remind <duration>` — re-fire a nudge back to the standing goal
	// after a delay. Parsed here so the goal command surface stays self-contained.
	if (args[0] === "remind") {
		const durationMs = parseDuration(args.slice(1).join(" "));
		if (durationMs === undefined)
			return { kind: "invalid", message: "Usage: /goal remind <duration>  (e.g. /goal remind 10m)" };
		return { kind: "remind", durationMs };
	}
	const value = text
		.trim()
		.replace(/^\/goal\s+/i, "")
		.trim();
	if (!value) return { kind: "invalid", message: GOAL_USAGE };
	return { kind: "set", text: value };
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

export function buildGoalContinuation(goal: StandingGoal): string {
	return [
		GOAL_CONTINUATION_PREFIX,
		`Goal: ${goal.text}`,
		`Turn budget: ${goal.turnsUsed}/${goal.maxTurns}.`,
		"Continue with the next concrete step. Before declaring completion, verify the deliverable and state the evidence explicitly. If blocked or user input is required, state that clearly and stop.",
	].join("\n\n");
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

const GOAL_JUDGE_SYSTEM_PROMPT = [
	"You are a strict completion judge for a Safe Autonomous AI Agent.",
	'Reply only with one JSON object: {"verdict":"done|continue|blocked","reason":"one sentence"}.',
	"done requires concrete evidence in the final response that the stated goal is fully satisfied.",
	"blocked applies only when progress requires user input or an external blocker cannot be resolved now.",
	"continue is the default whenever evidence is incomplete or ambiguous.",
].join(" ");

/** Parses the strict JSON completion contract used by the goal judge. */
export function parseGoalJudgeResponse(raw: string): GoalVerdict | undefined {
	try {
		const value = JSON.parse(raw.trim()) as {
			verdict?: unknown;
			reason?: unknown;
		};
		const verdict = value.verdict;
		if (verdict !== "done" && verdict !== "continue" && verdict !== "blocked") return undefined;
		return {
			kind: verdict,
			reason:
				typeof value.reason === "string" && value.reason.trim()
					? value.reason.trim()
					: "No judge rationale was returned.",
		};
	} catch {
		return undefined;
	}
}

/**
 * Judge completion with the active model. Fail open to `continue`: a broken
 * judge must never falsely mark a standing goal done or wedge the loop.
 */
export async function judgeGoalResponse(options: GoalJudgeOptions): Promise<GoalVerdict> {
	if (!options.response.trim()) {
		return {
			kind: "continue",
			reason: "The agent returned no final response.",
		};
	}
	const raw = await classifyWithSessionModel({
		modelRuntime: options.modelRuntime,
		model: options.model,
		system: GOAL_JUDGE_SYSTEM_PROMPT,
		user: `Goal:\n${options.goal.text}\n\nAgent final response:\n${options.response.slice(0, 8_000)}`,
		maxTokens: 120,
	});
	return (
		parseGoalJudgeResponse(raw) ?? {
			kind: "continue",
			reason: "Goal judge was unavailable or returned an invalid verdict; continuing safely.",
		}
	);
}

export function isGoalContinuation(text: string): boolean {
	return text.trimStart().startsWith(GOAL_CONTINUATION_PREFIX);
}

export function isPlanPrompt(text: string): boolean {
	return text.trimStart().startsWith(PLAN_PROMPT_PREFIX);
}

export function isGoalPlanState(value: unknown): value is GoalPlanState {
	if (!value || typeof value !== "object") return false;
	const state = value as GoalPlanState;
	return (
		(state.goal === undefined ||
			(typeof state.goal.text === "string" &&
				["active", "paused", "done"].includes(state.goal.status) &&
				Number.isInteger(state.goal.turnsUsed) &&
				Number.isInteger(state.goal.maxTurns) &&
				typeof state.goal.updatedAt === "string")) &&
		(state.plan === undefined ||
			(typeof state.plan.objective === "string" &&
				Array.isArray(state.plan.steps) &&
				Array.isArray(state.plan.routeSummary) &&
				typeof state.plan.updatedAt === "string"))
	);
}

export function formatGoalStatus(goal?: StandingGoal): string {
	if (!goal) return "No standing goal. Use /goal <text> to set one.";
	const lines = [`Goal (${goal.status}, ${goal.turnsUsed}/${goal.maxTurns} turns): ${goal.text}`];
	if (goal.lastVerdict) {
		lines.push(`Last verdict: ${goal.lastVerdict}${goal.lastReason ? ` — ${goal.lastReason}` : ""}`);
	}
	return lines.join("\n");
}

export function formatPlanStatus(plan?: SavedPlan): string {
	if (!plan) return "No saved plan. Use /plan <text> to generate one.";
	const lines = [`Plan (${plan.status}): ${plan.objective}`, `Artifact: ${plan.path}`];
	for (const [index, step] of plan.steps.entries()) {
		lines.push(`${index + 1}. [${step.status}] ${step.objective}`);
	}
	return lines.join("\n");
}
