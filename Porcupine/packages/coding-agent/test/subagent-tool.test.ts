import type { AgentTool } from "@porcupineai/agent-core";
import { describe, expect, it } from "vitest";
import {
	buildSpawnRoster,
	createStopSubagentToolDefinition,
	createSubagentToolDefinition,
} from "../src/core/tools/subagent.ts";

function noopTool(name: string): AgentTool<any> {
	return {
		name,
		label: name,
		description: "noop",
		parameters: { type: "object", properties: {} },
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
	};
}

function makeTool(options: Partial<Parameters<typeof createSubagentToolDefinition>[0]> = {}) {
	return createSubagentToolDefinition({
		getToolRegistry: () =>
			new Map([
				["read", noopTool("read")],
				["bash", noopTool("bash")],
			]),
		resolveModel: () => undefined,
		getStreamFn: () => (async () => undefined) as never,
		getSettings: () => ({
			model: undefined,
			maxSteps: 30,
			contextWindow: 256_000,
			maxConcurrent: 1,
			names: ["buck", "fudgy", "tinker", "rivet", "gizmo"],
		}),
		...options,
	});
}

describe("stop_subagent tool", () => {
	const stopTool = createStopSubagentToolDefinition({
		stop: (id) => id === "sa-1",
		stopAll: () => 2,
		getActiveRefs: () => ["@buck", "@fudgy"],
	});

	it("stops a single sub-agent by id", async () => {
		const result = await stopTool.execute("id", { id: "sa-1" }, undefined, undefined, undefined as never);
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		expect(text).toContain("⏹ Stopped sub-agent sa-1");
		expect(result.details).toMatchObject({ stopped: 1 });
	});

	it("reports when the ref is not running and lists active tags", async () => {
		const result = await stopTool.execute("id", { id: "sa-9" }, undefined, undefined, undefined as never);
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		expect(text).toContain('No running sub-agent "sa-9"');
		expect(text).toContain("@buck, @fudgy");
		expect(result.details).toMatchObject({ stopped: 0 });
	});

	it("stops all running sub-agents when id is omitted", async () => {
		const result = await stopTool.execute("id", {}, undefined, undefined, undefined as never);
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		expect(text).toContain("Stopped 2 sub-agents");
		expect(result.details).toMatchObject({ stopped: 2 });
	});
});

describe("subagent tool", () => {
	it("rejects when another sub-agent is already running", async () => {
		const tool = makeTool({ getActiveSubagentRuns: () => 1 });
		const result = await tool.execute("id-1", { task: "do the thing" }, undefined, undefined, undefined as never);

		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		expect(text).toContain("capacity reached");
		expect(result.details).toMatchObject({ started: false });
	});

	it("respects subagent.maxConcurrent instead of a hardcoded limit of one", async () => {
		const { registerFauxProvider, fauxAssistantMessage, streamSimple } = await import("@porcupineai/ai/compat");
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("Report: done.")]);

		let active = 2; // maxConcurrent 3: 2 active runs still leaves capacity
		const tool = makeTool({
			resolveModel: () => faux.getModel(),
			getStreamFn: () => streamSimple,
			getSettings: () => ({
				model: undefined,
				maxSteps: 30,
				contextWindow: 256_000,
				maxConcurrent: 3,
				names: ["buck", "fudgy", "tinker", "rivet", "gizmo"],
			}),
			getActiveSubagentRuns: () => active,
		});

		const allowed = await tool.execute("id-1", { task: "do the thing" }, undefined, undefined, undefined as never);
		expect(allowed.details).toMatchObject({ started: true });

		active = 3; // capacity full -> rejected
		const full = await tool.execute("id-2", { task: "do the thing" }, undefined, undefined, undefined as never);
		const fullText = full.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		expect(fullText).toContain("3/3 running");
		expect(full.details).toMatchObject({ started: false });
		faux.unregister();
	});

	it("reports when the configured sub-agent model cannot be resolved", async () => {
		const tool = makeTool({ resolveModel: () => undefined });
		const result = await tool.execute("id-1", { task: "do the thing" }, undefined, undefined, undefined as never);

		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		expect(text).toContain("Could not resolve sub-agent model");
	});

	it("exposes a prompt snippet so the model knows when to use it", () => {
		const tool = makeTool();
		expect(tool.name).toBe("subagent");
		expect(tool.promptSnippet).toContain("sub-agent");
		expect(tool.promptGuidelines?.length).toBeGreaterThan(0);
	});
});

