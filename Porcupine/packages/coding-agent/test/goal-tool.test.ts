import { describe, expect, it } from "vitest";
import { createGoalToolDefinition } from "../src/core/tools/goal.ts";
import type { GoalRecord } from "../src/porcupine/goal-record.ts";

const run = (definition: ReturnType<typeof createGoalToolDefinition>, input: unknown) =>
	definition.execute("goal-test", input as never, undefined, undefined, undefined as never);

describe("goal tool", () => {
	it("lets the agent declare a goal, then move its own steps with evidence", async () => {
		const saved: Array<GoalRecord | undefined> = [];
		const definition = createGoalToolDefinition({ persist: (goal) => saved.push(goal) });
		let result = await run(definition, {
			action: "create",
			objective: "Reduce KV cache to 2.5 bits",
			steps: "Measure baseline\nQuantise\nValidate with NIAH",
		});
		expect(result.details?.goal?.status).toBe("active");
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(String((result.content[0] as { text: string }).text)).toContain("Goal set");

		result = await run(definition, { action: "start", stepId: "measure-baseline-1" });
		expect(result.details?.goal?.steps[0]).toMatchObject({ status: "active" });

		result = await run(definition, { action: "done", stepId: "measure-baseline-1", note: "nsys profile saved" });
		expect(result.details).toMatchObject({ done: 1, total: 3 });

		for (const stepId of ["quantise-2", "validate-with-niah-3"]) {
			await run(definition, { action: "done", stepId, note: "verified" });
		}
		expect(result.details?.goal?.steps.length).toBe(3);
		const final = await run(definition, { action: "status" });
		expect(String((final.content[0] as { text: string }).text)).toContain("done");
		expect(saved.at(-1)?.status).toBe("done");
	});

	it("requires evidence for done and block, and reports problems instead of throwing", async () => {
		const definition = createGoalToolDefinition();
		await run(definition, { action: "create", objective: "g", steps: "one" });
		const done = await run(definition, { action: "done", stepId: "one-1" });
		expect(String((done.content[0] as { text: string }).text)).toMatch(/requires a note/);
		const block = await run(definition, { action: "block", stepId: "one-1", note: "Waiting on user" });
		expect(block.details?.goal?.status).toBe("blocked");
		const missing = await run(definition, { action: "start", stepId: "nope-9" });
		expect(String((missing.content[0] as { text: string }).text)).toMatch(/Unknown goal step/);
	});

	it("restores a persisted goal and clears it explicitly", async () => {
		const restored: GoalRecord = {
			objective: "Existing objective",
			status: "active",
			steps: [{ id: "step-1", objective: "Existing step", status: "pending" }],
			createdAt: "t",
			updatedAt: "t",
		};
		const definition = createGoalToolDefinition({ load: () => restored });
		const status = await run(definition, { action: "status" });
		expect(String((status.content[0] as { text: string }).text)).toContain("Existing objective");
		const cleared = await run(definition, { action: "clear" });
		expect(cleared.details?.goal).toBeUndefined();
		expect(String((cleared.content[0] as { text: string }).text)).toContain("cleared");
	});

	it("registers in every built-in tool lookup", async () => {
		const { allToolNames, createAllToolDefinitions } = await import("../src/core/tools/index.ts");
		expect(allToolNames.has("goal")).toBe(true);
		expect(createAllToolDefinitions(process.cwd()).goal.name).toBe("goal");
	});
});
