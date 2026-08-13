/**
 * Persistent memory tool — MEMORY.md + USER.md under the agent home.
 */

import type { AgentTool } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { getAgentDir } from "../../config.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { type MemoryAction, type MemoryTarget, mutateMemory } from "../../porcupine/memory-store.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const memorySchema = Type.Object({
	action: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove"), Type.Literal("list")], {
		description: "add | replace | remove | list",
	}),
	target: Type.Union([Type.Literal("memory"), Type.Literal("user")], {
		description: "memory = agent notes (MEMORY.md); user = user profile (USER.md)",
	}),
	content: Type.Optional(Type.String({ description: "Fact text for add/replace (and optional for remove)" })),
	oldText: Type.Optional(Type.String({ description: "Substring matching the entry to replace/remove" })),
});

export type MemoryToolInput = Static<typeof memorySchema>;

export interface MemoryToolDetails {
	ok: boolean;
	file: string;
	chars: number;
	limit: number;
}

export interface MemoryToolOptions {
	/** Agent home (~/.porcupine/agent). Defaults to getAgentDir(). */
	agentDir?: string;
}

export function createMemoryToolDefinition(
	options?: MemoryToolOptions,
): ToolDefinition<typeof memorySchema, MemoryToolDetails | undefined> {
	const agentDir = options?.agentDir ?? getAgentDir();

	return {
		name: "memory",
		label: "memory",
		description:
			"Durable memory store: USER.md (who the user is) and MEMORY.md (agent notes). add | replace | remove | list. Agent-decided, never auto-saved — full policy in the memory-hygiene skill.",
		promptSnippet: "USER.md / MEMORY.md store (agent-decided; see memory-hygiene skill)",
		promptGuidelines: [
			"Memory writes are agent-decided: durable facts only, dedupe first, one line each — see the memory-hygiene skill.",
		],
		parameters: memorySchema,
		async execute(_toolCallId, args) {
			const action = args.action as MemoryAction;
			const target = args.target as MemoryTarget;
			const result = mutateMemory(agentDir, action, target, {
				content: args.content,
				oldText: args.oldText,
			});

			let text: string;
			if (action === "list") {
				const lines = (result.entries ?? []).map((e) => `${e.index}. ${e.text}`);
				text = [`${result.message}`, `file: ${result.file}`, lines.length ? lines.join("\n") : "(empty)"].join(
					"\n",
				);
			} else {
				text = JSON.stringify(
					{
						ok: result.ok,
						message: result.message,
						file: result.file,
						chars: result.chars,
						limit: result.limit,
						entries: result.entries?.map((e) => e.text),
					},
					null,
					2,
				);
			}

			return {
				content: [{ type: "text", text }],
				details: {
					ok: result.ok,
					file: result.file,
					chars: result.chars,
					limit: result.limit,
				},
			};
		},
		renderCall(args) {
			const a = String(args?.action ?? "?");
			const t = String(args?.target ?? "?");
			return new Text(`${theme.fg("toolTitle", theme.bold("memory"))} ${theme.fg("toolOutput", `${a} ${t}`)}`, 0, 0);
		},
		renderResult(result, options) {
			const text = (result.content ?? [])
				.map((c) => (c.type === "text" ? c.text : ""))
				.join("")
				.trim();
			const preview = options.expanded ? text : text.split("\n").slice(0, 10).join("\n");
			return new Text(`\n${theme.fg("toolOutput", preview || "(empty)")}`, 0, 0);
		},
	};
}

export function createMemoryTool(options?: MemoryToolOptions): AgentTool<typeof memorySchema> {
	return wrapToolDefinition(createMemoryToolDefinition(options));
}
