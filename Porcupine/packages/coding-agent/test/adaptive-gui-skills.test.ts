import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/core/skills.ts";
import { createVisualizeToolDefinition } from "../src/core/tools/visualize.ts";
import { createVisualize3DToolDefinition } from "../src/core/tools/visualize-3d.ts";
import { buildCapabilityTreeFromSession } from "../src/porcupine/session-capabilities.ts";

describe("bundled adaptive GUI skills", () => {
	for (const name of ["adaptive-gui", "adaptive-learning"]) {
		const dir = resolve(__dirname, "../skills/docs", name);
		it(`discovers ${name} in the shared capability catalog`, () => {
			const { skills, diagnostics } = loadSkillsFromDir({ dir, source: "test" });
			expect(diagnostics).toEqual([]);
			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe(name);
			expect(skills[0].disableModelInvocation).toBe(false);
			const tree = buildCapabilityTreeFromSession({ tools: [], skills });
			expect(tree.search("Adaptive GUI").map((match) => match.capability.id)).toContain(`skill:${name}`);
		});
		it(`executes every ${name} example through the real tool validation`, async () => {
			const examples: Array<{ tool: string; input: Record<string, unknown> }> = JSON.parse(
				readFileSync(resolve(dir, "references/tool-examples.json"), "utf8"),
			);
			expect(examples.length).toBeGreaterThan(0);
			for (const example of examples) {
				if (example.tool === "visualize_3d") {
					const tool = createVisualize3DToolDefinition();
					const args = tool.prepareArguments!(example.input);
					const result = await tool.execute("example", args, undefined, undefined, undefined as never);
					expect(result.details.visualization?.version).toBe(1);
				} else {
					expect(example.tool).toBe("visualize");
					const tool = createVisualizeToolDefinition();
					const args = tool.prepareArguments!(example.input);
					const result = await tool.execute("example", args, undefined, undefined, undefined as never);
					expect(result.details.visualization.version).toBe(2);
				}
			}
		});
	}
});
