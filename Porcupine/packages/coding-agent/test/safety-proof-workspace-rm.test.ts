import { describe, expect, it, vi } from "vitest";
import { analyzeRmScope, guardBashCommand } from "../src/porcupine/auto-mode.ts";

const CWD = "/Users/tester/project";
const PROTECTED = ["/", "/etc", "/usr", "/bin", "/sbin", "/var", "/Library", "/System", "/Applications"];

describe("analyzeRmScope — intent inferred from scope", () => {
	it("recursive deletes inside the workspace are the agent's own domain", () => {
		expect(analyzeRmScope("rm -rf node_modules dist", CWD, PROTECTED)).toEqual({ insideWorkspace: true });
		expect(analyzeRmScope("rm -rf ./build .cache", CWD, PROTECTED)).toEqual({ insideWorkspace: true });
	});

	it("root and system paths are protected (hardline)", () => {
		expect(analyzeRmScope("rm -rf /etc", CWD, PROTECTED)?.protected).toBe("/etc");
		expect(analyzeRmScope("rm -rf //", CWD, PROTECTED)?.protected).toBe("/");
		expect(analyzeRmScope("rm -rf /usr/local", CWD, PROTECTED)?.protected).toBe("/usr");
	});

	it("home paths resolve outside the workspace", () => {
		expect(analyzeRmScope("rm -rf ~/Documents/x", CWD, PROTECTED)).toEqual({ insideWorkspace: false });
		expect(analyzeRmScope("rm -rf $HOME/Desktop", CWD, PROTECTED)).toEqual({ insideWorkspace: false });
	});

	it("braced variable forms resolve outside the workspace (regression: home-bypass)", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell variables are the subject under test
		expect(analyzeRmScope("rm -rf ${HOME}/Desktop", CWD, PROTECTED)).toEqual({ insideWorkspace: false });
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell variables are the subject under test
		expect(analyzeRmScope("rm -rf ${HOME}", CWD, PROTECTED)).toEqual({ insideWorkspace: false });
	});

	it("unresolvable shell variables fail closed (regression: empty-var path)", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell variables are the subject under test
		expect(analyzeRmScope("rm -rf ${NOPE}/etc", CWD, PROTECTED)).toEqual({ insideWorkspace: false });
		expect(analyzeRmScope("rm -rf $HOME$SOMETHING", CWD, PROTECTED)).toEqual({ insideWorkspace: false });
	});

	it("deleting the working directory itself is never allowed", () => {
		expect(analyzeRmScope("rm -rf .", CWD, PROTECTED)?.protected).toBe("the working directory itself");
	});

	it("user-configured protected paths are honored", () => {
		expect(analyzeRmScope("rm -rf vendor/secret", CWD, ["/Users/tester/project/vendor"]))?.toBeDefined();
	});
});

describe("guardBashCommand — workspace-scoped rm -rf", () => {
	const confirm = vi.fn(async () => true);

	it("Auto: rm -rf inside the workspace is approved without the classifier", async () => {
		const decision = await guardBashCommand({
			command: "rm -rf node_modules dist",
			mode: "auto",
			cwd: CWD,
			protectedPaths: PROTECTED,
			modelRuntime: undefined as never,
			model: undefined,
			confirm,
		});
		expect(decision.approved).toBe(true);
		expect(decision.via).toBe("safe");
		expect(confirm).not.toHaveBeenCalled();
	});

	it("Auto: rm -rf of a protected path is a hardline block", async () => {
		const decision = await guardBashCommand({
			command: "rm -rf /etc",
			mode: "auto",
			cwd: CWD,
			protectedPaths: PROTECTED,
			modelRuntime: undefined as never,
			model: undefined,
			confirm,
		});
		expect(decision.approved).toBe(false);
		expect(decision.via).toBe("hardline");
		expect(decision.message).toContain("/etc");
	});

	it("Normal: rm -rf outside the workspace still asks", async () => {
		const decision = await guardBashCommand({
			command: "rm -rf ~/Documents/x",
			mode: "normal",
			cwd: CWD,
			protectedPaths: PROTECTED,
			modelRuntime: undefined as never,
			model: undefined,
			confirm,
		});
		expect(decision.approved).toBe(true);
		expect(decision.via).toBe("manual");
		expect(confirm).toHaveBeenCalled();
	});

	it("Normal: rm -rf inside the workspace is approved without asking", async () => {
		confirm.mockClear();
		const decision = await guardBashCommand({
			command: "rm -rf .next",
			mode: "normal",
			cwd: CWD,
			protectedPaths: PROTECTED,
			modelRuntime: undefined as never,
			model: undefined,
			confirm,
		});
		expect(decision.approved).toBe(true);
		expect(decision.via).toBe("safe");
		expect(confirm).not.toHaveBeenCalled();
	});
});
