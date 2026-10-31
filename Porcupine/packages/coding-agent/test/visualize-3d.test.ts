import { describe, expect, it } from "vitest";
import { allToolNames, createAllToolDefinitions, createTool, createToolDefinition } from "../src/core/tools/index.ts";
import { createVisualize3DToolDefinition } from "../src/core/tools/visualize-3d.ts";

const scene = {
	title: "A small block world",
	description: "The green block sits above the blue ground plane.",
	objects: [
		{ type: "box", position: [0, 1, 0], size: [1, 1, 1], color: "#80c060", label: "block" },
		{ type: "box", position: [0, -1, 0], size: [6, 0.2, 6], color: "#4878a8", label: "ground" },
		{ type: "arrow", from: [0, 0, 0], to: [1, 2, 0], color: "#f0a050", label: "up" },
	],
} as const;

describe("visualize_3d tool", () => {
	it("returns a bounded declarative scene for supported renderers", async () => {
		const definition = createVisualize3DToolDefinition();
		const result = await definition.execute("call-1", scene as never, undefined, undefined, undefined as never);

		expect(definition.name).toBe("visualize_3d");
		expect(result.details.visualization).toEqual({ version: 1, ...scene });
		expect(result.content[0]).toMatchObject({ type: "text" });
	});

	it("rejects unsupported shapes, unbounded values, and unknown properties", async () => {
		const definition = createVisualize3DToolDefinition();
		const invalid = [
			{ ...scene, title: "   " },
			{ ...scene, objects: [{ type: "mesh", source: "<script>" }] },
			{ ...scene, objects: Array.from({ length: 2001 }, () => scene.objects[0]) },
			{ ...scene, objects: [{ type: "sphere", position: [0, 0, 0], radius: 1000, color: "#ffffff" }] },
			{ ...scene, surprise: "ignored?" },
		];

		for (const input of invalid) {
			await expect(
				definition.execute("call-invalid", input as never, undefined, undefined, undefined as never),
			).rejects.toThrow(/unsupported 3D scene/);
		}
	});

	it("registers in every built-in tool lookup", () => {
		expect(allToolNames.has("visualize_3d")).toBe(true);
		expect(createAllToolDefinitions(process.cwd()).visualize_3d.name).toBe("visualize_3d");
		expect(createToolDefinition("visualize_3d", process.cwd()).name).toBe("visualize_3d");
		expect(createTool("visualize_3d", process.cwd()).name).toBe("visualize_3d");
	});
});
