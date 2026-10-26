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
export type WorkbenchReplayEvent =
	| {
			type: "message_end";
			message: { role: string; content: string; customType?: string; details?: Record<string, unknown> };
	  }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: { content: Array<{ type: "text"; text: string }>; details?: { visualization: unknown } };
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
export function serializeWorkbenchTimeline(messages: readonly SourceMessage[]): WorkbenchReplayEvent[] {
	const events: WorkbenchReplayEvent[] = [];
	for (const message of messages) {
		const content = textOf(message.content);
		if (message.role === "user" || message.role === "assistant") {
			if (content) events.push({ type: "message_end", message: { role: message.role, content } });
			if (message.role === "assistant" && Array.isArray(message.content)) {
				for (const part of message.content) {
					if (
						record(part) &&
						part.type === "toolCall" &&
						typeof part.id === "string" &&
						typeof part.name === "string"
					)
						events.push({
							type: "tool_execution_start",
							toolCallId: part.id,
							toolName: part.name,
							args: part.arguments,
						});
				}
			}
		} else if (message.role === "toolResult" && message.toolCallId && message.toolName) {
			const visualization = record(message.details) ? message.details.visualization : undefined;
			events.push({
				type: "tool_execution_end",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				result: {
					content: [{ type: "text", text: content }],
					...(visualization ? { details: { visualization } } : {}),
				},
				isError: Boolean(message.isError),
			});
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
