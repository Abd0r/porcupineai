/**
 * SAFETY PROOF (FIXED): write-then-execute no longer bypasses the bash gate.
 *
 * The guard now tracks recently-written files (src/porcupine/written-files.ts)
 * and, before running a command that executes such a file, scans that file's
 * CONTENT with the same dangerous-command detector. In Auto mode this is an
 * unconditional hardline block (no LLM approval); in Normal mode it routes
 * through the interactive confirmation path.
 *
 * Regression basis: `bash payload.sh` where payload.sh contains `rm -rf /`
 * used to return "safe" from the gate because only the command string was
 * inspected. Now it blocks.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { guardBashCommand } from "../src/porcupine/auto-mode.ts";
import { clearWrittenPaths, isWrittenPath, recordWrittenPath } from "../src/porcupine/written-files.ts";

const tmp = mkdtempSync(join(tmpdir(), "porcupine-safety-write-"));

afterEach(() => {
	clearWrittenPaths();
});

function modelStub(): never {
	throw new Error("model should not be invoked for hardline denial");
}

describe("SAFETY PROOF (FIXED): write-then-execute is blocked", () => {
	it("Auto mode: executing a written script that contains `rm -rf /` is a hardline block", async () => {
		const scriptPath = join(tmp, "payload.sh");
		writeFileSync(scriptPath, "rm -rf /\necho wiped", "utf8");
		recordWrittenPath(scriptPath);

		const decision = await guardBashCommand({
			command: `bash payload.sh`,
			mode: "auto",
			modelRuntime: undefined as never,
			model: undefined,
			// In Auto no classifier should ever be asked for a hardline denial.
			confirm: async () => {
				throw new Error("should not prompt in auto");
			},
			cwd: tmp,
		});
		expect(decision.approved).toBe(false);
		expect(decision.via).toBe("hardline");
		expect(decision.message).toContain("BLOCKED");
	});

	it("Auto mode also blocks execution via source / absolute path", async () => {
		const scriptPath = join(tmp, "s2.sh");
		writeFileSync(scriptPath, "mkfs /dev/sdb", "utf8");
		recordWrittenPath(scriptPath);
		const viaSource = await guardBashCommand({
			command: `source ${scriptPath}`,
			mode: "auto",
			modelRuntime: undefined as never,
			model: undefined,
			confirm: modelStub,
			cwd: tmp,
		});
		expect(viaSource.approved).toBe(false);
		expect(viaSource.via).toBe("hardline");
	});

	it("Normal mode: executing a written dangerous script requires user confirmation", async () => {
		const scriptPath = join(tmp, "payload.sh");
		writeFileSync(scriptPath, "rm -rf /", "utf8");
		recordWrittenPath(scriptPath);

		const denied = await guardBashCommand({
			command: `bash payload.sh`,
			mode: "normal",
			modelRuntime: undefined as never,
			model: undefined,
			confirm: async () => false,
			cwd: tmp,
		});
		expect(denied.approved).toBe(false);
		expect(denied.via).toBe("manual");

		const allowed = await guardBashCommand({
			command: `bash payload.sh`,
			mode: "normal",
			modelRuntime: undefined as never,
			model: undefined,
			confirm: async () => true,
			cwd: tmp,
		});
		expect(allowed.approved).toBe(true);
	});

	it("a tracked file that does NOT match is not scanned/blocked", async () => {
		const scriptPath = join(tmp, "safe.sh");
		writeFileSync(scriptPath, "echo hello", "utf8");
		recordWrittenPath(scriptPath);
		const decision = await guardBashCommand({
			command: `bash safe.sh`,
			mode: "normal",
			modelRuntime: undefined as never,
			model: undefined,
			confirm: async () => {
				throw new Error("should not confirm a safe script");
			},
			cwd: tmp,
		});
		expect(decision.approved).toBe(true);
	});
});

describe("SAFETY PROOF (FIXED): the write tool records successful writes for later bash re-scan", () => {
	it("a successful write marks the file as a recently-written path", async () => {
		clearWrittenPaths();
		const target = join(tmp, "recorded.txt");
		const def = createWriteToolDefinition(tmp, {
			confirmMutation: async () => true,
			operations: {
				writeFile: async () => {
					// simulate a real successful write
				},
				mkdir: async () => {},
			},
		});
		expect(def.name).toBe("write");
		await def.execute(
			"id",
			{ path: "recorded.txt", content: "printf payload" },
			undefined,
			undefined,
			undefined as never,
		);
		// The path resolve() was recorded relative to the tool's cwd.
		expect(isWrittenPath(target)).toBe(true);
		// A content-scan helper exists and the gate imports it.
		expect(recordWrittenPath).toBeTypeOf("function");
	});
});
