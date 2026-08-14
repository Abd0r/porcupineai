import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildBwrapArgs, buildWindowsHelperArgs, defaultWritableStateDirs } from "../src/core/sandbox/index.ts";

describe("bwrap arg builder", () => {
	it("returns null for mode off", () => {
		expect(buildBwrapArgs("off", "/ws", "/tmp")).toBeNull();
	});

	it("ro-binds root and mounts dev/proc", () => {
		const args = buildBwrapArgs("read-only", "/ws", "/tmp");
		expect(args).toContain("--ro-bind");
		expect(args).toContain("--dev");
		expect(args).toContain("--proc");
		expect(args).toContain("--die-with-parent");
	});

	it("read-only mode adds no writable --bind mounts", () => {
		const args = buildBwrapArgs("read-only", "/ws", "/tmp");
		expect(args).not.toContain("--bind");
	});

	it("workspace-write binds existing dirs and skips missing ones", () => {
		const tmp = tmpdir();
		const args = buildBwrapArgs("workspace-write", "/nonexistent-zzz", tmp);
		expect(args).toContain("--bind");
		expect(args).toContain(tmp);
		expect(args).not.toContain("/nonexistent-zzz");
	});

	it("includes default home state dirs", () => {
		expect(defaultWritableStateDirs("/home/u")).toContain("/home/u/.npm");
	});
});

describe("windows helper arg builder", () => {
	it("returns null for mode off", () => {
		expect(buildWindowsHelperArgs("off", "/ws", "/tmp")).toBeNull();
	});

	it("read-only mode uses --read-only and no --write", () => {
		const args = buildWindowsHelperArgs("read-only", "C:\\ws", "C:\\tmp");
		expect(args).toContain("--read-only");
		expect(args).toContain("--workspace");
		expect(args).not.toContain("--write");
	});

	it("workspace-write mode lists workspace and temp as writable", () => {
		const args = buildWindowsHelperArgs("workspace-write", "C:\\ws", "C:\\tmp");
		expect(args).toContain("--workspace");
		expect(args).toContain("--write");
		expect(args).toContain("C:\\tmp");
	});
});
