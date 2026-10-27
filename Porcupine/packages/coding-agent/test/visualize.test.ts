import { validateToolArguments } from "@porcupineai/ai";
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
	it("accepts JSON-encoded array arguments before runtime schema validation", async () => {
		const tool = createVisualizeToolDefinition();
		const input = { ...diagram, objects: JSON.stringify([{ ...diagram.objects[0], from: "[0,0]", to: "[0,4]" }]) };
		const prepared = tool.prepareArguments?.(input) ?? input;
		const args = validateToolArguments(tool, {
			type: "toolCall",
			id: "encoded",
			name: tool.name,
			arguments: prepared,
		});
		expect((await run(args)).details.visualization).toEqual({ version: 2, ...diagram });
		expect(typeof input.objects).toBe("string");
		const chartInput = {
			...chart,
			series: JSON.stringify([{ ...chart.series[0], points: JSON.stringify(chart.series[0].points) }]),
		};
		const chartArgs = validateToolArguments(tool, {
			type: "toolCall",
			id: "chart",
			name: tool.name,
			arguments: tool.prepareArguments!(chartInput),
		});
		expect((await run(chartArgs)).details.visualization).toEqual({ version: 2, ...chart });
		for (const objects of ["invalid json", '{"type":"arrow"}', '[{"type":"script"}]']) {
			expect(() =>
				validateToolArguments(tool, {
					type: "toolCall",
					id: "bad",
					name: tool.name,
					arguments: tool.prepareArguments!({ ...diagram, objects }),
				}),
			).toThrow();
		}
	});
	it("validates quiz answer keys before presenting scored questions", async () => {
		const quiz = {
			kind: "quiz",
			title: "Physics",
			questions: [
				{
					question: "Unit of force?",
					options: ["Newton", "Joule"],
					correctAnswers: [0],
					explanation: "Force is measured in newtons.",
				},
			],
		};
		expect((await run(quiz)).details.visualization).toEqual({ version: 2, ...quiz });
		for (const correctAnswers of [[2], [], [0, 0]])
			await expect(run({ ...quiz, questions: [{ ...quiz.questions[0], correctAnswers }] })).rejects.toThrow();
	});
	it("creates choice and written-answer cards without inventing an answer", async () => {
		for (const options of [[], ["Mass", "Velocity"]]) {
			const input = { kind: "question", title: "Check understanding", question: "What changes?", options };
			const result = await run(input);
			expect(result.details.visualization).toEqual({ version: 2, ...input });
			expect(result.content[0]).toHaveProperty(
				"text",
				expect.stringContaining("Wait for the user's submitted answer"),
			);
		}
		await expect(run({ kind: "question", title: "Quiz", question: "?", options: [" "] })).rejects.toThrow();
	});
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
