import type { SessionEntry } from "../core/session-manager.ts";

/** Public replay data, deliberately excluding provider signatures and arbitrary metadata. */
interface SourceMessage {
	role: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	customType?: string;
	details?: unknown;
}
type ReplayContent =
	| { type: "image"; data: string; mimeType: string }
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string };
export type WorkbenchReplayEvent =
	| { type: "command_result"; command: string; text: string }
	| {
			type: "message_end";
			message: {
				role: string;
				content: string | ReplayContent[];
				customType?: string;
				details?: Record<string, unknown>;
			};
	  }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: {
				content: Array<{ type: "text"; text: string }>;
				details?: {
					visualization?: unknown;
					plan?: unknown;
					diff?: string;
					patch?: string;
					firstChangedLine?: number;
				};
			};
			isError: boolean;
	  };

function record(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => record(part) && part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}
/** GUI history follows the selected branch, independently of the model's compacted context. */
export function serializeWorkbenchHistory(entries: readonly SessionEntry[]): WorkbenchReplayEvent[] {
	const messages: SourceMessage[] = [];
	for (const entry of entries) {
		if (entry.type === "message") messages.push(entry.message);
		if (
			entry.type === "custom" &&
			entry.customType === "workbench.command" &&
			record(entry.data) &&
			typeof entry.data.command === "string" &&
			typeof entry.data.text === "string"
		)
			messages.push({
				role: "custom",
				customType: "workbench.command",
				content: entry.data.text,
				details: { command: entry.data.command },
			});
		if (entry.type === "custom_message")
			messages.push({
				role: "custom",
				customType: entry.customType,
				content: entry.content,
				details: entry.details,
			});
	}
	return serializeWorkbenchTimeline(messages);
}
export function serializeWorkbenchTimeline(messages: readonly SourceMessage[]): WorkbenchReplayEvent[] {
	const events: WorkbenchReplayEvent[] = [];
	for (const message of messages) {
		const content = textOf(message.content);
		if (message.role === "user" || message.role === "assistant") {
			if (message.role === "assistant" && Array.isArray(message.content)) {
				let blocks: ReplayContent[] = [];
				const flush = () => {
					if (blocks.length) events.push({ type: "message_end", message: { role: "assistant", content: blocks } });
					blocks = [];
				};
				for (const part of message.content) {
					if (!record(part)) continue;
					if (part.type === "text" && typeof part.text === "string" && part.text)
						blocks.push({ type: "text", text: part.text });
					if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking && !part.redacted)
						blocks.push({ type: "thinking", thinking: part.thinking });
					if (
						record(part) &&
						part.type === "toolCall" &&
						typeof part.id === "string" &&
						typeof part.name === "string"
					) {
						flush();
						events.push({
							type: "tool_execution_start",
							toolCallId: part.id,
							toolName: part.name,
							args: part.arguments,
						});
					}
				}
				flush();
			} else if (message.role === "user" && Array.isArray(message.content)) {
				const parts: ReplayContent[] = [];
				for (const part of message.content) {
					if (!record(part)) continue;
					if (part.type === "text" && typeof part.text === "string") parts.push({ type: "text", text: part.text });
					if (
						part.type === "image" &&
						typeof part.data === "string" &&
						typeof part.mimeType === "string" &&
						["image/png", "image/jpeg", "image/webp", "image/gif"].includes(part.mimeType)
					)
						parts.push({ type: "image", data: part.data, mimeType: part.mimeType });
				}
				if (parts.length) events.push({ type: "message_end", message: { role: "user", content: parts } });
			} else if (content) events.push({ type: "message_end", message: { role: message.role, content } });
		} else if (message.role === "toolResult" && message.toolCallId && message.toolName) {
			const details: {
				visualization?: unknown;
				plan?: unknown;
				diff?: string;
				patch?: string;
				firstChangedLine?: number;
			} = {};
			if (record(message.details)) {
				if (message.toolName === "plan" && "plan" in message.details) details.plan = message.details.plan;
				if (message.details.visualization) details.visualization = message.details.visualization;
				if (typeof message.details.diff === "string") details.diff = message.details.diff;
				if (typeof message.details.patch === "string") details.patch = message.details.patch;
				if (Number.isInteger(message.details.firstChangedLine) && Number(message.details.firstChangedLine) > 0)
					details.firstChangedLine = Number(message.details.firstChangedLine);
			}
			events.push({
				type: "tool_execution_end",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				result: {
					content: [{ type: "text", text: content }],
					...(Object.keys(details).length ? { details } : {}),
				},
				isError: Boolean(message.isError),
			});
		} else if (
			message.role === "custom" &&
			message.customType === "workbench.command" &&
			record(message.details) &&
			typeof message.details.command === "string"
		) {
			events.push({ type: "command_result", command: message.details.command, text: content });
		} else if (message.role === "custom" && message.customType?.startsWith("subagent")) {
			const details: Record<string, unknown> = {};
			if (record(message.details))
				for (const key of ["id", "from", "agentTag", "ok"])
					if (key in message.details) details[key] = message.details[key];
			events.push({
				type: "message_end",
				message: { role: "custom", customType: message.customType, content, details },
			});
		}
	}
	return events;
}
