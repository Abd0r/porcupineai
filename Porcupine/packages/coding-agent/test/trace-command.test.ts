import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
	extractTrajectory,
	formatTraceAll,
	formatTraceStep,
	parseTraceSelection,
	resolveTraceStep,
	TRACE_NO_DATA_MESSAGE,
} from "../src/modes/interactive/trace-command.ts";

const tempRoots: string[] = [];

function tempSessionDir(): string {
	const dir = join(tmpdir(), `porcupine-trace-command-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempRoots.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempRoots) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
	tempRoots.length = 0;
});

function sha1(text: string): string {
	return createHash("sha1").update(text).digest("hex");
}

/** Seed a real session with one system prompt snapshot and two request headers. */
function seedTraceSession(): { manager: SessionManager; prompt: string } {
	const manager = SessionManager.create("/tmp", tempSessionDir());
	const prompt = "You are the trajectory agent.";
	const hash = sha1(prompt);
	manager.appendSystemPrompt(prompt, hash, "session-start");
	manager.appendRequestHeader({
		model: "deepseek-v4-flash",
		provider: "deepseek",
		thinkingLevel: "high",
		promptHash: hash,
		toolNames: ["read", "bash"],
	});
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() });
	manager.appendRequestHeader({
		model: "deepseek-v4-flash",
		provider: "deepseek",
		thinkingLevel: "low",
		promptHash: hash,
		toolNames: ["read", "edit"],
	});
	return { manager, prompt };
}

describe("parseTraceSelection", () => {
	test("no argument selects the last step", () => {
		expect(parseTraceSelection("")).toEqual({ kind: "last" });
		expect(parseTraceSelection("  ")).toEqual({ kind: "last" });
	});

	test('"all" selects the all-steps listing', () => {
		expect(parseTraceSelection("all")).toEqual({ kind: "all" });
	});

	test("a positive integer selects that 1-based step", () => {
		expect(parseTraceSelection("2")).toEqual({ kind: "index", index: 2 });
	});

	test("rejects non-numeric and non-positive arguments", () => {
		expect(parseTraceSelection("0")).toEqual({ kind: "invalid", reason: expect.any(String) });
		expect(parseTraceSelection("-1")).toEqual({ kind: "invalid", reason: expect.any(String) });
		expect(parseTraceSelection("banana")).toEqual({ kind: "invalid", reason: expect.any(String) });
	});
});

describe("builds a trajectory report from system_prompt + request_header entries", () => {
	test("extractTrajectory pairs each request_header with its prompt snapshot", () => {
		const { manager, prompt } = seedTraceSession();
		const data = extractTrajectory(manager.getEntries());

		expect(data.steps.length).toBe(2);
		expect(data.promptCount).toBe(1);

		const first = data.steps[0]!;
		expect(first.stepIndex).toBe(1);
		expect(first.model).toBe("deepseek-v4-flash");
		expect(first.provider).toBe("deepseek");
		expect(first.thinkingLevel).toBe("high");
		expect(first.toolNames).toEqual(["read", "bash"]);
		expect(first.promptHash).toBe(sha1(prompt));
		// The full prompt is attached for a step with a preceding snapshot.
		expect(first.promptText).toBe(prompt);
		expect(first.promptReason).toBe("session-start");

		const second = data.steps[1]!;
		expect(second.thinkingLevel).toBe("low");
		expect(second.toolNames).toEqual(["read", "edit"]);
	});

	test("formatTraceStep includes model, thinking level, tools, prompt hash, and full prompt", () => {
		const { manager, prompt } = seedTraceSession();
		const data = extractTrajectory(manager.getEntries());
		const resolved = resolveTraceStep(data, { kind: "index", index: 1 });

		expect(resolved.kind).toBe("step");
		if (resolved.kind !== "step") return;

		const report = formatTraceStep(data, resolved.step);
		expect(report).toContain("deepseek-v4-flash");
		expect(report).toContain("high");
		expect(report).toContain("read, bash");
		expect(report).toContain(sha1(prompt));
		expect(report).toContain(prompt);
	});

	test("messages in a step span are surfaced", () => {
		const { manager } = seedTraceSession();
		const data = extractTrajectory(manager.getEntries());
		// The user message logged after the first header belongs to step 1.
		expect(data.steps[0]!.messageRoles).toContain("user");
	});
});

describe("empty / pre-traceability session", () => {
	test("extractTrajectory yields no steps and the clear no-data message exists", () => {
		const manager = SessionManager.create("/tmp", tempSessionDir());
		const data = extractTrajectory(manager.getEntries());
		expect(data.steps).toEqual([]);
		expect(data.promptCount).toBe(0);
		expect(TRACE_NO_DATA_MESSAGE).toContain("no request headers");
	});

	test("/trace all on an empty session prints the bounded no-steps line", () => {
		const manager = SessionManager.create("/tmp", tempSessionDir());
		const data = extractTrajectory(manager.getEntries());
		const all = formatTraceAll(data);
		expect(all).toContain("No model steps have been logged yet.");
	});
});

describe("out-of-range index errors", () => {
	test("resolveTraceStep reports an index beyond the trajectory", () => {
		const { manager } = seedTraceSession();
		const data = extractTrajectory(manager.getEntries());
		const resolved = resolveTraceStep(data, { kind: "index", index: 99 });
		expect(resolved).toEqual({ kind: "out-of-range", total: 2, requested: 99 });
	});

	test("resolveTraceStep on a valid index resolves to that step", () => {
		const { manager } = seedTraceSession();
		const data = extractTrajectory(manager.getEntries());
		const resolved = resolveTraceStep(data, { kind: "index", index: 2 });
		expect(resolved.kind).toBe("step");
		if (resolved.kind === "step") {
			expect(resolved.step.stepIndex).toBe(2);
		}
	});
});

describe("/trace all lists one line per step", () => {
	test("formatTraceAll emits one line per step with model, thinking, tools, and short hash", () => {
		const { manager, prompt } = seedTraceSession();
		const data = extractTrajectory(manager.getEntries());
		const all = formatTraceAll(data);

		expect(all).toContain("2 step(s)");
		// One bullet line per step.
		const bulletCount = (all.match(/^- .*/gm) ?? []).length;
		expect(bulletCount).toBe(2);
		expect(all).toContain("deepseek-v4-flash");
		expect(all).toContain("thinking=high");
		expect(all).toContain("tools=[read, bash]");
		expect(all).toContain(`prompt=${sha1(prompt).slice(0, 7)}`);
	});
});
