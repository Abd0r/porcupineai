import { describe, expect, it } from "vitest";
import { createVisualizeToolDefinition } from "../src/core/tools/visualize.ts";

import { workspaceExamples } from "./adaptive-workspace-fixtures.ts";

const run = (input: unknown) =>
	createVisualizeToolDefinition().execute("fixture", input as never, undefined, undefined, undefined as never);
describe("adaptive workspaces", () => {
	it.each(workspaceExamples)("presents bounded $kind components", async (example) => {
		const input = { ...example, title: "Workspace", componentId: example.kind };
		expect((await run(input)).details.visualization).toEqual({ version: 2, ...input });
	});
	it("rejects inconsistent data and executable payloads", async () => {
		for (const input of [
			{ kind: "table", columns: ["A"], rows: [[1, 2]] },
			{ kind: "form", fields: [{ type: "choice", label: "Empty" }] },
			{ kind: "graph", nodes: [{ id: "a", label: "A", detail: "A" }], edges: [{ from: "a", to: "unknown" }] },
			{
				kind: "evidence",
				claims: [{ claim: "X", evidence: "Y", source: "Z", url: "javascript:alert(1)", confidence: "high" }],
			},
			{ ...workspaceExamples[10], script: "alert(1)" },
		])
			await expect(run({ ...input, title: "Invalid" })).rejects.toThrow();
	});
});
