import { describe, expect, it } from "vitest";
import { createVisualizeTool } from "../src/core/tools/visualize.ts";
import { createVisualize3DTool } from "../src/core/tools/visualize-3d.ts";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { createHarness } from "./test-harness.ts";

describe("workbench visual execution", () => {
	it("exposes the browser selection policy and executes chart and 3D tool calls through the real session", async () => {
		const chart = {
			kind: "chart",
			title: "Supplied measurements",
			chartType: "line",
			xLabel: "Time (s)",
			yLabel: "Distance (m)",
			series: [
				{
					name: "Measurements",
					color: "#80c060",
					points: [
						{ x: 0, y: 0 },
						{ x: 1, y: 2 },
					],
				},
			],
		};
		const scene = {
			title: "Spatial relationship",
			objects: [{ type: "sphere", position: [0, 0, 0], radius: 1, color: "#80c060" }],
		};
		const harness = await createHarness({
			tools: [createVisualizeTool(), createVisualize3DTool()],
			responses: [
				{
					thinking: "Use the supplied measurements.",
					toolCalls: [{ id: "chart", name: "visualize", args: chart }],
				},
				{ toolCalls: [{ id: "scene", name: "visualize_3d", args: scene }] },
				"Here are the chart and spatial view.",
			],
		});
		try {
			harness.session.setActiveToolsByName([]);
			const api = adaptSessionToServeApi(harness.session);
			api.setClientSurface?.("web");
			expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining(["visualize", "visualize_3d"]));
			expect(harness.agent.state.systemPrompt).toContain("without waiting for an explicit request");
			expect(harness.agent.state.systemPrompt).toContain("spatial structure");
			await api.sendUserMessage("Explain these measurements and the spatial relationship.");
			const results = api.getTimeline!().filter((event) => event.type === "tool_execution_end");
			expect(results).toHaveLength(2);
			expect(results[0]).toMatchObject({
				isError: false,
				result: { details: { visualization: { version: 2, ...chart } } },
			});
			expect(results[1]).toMatchObject({
				isError: false,
				result: { details: { visualization: { version: 1, ...scene } } },
			});
		} finally {
			harness.cleanup();
		}
	});
});
