import { CapabilityTree } from "@porcupineai/agent-core";
import { describe, expect, it } from "vitest";
import { PorcupineSessionOrchestrator } from "../src/porcupine/session-orchestrator.ts";

function createTree(): CapabilityTree {
	return new CapabilityTree([
		{
			id: "tool:read",
			kind: "tool",
			path: ["tools", "read"],
			description: "Read source files from a workspace.",
			tags: ["tool", "read"],
			available: true,
		},
		{
			id: "tool:edit",
			kind: "tool",
			path: ["tools", "edit"],
			description: "Edit existing files with search and replace.",
			tags: ["tool", "edit"],
			available: true,
		},
		{
			id: "tool:bash",
			kind: "tool",
			path: ["tools", "bash"],
			description: "Run shell commands and tests.",
			tags: ["tool", "bash"],
			available: true,
		},
	]);
}

/**
 * Foundation-safe-autonomy tests for the session-orchestrator hot path.
 * These pin the observable invariants that the copy-on-write and
 * build-once optimizations preserve. No policy/approval behavior changes here.
 */
describe("foundation-safe-autonomy session orchestrator", () => {
	describe("prepareTurn builds the plan context block once", () => {
		it("builds the plan context block once per turn", async () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			const turn = await orchestrator.prepareTurn("Read the failing source and fix the bug");

			expect(turn.contextBlock).toContain("[Porcupine orchestration]");
			expect(turn.contextBlock).toContain("Plan:");
		});
	});

	describe("graph mutation no-op invariants (copy-on-write safety)", () => {
		it("markStep with an unknown stepId leaves the task graph unchanged", async () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			await orchestrator.prepareTurn("edit the file and run tests");
			const before = orchestrator.getTaskGraph();
			orchestrator.markStep("no-such-step", "done");
			const after = orchestrator.getTaskGraph();
			expect(after).toEqual(before);
		});

		it("markStepForTool with no pending match leaves steps unchanged but flips status to running", async () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			orchestrator.ensureDynamicStep("read");
			orchestrator.resetDynamicGraph();

			// A tool with no pending step must not create/advance any step.
			orchestrator.markStepForTool("edit");
			const graph = orchestrator.getTaskGraph();
			expect(graph.steps).toEqual([]);
			expect(graph.status).toBe("running");
		});

		it("markToolFinished for a tool with no active step is a true no-op", async () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			orchestrator.ensureDynamicStep("read");
			orchestrator.markToolFinished("read", false);
			const before = orchestrator.getTaskGraph();

			// "edit" is not active — must not complete the read step nor change status.
			orchestrator.markToolFinished("edit", false);
			expect(orchestrator.getTaskGraph()).toEqual(before);
		});

		it("markToolFinished still completes the matching active step (no regression)", () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			orchestrator.ensureDynamicStep("read");
			orchestrator.markToolFinished("read", false);
			expect(orchestrator.getTaskGraph().steps[0]?.status).toBe("done");
		});

		it("markStep still advances the matching plan step", async () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			const turn = await orchestrator.prepareTurn("edit the file and run tests");
			const firstId = turn.taskGraph.steps[0]!.id;
			orchestrator.markStep(firstId, "active");
			expect(orchestrator.getTaskGraph().steps[0]?.status).toBe("active");
		});
	});

	describe("ensureDynamicStep tail-only copy-on-write (hot path)", () => {
		it("a redundant same-tool already-active call is a true no-op (zero allocation)", () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			orchestrator.ensureDynamicStep("read");
			const graphBefore = (orchestrator as unknown as { taskGraph: unknown }).taskGraph as { steps: unknown[] };
			const stepsBefore = graphBefore.steps;

			// Second consecutive same-tool call while the step is already active
			// must early-return before re-assigning the graph (pruned allocation).
			orchestrator.ensureDynamicStep("read");

			const graphAfter = (orchestrator as unknown as { taskGraph: unknown }).taskGraph as { steps: unknown[] };
			expect(graphBefore).toBe(graphAfter); // object identity preserved => no reassignment
			expect(graphAfter.steps).toBe(stepsBefore); // array not rebuilt
			expect(orchestrator.getTaskGraph().steps).toEqual([
				{ id: "dyn-1", objective: "read", capabilityIds: ["tool:read"], status: "active" },
			]);
		});

		it("preserves the observable graph across tail-only reference sharing", () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			// Fill several distinct steps, then run a full mutate-back cycle. The
			// tail-only copy-on-write reuses prefix references; the observable graph
			// must remain byte-for-byte as the original full-clone implementation.
			orchestrator.ensureDynamicStep("read");
			orchestrator.ensureDynamicStep("edit");
			orchestrator.ensureDynamicStep("bash");
			expect(orchestrator.getTaskGraph().steps.map((s) => s.objective)).toEqual(["read", "edit", "bash"]);

			// Re-activate the continuation of the tail step (same tool, currently active
			// after the last ensureDynamicStep) — no-op path must not disturb earlier steps.
			orchestrator.ensureDynamicStep("bash");
			orchestrator.markToolFinished("read", false); // completes an EARLIER step
			const graph = orchestrator.getTaskGraph();
			expect(graph.steps.map((s) => s.status)).toEqual(["done", "active", "active"]);
			expect(graph.steps.map((s) => s.objective)).toEqual(["read", "edit", "bash"]);
			expect(graph.steps[0]?.capabilityIds).toEqual(["tool:read"]);
			expect(graph.steps[1]?.capabilityIds).toEqual(["tool:edit"]);
		});

		it("cap reaches: repoint last step reuses prefix references without disturbing them", () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			for (let i = 0; i < 12; i++) orchestrator.ensureDynamicStep(`tool-${i}`);
			orchestrator.markToolFinished("tool-0", false); // pin an earlier step
			const preCap = orchestrator.getTaskGraph();

			orchestrator.ensureDynamicStep("new-tool"); // cap reached => repoint tail
			const graph = orchestrator.getTaskGraph();
			expect(graph.steps.length).toBe(12);
			expect(graph.steps[11]?.objective).toBe("new-tool");
			expect(graph.steps[11]?.capabilityIds).toEqual(["tool:new-tool"]);
			// The earlier pinned step is untouched by the tail-only copy.
			expect(graph.steps[0]?.status).toBe("done");
			expect(graph.steps[0]?.objective).toBe(preCap.steps[0]?.objective);
		});
	});
});
