import type { AgentTool } from "@porcupineai/agent-core";
import { describe, expect, it, vi } from "vitest";
import {
	isSensitiveLazyTool,
	type LazyToolActivationDeps,
	resolveLazyToolActivation,
	resolveLazyToolName,
	SENSITIVE_LAZY_TOOLS,
} from "../src/porcupine/lazy-tool-activation.ts";

function fakeTool(name: string): AgentTool {
	return { name } as unknown as AgentTool;
}

function createDeps(overrides?: Partial<LazyToolActivationDeps>): LazyToolActivationDeps & {
	seated: string[];
	tools: Map<string, AgentTool>;
} {
	const tools = new Map<string, AgentTool>([
		["plan", fakeTool("plan")],
		["read", fakeTool("read")],
		["computer_use", fakeTool("computer_use")],
	]);
	const seated: string[] = [];
	return {
		tools,
		seated,
		hasTool: (name: string) => tools.has(name),
		isActive: () => false,
		getTool: (name: string) => tools.get(name),
		seat: (name: string) => {
			seated.push(name);
		},
		mode: "auto",
		...overrides,
	};
}

describe("lazy tool name resolution", () => {
	it("matches exact registered names", () => {
		expect(resolveLazyToolName("plan", (name) => name === "plan")).toBe("plan");
	});

	it("resolves dotted guesses to their last segment", () => {
		expect(resolveLazyToolName("default.plan", (name) => name === "plan")).toBe("plan");
	});

	it("returns undefined for unknown names without fuzzy matching", () => {
		expect(resolveLazyToolName("reaad", (name) => name === "read")).toBeUndefined();
		expect(resolveLazyToolName("nope", () => false)).toBeUndefined();
		expect(resolveLazyToolName("  ", (name) => name === "plan")).toBeUndefined();
	});
});

describe("sensitive lazy tier", () => {
	it("marks host-control and outbound-send tools sensitive", () => {
		for (const name of ["computer_use", "email_send", "x_post", "x_reply"]) {
			expect(SENSITIVE_LAZY_TOOLS.has(name)).toBe(true);
			expect(isSensitiveLazyTool(name)).toBe(true);
		}
	});

	it("keeps read, search, and plan tools in the safe tier", () => {
		for (const name of ["read", "plan", "tasks", "memory", "bash"]) {
			expect(isSensitiveLazyTool(name)).toBe(false);
		}
	});
});

describe("resolveLazyToolActivation", () => {
	it("seats and returns safe tools in every mode", async () => {
		for (const mode of ["ask", "normal", "auto"] as const) {
			const deps = createDeps({ mode });
			const resolution = await resolveLazyToolActivation("plan", deps);
			expect(resolution?.tool?.name).toBe("plan");
			expect(deps.seated).toEqual(["plan"]);
		}
	});

	it("resolves dotted safe names and seats the canonical tool", async () => {
		const deps = createDeps();
		const resolution = await resolveLazyToolActivation("default.plan", deps);
		expect(resolution?.tool?.name).toBe("plan");
		expect(deps.seated).toEqual(["plan"]);
	});

	it("returns undefined for names outside the registry", async () => {
		const deps = createDeps();
		expect(await resolveLazyToolActivation("nope", deps)).toBeUndefined();
	});

	it("respects user-disabled tools even when the model guesses them", async () => {
		const deps = createDeps({ hasTool: () => false });
		expect(await resolveLazyToolActivation("plan", deps)).toBeUndefined();
		expect(deps.seated).toEqual([]);
	});

	it("returns the tool without seating when it is already active", async () => {
		const deps = createDeps({ isActive: () => true });
		const resolution = await resolveLazyToolActivation("plan", deps);
		expect(resolution?.tool?.name).toBe("plan");
		expect(deps.seated).toEqual([]);
	});

	it("asks for confirmation before seating sensitive tools in Ask mode", async () => {
		const confirm = vi.fn(async () => true);
		const deps = createDeps({ mode: "ask", confirm });
		const resolution = await resolveLazyToolActivation("computer_use", deps);
		expect(confirm).toHaveBeenCalledOnce();
		expect(resolution?.tool?.name).toBe("computer_use");
		expect(deps.seated).toEqual(["computer_use"]);
	});

	it("denies sensitive tools when the user declines", async () => {
		const deps = createDeps({ mode: "normal", confirm: async () => false });
		const resolution = await resolveLazyToolActivation("computer_use", deps);
		expect(resolution?.tool).toBeUndefined();
		expect(resolution?.error).toContain("computer_use");
		expect(deps.seated).toEqual([]);
	});

	it("fails closed for sensitive tools with no confirm callback", async () => {
		const deps = createDeps({ mode: "ask", confirm: undefined });
		const resolution = await resolveLazyToolActivation("computer_use", deps);
		expect(resolution?.tool).toBeUndefined();
		expect(resolution?.error).toContain("computer_use");
		expect(deps.seated).toEqual([]);
	});

	it("uses the LLM gate for sensitive tools in Auto mode", async () => {
		const approved = createDeps({ mode: "auto", classify: async () => "approve" });
		expect((await resolveLazyToolActivation("computer_use", approved))?.tool?.name).toBe("computer_use");
		expect(approved.seated).toEqual(["computer_use"]);

		const denied = createDeps({ mode: "auto", classify: async () => "deny" });
		const resolution = await resolveLazyToolActivation("computer_use", denied);
		expect(resolution?.tool).toBeUndefined();
		expect(resolution?.error).toContain("computer_use");
		expect(denied.seated).toEqual([]);
	});

	it("fails closed when dependencies throw", async () => {
		const deps = createDeps({
			getTool: () => {
				throw new Error("boom");
			},
		});
		expect(await resolveLazyToolActivation("plan", deps)).toBeUndefined();
	});
});
