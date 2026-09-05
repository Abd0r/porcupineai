/**
 * PlanRecord: one durable, model-authored TODO record per active objective.
 *
 * Outcome milestones with dependencies, expected outputs, verification,
 * evidence refs, ownership, and attempt history. The Markdown plan and the
 * TUI graph are views of this record, not separate sources of truth.
 */

export type PlanRecordStepStatus =
	| "pending"
	| "ready"
	| "active"
	| "verifying"
	| "done"
	| "failed"
	| "blocked"
	| "skipped"
	| "cancelled";

export interface PlanRecordStep {
	id: string;
	objective: string;
	dependencies: string[];
	expectedOutputs: string[];
	verification: string;
	evidenceRefs: string[];
	owner?: string;
	status: PlanRecordStepStatus;
	attempts: number;
}

export interface PlanRecord {
	id: string;
	objective: string;
	scope: string[];
	successCriteria: string[];
	revision: number;
	sessionId?: string;
	branchId?: string;
	updatedAt: string;
	steps: PlanRecordStep[];
}

function slugify(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "step"
	);
}

export function createPlanRecordStep(
	objective: string,
	index: number,
	overrides?: Partial<PlanRecordStep>,
): PlanRecordStep {
	return {
		id: `${slugify(objective)}-${index + 1}`,
		objective,
		dependencies: [],
		expectedOutputs: [],
		verification: "",
		evidenceRefs: [],
		status: "pending",
		attempts: 0,
		...overrides,
	};
}

export function createPlanRecord(objective: string, stepObjectives: string[]): PlanRecord {
	if (!objective.trim()) throw new Error("PlanRecord requires a non-empty objective.");
	return {
		id: `plan-${Date.now().toString(36)}`,
		objective: objective.trim().slice(0, 240),
		scope: [],
		successCriteria: [],
		revision: 1,
		updatedAt: new Date().toISOString(),
		steps: stepObjectives.map((stepObjective, index) => createPlanRecordStep(stepObjective, index)),
	};
}

