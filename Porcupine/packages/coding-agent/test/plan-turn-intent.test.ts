import { CapabilityTree } from "@porcupineai/agent-core";
import { describe, expect, it } from "vitest";
import {
	buildGoalContinuation,
	buildPlanPrompt,
	classifyPlanSettle,
	filterOutGoalPlanQueue,
	isPlanPrompt,
	shouldPreservePlanGraphForTurn,
} from "../src/porcupine/goal-plan-state.ts";
import { userRequestedPlanning } from "../src/porcupine/personality.ts";
import { PorcupineSessionOrchestrator } from "../src/porcupine/session-orchestrator.ts";

function createTree(): CapabilityTree {
	return new CapabilityTree([
		{
			id: "tool:read",
			kind: "tool",
			path: ["tools", "read"],
			description: "Read source files from a workspace.",
			tags: ["tool", "read", "file"],
			available: true,
		},
		{
			id: "tool:bash",
			kind: "tool",
			path: ["tools", "bash"],
			description: "Run shell commands and tests.",
			tags: ["tool", "bash", "test"],
			available: true,
		},
	]);
}

describe("plan-turn intent token (T1.1)", () => {
	it("preserves the prepared graph only for the queued plan draft", () => {
		const prompt = buildPlanPrompt("Read files then run tests", ".porcupine/plans/probe.md");
		expect(isPlanPrompt(prompt)).toBe(true);
		expect(shouldPreservePlanGraphForTurn(prompt, true)).toBe(true);
		expect(shouldPreservePlanGraphForTurn(prompt, false)).toBe(false);
		expect(shouldPreservePlanGraphForTurn("Read files then run tests", true)).toBe(false);
		expect(shouldPreservePlanGraphForTurn("/plan Read files then run tests", true)).toBe(false);
	});

	it("documents why the token exists: generated prompts do not match the planning heuristic", () => {
		const prompt = buildPlanPrompt("Read files then run tests", ".porcupine/plans/probe.md");
		expect(userRequestedPlanning(prompt)).toBe(false);
	});

	it("keeps the prepared graph when the plan path marks running instead of resetting", async () => {
		const orchestrator = new PorcupineSessionOrchestrator({ getCapabilities: () => createTree() });
		await orchestrator.prepareTurn("Read files then run tests");
		const prepared = orchestrator.getTaskGraph().steps.length;
		expect(prepared).toBeGreaterThan(0);

		// Plan-turn path: mark running, graph survives.
		orchestrator.markRunning();
		expect(orchestrator.getTaskGraph().steps.length).toBe(prepared);

		// Ordinary-turn path: reset clears the graph.
		orchestrator.resetDynamicGraph();
		expect(orchestrator.getTaskGraph().steps).toEqual([]);
		expect(orchestrator.getTaskGraph().status).toBe("idle");
	});
});

describe("honest turn outcome (T1.2)", () => {
	it("reports failed when a step failed even if the caller passes success", () => {
		const orchestrator = new PorcupineSessionOrchestrator({ getCapabilities: () => createTree() });
		orchestrator.ensureDynamicStep("edit");
		orchestrator.markToolFinished("edit", true);
		expect(orchestrator.hasFailedSteps()).toBe(true);
		orchestrator.markTurnComplete(true);
		const graph = orchestrator.getTaskGraph();
		expect(graph.status).toBe("failed");
		expect(graph.steps.some((step) => step.status === "failed")).toBe(true);
	});

	it("still reports done for a clean turn", () => {
		const orchestrator = new PorcupineSessionOrchestrator({ getCapabilities: () => createTree() });
		orchestrator.ensureDynamicStep("edit");
		orchestrator.markToolFinished("edit", false);
		expect(orchestrator.hasFailedSteps()).toBe(false);
		orchestrator.markTurnComplete(true);
		expect(orchestrator.getTaskGraph().status).toBe("done");
	});

	it("classifies plan settle outcomes without conflating cancel and empty response", () => {
		expect(classifyPlanSettle({ planExists: true, hasMarkdown: true, interrupted: true })).toBe("interrupted");
		expect(classifyPlanSettle({ planExists: false, hasMarkdown: false, interrupted: false })).toBe("no-metadata");
		expect(classifyPlanSettle({ planExists: true, hasMarkdown: false, interrupted: false })).toBe("empty");
		expect(classifyPlanSettle({ planExists: true, hasMarkdown: true, interrupted: false })).toBe("save");
	});

	it("drops queued goal and plan entries when leaving a session", () => {
		const goal = buildGoalContinuation({
			text: "finish",
			status: "active",
			turnsUsed: 0,
			maxTurns: 20,
			createdAt: "t",
			updatedAt: "t",
		});
		const plan = buildPlanPrompt("do work", ".porcupine/plans/x.md");
		expect(filterOutGoalPlanQueue([goal, plan, "hello"])).toEqual(["hello"]);
		expect(filterOutGoalPlanQueue([])).toEqual([]);
	});

	it("reports failed for retrying turns", () => {
		const orchestrator = new PorcupineSessionOrchestrator({ getCapabilities: () => createTree() });
		orchestrator.ensureDynamicStep("read");
		orchestrator.markToolFinished("read", false);
		orchestrator.markTurnComplete(false);
		expect(orchestrator.getTaskGraph().status).toBe("failed");
	});
});
