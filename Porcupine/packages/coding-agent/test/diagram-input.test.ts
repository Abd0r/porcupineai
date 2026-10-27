import { validateToolArguments } from "@porcupineai/ai";
import { describe, expect, it } from "vitest";
import { createVisualizeToolDefinition } from "../src/core/tools/visualize.ts";
import { calculusDiagram } from "./calculus-diagram-fixture.ts";

describe("diagram input", () => {
	it("accepts the reported calculus map through runtime argument preparation", async () => {
		const tool = createVisualizeToolDefinition();
		const args = tool.prepareArguments!(calculusDiagram);
		validateToolArguments(tool, { type: "toolCall", id: "calculus", name: "visualize", arguments: args });
		const result = await tool.execute("calculus", args, undefined, undefined, undefined as never);
		const visual = result.details.visualization;
		expect(visual.kind).toBe("diagram");
		if (visual.kind !== "diagram") throw Error("Expected diagram");
		expect(visual.title).toBe("Conceptual map of calculus");
		expect(visual.objects).toHaveLength(8);
		expect(visual.objects[0]).toMatchObject({ type: "rectangle", position: [0, 0], size: [4, 2], color: "#4a90d9" });
		expect(visual.objects[4]).toMatchObject({ type: "arrow", from: [-4 / 3, -1], to: [-20 / 3, -5] });
		expect(typeof calculusDiagram.objects).toBe("string");
	});
	it("gives diagram-specific errors for bad references and invalid shapes", () => {
		const tool = createVisualizeToolDefinition();
		for (const objects of [
			[{ type: "arrow", from: "missing", to: [0, 0] }],
			[{ type: "script", source: "alert(1)" }],
		]) {
			expect(() => tool.prepareArguments!({ title: "Invalid", kind: "diagram", objects })).toThrow(/diagram/i);
		}
	});
});
