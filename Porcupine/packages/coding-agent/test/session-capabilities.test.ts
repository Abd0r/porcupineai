import { describe, expect, it } from "vitest";
import { artifactChangeFromToolCall, buildCapabilityTreeFromSession } from "../src/porcupine/session-capabilities.ts";

describe("Porcupine session bridge", () => {
	it("builds a capability tree from tools and skills", () => {
		const tree = buildCapabilityTreeFromSession({
			tools: [
				{ name: "edit", description: "Edit files", available: true },
				{ name: "bash", description: "Run shell commands", available: true },
			],
			skills: [{ name: "review", description: "Code review workflow" }],
		});

		const editMatches = tree.search("edit files");
		expect(editMatches.some((match) => match.capability.id === "tool:edit")).toBe(true);

		const skillMatches = tree.search("review");
		expect(skillMatches.some((match) => match.capability.id === "skill:review")).toBe(true);
	});

	it("derives artifact changes from write tool calls", () => {
		const change = artifactChangeFromToolCall("write", { path: "notes.md", content: "hello\nworld\n" }, false);

		expect(change).toMatchObject({
			path: "notes.md",
			operation: "created",
			linesAdded: 2,
		});
		expect(change?.additions).toEqual(["hello", "world"]);
	});

	it("derives artifact changes from edit tool calls", () => {
		const change = artifactChangeFromToolCall(
			"edit",
			{
				path: "src/app.ts",
				edits: [{ oldText: "const x = 1;", newText: "const x = 2;" }],
			},
			false,
		);

		expect(change).toMatchObject({
			path: "src/app.ts",
			operation: "updated",
			linesAdded: 1,
			linesRemoved: 1,
		});
	});

	it("ignores failed tool calls", () => {
		expect(artifactChangeFromToolCall("write", { path: "x.ts", content: "x" }, true)).toBeUndefined();
	});
});
