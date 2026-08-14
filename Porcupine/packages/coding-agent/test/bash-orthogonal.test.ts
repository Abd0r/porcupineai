import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BashOperations, createBashTool } from "../src/core/tools/bash.ts";

function getTextOutput(result: { content?: Array<{ type: string; text?: string }>; details?: unknown }): string {
	return (
		result.content
			?.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("\n") ?? ""
	);
}

describe("bash tool orthogonal outcome reporting", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `coding-agent-bash-orthogonal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("keeps clean success output unchanged (no duplicated status)", async () => {
		const operations: BashOperations = {
			exec: async (_cmd, _cwd, { onData }) => {
				onData(Buffer.from("hello world\n", "utf-8"));
				return { exitCode: 0 };
			},
		};
		const bash = createBashTool(testDir, { operations });

		const result = await bash.execute("test-clean", { command: "echo hi" });
		expect(getTextOutput(result)).toBe("hello world\n");
	});

	it("reports a process killed by signal orthogonally from exitCode", async () => {
		const operations: BashOperations = {
			exec: async () => ({ exitCode: null, signal: "SIGKILL" }),
		};
		const bash = createBashTool(testDir, { operations });

		let error: unknown;
		try {
			await bash.execute("test-sigkill", { command: "kill -9 $$" });
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("Process killed by signal SIGKILL");
	});

	it("reports timedOut even when the process exited 0 (trapped the signal)", async () => {
		const operations: BashOperations = {
			exec: async () => ({ exitCode: 0, timedOut: true }),
		};
		const bash = createBashTool(testDir, { operations });

		let error: unknown;
		try {
			await bash.execute("test-timeout-zero", { command: "sleep 0" });
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("Command timed out");
	});

	it("reports external abort via the aborted field", async () => {
		const operations: BashOperations = {
			exec: async () => ({ exitCode: null, aborted: true }),
		};
		const bash = createBashTool(testDir, { operations });

		let error: unknown;
		try {
			await bash.execute("test-aborted", { command: "while true; do :; done" });
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("Command aborted");
	});

	it("still reports a non-zero exit code as before", async () => {
		const operations: BashOperations = {
			exec: async () => ({ exitCode: 5 }),
		};
		const bash = createBashTool(testDir, { operations });

		let error: unknown;
		try {
			await bash.execute("test-nonzero", { command: "exit 5" });
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("Command exited with code 5");
	});

	it("prefers exit code over a stale signal abbreviation when both present", async () => {
		const operations: BashOperations = {
			exec: async () => ({ exitCode: 3, signal: "SIGTERM" }),
		};
		const bash = createBashTool(testDir, { operations });

		let error: unknown;
		try {
			await bash.execute("test-both", { command: "exit 3" });
		} catch (err) {
			error = err;
		}
		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		expect(message).toContain("Command exited with code 3");
		expect(message).not.toContain("killed by signal");
	});

	it("exposes the additive fields on the exec result type without breaking legacy return shape", async () => {
		// A minimal operation returning only exitCode must still typecheck and run.
		const legacy: BashOperations = {
			exec: async (_cmd, _cwd, { onData }) => {
				onData(Buffer.from("legacy\n", "utf-8"));
				return { exitCode: 0 };
			},
		};
		const bash = createBashTool(testDir, { operations: legacy });
		const result = await bash.execute("test-legacy", { command: "cmd" });
		expect(getTextOutput(result)).toBe("legacy\n");
	});

	it("accepts the new optional fields on the exec result", async () => {
		const rich: BashOperations = {
			exec: async () => ({ exitCode: 0, timedOut: false, aborted: false, signal: null }),
		};
		const bash = createBashTool(testDir, { operations: rich });
		const result = await bash.execute("test-rich", { command: "cmd" });
		expect(getTextOutput(result)).toBe("(no output)");
	});
});
