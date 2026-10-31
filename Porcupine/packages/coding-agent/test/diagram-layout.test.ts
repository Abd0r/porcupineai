import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../src/server/diagram-layout.ts";

const measure = (text: string) => text.length * 8;

describe("diagram layout", () => {
	it("fits offset content instead of reserving a square around the origin", () => {
		const layout = layoutDiagram(
			[
				{
					type: "rectangle",
					position: [15, 10],
					size: [4, 2],
					color: "#609bd0",
					label: "Compare imagined vs real observations",
				},
			],
			640,
			measure,
		);
		expect(layout.width).toBeLessThan(400);
		expect(layout.height).toBeLessThan(220);
		expect(layout.labels[0].x).toBeCloseTo(layout.width / 2, 0);
		for (const label of layout.labels) {
			expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0);
			expect(label.x + label.width / 2).toBeLessThanOrEqual(layout.width);
			expect(label.text.replace(/\s+/g, " ")).toBe("Compare imagined vs real observations");
			expect(label.height).toBeLessThanOrEqual(2 * layout.scale - 16);
		}
	});
	it("moves an edge label away from the node it would cover", () => {
		const layout = layoutDiagram(
			[
				{ type: "rectangle", position: [0, 0], size: [4, 2], color: "#609bd0", label: "Imagine" },
				{
					type: "arrow",
					from: [-4, 0],
					to: [4, 0],
					color: "#609bd0",
					label: "Different actions, different futures?",
				},
			],
			640,
			measure,
		);
		const node = layout.labels.find((label) => label.kind === "node")!;
		const edge = layout.labels.find((label) => label.kind === "edge")!;
		expect(Math.abs(node.y - edge.y)).toBeGreaterThan(layout.scale + edge.height / 2);
	});
	it("preserves math delimiters and never shrinks text to fit a narrow viewport", () => {
		const objects = [
			{ type: "text" as const, position: [0, 0] as [number, number], text: "\\( F = m a \\)", color: "#609bd0" },
		];
		const small = layoutDiagram(objects, 240, measure),
			large = layoutDiagram(objects, 1280, measure);
		expect(small.labels[0].text).toBe(objects[0].text);
		expect(small.labels[0].width).toBe(large.labels[0].width);
		expect(small.height).toBeLessThan(100);
	});
});
