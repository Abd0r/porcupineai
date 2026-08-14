/**
 * Runtime introspection for the model.
 *
 * `inspect_runtime` reports over the LIVE runtime (the actual tool registry,
 * command registry, and loaded extensions) rather than static docs. It is
 * strictly read-only: it never mutates state, never runs extension code, and
 * never triggers side effects. If a surface is unavailable in the current
 * session it is reported as unavailable rather than throwing.
 */

import type { AgentTool } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const inspectSchema = Type.Object({
	scope: Type.Optional(
		Type.Union([Type.Literal("all"), Type.Literal("auto")], {
			description: "Keep the report compact: all sections, auto-scoped for a quick overview.",
		}),
	),
});

export type InspectRuntimeToolInput = Static<typeof inspectSchema>;

export interface InspectRuntimeToolDetails {
	sections: string[];
}

/** One live tool entry exposed to the runtime inspector. */
export interface RuntimeInspectTool {
	name: string;
	description?: string;
	parametersDescription?: string;
}

/** One live slash command entry. */
export interface RuntimeInspectCommand {
	name: string;
}

/** One loaded extension and the registration kinds it performed. */
export interface RuntimeInspectExtension {
	path: string;
	registrations: string[];
}

/** Live read-only view of the runtime as seen by this session. */
export interface RuntimeInspectState {
	getTools: () => RuntimeInspectTool[];
	getCommands: () => RuntimeInspectCommand[];
	getExtensions: () => RuntimeInspectExtension[];
}

export interface InspectRuntimeToolOptions {
	getState?: () => RuntimeInspectState | undefined;
}

/**
 * Extension hook/event names extensions can subscribe to via api.on().
 * Mirrors the ExtensionAPI `on` overloads in core/extensions/types.ts.
 */
export const EXTENSION_HOOKS: readonly string[] = [
	"project_trust",
	"resources_discover",
	"session_start",
	"session_info_changed",
	"session_before_switch",
	"session_before_fork",
	"session_before_compact",
	"session_compact",
	"session_shutdown",
	"session_before_tree",
	"session_tree",
	"context",
	"before_provider_request",
	"before_provider_headers",
	"after_provider_response",
	"before_agent_start",
	"agent_start",
	"agent_end",
	"agent_settled",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"model_select",
	"thinking_level_select",
	"tool_call",
	"tool_result",
	"user_bash",
	"input",
];

/** Extension API surface: registration method names with one-line signatures. */
export const EXTENSION_API_SURFACE: readonly { name: string; signature: string }[] = [
	{ name: "on", signature: "on(event, handler) -> () => void" },
	{ name: "registerTool", signature: "registerTool(tool) -> () => void" },
	{ name: "registerCommand", signature: "registerCommand(name, options) -> () => void" },
	{ name: "registerShortcut", signature: "registerShortcut(shortcut, options) -> () => void" },
	{ name: "registerFlag", signature: "registerFlag(name, options) -> () => void" },
	{ name: "getFlag", signature: "getFlag(name) -> boolean | string | undefined" },
	{ name: "registerMessageRenderer", signature: "registerMessageRenderer(customType, renderer) -> () => void" },
	{ name: "registerMarkdownTransformer", signature: "registerMarkdownTransformer(transformer) -> () => void" },
	{ name: "registerEntryRenderer", signature: "registerEntryRenderer(customType, renderer) -> () => void" },
	{ name: "registerProvider", signature: "registerProvider(provider | name, config)" },
	{ name: "unregisterProvider", signature: "unregisterProvider(name)" },
	{ name: "dispose", signature: "dispose() -> unwinds all registrations" },
];

/**
 * Module-level default state provider. It is set once at session construction
 * (see sdk.ts) so the always-available inspect_runtime tool reads the LIVE
 * registries even though its definition is built without per-session options.
 * Tests inject state directly via createInspectRuntimeToolDefinition.
 */
let defaultGetState: (() => RuntimeInspectState | undefined) | undefined;

/** Register the runtime state provider for the current session. Idempotent-ish. */
export function registerRuntimeInspector(getState: () => RuntimeInspectState | undefined): () => void {
	const previous = defaultGetState;
	defaultGetState = getState;
	return () => {
		if (defaultGetState === getState) defaultGetState = previous;
	};
}

