import { describe, expect, it } from "vitest";
import { createAllToolDefinitions, createAllTools, createReadOnlyToolDefinitions } from "../src/core/tools/index.ts";
import { createVisualizeToolDefinition } from "../src/core/tools/visualize.ts";

const chart = {
	kind: "chart",
	title: "Illustrative motion",
	chartType: "line",
	xLabel: "Time (s)",
	yLabel: "Position (m)",
	series: [
		{
			name: "Example",
			color: "#80c060",
			points: [
				{ x: 0, y: -2, error: 0.5 },
				{ x: 1, y: 4 },
			],
		},
	],
};
const diagram = {
	kind: "diagram",
	title: "Force diagram",
	objects: [{ type: "arrow", from: [0, 0], to: [0, 4], color: "#ffffff", label: "Force (N)" }],
};
const run = (input: unknown) =>
	createVisualizeToolDefinition().execute("visual-test", input as never, undefined, undefined, undefined as never);

describe("visualize tool", () => {
	it("returns versioned 2D data and a meaningful text fallback", async () => {
		const result = await run(diagram);
		expect(result.details.visualization).toEqual({ version: 2, ...diagram });
		expect(result.content).toEqual(
			expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("Force (N)") })]),
		);
	});
	it.each(["line", "scatter", "bar"])(
		"supports %s charts with units, negative data and uncertainty",
		async (chartType) => {
			const result = await run({ ...chart, chartType });
			expect(result.details.visualization).toEqual({ version: 2, ...chart, chartType });
			expect(result.content).toEqual(
				expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("Position (m)") })]),
			);
		},
	);
	it("fails closed for unknown keys, unsupported shapes, unsafe numbers and size limits", async () => {
		for (const input of [
			{ ...chart, title: " " },
			{ ...chart, xLabel: " " },
			{ ...chart, script: "anything" },
			{ ...chart, series: [{ ...chart.series[0], points: [{ x: Infinity, y: 1 }] }] },
			{ ...chart, series: [{ ...chart.series[0], points: [{ x: 0, y: 1, error: -1 }] }] },
			{ ...chart, series: [{ ...chart.series[0], points: Array.from({ length: 201 }, () => ({ x: 0, y: 0 })) }] },
			{ ...diagram, objects: [{ ...diagram.objects[0], from: [21, 0] }] },
			{ ...diagram, objects: [{ type: "svg", source: "<script>" }] },
			{ ...diagram, objects: Array.from({ length: 81 }, () => diagram.objects[0]) },
		])
			await expect(run(input)).rejects.toThrow(/Invalid/);
	});
	it("registers the presentation tool without changing the existing 3D tool", () => {
		expect(createAllToolDefinitions(process.cwd()).visualize.name).toBe("visualize");
		expect(createAllTools(process.cwd()).visualize.name).toBe("visualize");
		expect(createReadOnlyToolDefinitions(process.cwd()).map((tool) => tool.name)).toContain("visualize");
		expect(createAllToolDefinitions(process.cwd()).visualize_3d.name).toBe("visualize_3d");
	});
});
