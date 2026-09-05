import { CapabilityTree, PorcupineAgentRuntime } from "@porcupineai/agent-core";
import { describe, expect, it } from "vitest";
import { createHeuristicRuntimeAdapters } from "../src/porcupine/session-adapters.ts";
import { formatPlanContextBlock, PorcupineSessionOrchestrator } from "../src/porcupine/session-orchestrator.ts";

function createTree(): CapabilityTree {
	return new CapabilityTree([
		{
			id: "tool:read",
			kind: "tool",
			path: ["tools", "read"],
			description: "Read source files from a workspace.",
			tags: ["tool", "read", "file", "source"],
			available: true,
		},
		{
			id: "tool:edit",
			kind: "tool",
			path: ["tools", "edit"],
			description: "Edit existing files with search and replace.",
			tags: ["tool", "edit", "patch", "fix"],
			available: true,
		},
		{
			id: "tool:bash",
			kind: "tool",
			path: ["tools", "bash"],
			description: "Run shell commands and tests.",
			tags: ["tool", "bash", "shell", "test"],
			available: true,
		},
	]);
}

describe("Porcupine session orchestrator", () => {
	it("prepares a plan from a coding prompt without executing tools", async () => {
		const tree = createTree();
		const events: string[] = [];
		const orchestrator = new PorcupineSessionOrchestrator({
			getCapabilities: () => tree,
			onEvent: (event) => {
				events.push(event.type);
			},
		});

		const turn = await orchestrator.prepareTurn("Read the failing source and fix the bug");

		expect(turn.prepare.status).toBe("planned");
		expect(turn.prepare.plan?.steps.length).toBeGreaterThan(0);
		expect(turn.contextBlock).toContain("[Porcupine orchestration]");
		expect(turn.contextBlock).toContain("Plan:");
		expect(turn.taskGraph.status).toBe("ready");
		expect(events).toEqual(["phase:analyze", "phase:route", "route:complete", "phase:plan", "plan:complete"]);
	});

	it("tracks tool progress on the task graph", async () => {
		const orchestrator = new PorcupineSessionOrchestrator({
			getCapabilities: () => createTree(),
		});
		await orchestrator.prepareTurn("edit the file and run tests");
		orchestrator.markRunning();
		orchestrator.markStepForTool("edit");
		let graph = orchestrator.getTaskGraph();
		expect(graph.status).toBe("running");
		expect(graph.steps.some((step) => step.status === "active")).toBe(true);

		orchestrator.markToolFinished("edit", false);
		orchestrator.markStepForTool("bash");
		orchestrator.markToolFinished("bash", false);
		orchestrator.markTurnComplete(true);
		graph = orchestrator.getTaskGraph();
		expect(graph.status).toBe("done");
	});

	it("formats plan context and can run autonomous handoff path", async () => {
		const tree = createTree();
		const adapters = createHeuristicRuntimeAdapters(tree);
		const runtime = new PorcupineAgentRuntime({ capabilities: tree, adapters });
		const prepared = await runtime.prepare("run tests after edit");
		expect(formatPlanContextBlock(prepared)).toContain("Objective:");

		const orchestrator = new PorcupineSessionOrchestrator({
			getCapabilities: () => tree,
		});
		const result = await orchestrator.runAutonomous("edit file then test");
		expect(["completed", "blocked", "failed-execution", "failed-verification"]).toContain(result.status);
	});

	describe("dynamic task graph (model-led turns)", () => {
		it("builds steps from actual tool calls with consecutive same-tool dedupe", async () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});

			// No prepareTurn — ordinary model-led turn.
			orchestrator.ensureDynamicStep("read");
			orchestrator.markToolFinished("read", false);
			orchestrator.ensureDynamicStep("bash");
			orchestrator.ensureDynamicStep("bash"); // same tool again → same step
			orchestrator.markToolFinished("bash", false);
			orchestrator.ensureDynamicStep("edit");
			orchestrator.markToolFinished("edit", false);

			const graph = orchestrator.getTaskGraph();
			expect(graph.status).toBe("done");
			expect(graph.steps.map((s) => s.objective)).toEqual(["read", "bash", "edit"]);
			expect(graph.steps.every((s) => s.status === "done" || s.status === "active")).toBe(true);
		});

		it("marks the graph done when the turn completes", () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			orchestrator.ensureDynamicStep("read");
			orchestrator.markToolFinished("read", false);
			orchestrator.markTurnComplete(true);
			expect(orchestrator.getTaskGraph().status).toBe("done");
		});

		it("resetDynamicGraph clears a previous model-led graph", () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			orchestrator.ensureDynamicStep("read");
			orchestrator.resetDynamicGraph();
			expect(orchestrator.getTaskGraph().status).toBe("idle");
			expect(orchestrator.getTaskGraph().steps).toEqual([]);
		});

		it("repoints the last step to a different tool when the cap is reached", () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			// Fill MAX_DYNAMIC_STEPS (12) distinct steps.
			for (let i = 0; i < 12; i++) orchestrator.ensureDynamicStep(`tool-${i}`);
			const before = orchestrator.getTaskGraph().steps;
			expect(before.length).toBe(12);
			expect(before[11]?.objective).toBe("tool-11");

			// A NEW, different tool at the cap must repoint the last step to it.
			orchestrator.ensureDynamicStep("new-tool");
			const steps = orchestrator.getTaskGraph().steps;
			expect(steps.length).toBe(12);
			expect(steps[11]?.objective).toBe("new-tool");
			expect(steps[11]?.capabilityIds).toEqual(["tool:new-tool"]);
			expect(steps[11]?.status).toBe("active");
		});

		it("does not complete a step for a different tool via substring matching", () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			orchestrator.ensureDynamicStep("github");
			// "git" is a substring of "github", but must NOT complete the github step.
			orchestrator.markToolFinished("git", false);
			expect(orchestrator.getTaskGraph().steps[0]?.status).toBe("active");
			// The exact tool still completes it.
			orchestrator.markToolFinished("github", false);
			expect(orchestrator.getTaskGraph().steps[0]?.status).toBe("done");
		});

		it("does not interfere with an explicit plan graph", async () => {
			const orchestrator = new PorcupineSessionOrchestrator({
				getCapabilities: () => createTree(),
			});
			await orchestrator.prepareTurn("edit the file and run tests");
			const planSteps = orchestrator.getTaskGraph().steps.length;
			orchestrator.ensureDynamicStep("bash"); // must be a no-op
			const graph = orchestrator.getTaskGraph();
			expect(graph.steps.length).toBe(planSteps);
			expect(graph.steps.some((s) => s.id.startsWith("dyn-"))).toBe(false);
		});
	});
});
