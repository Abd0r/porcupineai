/**
 * Plan tool: the model's structured TODO list for multi-step work.
 *
 * One active outcome plan per session: milestones with dependencies,
 * expected outputs, verification, evidence refs, and ownership. Tool calls
 * never complete a milestone by themselves — a step moves pending → active
 * → verifying (with evidence) → done, and direct completion without
 * evidence is rejected. State is session-local (held by the tool instance);
 * persistence to session entries lands with the continuity slice.
 */

import type { AgentTool } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import {
	completePlanStep,
	createPlanRecord,
	formatPlanRecordMarkdown,
	type PlanRecord,
	type PlanRecordStepStatus,
	requestPlanStepVerification,
	revisePlanRecord,
	setPlanStepStatus,
	startPlanStep,
	validatePlanRecord,
} from "../../porcupine/plan-record.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const planSchema = Type.Object({
	action: Type.Union(
		[
			Type.Literal("status"),
			Type.Literal("create"),
			Type.Literal("add-step"),
			Type.Literal("start"),
			Type.Literal("verify"),
			Type.Literal("complete"),
			Type.Literal("block"),
			Type.Literal("fail"),
			Type.Literal("skip"),
			Type.Literal("cancel"),
			Type.Literal("clear"),
			Type.Literal("export"),
		],
		{
			description:
				"status | create | add-step | start | verify | complete | block | fail | skip | cancel | clear | export",
		},
	),
	objective: Type.Optional(Type.String({ description: "Plan objective (action=create)" })),
	steps: Type.Optional(Type.String({ description: "Newline-separated step objectives (action=create)" })),
	stepId: Type.Optional(Type.String({ description: "Step id (start/verify/complete/block/fail/skip/cancel)" })),
	evidence: Type.Optional(Type.String({ description: "Newline-separated evidence refs (action=verify)" })),
	note: Type.Optional(Type.String({ description: "Reason note (block/fail/skip/cancel, add-step dependency)" })),
	owner: Type.Optional(Type.String({ description: "Owner tag for delegation (action=start)" })),
});

export type PlanToolInput = Static<typeof planSchema>;

export interface PlanToolDetails {
	action: string;
	stepId?: string;
	revision?: number;
	/** Agent-written todo name for end-beat chips. */
	stepObjective?: string;
	/** True only when the call actually changed plan state. */
	transitioned?: boolean;
}

export interface PlanToolOptions {
	/** Initial record override (tests). */
	initial?: PlanRecord;
}

interface PlanStore {
	active?: PlanRecord;
	archived: PlanRecord[];
}

function stepLine(step: { id: string; objective: string; status: PlanRecordStepStatus }): string {
	const glyph =
		step.status === "done"
			? "✓"
			: step.status === "active"
				? "●"
				: step.status === "verifying"
					? "◐"
					: step.status === "failed"
						? "✗"
						: step.status === "blocked"
							? "■"
							: step.status === "cancelled" || step.status === "skipped"
								? "–"
								: "○";
	return `${glyph} ${step.id}  [${step.status}]  ${step.objective}`;
}

function formatPlanStatus(store: PlanStore): string {
	const record = store.active;
	if (!record) return "No active plan. Use action=create with an objective and newline-separated steps.";
	const lines = [`Plan (revision ${record.revision}): ${record.objective}`, ...record.steps.map(stepLine)];
	return lines.join("\n");
}

