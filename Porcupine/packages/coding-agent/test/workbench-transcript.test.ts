import { describe, expect, it } from "vitest";
import { serializeWorkbenchTimeline } from "../src/server/workbench-transcript.ts";

describe("workbench timeline replay", () => {
	it("preserves conversation, tool calls, results and sub-agent reports in message order", () => {
		const timeline = serializeWorkbenchTimeline([
			{ role: "user", content: "Fix it" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "private provider reasoning", signature: "secret-signature" },
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
		expect(JSON.stringify(timeline)).not.toMatch(/secret-signature|private provider reasoning|not public/);
	});
});
