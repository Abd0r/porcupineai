import { describe, expect, it } from "vitest";
import { createWorkbenchCommands } from "../src/server/workbench-commands.ts";
import { createHarness } from "./test-harness.ts";

describe("GUI slash commands", () => {
	it("lists actual commands and changes real session settings without a model turn", async () => {
		const h = await createHarness();
		try {
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			expect((await commands.execute("/commands")).text).toContain("/reasoning");
			await commands.execute("/name Research");
			expect(h.session.sessionName).toBe("Research");
			await commands.execute("/reasoning adaptive");
			expect(h.session.getReasoningMode()).toBe("adaptive");
			expect((await commands.execute("/session")).text).toContain(h.session.sessionId);
			expect((await commands.execute("/login")).text).toContain("terminal");
			expect(h.faux.callCount).toBe(0);
		} finally {
			h.cleanup();
		}
	});
});
