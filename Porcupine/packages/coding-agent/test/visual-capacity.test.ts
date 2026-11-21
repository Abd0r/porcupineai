import { describe, expect, it } from "vitest";
import { createVisualizeToolDefinition } from "../src/core/tools/visualize.ts";
import { createVisualize3DToolDefinition } from "../src/core/tools/visualize-3d.ts";

const run = (input: unknown) =>
	createVisualizeToolDefinition().execute("capacity", input as never, undefined, undefined, undefined as never);
describe("larger scientific and study workspaces", () => {
	it("prepares dense encoded series and enforces the total sample budget", async () => {
		const tool = createVisualizeToolDefinition(),
			series = {
				name: "Supplied",
				color: "#247abe",
				points: Array.from({ length: 2000 }, (_, x) => ({
					x,
					y: x,
					label: "Measured sample with an explicit annotation on the plot",
				})),
			},
			base = { kind: "chart", title: "Dense", chartType: "line", xLabel: "x", yLabel: "y" };
		expect(JSON.stringify(series).length).toBeGreaterThan(128000);
		const prepared = tool.prepareArguments!({ ...base, series: JSON.stringify([series]) });
		await expect(run(prepared)).resolves.toBeDefined();
		await expect(
			run({
				...base,
				series: Array.from({ length: 5 }, () => ({
					...series,
					points: Array.from({ length: 10000 }, (_, x) => ({ x, y: x })),
				})),
			}),
		).rejects.toThrow("40000");
	});
	it("samples mathematical chart expressions without executing JavaScript", async () => {
		const base = {
			kind: "chart",
			title: "Wave",
			chartType: "line",
			xLabel: "x",
			yLabel: "density",
			series: [{ name: "psi", color: "#247abe", expression: "sin(pi*x)^2", domain: [0, 1], samples: 1001 }],
		};
		const result = await run(base);
		const spec = result.details.visualization;
		expect(spec.kind).toBe("chart");
		if (spec.kind !== "chart") throw new Error("Missing chart");
		expect(spec.series[0].points).toHaveLength(1001);
		expect(spec.series[0].points[500].y).toBeCloseTo(1);
		expect(JSON.stringify(result.content).length).toBeLessThan(10000);
		for (const expression of ["globalThis.process.exit()", "x.constructor", "sin(x);alert(1)", "1/0"])
			await expect(run({ ...base, series: [{ ...base.series[0], expression }] })).rejects.toThrow();
	});
	it("accepts dense measured data and expanded decks", async () => {
		await expect(
			run({
				kind: "chart",
				title: "Measured",
				chartType: "line",
				xLabel: "t",
				yLabel: "y",
				series: Array.from({ length: 12 }, (_, i) => ({
					name: String(i),
					color: "#247abe",
					points: Array.from({ length: 1000 }, (_, x) => ({ x, y: Math.sin(x) })),
				})),
			}),
		).resolves.toBeDefined();
		await expect(
			run({
				kind: "quiz",
				title: "Study",
				questions: Array.from({ length: 50 }, (_, i) => ({
					question: String(i),
					options: ["a", "b"],
					correctAnswers: [0],
					explanation: "a",
				})),
			}),
		).resolves.toBeDefined();
		await expect(
			run({
				kind: "flashcards",
				title: "Study",
				cards: Array.from({ length: 250 }, (_, i) => ({ front: String(i), back: "Answer" })),
			}),
		).resolves.toBeDefined();
	});
	it("allows parameterized expression simulations", async () => {
		await expect(
			run({
				kind: "simulation",
				title: "Wave packet",
				model: "expression",
				expression: { x: "t", y: "exp(-a*t^2)*cos(t)", duration: 20, samples: 1000 },
				parameters: [{ name: "a", label: "Width", min: 0.1, max: 2, value: 1, step: 0.1 }],
			}),
		).resolves.toBeDefined();
	});
	it("accepts molecular bonds and dense scenes", async () => {
		const tool = createVisualize3DToolDefinition();
		await expect(
			tool.execute(
				"molecule",
				{
					title: "Molecule",
					objects: [
						{ type: "bond", from: [0, 0, 0], to: [1, 1, 0], radius: 0.1, color: "#888888" },
						...Array.from({ length: 100 }, () => ({
							type: "sphere",
							position: [0, 0, 0],
							radius: 0.2,
							color: "#247abe",
						})),
					],
				} as never,
				undefined,
				undefined,
				undefined as never,
			),
		).resolves.toBeDefined();
	});
});
