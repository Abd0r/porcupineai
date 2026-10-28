/**
 * GoalRecord: an agent-authored objective with tracked steps.
 *
 * Goals are not user commands. The agent declares what it is trying to achieve,
 * then moves its own steps forward with evidence, exactly like the plan tool.
 * The record is session-scoped and rendered by both the terminal and browser.
 */

export const GOAL_SESSION_ENTRY = "porcupine.goal-record";

export type GoalStepStatus = "pending" | "active" | "done" | "blocked";
export type GoalStatus = "active" | "done" | "blocked";

export interface GoalStep {
	id: string;
	objective: string;
	status: GoalStepStatus;
	note?: string;
}

export interface GoalRecord {
	objective: string;
	status: GoalStatus;
	steps: GoalStep[];
	createdAt: string;
	updatedAt: string;
}

function slug(text: string, fallback: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || fallback
	);
}

export function createGoalStep(objective: string, index: number): GoalStep {
	const trimmed = objective.trim();
	if (!trimmed) throw new Error("Goal steps need a non-empty objective.");
	return { id: `${slug(trimmed, "step")}-${index}`, objective: trimmed.slice(0, 240), status: "pending" };
}

export function createGoalRecord(objective: string, stepObjectives: string[]): GoalRecord {
	const trimmed = objective.trim();
	if (!trimmed) throw new Error("A goal needs a non-empty objective.");
	if (stepObjectives.length === 0) throw new Error("A goal needs at least one step.");
	const now = new Date().toISOString();
	return {
		objective: trimmed.slice(0, 240),
		status: "active",
		steps: stepObjectives.map((step, index) => createGoalStep(step, index + 1)),
		createdAt: now,
		updatedAt: now,
	};
}

export function validateGoalRecord(record: GoalRecord): void {
	if (!record.objective.trim()) throw new Error("Goal objective must not be empty.");
	if (!["active", "done", "blocked"].includes(record.status)) throw new Error("Unknown goal status.");
	const ids = new Set<string>();
	for (const step of record.steps) {
		if (!step.objective.trim()) throw new Error("Goal step objective must not be empty.");
		if (ids.has(step.id)) throw new Error(`Duplicate goal step id: ${step.id}`);
		ids.add(step.id);
	}
}

export function setGoalStepStatus(
	record: GoalRecord,
	stepId: string,
	status: GoalStepStatus,
	note?: string,
): GoalRecord {
	const step = record.steps.find((candidate) => candidate.id === stepId);
	if (!step) throw new Error(`Unknown goal step: ${stepId}`);
	const steps = record.steps.map((candidate) =>
		candidate.id === stepId
			? { ...candidate, status, ...(note?.trim() ? { note: note.trim().slice(0, 240) } : {}) }
			: candidate,
	);
	const updated: GoalRecord = { ...record, steps, updatedAt: new Date().toISOString() };
	// A goal is done only when every step is done. Blocked dominates while active.
	if (steps.every((candidate) => candidate.status === "done")) {
		updated.status = "done";
	} else if (steps.some((candidate) => candidate.status === "blocked")) {
		updated.status = "blocked";
	} else {
		updated.status = "active";
	}
	return updated;
}

export function addGoalStep(record: GoalRecord, objective: string): GoalRecord {
	const step = createGoalStep(objective, record.steps.length + 1);
	const steps = record.steps.map((candidate) => ({ ...candidate }));
	if (steps.some((candidate) => candidate.id === step.id)) step.id = `${step.id}-2`;
	steps.push(step);
	return { ...record, steps, status: "active", updatedAt: new Date().toISOString() };
}

export function goalProgress(record: GoalRecord): { done: number; total: number; current?: GoalStep } {
	return {
		done: record.steps.filter((step) => step.status === "done").length,
		total: record.steps.length,
		current: record.steps.find((step) => step.status === "active"),
	};
}

export function formatGoalStatus(record?: GoalRecord): string {
	if (!record) return "No goal set. The agent declares one with the goal tool.";
	const { done, total, current } = goalProgress(record);
	const lines = [`Goal (${record.status}, ${done}/${total} steps): ${record.objective}`];
	if (current) lines.push(`Current: ${current.objective}`);
	for (const step of record.steps) {
		lines.push(
			`${step.status === "done" ? "[x]" : step.status === "active" ? "[>]" : step.status === "blocked" ? "[!]" : "[ ]"} ${step.objective}`,
		);
	}
	return lines.join("\n");
}

export function formatGoalMarkdown(record: GoalRecord): string {
	const lines = [`# Goal: ${record.objective}`, "", `Status: ${record.status}`, ""];
	for (const step of record.steps) lines.push(`- [${step.status === "done" ? "x" : " "}] ${step.objective}`);
	return lines.join("\n");
}

export function isGoalRecord(value: unknown): value is GoalRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as GoalRecord;
	return (
		typeof record.objective === "string" &&
		["active", "done", "blocked"].includes(record.status) &&
		Array.isArray(record.steps) &&
		record.steps.every(
			(step) =>
				step &&
				typeof step.id === "string" &&
				typeof step.objective === "string" &&
				["pending", "active", "done", "blocked"].includes(step.status),
		)
	);
}