/** Throw on duplicate ids, unknown dependencies, cycles, or empty objectives. */
export function validatePlanRecord(record: PlanRecord): void {
	if (!record.objective.trim()) throw new Error("PlanRecord objective must not be empty.");
	const ids = new Set<string>();
	for (const step of record.steps) {
		if (!step.id) throw new Error("PlanRecord step requires an id.");
		if (ids.has(step.id)) throw new Error(`Duplicate plan step: ${step.id}`);
		ids.add(step.id);
		if (!step.objective.trim()) throw new Error(`PlanRecord step ${step.id} requires an objective.`);
	}
	for (const step of record.steps) {
		for (const dependency of step.dependencies) {
			if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} in step ${step.id}`);
			if (dependency === step.id) throw new Error(`PlanRecord step ${step.id} cannot depend on itself.`);
		}
	}
	// Cycle detection via Kahn's algorithm.
	const indegree = new Map<string, number>(record.steps.map((step) => [step.id, 0]));
	const dependents = new Map<string, string[]>();
	for (const step of record.steps) {
		for (const dependency of step.dependencies) {
			indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
			const list = dependents.get(dependency) ?? [];
			list.push(step.id);
			dependents.set(dependency, list);
		}
	}
	const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
	let visited = 0;
	while (queue.length > 0) {
		const id = queue.shift()!;
		visited++;
		for (const dependent of dependents.get(id) ?? []) {
			const next = (indegree.get(dependent) ?? 0) - 1;
			indegree.set(dependent, next);
			if (next === 0) queue.push(dependent);
		}
	}
	if (visited !== record.steps.length) throw new Error("PlanRecord contains a dependency cycle.");
}

/** Mark a ready step active. Throws when dependencies are not done. */
export function startPlanStep(record: PlanRecord, stepId: string, owner?: string): PlanRecord {
	return revisePlanRecord(record, (draft) => {
		const step = draft.steps.find((candidate) => candidate.id === stepId);
		if (!step) throw new Error(`Unknown plan step: ${stepId}`);
		if (step.status !== "pending" && step.status !== "ready") {
			throw new Error(`Plan step ${stepId} is not startable from status ${step.status}.`);
		}
		const done = new Set(
			draft.steps.filter((candidate) => candidate.status === "done").map((candidate) => candidate.id),
		);
		const blocked = step.dependencies.filter((dependency) => !done.has(dependency));
		if (blocked.length > 0) throw new Error(`Plan step ${stepId} is blocked by: ${blocked.join(", ")}.`);
		step.status = "active";
		step.attempts += 1;
		if (owner !== undefined) step.owner = owner;
	});
}

/** Attach evidence and move an active step to verifying. Completion requires this first. */
export function requestPlanStepVerification(record: PlanRecord, stepId: string, evidenceRefs: string[]): PlanRecord {
	if (evidenceRefs.length === 0) throw new Error(`Plan step ${stepId} needs evidence before verification.`);
	return revisePlanRecord(record, (draft) => {
		const step = draft.steps.find((candidate) => candidate.id === stepId);
		if (!step) throw new Error(`Unknown plan step: ${stepId}`);
		if (step.status !== "active") throw new Error(`Plan step ${stepId} must be active to request verification.`);
		const refs = new Set(step.evidenceRefs);
		for (const ref of evidenceRefs) refs.add(ref);
		step.evidenceRefs = [...refs];
		step.status = "verifying";
	});
}

/** Complete a verifying step. Direct completion without evidence is rejected. */
export function completePlanStep(record: PlanRecord, stepId: string): PlanRecord {
	return revisePlanRecord(record, (draft) => {
		const step = draft.steps.find((candidate) => candidate.id === stepId);
		if (!step) throw new Error(`Unknown plan step: ${stepId}`);
		if (step.status !== "verifying") {
			throw new Error(`Plan step ${stepId} must be verifying before it can complete.`);
		}
		if (step.evidenceRefs.length === 0) throw new Error(`Plan step ${stepId} has no evidence.`);
		step.status = "done";
	});
}

/** Mark a step blocked, failed, skipped, or cancelled with an optional reason note. */
export function setPlanStepStatus(
	record: PlanRecord,
	stepId: string,
	status: "blocked" | "failed" | "skipped" | "cancelled",
	note?: string,
): PlanRecord {
	return revisePlanRecord(record, (draft) => {
		const step = draft.steps.find((candidate) => candidate.id === stepId);
		if (!step) throw new Error(`Unknown plan step: ${stepId}`);
		step.status = status;
		if (note) {
			const refs = new Set(step.evidenceRefs);
			refs.add(`note:${note.slice(0, 120)}`);
			step.evidenceRefs = [...refs];
		}
	});
}

/** Steps whose dependencies are all done and which have not started. */
export function readyPlanSteps(record: PlanRecord): PlanRecordStep[] {
	const done = new Set(record.steps.filter((step) => step.status === "done").map((step) => step.id));
	return record.steps.filter(
		(step) =>
			(step.status === "pending" || step.status === "ready") &&
			step.dependencies.every((dependency) => done.has(dependency)),
	);
}

/** Map a record step status onto the legacy task-graph step status for display. */
export function planStepToGraphStatus(
	status: PlanRecordStepStatus,
): "pending" | "active" | "done" | "failed" | "skipped" {
	switch (status) {
		case "done":
			return "done";
		case "failed":
			return "failed";
		case "active":
		case "verifying":
			return "active";
		case "skipped":
		case "cancelled":
			return "skipped";
		default:
			return "pending";
	}
}

/** Deterministic Markdown rendering of a record: the artifact view of the same data. */
export function formatPlanRecordMarkdown(record: PlanRecord): string {
	const lines = [`# Plan (revision ${record.revision}): ${record.objective}`, "", `Updated: ${record.updatedAt}`];
	if (record.successCriteria.length > 0) {
		lines.push("", "## Success criteria");
		for (const criterion of record.successCriteria) lines.push(`- [ ] ${criterion}`);
	}
	lines.push("", "## Steps");
	for (const [index, step] of record.steps.entries()) {
		const box = step.status === "done" ? "x" : " ";
		lines.push(`${index + 1}. [${box}] [${step.status}] ${step.objective} (${step.id})`);
		if (step.dependencies.length > 0) lines.push(`   needs: ${step.dependencies.join(", ")}`);
		if (step.verification) lines.push(`   verify: ${step.verification}`);
		if (step.evidenceRefs.length > 0) lines.push(`   evidence: ${step.evidenceRefs.join(", ")}`);
		if (step.owner) lines.push(`   owner: ${step.owner}`);
	}
	return `${lines.join("\n")}\n`;
}

/** One-line evidence summary for goal judging and bridge messages. */
export function summarizePlanRecordForGoal(record: PlanRecord): string {
	const done = record.steps.filter((step) => step.status === "done").length;
	const blocked = record.steps
		.filter((step) => step.status === "blocked" || step.status === "failed")
		.map((step) => step.id);
	const base = `Plan "${record.objective}" rev ${record.revision}: ${done}/${record.steps.length} done.`;
	return blocked.length > 0 ? `${base} Blocked: ${blocked.join(", ")}.` : base;
}

/** Compact current-plan view for compaction summaries and resume. */
export function projectPlanRecordSummary(record: PlanRecord): string {
	const lines = [`Plan: ${record.objective} (rev ${record.revision})`];
	for (const step of record.steps) {
		if (step.status === "done" || step.status === "skipped" || step.status === "cancelled") continue;
		lines.push(`- [${step.status}] ${step.objective} (${step.id})`);
	}
	const done = record.steps.filter((step) => step.status === "done").length;
	lines.push(`Done: ${done}/${record.steps.length}.`);
	return lines.join("\n");
}

/** Attach a sub-agent run to a step as its owner. Does not verify worker claims. */
export function attachSubagentToStep(record: PlanRecord, stepId: string, subagentId: string): PlanRecord {
	return revisePlanRecord(record, (draft) => {
		const step = draft.steps.find((candidate) => candidate.id === stepId);
		if (!step) throw new Error(`Unknown plan step: ${stepId}`);
		step.owner = subagentId;
		const refs = new Set(step.evidenceRefs);
		refs.add(`subagent:${subagentId}`);
		step.evidenceRefs = [...refs];
	});
}

export interface PlanFileCheck {
	fileExists(path: string): boolean;
}

/**
 * Evaluate `file-exists:<path>` verification predicates from a step's
 * verification text. Unknown lines are ignored (pending human check).
 * Returns failed paths; empty means all checkable predicates passed.
 */
export function evaluatePlanStepChecks(step: Pick<PlanRecordStep, "verification">, io: PlanFileCheck): string[] {
	const failures: string[] = [];
	for (const line of step.verification.split("\n")) {
		const match = /^\s*file-exists:(.+?)\s*$/.exec(line);
		if (!match?.[1]) continue;
		if (!io.fileExists(match[1])) failures.push(match[1]);
	}
	return failures;
}

/**
 * Bounded repair: revise affected steps once per failure, preserving completed
 * work. Callers must cap invocations (one replan per failure) and report after.
 */
export function replanAfterFailure(
	record: PlanRecord,
	failedStepId: string,
	reason: string,
	replacementObjectives: string[],
): PlanRecord {
	return revisePlanRecord(record, (draft) => {
		const failed = draft.steps.find((candidate) => candidate.id === failedStepId);
		if (!failed) throw new Error(`Unknown plan step: ${failedStepId}`);
		failed.status = "failed";
		const refs = new Set(failed.evidenceRefs);
		refs.add(`failure:${reason.slice(0, 120)}`);
		failed.evidenceRefs = [...refs];
		for (const objective of replacementObjectives) {
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
				dependencies: failed.dependencies.slice(),
				expectedOutputs: [],
				verification: "",
				evidenceRefs: [],
				status: "pending",
				attempts: 0,
			});
		}
	});
}

/** Return a revised copy with bumped revision and fresh timestamp. Completed evidence is preserved. */
export function revisePlanRecord(record: PlanRecord, mutate: (draft: PlanRecord) => void): PlanRecord {
	const draft: PlanRecord = {
		...record,
		scope: record.scope.slice(),
		successCriteria: record.successCriteria.slice(),
		steps: record.steps.map((step) => ({
			...step,
			dependencies: step.dependencies.slice(),
			expectedOutputs: step.expectedOutputs.slice(),
			evidenceRefs: step.evidenceRefs.slice(),
		})),
	};
	mutate(draft);
	validatePlanRecord(draft);
	return { ...draft, revision: record.revision + 1, updatedAt: new Date().toISOString() };
}
