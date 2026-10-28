/**
 * Goal tool: the agent declares and tracks its own objective.
 *
 * There is no user-facing `/goal` command. The model states what it is trying to
 * achieve, adds or starts steps as it works, and closes them with evidence. A
 * goal becomes `done` only when every step is done, and `blocked` when a step is
 * explicitly blocked. State is session-scoped so it survives resume and is visible
 * to both the terminal and browser clients.
 */

import type { AgentTool } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import {
	addGoalStep,
	createGoalRecord,
	formatGoalMarkdown,
	formatGoalStatus,
	type GoalRecord,
	goalProgress,
	setGoalStepStatus,
	validateGoalRecord,
} from "../../porcupine/goal-record.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const goalSchema = Type.Object({
	action: Type.Union(
		[
			Type.Literal("status"),
			Type.Literal("create"),
			Type.Literal("add-step"),
			Type.Literal("start"),
			Type.Literal("done"),
			Type.Literal("block"),
			Type.Literal("clear"),
		],
		{ description: "status | create | add-step | start | done | block | clear" },
	),
	objective: Type.Optional(Type.String({ description: "Goal objective (action=create)" })),
	steps: Type.Optional(Type.String({ description: "Newline-separated initial steps (action=create)" })),
	step: Type.Optional(Type.String({ description: "Step objective (action=add-step)" })),
	stepId: Type.Optional(Type.String({ description: "Step id (action=start|done|block)" })),
	note: Type.Optional(Type.String({ description: "Evidence or reason (action=done|block)" })),
});

export type GoalToolInput = Static<typeof goalSchema>;

export interface GoalToolDetails {
	action: string;
	goal?: GoalRecord;
	stepId?: string;
	done?: number;
	total?: number;
}

export interface GoalToolOptions {
	/** Restore the persisted goal for this session. */
	load?: () => GoalRecord | undefined;
	/** Persist the current goal so resume keeps it. */
	persist?: (goal: GoalRecord | undefined) => void;
	/** Notify clients that the tracked goal changed. */
	onChange?: (goal: GoalRecord | undefined) => void;
}

function splitLines(value: string | undefined): string[] {
	return (value ?? "")
		.split("\n")
		.map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
		.filter(Boolean);
}

export function createGoalToolDefinition(
	options?: GoalToolOptions,
): ToolDefinition<typeof goalSchema, GoalToolDetails> {
	const store: { current?: GoalRecord } = { current: options?.load?.() };

	const commit = (goal: GoalRecord | undefined): GoalRecord | undefined => {
		store.current = goal;
		if (goal) validateGoalRecord(goal);
		options?.persist?.(goal);
		options?.onChange?.(goal);
		return goal;
	};

	return {
		name: "goal",
		label: "goal",
		description:
			"The agent's own tracked objective, with steps. Declare a goal when a task needs several dependent steps, then move steps start/done/block as you work. A goal becomes done only when every step is done. There is no user command; you own this record.",
		promptSnippet: "Declare and track your own goal with steps",
		promptGuidelines: [
			"Use goal create when the request needs more than a couple of dependent steps, then start one step at a time.",
			"Mark a step done only with concrete evidence from the work, and pass that evidence in note.",
			"If progress needs user input or an external blocker, block the step with the reason instead of stalling silently.",
			"Keep the objective and steps short. Do not create a goal for trivial single-step requests or for chat.",
		],
		parameters: goalSchema,
		async execute(_toolCallId, args) {
			const action = args.action;
			let text: string;
			let stepId = args.stepId?.trim();
			try {
				if (action === "status") {
					text = formatGoalStatus(store.current);
				} else if (action === "create") {
					const objective = args.objective?.trim();
					if (!objective) throw new Error("action=create requires an objective.");
					const steps = splitLines(args.steps);
					if (steps.length === 0) throw new Error("action=create requires at least one step.");
					commit(createGoalRecord(objective, steps));
					text = `Goal set:\n${formatGoalStatus(store.current)}`;
				} else if (action === "clear") {
					commit(undefined);
					text = "Goal cleared.";
				} else {
					const current = store.current;
					if (!current) throw new Error("No goal set. Use action=create first.");
					if (action === "add-step") {
						const objective = args.step?.trim();
						if (!objective) throw new Error("action=add-step requires step text.");
						commit(addGoalStep(current, objective));
						text = `Step added:\n${formatGoalStatus(store.current)}`;
					} else {
						if (!stepId) {
							const progress = goalProgress(current);
							if (!progress.current) throw new Error("Pass stepId; no step is currently active.");
							stepId = progress.current.id;
						}
						const status = action === "start" ? "active" : action === "done" ? "done" : "blocked";
						if (action !== "start" && !args.note?.trim()) {
							throw new Error(`action=${action} requires a note with evidence or the blocking reason.`);
						}
						commit(setGoalStepStatus(current, stepId, status, args.note));
						text = `Step ${status}: ${stepId}\n${formatGoalStatus(store.current)}`;
					}
				}
			} catch (error) {
				text = error instanceof Error ? error.message : String(error);
			}
			const goal = store.current;
			return {
				content: [{ type: "text", text }],
				details: {
					action,
					...(goal ? { goal, done: goalProgress(goal).done, total: goal.steps.length } : {}),
					...(stepId ? { stepId } : {}),
				} satisfies GoalToolDetails,
			};
		},
		renderCall(args) {
			const action = String(args?.action ?? "?");
			const target = String(args?.stepId ?? args?.objective ?? args?.step ?? "");
			return new Text(
				`${theme.fg("toolTitle", theme.bold("goal"))} ${theme.fg("toolOutput", `${action} ${target}`.trim())}`,
				0,
				0,
			);
		},
		renderResult(result, options) {
			const text = (result.content ?? [])
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("")
				.trim();
			const preview = options.expanded ? text : text.split("\n").slice(0, 8).join("\n");
			return new Text(`\n${theme.fg("toolOutput", preview || "(empty)")}`, 0, 0);
		},
	};
}

export function createGoalTool(options?: GoalToolOptions): AgentTool<typeof goalSchema> {
	return wrapToolDefinition(createGoalToolDefinition(options));
}

/** Markdown export for `/session` style summaries and tests. */
export function exportGoalMarkdown(goal: GoalRecord): string {
	return formatGoalMarkdown(goal);
}
