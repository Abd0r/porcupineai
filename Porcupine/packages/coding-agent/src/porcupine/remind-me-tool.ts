/**
 * `remind_me` model-facing tool.
 *
 * Schedules a session-local, attended reminder that fires while the interactive
 * session is open and idle, delivered through the existing task-completion chat
 * bridge fan-out (the {@link ReminderEngine} that is provided by the caller
 * owns that notify path). Mirrors the tasks tool pattern: the definition takes
 * an optional engine and lazily falls back to a default one for standalone use.
 */

import type { AgentTool } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../core/extensions/types.ts";
import { wrapToolDefinition } from "../core/tools/tool-definition-wrapper.ts";
import { formatDuration, parseDuration, ReminderEngine } from "../porcupine/reminders.ts";

const schema = Type.Object({
	text: Type.String({ description: "What to be reminded about." }),
	duration: Type.String({
		description:
			"How long until the reminder fires, e.g. 45s, 5m, 2h, 1d, or a bare number of seconds. The reminder only fires while the interactive session is open and idle.",
	}),
});

export type RemindMeToolInput = Static<typeof schema>;

export interface RemindMeToolOptions {
	/** Engine override (tests / interactive wiring). When omitted, a no-op-notify
	 * engine is used so the tool is safe to call standalone. */
	engine?: ReminderEngine;
}

export function createRemindMeToolDefinition(
	options?: RemindMeToolOptions,
): ToolDefinition<typeof schema, { text: string; durationMs: number }> {
	let engine: ReminderEngine | undefined;
	const getEngine = (): ReminderEngine => {
		engine ??= options?.engine ?? new ReminderEngine({ notify: () => {} });
		return engine;
	};

	return {
		name: "remind_me",
		label: "remind_me",
		description:
			"Schedule an attended reminder to surface while the interactive session is open and idle. The reminder delivers through the same chat-bridge notification path as completed task runs; it never fires when the session is closed, and it is not a daemon.",
		promptSnippet: "Schedule a reminder that fires later while idle",
		promptGuidelines: [
			"Use remind_me when the user wants a nudge later (e.g. 'remind me to circle back').",
			"Provide a short text and a duration like 45s, 5m, 2h, or 1d.",
			"Reminders are attended-only: they fire while the interactive session is open and idle, through chat bridges.",
		],
		parameters: schema,
		async execute(_toolCallId, args) {
			const text = args.text?.trim();
			const durationMs = parseDuration(args.duration ?? "");
			if (!text) {
				return {
					content: [{ type: "text", text: "remind_me requires a non-empty text." }],
					details: { text: "", durationMs: 0 },
				};
			}
			if (durationMs === undefined) {
				return {
					content: [{ type: "text", text: "remind_me requires a duration like 45s, 5m, 2h, or 1d." }],
					details: { text, durationMs: 0 },
				};
			}
			const reminder = getEngine().schedule({ text, source: "model", durationMs });
			return {
				content: [
					{
						type: "text",
						text:
							reminder === undefined
								? "Could not schedule the reminder."
								: `Reminder set: "${text}" in ${formatDuration(durationMs)}. It fires only while the interactive session is open and idle.`,
					},
				],
				details: { text, durationMs },
			};
		},
		renderCall(_args) {
			return new Text("remind_me", 0, 0);
		},
		renderResult(result) {
			const text = (result.content ?? [])
				.map((c) => (c.type === "text" ? c.text : ""))
				.join("")
				.trim();
			return new Text(text, 0, 0);
		},
	};
}

export function createRemindMeTool(options?: RemindMeToolOptions): AgentTool<typeof schema> {
	return wrapToolDefinition(createRemindMeToolDefinition(options));
}