function splitLines(value: string | undefined): string[] {
	return (value ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export function createPlanToolDefinition(
	options?: PlanToolOptions,
): ToolDefinition<typeof planSchema, PlanToolDetails | undefined> {
	const store: PlanStore = { active: options?.initial, archived: [] };

	return {
		name: "plan",
		label: "plan",
		description:
			"Invoke by the exact tool name `plan` (no namespace prefix). Structured TODO list for multi-step work. action=status shows the active plan; action=create starts one (objective + newline-separated steps); action=start begins a ready step; action=verify attaches evidence and moves it to verifying; action=complete finishes a verifying step (evidence required — direct completion is rejected); action=block|fail|skip|cancel marks a step. Tool calls never complete a step by themselves.",
		promptSnippet: "Structured plan TODO list (create/start/verify/complete with evidence)",
		promptGuidelines: [
			"Use the plan tool for multi-step work: create milestones with dependencies, start them when ready, attach evidence with verify, then complete. Never mark a step done without evidence.",
			"Simple single actions need no plan. For trivial chat, do not touch the plan tool.",
		],
		parameters: planSchema,
		async execute(_toolCallId, args) {
			const action = args.action;
			const stepId = args.stepId?.trim();
			let text: string;
			let revision = store.active?.revision;
			const entryRevision = revision;

			try {
				switch (action) {
					case "status":
						text = formatPlanStatus(store);
						break;
					case "create": {
						const objective = args.objective?.trim();
						const steps = splitLines(args.steps);
						if (!objective) {
							text = "action=create requires objective.";
							break;
						}
						if (steps.length === 0) {
							text = "action=create requires at least one step (newline-separated in steps).";
							break;
						}
						if (store.active) store.archived.push(store.active);
						store.active = createPlanRecord(objective, steps);
						revision = store.active.revision;
						text = `Plan created (${store.active.steps.length} steps):\n${formatPlanStatus(store)}`;
						break;
					}
					case "add-step": {
						const record = store.active;
						const objective = args.objective?.trim();
						if (!record) {
							text = "No active plan. Use action=create first.";
							break;
						}
						if (!objective) {
							text = "action=add-step requires objective.";
							break;
						}
						const dependsOn = splitLines(args.note);
						store.active = revisePlanRecord(record, (draft) => {
							const next = draft.steps.length;
							const slug =
								objective
									.toLowerCase()
									.replace(/[^a-z0-9]+/g, "-")
									.replace(/^-+|-+$/g, "")
									.slice(0, 40) || "step";
							draft.steps.push({
								id: `${slug}-${next + 1}`,
								objective,
								dependencies: dependsOn,
								expectedOutputs: [],
								verification: "",
								evidenceRefs: [],
								status: "pending",
								attempts: 0,
							});
						});
						revision = store.active.revision;
						text = `Step added:\n${formatPlanStatus(store)}`;
						break;
					}
					case "start": {
						const record = store.active;
						if (!record || !stepId) {
							text = !record ? "No active plan. Use action=create first." : "action=start requires stepId.";
							break;
						}
						store.active = startPlanStep(record, stepId, args.owner?.trim() || undefined);
						revision = store.active.revision;
						text = `Step started: ${stepId}`;
						break;
					}
					case "verify": {
						const record = store.active;
						if (!record || !stepId) {
							text = !record ? "No active plan. Use action=create first." : "action=verify requires stepId.";
							break;
						}
						const evidence = splitLines(args.evidence);
						store.active = requestPlanStepVerification(record, stepId, evidence);
						revision = store.active.revision;
						text = `Step verifying: ${stepId} (${evidence.length} evidence ref${evidence.length === 1 ? "" : "s"})`;
						break;
					}
					case "complete": {
						const record = store.active;
						if (!record || !stepId) {
							text = !record ? "No active plan. Use action=create first." : "action=complete requires stepId.";
							break;
						}
						store.active = completePlanStep(record, stepId);
						revision = store.active.revision;
						text = `Step done: ${stepId}`;
						break;
					}
					case "block":
					case "fail":
					case "skip":
					case "cancel": {
						const record = store.active;
						if (!record || !stepId) {
							text = !record ? "No active plan. Use action=create first." : `action=${action} requires stepId.`;
							break;
						}
						const terminal = { block: "blocked", fail: "failed", skip: "skipped", cancel: "cancelled" } as const;
						store.active = setPlanStepStatus(record, stepId, terminal[action], args.note?.trim() || undefined);
						revision = store.active.revision;
						text = `Step ${action}led: ${stepId}`;
						break;
					}
					case "clear": {
						if (store.active) store.archived.push(store.active);
						store.active = undefined;
						text = "Active plan cleared.";
						break;
					}
					case "export": {
						if (!store.active) {
							text = "No active plan. Use action=create first.";
							break;
						}
						text = formatPlanRecordMarkdown(store.active);
						break;
					}
					default:
						text = `Unknown action: ${action}`;
						break;
				}
			} catch (error) {
				text = error instanceof Error ? error.message : String(error);
			}

			const stepObjective = stepId ? store.active?.steps.find((step) => step.id === stepId)?.objective : undefined;

			const transitioned = store.active?.revision !== entryRevision;

			return {
				content: [{ type: "text", text }],
				details: {
					action,
					stepId,
					revision: store.active?.revision,
					stepObjective,
					transitioned,
				} satisfies PlanToolDetails,
			};
		},
		renderCall(args) {
			const action = String(args?.action ?? "?");
			const target = String(args?.stepId ?? "");
			return new Text(
				`${theme.fg("toolTitle", theme.bold("plan"))} ${theme.fg("toolOutput", `${action} ${target}`.trim())}`,
				0,
				0,
			);
		},
		renderResult(result, options) {
			const text = (result.content ?? [])
				.map((c) => (c.type === "text" ? c.text : ""))
				.join("")
				.trim();
			const preview = options.expanded ? text : text.split("\n").slice(0, 12).join("\n");
			return new Text(`\n${theme.fg("toolOutput", preview || "(empty)")}`, 0, 0);
		},
	};
}

export function createPlanTool(options?: PlanToolOptions): AgentTool<typeof planSchema> {
	return wrapToolDefinition(createPlanToolDefinition(options));
}

/** Test helper: validate a record through the tool's contract. */
export function validatePlanToolRecord(record: PlanRecord): void {
	validatePlanRecord(record);
}
