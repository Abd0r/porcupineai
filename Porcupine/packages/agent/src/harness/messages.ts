import type { AudioContent, ImageContent, Message, TextContent } from "@porcupineai/ai";
import type { AgentMessage } from "../types.ts";

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

export const BRANCH_SUMMARY_SUFFIX = `</summary>`;

export interface BashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
	timestamp: number;
	excludeFromContext?: boolean;
}

export interface CustomMessage<T = unknown> {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent | AudioContent)[];
	display: boolean;
	details?: T;
	timestamp: number;
}

export interface BranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	fromId: string;
	timestamp: number;
}

export interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

declare module "../types.ts" {
	interface CustomAgentMessages {
		bashExecution: BashExecutionMessage;
		custom: CustomMessage;
		branchSummary: BranchSummaryMessage;
		compactionSummary: CompactionSummaryMessage;
	}
}

export function bashExecutionToText(msg: BashExecutionMessage): string {
	let text = `Ran \`${msg.command}\`\n`;
	if (msg.output) {
		text += `\`\`\`\n${msg.output}\n\`\`\``;
	} else {
		text += "(no output)";
	}
	if (msg.cancelled) {
		text += "\n\n(command cancelled)";
	} else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
		text += `\n\nCommand exited with code ${msg.exitCode}`;
	}
	if (msg.truncated && msg.fullOutputPath) {
		text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
	}
	return text;
}

export function createBranchSummaryMessage(summary: string, fromId: string, timestamp: string): BranchSummaryMessage {
	return {
		role: "branchSummary",
		summary,
		fromId,
		timestamp: new Date(timestamp).getTime(),
	};
}

export function createCompactionSummaryMessage(
	summary: string,
	tokensBefore: number,
	timestamp: string,
): CompactionSummaryMessage {
	return {
		role: "compactionSummary",
		summary,
		tokensBefore,
		timestamp: new Date(timestamp).getTime(),
	};
}

export function createCustomMessage(
	customType: string,
	content: string | (TextContent | ImageContent | AudioContent)[],
	display: boolean,
	details: unknown | undefined,
	timestamp: string,
): CustomMessage {
	return {
		role: "custom",
		customType,
		content,
		display,
		details,
		timestamp: new Date(timestamp).getTime(),
	};
}

export function convertToLlm(messages: AgentMessage[]): Message[] {
	// Single-pass builder: avoids the map→filter double pass and the intermediate
	// `(Message | undefined)[]` allocation. Semantics are identical (same order, same
	// filtering of un-convertible roles, same object references passed through for
	// standard roles). Pre-sized so the common no-filter case avoids reallocation.
	const out = new Array<Message>(messages.length);
	let n = 0;
	for (const m of messages) {
		switch (m.role) {
			case "bashExecution":
				if (m.excludeFromContext) {
					break;
				}
				out[n++] = {
					role: "user",
					content: [{ type: "text", text: bashExecutionToText(m) }],
					timestamp: m.timestamp,
				};
				break;
			case "custom": {
				const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
				out[n++] = {
					role: "user",
					content,
					timestamp: m.timestamp,
				};
				break;
			}
			case "branchSummary":
				out[n++] = {
					role: "user",
					content: [{ type: "text" as const, text: BRANCH_SUMMARY_PREFIX + m.summary + BRANCH_SUMMARY_SUFFIX }],
					timestamp: m.timestamp,
				};
				break;
			case "compactionSummary":
				out[n++] = {
					role: "user",
					content: [
						{ type: "text" as const, text: COMPACTION_SUMMARY_PREFIX + m.summary + COMPACTION_SUMMARY_SUFFIX },
					],
					timestamp: m.timestamp,
				};
				break;
			case "user":
			case "assistant":
			case "toolResult":
				out[n++] = m;
				break;
			default:
				break;
		}
	}
	out.length = n;
	return out;
}
