import { describe, expect, it } from "vitest";
import { createRepeatToolGuard } from "../src/porcupine/repeat-tool-guard.ts";

describe("createRepeatToolGuard", () => {
	it("returns null until the first threshold is reached", () => {
		const guard = createRepeatToolGuard();
		expect(guard.observe("read", { path: "a.ts" })).toBeNull();
		expect(guard.observe("read", { path: "a.ts" })).toBeNull();
	});

	it("escalates at each default threshold for identical calls", () => {
		const guard = createRepeatToolGuard();
		const first = guard.observe("read", { path: "a.ts" });
		const second = guard.observe("read", { path: "a.ts" });
		const third = guard.observe("read", { path: "a.ts" });

		expect(first).toBeNull();
		expect(second).toBeNull();
		expect(third).toMatch(/3 times/);
		expect(third).toContain("read");

		// Continue calling; threshold 5 and 8 should fire in turn.
		let msg: string | null = null;
		for (let i = 4; i <= 8; i++) {
			msg = guard.observe("read", { path: "a.ts" });
			if (i === 5) expect(msg).toMatch(/5 times/);
			if (i === 6 || i === 7) expect(msg).toBeNull();
			if (i === 8) expect(msg).toContain("8");
		}
		expect(msg).not.toBeNull();
	});

	it("fires at custom thresholds", () => {
		const guard = createRepeatToolGuard({ thresholds: [2, 4] });
		expect(guard.observe("ls", { path: "/" })).toBeNull();
		expect(guard.observe("ls", { path: "/" })).toMatch(/2 times/);
		expect(guard.observe("ls", { path: "/" })).toBeNull();
		expect(guard.observe("ls", { path: "/" })).toMatch(/4 times/);
	});

	it("treats canonically-identical args as the same call", () => {
		const guard = createRepeatToolGuard({ thresholds: [3] });
		// Key order differs but values match.
		guard.observe("edit", { oldText: "a", newText: "b" });
		guard.observe("edit", { newText: "b", oldText: "a" });
		expect(guard.observe("edit", { oldText: "a", newText: "b" })).toMatch(/3 times/);
	});

	it("compares args literally so different values are not conflated", () => {
		const guard = createRepeatToolGuard({ thresholds: [2] });
		guard.observe("bash", { command: "ls" });
		expect(guard.observe("bash", { command: "pwd" })).toBeNull();
	});

	it("resets after a different tool", () => {
		const guard = createRepeatToolGuard({ thresholds: [2] });
		guard.observe("read", { path: "a.ts" });
		guard.observe("write", { path: "b.ts" });
		expect(guard.observe("read", { path: "a.ts" })).toBeNull();
	});

	it("resets after a different tool with same args", () => {
		const guard = createRepeatToolGuard({ thresholds: [2] });
		guard.observe("read", { path: "a.ts" });
		guard.observe("write", { path: "a.ts" });
		expect(guard.observe("read", { path: "a.ts" })).toBeNull();
	});

	it("resets after the same tool with differing args", () => {
		const guard = createRepeatToolGuard({ thresholds: [2] });
		guard.observe("bash", { command: "ls" });
		expect(guard.observe("bash", { command: "pwd" })).toBeNull();
		expect(guard.observe("bash", { command: "ls" })).toBeNull();
	});

	it("never counts excluded tools even when repeated identically", () => {
		const guard = createRepeatToolGuard({ thresholds: [2], exclude: ["todo_write"] });
		expect(guard.observe("todo_write", { message: "x" })).toBeNull();
		expect(guard.observe("todo_write", { message: "x" })).toBeNull();
		expect(guard.observe("todo_write", { message: "x" })).toBeNull();
	});

	it("handles non-JSON args safely without throwing", () => {
		const guard = createRepeatToolGuard({ thresholds: [3] });
		const weird: Record<string, unknown> = {};
		const cyclicChild: Record<string, unknown> = { b: 1 };
		cyclicChild.self = cyclicChild;
		weird.undefinedVal = undefined;
		weird.fn = () => 1;
		weird.big = 10n;
		weird.cycle = cyclicChild;

		expect(() => guard.observe("bash", weird)).not.toThrow();
		expect(guard.observe("bash", weird)).toBeNull();
		// Third identical-canonicalized call triggers escalation.
		expect(guard.observe("bash", weird)).toMatch(/3 times/);
	});

	it("handles undefined and null args", () => {
		const guard = createRepeatToolGuard({ thresholds: [2] });
		expect(guard.observe("bash", undefined)).toBeNull();
		expect(guard.observe("bash", undefined)).toMatch(/2 times/);

		const nullGuard = createRepeatToolGuard({ thresholds: [2] });
		expect(nullGuard.observe("bash", null)).toBeNull();
		expect(nullGuard.observe("bash", null)).toMatch(/2 times/);
	});

	it("per-instance state is independent (caller owns session keying)", () => {
		const a = createRepeatToolGuard({ thresholds: [2] });
		const b = createRepeatToolGuard({ thresholds: [2] });
		a.observe("read", { path: "a.ts" });
		expect(b.observe("read", { path: "a.ts" })).toBeNull();
		expect(a.observe("read", { path: "a.ts" })).toMatch(/2 times/);
	});
});
