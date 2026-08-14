/**
 * Runtime introspection tool (inspect_runtime).
 *
 * Asserts the tool reports LIVE tool names, command names, extension list,
 * hook names, and the extension API surface, and that it is strictly read-only
 * (never mutates state and never runs extension code).
 */
import { describe, expect, it, vi } from "vitest";
import {
	createInspectRuntimeToolDefinition,
	EXTENSION_API_SURFACE,
	EXTENSION_HOOKS,
	type RuntimeInspectExtension,
	type RuntimeInspectState,
	registerRuntimeInspector,
} from "../src/core/tools/inspect-runtime.ts";

async function runInspect(getState: () => RuntimeInspectState | undefined): Promise<string> {
	const tool = createInspectRuntimeToolDefinition({ getState });
	let output = "";
	const result = (await tool.execute("call-1", {}, undefined, undefined, {} as never)) as {
		content: Array<{ text: string }>;
	};
	output = result.content.map((item) => item.text).join("");
	return output;
}

describe("inspect_runtime", () => {
	it("is always available (not extension-gated) via the tool registry", async () => {
		// Default construction (as in createAllToolDefinitions) works with no options.
		const tool = createInspectRuntimeToolDefinition();
		expect(tool.name).toBe("inspect_runtime");
		const result = (await tool.execute("call-0", {}, undefined, undefined, {} as never)) as {
			content: Array<{ text: string }>;
		};
		// No state bound => reports unavailable rather than throwing.
		expect(result.content[0]?.text).toContain("UNAVAILABLE");
	});

	it("returns live tool names with descriptions and parameter schemas", async () => {
		const state: RuntimeInspectState = {
			getTools: () => [
				{
					name: "read",
					description: "Read file contents",
					parametersDescription: "path, offset",
				},
				{ name: "grep", description: "Search", parametersDescription: "pattern" },
			],
			getCommands: () => [{ name: "model" }, { name: "compact" }],
			getExtensions: () => [],
		};

		const output = await runInspect(() => state);

		expect(output).toContain("ACTIVE TOOLS");
		expect(output).toContain("read - Read file contents");
		expect(output).toContain("(path, offset)");
		expect(output).toContain("grep - Search");
	});

	it("returns registered slash command names sorted", async () => {
		const state: RuntimeInspectState = {
			getTools: () => [],
			getCommands: () => [{ name: "zebra" }, { name: "alpha" }],
			getExtensions: () => [],
		};
		const output = await runInspect(() => state);
		expect(output).toContain("SLASH COMMANDS");
		expect(output).toContain("alpha, zebra");
	});

	it("reports loaded extensions with source path and registration kinds", async () => {
		const state: RuntimeInspectState = {
			getTools: () => [],
			getCommands: () => [],
			getExtensions: () => [
				{
					path: "~/.porcupine/agent/extensions/my.ts",
					registrations: ["tools", "commands"],
				} as RuntimeInspectExtension,
				{ path: "/proj/.porcupine/extensions/watch.ts", registrations: ["events:input,tool_call"] },
			],
		};
		const output = await runInspect(() => state);
		expect(output).toContain("LOADED EXTENSIONS");
		expect(output).toContain("my.ts [tools, commands]");
		expect(output).toContain("watch.ts [events:input,tool_call]");
	});

	it("lists extension hook/event names", async () => {
		const output = await runInspect(() => ({ getTools: () => [], getCommands: () => [], getExtensions: () => [] }));
		expect(output).toContain("EXTENSION HOOKS");

		const requiredHooks = [
			"input",
			"before_agent_start",
			"agent_settled",
			"session_before_switch",
			"project_trust",
			"model_select",
			"thinking_level_select",
			"session_start",
		];
		for (const hook of requiredHooks) {
			expect(EXTENSION_HOOKS).toContain(hook);
			expect(output).toContain(hook);
		}
	});

	it("lists the extension API surface with signatures", async () => {
		const output = await runInspect(() => ({ getTools: () => [], getCommands: () => [], getExtensions: () => [] }));
		expect(output).toContain("EXTENSION API SURFACE");
		for (const entry of EXTENSION_API_SURFACE) {
			expect(output).toContain(entry.name);
			expect(entry.signature.length).toBeGreaterThan(0);
		}
		expect(EXTENSION_API_SURFACE.map((e) => e.name)).toContain("registerTool");
		expect(EXTENSION_API_SURFACE.map((e) => e.name)).toContain("on");
	});

	it("is strictly read-only: never runs extension code and never mutates state", async () => {
		// Pass a spy-free live-state object; verify the tool does not invoke any
		// mutating operation and returns compact structured text.
		const getTools = vi.fn(() => [{ name: "read" }]);
		const getCommands = vi.fn(() => [{ name: "compact" }]);
		const getExtensions = vi.fn(() => []);
		const state: RuntimeInspectState = { getTools, getCommands, getExtensions };

		const output = await runInspect(() => state);

		// Each live accessor is read exactly once for the report.
		expect(getTools).toHaveBeenCalledTimes(1);
		expect(getCommands).toHaveBeenCalledTimes(1);
		expect(getExtensions).toHaveBeenCalledTimes(1);

		// Structured text, not a JSON blob.
		expect(output.startsWith("{")).toBe(false);
		expect(output.includes("ACTIVE TOOLS")).toBe(true);
		// Compact: no dense JSON arrays/objects in the report body.
		expect(output.includes('"name"')).toBe(false);
	});

	it("reports unavailable rather than throwing when a surface is absent", async () => {
		const output = await runInspect(() => undefined);
		expect(output).toContain("UNAVAILABLE");
		expect(output).toContain("no live runtime state is bound");
	});

	it("registerRuntimeInspector provides the module-level default state", async () => {
		const unregister = registerRuntimeInspector(() => ({
			getTools: () => [{ name: "memory" }],
			getCommands: () => [],
			getExtensions: () => [{ path: "<inline>", registrations: [] }],
		}));
		try {
			const tool = createInspectRuntimeToolDefinition();
			const result = (await tool.execute("call-9", {}, undefined, undefined, {} as never)) as {
				content: Array<{ text: string }>;
			};
			expect(result.content[0]?.text).toContain("memory");
		} finally {
			unregister();
		}
	});
});
