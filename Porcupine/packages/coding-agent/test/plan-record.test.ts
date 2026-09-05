import { describe, expect, it } from "vitest";
import {
	attachSubagentToStep,
	completePlanStep,
	createPlanRecord,
	evaluatePlanStepChecks,
	formatPlanRecordMarkdown,
	planStepToGraphStatus,
	projectPlanRecordSummary,
	readyPlanSteps,
	replanAfterFailure,
	requestPlanStepVerification,
	revisePlanRecord,
	setPlanStepStatus,
	startPlanStep,
	summarizePlanRecordForGoal,
	validatePlanRecord,
} from "../src/porcupine/plan-record.ts";

describe("plan record (T2.1)", () => {
	it("creates and validates a linear plan", () => {
		const record = createPlanRecord("Fix bug", ["Reproduce", "Fix", "Verify"]);
		record.steps[1]!.dependencies = [record.steps[0]!.id];
		record.steps[2]!.dependencies = [record.steps[1]!.id];
		expect(() => validatePlanRecord(record)).not.toThrow();
		expect(record.revision).toBe(1);
	});

	it("rejects empty objectives, duplicate ids, unknown deps, and cycles", () => {
		expect(() => createPlanRecord("  ", ["a"])).toThrow(/non-empty/);
		const record = createPlanRecord("Work", ["a", "b"]);
		record.steps[1]!.id = record.steps[0]!.id;
		expect(() => validatePlanRecord(record)).toThrow(/Duplicate/);
		record.steps[1]!.id = "b-2";
		record.steps[1]!.dependencies = ["missing"];
		expect(() => validatePlanRecord(record)).toThrow(/Unknown dependency/);
		record.steps[0]!.dependencies = ["b-2"];
		record.steps[1]!.dependencies = [record.steps[0]!.id];
		expect(() => validatePlanRecord(record)).toThrow(/cycle/);
	});

	it("computes ready steps from dependencies", () => {
		const record = createPlanRecord("Work", ["a", "b", "c"]);
		const [a, b, c] = record.steps;
		b!.dependencies = [a!.id];
		c!.dependencies = [b!.id];
		expect(readyPlanSteps(record).map((step) => step.id)).toEqual([a!.id]);
		a!.status = "done";
		expect(readyPlanSteps(record).map((step) => step.id)).toEqual([b!.id]);
	});

	it("revises with bumped revision and preserved evidence", () => {
		const record = createPlanRecord("Work", ["a"]);
		record.steps[0]!.evidenceRefs = ["tool:call-1"];
		record.steps[0]!.status = "done";
		const revised = revisePlanRecord(record, (draft) => {
			draft.steps.push({
				id: "b-2",
				objective: "follow-up",
				dependencies: [draft.steps[0]!.id],
				expectedOutputs: [],
				verification: "",
				evidenceRefs: [],
				status: "pending",
				attempts: 0,
			});
		});
		expect(revised.revision).toBe(2);
		expect(revised.steps[0]!.evidenceRefs).toEqual(["tool:call-1"]);
		expect(revised.steps).toHaveLength(2);
	});

	it("enforces start, verify-before-done, and terminal states", () => {
		let record = createPlanRecord("Work", ["a", "b"]);
		const [a, b] = record.steps;
		b!.dependencies = [a!.id];
		expect(() => startPlanStep(record, b!.id)).toThrow(/blocked by/);
		record = startPlanStep(record, a!.id, "main");
		expect(record.steps[0]!.status).toBe("active");
		expect(record.steps[0]!.attempts).toBe(1);
		expect(() => completePlanStep(record, a!.id)).toThrow(/verifying/);
		expect(() => requestPlanStepVerification(record, a!.id, [])).toThrow(/needs evidence/);
		record = requestPlanStepVerification(record, a!.id, ["tool:bash-1"]);
		expect(record.steps[0]!.status).toBe("verifying");
		record = completePlanStep(record, a!.id);
		expect(record.steps[0]!.status).toBe("done");
		record = startPlanStep(record, b!.id);
		record = setPlanStepStatus(record, b!.id, "blocked", "waiting on review");
		expect(record.steps[1]!.status).toBe("blocked");
	});

	it("maps statuses, renders markdown, and summarizes", () => {
		expect(planStepToGraphStatus("verifying")).toBe("active");
		expect(planStepToGraphStatus("blocked")).toBe("pending");
		expect(planStepToGraphStatus("cancelled")).toBe("skipped");
		let record = createPlanRecord("Ship", ["a", "b"]);
		record = startPlanStep(record, record.steps[0]!.id);
		record = requestPlanStepVerification(record, record.steps[0]!.id, ["tool:bash-1"]);
		record = completePlanStep(record, record.steps[0]!.id);
		const markdown = formatPlanRecordMarkdown(record);
		expect(markdown).toContain("# Plan (revision 4): Ship");
		expect(markdown).toContain("[x] [done]");
		expect(markdown).toContain("evidence: tool:bash-1");
		expect(summarizePlanRecordForGoal(record)).toContain("1/2 done");
		expect(projectPlanRecordSummary(record)).toContain("Done: 1/2.");
		expect(projectPlanRecordSummary(record)).not.toContain("[done]");
	});

	it("attaches sub-agents, evaluates file checks, and replans once", () => {
		let record = createPlanRecord("Work", ["a"]);
		record = attachSubagentToStep(record, record.steps[0]!.id, "@buck");
		expect(record.steps[0]!.owner).toBe("@buck");
		expect(record.steps[0]!.evidenceRefs).toContain("subagent:@buck");
		const io = { fileExists: (path: string) => path === "exists.ts" };
		expect(evaluatePlanStepChecks({ verification: "file-exists:exists.ts" }, io)).toEqual([]);
		expect(evaluatePlanStepChecks({ verification: "file-exists:missing.ts\nnotes here" }, io)).toEqual([
			"missing.ts",
		]);
		record = replanAfterFailure(record, record.steps[0]!.id, "test red", ["retry a"]);
		expect(record.revision).toBe(3);
		expect(record.steps[0]!.status).toBe("failed");
		expect(record.steps).toHaveLength(2);
		expect(record.steps[1]!.status).toBe("pending");
	});

	it("round-trips through JSON persistence", () => {
		const record = createPlanRecord("Work", ["a", "b"]);
		const restored = JSON.parse(JSON.stringify(record)) as typeof record;
		expect(() => validatePlanRecord(restored)).not.toThrow();
		expect(restored.objective).toBe(record.objective);
	});
});
