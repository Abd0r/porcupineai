import { afterEach, describe, expect, it } from "vitest";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { createHarness, fauxModel } from "./test-harness.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});
describe("live workbench session surfaces", () => {
	it("reads and applies actual reasoning/autonomy settings, not browser-only state", async () => {
		const harness = await createHarness({ model: { ...fauxModel, reasoning: true } });
		cleanups.push(harness.cleanup);
		const adapted = adaptSessionToServeApi(harness.session);
		expect(adapted.getControls?.().interactionMode).toBe(harness.session.interactionMode);
		adapted.configure?.({ interactionMode: "ask" });
		expect(harness.session.interactionMode).toBe("ask");
		adapted.configure?.({ reasoningMode: "adaptive" });
		expect(harness.session.getReasoningMode()).toBe("adaptive");
		adapted.configure?.({ reasoningMode: "off" });
		expect(harness.session.getReasoningMode()).toBe("off");
	});
	it("lists the actual configured tools without executing them", async () => {
		const harness = await createHarness();
		cleanups.push(harness.cleanup);
		const adapted = adaptSessionToServeApi(harness.session),
			expected = harness.session
				.getAllTools()
				.map((tool) => tool.name)
				.sort();
		const result = adapted.getCatalog?.("tools", "", 0, 5000);
		expect(result?.entries.map((entry) => entry.name).sort()).toEqual(expected);
		expect(harness.faux.callCount).toBe(0);
	});
});
