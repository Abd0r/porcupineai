import { accessSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	didYouMean,
	isBlockedDevicePath,
	normalizeFilenameCandidates,
	resolveWithFilenameNormalization,
} from "../src/core/tools/path-utils.ts";

const NARROW_NBSP = "\u202F";
const NBSP = "\u00A0";
const RIGHT_QUOTE = "\u2019";

const exists = (p: string): boolean => {
	try {
		accessSync(p);
		return true;
	} catch {
		return false;
	}
};

/**
 * A resolve callback that enforces the workspace boundary (mirrors the read
 * tool's real one) and throws ENOENT for missing files.
 */
const makeResolver = (cwd: string) => {
	const base = resolve(cwd);
	return async (p: string): Promise<string> => {
		let abs = resolve(cwd, p);
		if (!isAbsolute(abs)) abs = resolve(base, abs);
		// Boundary check: must stay inside base.
		const rel = abs.startsWith(`${base}/`) || abs === base;
		if (!rel) {
			const e: NodeJS.ErrnoException = new Error(`EACCES: ${abs}`);
			e.code = "EACCES";
			throw e;
		}
		if (!exists(abs)) {
			const e: NodeJS.ErrnoException = new Error(`ENOENT: ${abs}`);
			e.code = "ENOENT";
			throw e;
		}
		return abs;
	};
};

describe("normalizeFilenameCandidates", () => {
	it("returns original first and deduplicates", () => {
		const result = normalizeFilenameCandidates("file.txt");
		expect(result[0]).toBe("file.txt");
		expect(new Set(result).size).toBe(result.length);
	});

	it("produces NFD variant for accented names and keeps it bounded", () => {
		const nfc = "file\u00e9.txt"; // é single char
		const result = normalizeFilenameCandidates(nfc);
		expect(result).toContain("file\u0065\u0301.txt"); // NFD decomposed
		expect(result.length).toBeLessThanOrEqual(10);
	});

	it("swaps narrow no-break space (U+202F) for a regular space", () => {
		const result = normalizeFilenameCandidates(`screenshot${NARROW_NBSP}AM.png`);
		expect(result).toContain("screenshot AM.png");
	});

	it("swaps no-break space (U+00A0) for a regular space", () => {
		const result = normalizeFilenameCandidates(`file${NBSP}name.txt`);
		expect(result).toContain("file name.txt");
	});

	it("swaps straight quote for curly quote", () => {
		const result = normalizeFilenameCandidates("Capture d'ecran.txt");
		expect(result).toContain(`Capture d${RIGHT_QUOTE}ecran.txt`);
	});
});

describe("resolveWithFilenameNormalization", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "path-normalize-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("(a) resolves NFC input to an NFD file via filename normalization", async () => {
		const nfdName = "file\u0065\u0301.txt"; // e + combining acute
		writeFileSync(join(tempDir, nfdName), "hi");
		const resolver = makeResolver(tempDir);
		const result = await resolveWithFilenameNormalization(
			tempDir,
			"file\u00e9.txt", // NFC composed
			resolver,
		);
		// On APFS the filesystem normalizes automatically so the resolved path
		// may be NFC or NFD; either way it must land on the accented file.
		expect(result).toContain(tempDir);
		expect(result).toMatch(/file.+\.txt$/);
	});

	it("(b) resolves a regular-space input to a narrow-space file", async () => {
		writeFileSync(join(tempDir, `Screenshot 10.00.00${NARROW_NBSP}AM.png`), "hi");
		const resolver = makeResolver(tempDir);
		const result = await resolveWithFilenameNormalization(tempDir, "Screenshot 10.00.00 AM.png", resolver);
		expect(result).toContain("AM.png");
	});

	it("(c) resolves a straight-quote input to a curly-quote file", async () => {
		writeFileSync(join(tempDir, `Capture d${RIGHT_QUOTE}ecran.txt`), "hi");
		const resolver = makeResolver(tempDir);
		const result = await resolveWithFilenameNormalization(tempDir, "Capture d'ecran.txt", resolver);
		expect(result).toContain("ecran.txt");
	});

	it("normal resolution unchanged when file exists (one attempt only)", async () => {
		writeFileSync(join(tempDir, "hello.txt"), "hi");
		const resolver = makeResolver(tempDir);
		const seen: string[] = [];
		const recording = async (p: string) => {
			seen.push(p);
			return resolver(p);
		};
		const result = await resolveWithFilenameNormalization(tempDir, "hello.txt", recording);
		expect(result).toBe(join(tempDir, "hello.txt"));
		expect(seen).toEqual(["hello.txt"]);
	});

	it("throws the original error when no candidate matches", async () => {
		writeFileSync(join(tempDir, "real.txt"), "hi");
		const resolver = makeResolver(tempDir);
		await expect(resolveWithFilenameNormalization(tempDir, "nope.txt", resolver)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("never lets a repair escape the workspace boundary", async () => {
		writeFileSync(join(tempDir, "target\u00e9.txt"), "hi");
		const resolver = makeResolver(tempDir);
		// A path that tries to escape via .. must be refused by the resolver's
		// boundary check, not silently repaired.
		await expect(resolveWithFilenameNormalization(tempDir, "../outside.txt", resolver)).rejects.toBeDefined();
	});
});

describe("didYouMean", () => {
	it("(d) catches AGENT.md -> AGENTS.md by Levenshtein", () => {
		const entries = ["AGENTS.md", "README.md", "package.json"];
		expect(didYouMean("AGENT.md", entries)).toBe("AGENTS.md");
	});

	it("prefers substring match", () => {
		const entries = ["notes.md", "my-notes.md", "README.md"];
		expect(didYouMean("notes", entries)).toBe("notes.md");
	});

	it("returns the closest within maxDistance and undefined beyond it", () => {
		const entries = ["config.json", "cfg.ts"];
		expect(didYouMean("config", entries, 0)).toBe("config.json");
		expect(didYouMean("zebra", entries)).toBeUndefined();
	});
});

describe("isBlockedDevicePath", () => {
	const blocked: Array<[string, string]> = [
		["/dev/zero", "zero device"],
		["/dev/urandom", "urandom"],
		["/dev/random", "random"],
		["/dev/stdin", "stdin"],
		["/dev/stdout", "stdout"],
		["/dev/stderr", "stderr"],
		["/dev/full", "full device"],
		["/proc/1234/fd/5", "proc fd by pid"],
	];

	it("(e) matches the 8 blocked device cases", () => {
		for (const [path, label] of blocked) {
			expect(isBlockedDevicePath(path), `should block ${label} (${path})`).toBe(true);
		}
	});

	it("does not flag normal files or nested /proc paths", () => {
		expect(isBlockedDevicePath("/home/user/dev/file.txt")).toBe(false);
		expect(isBlockedDevicePath("/dev/null")).toBe(false);
		expect(isBlockedDevicePath("/proc/self/status")).toBe(false);
		expect(isBlockedDevicePath("/proc/1234/cmdline")).toBe(false);
	});
});
