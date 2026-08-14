import { describe, expect, test } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { DANGEROUS_RULES, guardBashCommand, HARDLINE_RULES } from "../src/porcupine/auto-mode.ts";

/** Minimal model runtime stub: guardBashCommand only calls it for Auto classify. */
const modelRuntime = {} as ModelRuntime;
const model = undefined;

const HARD_COMMANDS: Array<{ cmd: string; key: string }> = [
	{ cmd: "rm -rf /", key: "rm-rf-root" },
	{ cmd: "rm -f /", key: "rm-root" },
	{ cmd: "mkfs.ext4 /dev/sda1", key: "mkfs" },
	{ cmd: "dd if=/dev/zero of=/dev/sda bs=1M", key: "dd-device" },
	{ cmd: ":(){ :|:& };:", key: "fork-bomb" },
	{ cmd: "shutdown -h now", key: "power" },
	{ cmd: "kill -9 -1", key: "kill-all" },
	{ cmd: "init 0", key: "sysv-poweroff" },
];

describe("monotonic hardline policy (dsh lesson 10)", () => {
	test("hardline rule list is frozen", () => {
		expect(Object.isFrozen(HARDLINE_RULES)).toBe(true);
		expect(Object.isFrozen(DANGEROUS_RULES)).toBe(true);
	});

	test("hardline rules cannot be mutated (monotonic: deny cannot be loosened)", () => {
		expect(() => {
			(HARDLINE_RULES as unknown as unknown[]).push({ re: /never/, key: "x", description: "y" });
		}).toThrow(TypeError);
		expect(() => {
			(DANGEROUS_RULES as unknown as unknown[]).length = 0;
		}).toThrow(TypeError);
	});

	test("every hardline command is denied in every mode, even with a confirming human", async () => {
		for (const { cmd } of HARD_COMMANDS) {
			for (const mode of ["ask", "normal", "auto"] as const) {
				const decision = await guardBashCommand({
					command: cmd,
					mode,
					modelRuntime,
					model,
					confirm: async () => true,
					cwd: process.cwd(),
				});
				expect(decision.approved, `${mode} must deny: ${cmd}`).toBe(false);
				expect(decision.via, `${mode} must hardline: ${cmd}`).toBe("hardline");
			}
		}
	});

	test("hardline denial is not overridable by the confirm callback (normal/ask)", async () => {
		let confirmCalled = false;
		const decision = await guardBashCommand({
			command: "rm -rf /",
			mode: "ask",
			modelRuntime,
			model,
			confirm: async () => {
				confirmCalled = true;
				return true;
			},
			cwd: process.cwd(),
		});
		expect(confirmCalled).toBe(false);
		expect(decision).toMatchObject({ approved: false, via: "hardline" });
	});

	test("normal-mode flagged commands still ask the human (not hardline)", async () => {
		let confirmCalled = false;
		const decision = await guardBashCommand({
			command: "sudo apt install vim",
			mode: "normal",
			modelRuntime,
			model,
			confirm: async () => {
				confirmCalled = true;
				return true;
			},
			cwd: process.cwd(),
		});
		expect(confirmCalled).toBe(true);
		expect(decision.approved).toBe(true);
	});

	test("path-equivalence variants of rm -rf / still hardline", async () => {
		for (const cmd of ["rm -rf //", "rm -rf /./", "rm -rf -- /", "rm -rf '/'", "rm -rf / && echo done"]) {
			const decision = await guardBashCommand({ command: cmd, mode: "auto", modelRuntime, model, cwd: "/tmp" });
			expect(decision.approved, `${cmd} must be denied`).toBe(false);
			expect(decision.via, `${cmd} must hardline`).toBe("hardline");
		}
	});
});
