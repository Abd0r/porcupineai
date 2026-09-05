import type { AgentTool } from "@porcupineai/agent-core";
import { describe, expect, it, vi } from "vitest";
import {
	isSensitiveLazyTool,
	type LazyToolActivationDeps,
	resolveLazyToolActivation,
	resolveLazyToolName,
	SENSITIVE_LAZY_TOOLS,
	SUBAGENT_LAZY_EXCLUDED,
	subagentLazyPoolNames,
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

describe("subagent lazy pool", () => {
	const registry = ["read", "plan", "tasks", "computer_use", "email_send", "show_markdown"];
	const active = ["read"];

	it("keeps safe dormant tools like plan", () => {
		expect(subagentLazyPoolNames(registry, active)).toContain("plan");
		expect(subagentLazyPoolNames(registry, active)).toContain("show_markdown");
	});

	it("excludes active tools", () => {
		expect(subagentLazyPoolNames(registry, active)).not.toContain("read");
	});

	it("excludes agent-level tools", () => {
		for (const name of ["subagent", "ask_question", "computer_use", "tasks", "projects"]) {
			expect(SUBAGENT_LAZY_EXCLUDED.has(name)).toBe(true);
		}
		const pool = subagentLazyPoolNames([...registry, "subagent", "ask_question", "projects"], active);
		expect(pool).not.toContain("tasks");
		expect(pool).not.toContain("computer_use");
		expect(pool).not.toContain("subagent");
		expect(pool).not.toContain("ask_question");
		expect(pool).not.toContain("projects");
	});

	it("excludes the sensitive tier", () => {
		for (const name of ["email_send", "x_post", "x_reply"]) {
			expect(SUBAGENT_LAZY_EXCLUDED.has(name)).toBe(true);
		}
		const pool = subagentLazyPoolNames([...registry, "x_post", "x_reply"], active);
		expect(pool).not.toContain("email_send");
		expect(pool).not.toContain("x_post");
		expect(pool).not.toContain("x_reply");
	});
});
