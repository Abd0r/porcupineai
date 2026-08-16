// Regression: BUG-9 — Mistral streaming tool-call identity collapsed distinct
// calls that share an id/index. When a chunk carries two tool calls whose `id`
// is absent ("null"), they both fell back to `index ?? 0`, so the second call's
// arguments were appended onto the first call's block instead of forming its own.
import { describe, expect, it, vi } from "vitest";

const mistralStreamEvents = vi.hoisted(() => ({
	events: [] as Array<unknown>,
}));

vi.mock("@mistralai/mistralai", () => {
	class HTTPClient {}

	class Mistral {
		chat = {
			stream: async function* () {
				for (const event of mistralStreamEvents.events) {
					yield event;
				}
			},
		};
	}

	return { HTTPClient, Mistral };
});

import { stream as streamMistral } from "../src/api/mistral-conversations.ts";
import { getModel } from "../src/compat.ts";
import type { Context } from "../src/types.ts";

const model = getModel("mistral", "devstral-medium-latest");
const context: Context = {
	messages: [{ role: "user", content: "Call both tools", timestamp: Date.now() }],
};

describe("Mistral streaming tool-call identity", () => {
	it("keeps distinct no-id tool calls in one chunk as separate blocks (BUG-9)", async () => {
		mistralStreamEvents.events = [
			{
				data: {
					id: "mistral-response-id",
					choices: [
						{
							finishReason: null,
							delta: {
								toolCalls: [
									{
										id: "null",
										type: "function",
										index: 0,
										function: { name: "get_current_weather", arguments: '{"location":"' },
									},
									{
										id: "null",
										type: "function",
										index: 0,
										function: { name: "get_current_time", arguments: '{"location":"' },
									},
								],
							},
						},
					],
				},
			},
			{
				data: {
					id: "mistral-response-id",
					choices: [
						{
							finishReason: "tool_calls",
							delta: {},
						},
					],
					usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
				},
			},
		];

		const message = await streamMistral(model, context, { apiKey: "test" }).result();

		const toolCalls = message.content.filter((block) => block.type === "toolCall");
		expect(toolCalls).toHaveLength(2);

		const byName = new Map(toolCalls.map((tc) => [tc.type === "toolCall" ? (tc as { name?: string }).name : "", tc]));
		expect(byName.get("get_current_weather")).toBeDefined();
		expect(byName.get("get_current_time")).toBeDefined();
		// Distinct calls must not share an identity.
		const ids = new Set(toolCalls.map((tc) => (tc as { id?: string }).id));
		expect(ids.size).toBe(2);
	});
});
