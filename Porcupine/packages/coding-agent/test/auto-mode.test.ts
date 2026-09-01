import { describe, expect, it } from "vitest";
import { AUTO_MODE_AUTONOMY_DIRECTIVE, detectDangerousCommand, guardBashCommand } from "../src/porcupine/auto-mode.ts";

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

	it("hardline-blocks direct overwrites of protected paths", () => {
		for (const command of ["echo x > /etc/hosts", "printf x > ~/.ssh/config", "echo x > /System/example"]) {
			expect(detectDangerousCommand(command)).toMatchObject({
				patternKey: "overwrite-protected-path",
				hardline: true,
			});
		}
		expect(detectDangerousCommand("echo x > /tmp/out")).toBeNull();
	});

	it("reuses a short-lived Auto verdict for the exact same flagged command", async () => {
		let calls = 0;
		const modelRuntime = {
			completeSimple: async () => {
				calls += 1;
				return { content: "APPROVE" };
			},
		} as any;
		const model = { provider: "test", id: `cache-${Date.now()}` } as any;
		const command = `sudo echo cache-${Date.now()}`;

		await guardBashCommand({ command, mode: "auto", modelRuntime, model });
		await guardBashCommand({ command, mode: "auto", modelRuntime, model });

		expect(calls).toBe(1);
	});
});
