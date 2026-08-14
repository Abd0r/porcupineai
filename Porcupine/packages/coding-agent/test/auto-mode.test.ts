import { describe, expect, it } from "vitest";
import { AUTO_MODE_AUTONOMY_DIRECTIVE } from "../src/porcupine/auto-mode.ts";

describe("Auto Mode autonomy directive", () => {
	it("exposes a non-empty directive telling the agent to operate autonomously", () => {
		expect(AUTO_MODE_AUTONOMY_DIRECTIVE).toContain("<porcupine_auto_mode>");
		expect(AUTO_MODE_AUTONOMY_DIRECTIVE).toContain("Auto Mode is enabled");
		expect(AUTO_MODE_AUTONOMY_DIRECTIVE).toContain("autonomous initiative");
	});

	it("keeps hardline destructive boundaries explicit in the directive", () => {
		expect(AUTO_MODE_AUTONOMY_DIRECTIVE).toContain("rm -rf /");
		expect(AUTO_MODE_AUTONOMY_DIRECTIVE).toContain("Force-push");
	});
});
