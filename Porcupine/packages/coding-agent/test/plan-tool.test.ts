import { describe, expect, it } from "vitest";
import { createPlanToolDefinition, type PlanToolInput } from "../src/core/tools/plan.ts";

async function run(def: ReturnType<typeof createPlanToolDefinition>, args: PlanToolInput) {
	return def.execute("test-call", args, undefined, undefined, undefined as never);
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.map((c) => c.text ?? "").join("");
}

describe("plan tool (T2.2)", () => {
	it("runs the full milestone lifecycle with evidence gating", async () => {
		const def = createPlanToolDefinition();
		let result = await run(def, { action: "status" });
		expect(textOf(result)).toContain("No active plan");

		result = await run(def, { action: "create", objective: "Ship fix", steps: "Reproduce\nFix\nVerify" });
		expect(textOf(result)).toContain("Plan created (3 steps)");

		const stepId = "reproduce-1";
		result = await run(def, { action: "complete", stepId });
		expect(textOf(result)).toContain("must be verifying");

		result = await run(def, { action: "start", stepId });
		expect(textOf(result)).toContain(`Step started: ${stepId}`);

		result = await run(def, { action: "verify", stepId, evidence: "" });
		expect(textOf(result)).toContain("needs evidence");

		result = await run(def, { action: "verify", stepId, evidence: "tool:bash-1" });
		expect(textOf(result)).toContain("Step verifying");

		result = await run(def, { action: "complete", stepId });
		expect(textOf(result)).toContain(`Step done: ${stepId}`);
		expect(result.details).toMatchObject({
			action: "complete",
			stepId,
			stepObjective: "Reproduce",
			transitioned: true,
		});

		result = await run(def, { action: "status" });
		expect(textOf(result)).toContain("[done]");
	});

	it("rejects unknown steps and clears cleanly", async () => {
		const def = createPlanToolDefinition();
		await run(def, { action: "create", objective: "Work", steps: "first\nsecond" });
		const unknown = await run(def, { action: "start", stepId: "missing-9" });
		expect(textOf(unknown)).toContain("Unknown plan step");
		// Created steps are independent unless add-step declares dependencies.
		const started = await run(def, { action: "start", stepId: "second-2" });
		expect(textOf(started)).toContain("Step started: second-2");
		const exported = await run(def, { action: "export" });
		expect(textOf(exported)).toContain("# Plan (revision 2): Work");
		expect(textOf(exported)).toContain("[active] second (second-2)");
		const cleared = await run(def, { action: "clear" });
		expect(textOf(cleared)).toContain("cleared");
		const status = await run(def, { action: "status" });
		expect(textOf(status)).toContain("No active plan");
	});
});