function formatState(state: RuntimeInspectState | undefined): string {
	if (!state) {
		return (
			"RUNTIME INTROSPECTION\n" +
			"Active tools, slash commands, and loaded extensions report UNAVAILABLE:\n" +
			"no live runtime state is bound in this context."
		);
	}

	const sections: string[] = [];
	let tools: RuntimeInspectTool[] = [];
	try {
		tools = state.getTools();
		sections.push(`active tools (${tools.length})`);
	} catch {
		sections.push("active tools (unavailable)");
	}

	let commands: RuntimeInspectCommand[] = [];
	try {
		commands = state.getCommands();
		sections.push(`slash commands (${commands.length})`);
	} catch {
		sections.push("slash commands (unavailable)");
	}

	let extensions: RuntimeInspectExtension[] = [];
	try {
		extensions = state.getExtensions();
		sections.push(`extensions (${extensions.length})`);
	} catch {
		sections.push("extensions (unavailable)");
	}

	const lines: string[] = [];

	const toolLines: string[] = [];
	for (const tool of tools) {
		toolLines.push(
			`  ${tool.name}${tool.description ? ` - ${tool.description}` : ""}${tool.parametersDescription ? ` (${tool.parametersDescription})` : ""}`,
		);
	}
	lines.push(`ACTIVE TOOLS ${tools.length > 0 ? `(${tools.length})` : ""}`);
	lines.push(toolLines.length > 0 ? toolLines.join("\n") : "  (none)");

	lines.push("");
	lines.push("SLASH COMMANDS");
	lines.push(
		commands.length > 0
			? commands
					.map((c) => c.name)
					.sort()
					.join(", ")
			: "  (none)",
	);

	lines.push("");
	lines.push("LOADED EXTENSIONS");
	if (extensions.length === 0) {
		lines.push("  (none)");
	} else {
		for (const ext of extensions) {
			const kinds = ext.registrations.length > 0 ? ext.registrations.join(", ") : "no registrations";
			lines.push(`  ${ext.path} [${kinds}]`);
		}
	}

	lines.push("");
	lines.push("EXTENSION HOOKS");
	lines.push(EXTENSION_HOOKS.join(", "));

	lines.push("");
	lines.push("EXTENSION API SURFACE");
	for (const entry of EXTENSION_API_SURFACE) {
		lines.push(`  ${entry.name}: ${entry.signature}`);
	}

	return lines.join("\n");
}

/**
 * Always-available, read-only introspection over the live runtime. Structured
 * text (not a JSON blob) to keep the output compact for a model context window.
 */
export function createInspectRuntimeToolDefinition(
	options: InspectRuntimeToolOptions = {},
): ToolDefinition<typeof inspectSchema, InspectRuntimeToolDetails> {
	const getState = options.getState ?? defaultGetState;

	return {
		name: "inspect_runtime",
		label: "inspect_runtime",
		description:
			"Read-only live snapshot of the runtime: active tool names with descriptions and parameter schemas, registered slash commands, loaded extensions (source path + registration kinds), extension hook names, and the extension API surface. Never mutates state or runs extension code.",
		promptSnippet: "Runtime live view: tools, commands, extensions, hooks, API surface",
		promptGuidelines: [
			"Call before assuming which tools, slash commands, or extensions are loaded. Reports the LIVE runtime, not static docs.",
			"Strictly read-only: never mutates state and never runs extension code.",
			"If a surface is unavailable in this session it is reported as unavailable instead of throwing.",
		],
		parameters: inspectSchema,
		async execute(_toolCallId: string, _params: Static<typeof inspectSchema>) {
			return {
				content: [{ type: "text", text: formatState(getState?.()) }],
				details: { sections: [] },
			};
		},
		renderCall() {
			return new Text(`${theme.fg("toolTitle", theme.bold("inspect_runtime"))}`, 0, 0);
		},
		renderResult(result) {
			const text = result.content
				.map((item) => (item.type === "text" ? item.text : ""))
				.join("")
				.trim();
			const expanded = text.split("\n").slice(0, 40).join("\n");
			return new Text(`\n${theme.fg("toolOutput", expanded)}`, 0, 0);
		},
	};
}

/** AgentTool wrapper (mirrors neighboring read-only tools). */
export function createInspectRuntimeTool(options?: InspectRuntimeToolOptions): AgentTool<typeof inspectSchema> {
	return wrapToolDefinition(createInspectRuntimeToolDefinition(options));
}
