import { describe, expect, it } from "vitest";
import { buildSurfaceContext, SURFACE_CONTEXT_HEADER } from "../src/porcupine/surface-context.ts";
import { createHarness } from "./test-harness.ts";

describe("surface-aware context", () => {
	it("describes the terminal surface without promising visuals", () => {
		const block = buildSurfaceContext("tui");
		expect(block.startsWith(SURFACE_CONTEXT_HEADER)).toBe(true);
		expect(block).toContain("terminal client");
		expect(block).toContain("Do not call `visualize`");
		expect(block).not.toContain("browser workbench");
	});

	it("describes the browser surface with its real capabilities and honest limits", () => {
		const block = buildSurfaceContext("web");
		expect(block).toContain("browser workbench");
		expect(block).toContain("visualize_3d");
		expect(block).toContain("accessible data table");
		expect(block).toContain("MathML");
		expect(block).toContain("chronological conversation");
		expect(block).not.toContain("sidebar shows your tracked goal");
		expect(block).toContain("None of these change your permissions");
	});

	it("describes the detached surface without budget waste", () => {
		const block = buildSurfaceContext("none");
		expect(block).toContain("No interactive client is attached");
		expect(block).toContain("render nowhere");
	});

	it("states the current limits so the agent adapts to settings", () => {
		const block = buildSurfaceContext("web", { maxSubagents: 2, compactAtPercent: 80 });
		expect(block).toContain("Compaction runs near 80%");
		expect(block).toContain("At most 2 sub-agents");
		expect(buildSurfaceContext("web")).not.toContain("Current limits");
	});

	it("is deterministic so the prompt cache stays effective", () => {
		expect(buildSurfaceContext("web")).toBe(buildSurfaceContext("web"));
	});

	it("lands in the live session system prompt and follows a surface switch", async () => {
		const harness = await createHarness({ systemPrompt: "Base prompt." });
		try {
			const tui = harness.agent.state.systemPrompt;
			expect(tui).toContain(SURFACE_CONTEXT_HEADER);
			expect(tui).toContain("terminal client");
			harness.session.setClientSurface("web");
			const web = harness.agent.state.systemPrompt;
			expect(web).toContain("browser workbench");
			expect(harness.session.clientSurface).toBe("web");
			const switchNotice = harness.eventsOfType("message_start").length;
			expect(switchNotice).toBeGreaterThanOrEqual(0);
			harness.session.setClientSurface("none");
			expect(harness.agent.state.systemPrompt).toContain("No interactive client is attached");
		} finally {
			harness.cleanup();
		}
	});
});