describe("subagent tool activation (regression: default tool list)", () => {
	it("is in the SDK default active tools so it actually reaches the agent", async () => {
		const { defaultActiveToolNames } = await import("../src/core/sdk.ts");
		expect(defaultActiveToolNames).toContain("subagent");
		expect(defaultActiveToolNames).toContain("capability_search");
	});

	it("is in allToolNames and produced by createAllToolDefinitions", async () => {
		const { allToolNames } = await import("../src/core/tools/index.ts");
		expect(allToolNames.has("subagent")).toBe(true);
		const { createAllToolDefinitions } = await import("../src/core/tools/index.ts");
		const defs = createAllToolDefinitions(process.cwd());
		expect(defs.subagent.name).toBe("subagent");
	});
});

describe("buildSpawnRoster", () => {
	it("is empty when nobody else is active", () => {
		expect(buildSpawnRoster([])).toBe("");
	});

	it("lists the main agent and active peers with tasks", () => {
		const roster = buildSpawnRoster([
			{ tag: "@buck", task: "Research harness" },
			{ tag: "@fudgy", task: "Write docs" },
		]);
		expect(roster).toContain("@porcupine (main, your parent)");
		expect(roster).toContain("@buck (Research harness)");
		expect(roster).toContain("@fudgy (Write docs)");
		expect(roster).toContain("told you just came online");
	});
});

describe("subagent spawn roster", () => {
	async function spawnWithPeers(peers: Array<{ tag: string; task: string }>) {
		const { registerFauxProvider, fauxAssistantMessage, streamSimple } = await import("@porcupineai/ai/compat");
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("Report: done.")]);
		const claimed: Array<{ id: string; preferred?: string; task?: string }> = [];
		const tool = makeTool({
			resolveModel: () => faux.getModel(),
			getStreamFn: () => streamSimple,
			claimName: (id, preferred, task) => {
				claimed.push({ id, preferred, task });
				return "tinker";
			},
			getActiveAgents: () => peers,
		});
		return { tool, faux, claimed };
	}

	it("tells the new worker who else is active", async () => {
		const { tool, faux, claimed } = await spawnWithPeers([{ tag: "@buck", task: "Research harness" }]);
		const result = await tool.execute("id-1", { task: "Write docs" }, undefined, undefined, undefined as never);
		expect(result.details).toMatchObject({ started: true, name: "tinker" });
		expect(claimed[0]).toMatchObject({ preferred: undefined, task: "Write docs" });
		faux.unregister();
	});

	it("omits the roster when nobody else is active", async () => {
		const { tool, faux } = await spawnWithPeers([]);
		const result = await tool.execute("id-1", { task: "Solo task" }, undefined, undefined, undefined as never);
		expect(result.details).toMatchObject({ started: true });
		faux.unregister();
	});
});

describe("subagent tool — background mode", () => {
	it("registers a cancel handle and unregisters it when the run settles", async () => {
		const { registerFauxProvider, fauxAssistantMessage, streamSimple } = await import("@porcupineai/ai/compat");
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("Report: done.")]);

		const registered: string[] = [];
		const unregistered: string[] = [];

		const tool = makeTool({
			resolveModel: () => faux.getModel(),
			getStreamFn: () => streamSimple,
			onRegister: (id, cancel) => {
				registered.push(id);
				expect(typeof cancel).toBe("function");
			},
			onUnregister: (id) => unregistered.push(id),
		});

		const result = await tool.execute("id-1", { task: "do the thing" }, undefined, undefined, undefined as never);
		expect(result.details).toMatchObject({ started: true });

		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(registered.length).toBe(1);
		expect(unregistered).toEqual(registered);
		faux.unregister();
	});

	it("returns immediately with an id and tag while the sub-agent runs in the background", async () => {
		const { registerFauxProvider, fauxAssistantMessage, streamSimple } = await import("@porcupineai/ai/compat");
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("Report: done.")]);
		const completed: unknown[] = [];

		const tool = makeTool({
			resolveModel: () => faux.getModel(),
			getStreamFn: () => streamSimple,
			onComplete: async (id, result) => {
				completed.push({ id, result });
			},
		});

		const result = await tool.execute("id-1", { task: "do the thing" }, undefined, undefined, undefined as never);
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");

		// Background: returns immediately, no final report yet.
		expect(text).toContain("Sub-agent started");
		expect(text).toContain("@buck");
		expect(result.details).toMatchObject({ started: true, background: true, name: "buck", tag: "@buck" });
		expect(typeof (result.details as { id?: string }).id).toBe("string");

		// The report lands via onComplete once the background run finishes.
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(completed.length).toBe(1);
		faux.unregister();
	});
});
