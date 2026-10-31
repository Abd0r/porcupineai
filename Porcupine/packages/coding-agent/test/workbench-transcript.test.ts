import { describe, expect, it } from "vitest";
import { serializeWorkbenchTimeline } from "../src/server/workbench-transcript.ts";

describe("workbench timeline replay", () => {
	it("preserves collaboration failures and a zero-worker stop without exposing arbitrary metadata", () => {
		const events = serializeWorkbenchTimeline([
			{
				role: "toolResult",
				toolName: "subagent",
				toolCallId: "spawn",
				details: { started: false, internal: "private" },
			},
			{ role: "toolResult", toolName: "send_to_subagent", toolCallId: "send", details: { ok: false } },
			{ role: "toolResult", toolName: "stop_subagent", toolCallId: "stop", details: { stopped: 0 } },
		]);
		expect(events[0]).toMatchObject({ isError: true });
		expect(events[1]).toMatchObject({ isError: true });
		expect(events[2]).toMatchObject({ result: { details: { stopped: 0 } } });
		expect(JSON.stringify(events)).not.toContain("private");
	});
	it("preserves conversation, tool calls, results and sub-agent reports in message order", () => {
		const timeline = serializeWorkbenchTimeline([
			{ role: "user", content: "Fix it" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Supplied reasoning", signature: "secret-signature" },
					{ type: "text", text: "Inspecting the source." },
					{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "AGENTS.md" } },
				],
			},
			{
				role: "toolResult",
				toolCallId: "read-1",
				toolName: "read",
				content: [{ type: "text", text: "Project instructions" }],
				isError: false,
				details: { privateMetadata: "not public" },
			},
			{
				role: "custom",
				customType: "subagent_report",
				content: "Verified",
				details: { id: "worker", ok: true, internal: "not public" },
			},
			{ role: "assistant", content: [{ type: "text", text: "Done." }] },
		]);
		expect(timeline.map((event) => event.type)).toEqual([
			"message_end",
			"message_end",
			"tool_execution_start",
			"tool_execution_end",
			"message_end",
			"message_end",
		]);
		expect(timeline[2]).toMatchObject({ toolCallId: "read-1", args: { path: "AGENTS.md" } });
		expect(JSON.stringify(timeline)).toContain("Supplied reasoning");
		expect(JSON.stringify(timeline)).not.toMatch(/secret-signature|not public/);
	});
	it("preserves reasoning-only messages and interleaved code and tool blocks in their original order", () => {
		const timeline = serializeWorkbenchTimeline([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Inspect first", signature: "opaque" },
					{ type: "toolCall", id: "read", name: "read", arguments: { path: "main.ts" } },
					{ type: "text", text: "```ts\nconst answer = 42;\n```" },
					{ type: "thinking", thinking: "Now verify" },
					{ type: "toolCall", id: "verify", name: "bash", arguments: { command: "node verify.js" } },
				],
			},
		]);
		expect(timeline.map((event) => event.type)).toEqual([
			"message_end",
			"tool_execution_start",
			"message_end",
			"tool_execution_start",
		]);
		expect(timeline[0]).toMatchObject({ message: { content: [{ type: "thinking", thinking: "Inspect first" }] } });
		expect(timeline[2]).toMatchObject({
			message: {
				content: [
					{ type: "text", text: "```ts\nconst answer = 42;\n```" },
					{ type: "thinking", thinking: "Now verify" },
				],
			},
		});
		expect(JSON.stringify(timeline)).not.toContain("opaque");
	});
});
