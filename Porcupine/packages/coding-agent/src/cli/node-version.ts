/**
 * Node.js runtime guard for the CLI entry point.
 *
 * IMPORTANT: this module must stay the FIRST import of `src/cli.ts`, and must
 * never import anything itself. The entry module graph reaches `undici` at
 * module scope (`core/http-dispatcher.ts`), and on Node < 22.19 that import
 * throws `TypeError: webidl.util.markAsUncloneable is not a function` while
 * modules are still being evaluated, before any code in the CLI body can run.
 * Because this file has no imports, it evaluates first and reports the real
 * problem instead of a cryptic stack trace.
 *
 * Keep the minimum in sync with `engines.node` in package.json.
 */

import { writeSync } from "node:fs";

/** Minimum supported runtime, matching `engines.node` in package.json. */
export const MINIMUM_NODE_VERSION = "22.19.0";

/** Parse "v22.19.0" / "22.19" / "24" into comparable numbers. */
export function parseNodeVersion(version: string): [number, number, number] {
	const [major = "0", minor = "0", patch = "0"] = version.trim().replace(/^v/i, "").split(".");
	return [Number(major) || 0, Number(minor) || 0, Number(patch) || 0];
}

/** True when `version` is at or above `minimum`. */
export function isNodeVersionSupported(version: string, minimum: string = MINIMUM_NODE_VERSION): boolean {
	const [major, minor, patch] = parseNodeVersion(version);
	const [minMajor, minMinor, minPatch] = parseNodeVersion(minimum);
	if (major !== minMajor) return major > minMajor;
	if (minor !== minMinor) return minor > minMinor;
	return patch >= minPatch;
}

/** Actionable message for an unsupported runtime. */
export function formatNodeVersionError(version: string, minimum: string = MINIMUM_NODE_VERSION): string {
	return [
		`Porcupine requires Node.js ${minimum} or newer.`,
		`You are running Node.js ${version}.`,
		"",
		"Upgrade Node.js and try again:",
		"  nvm install 22 && nvm use 22      # with nvm",
		"  https://nodejs.org/en/download    # without nvm",
		"",
	].join("\n");
}

// Side effect on import: fail fast with a clear message on an unsupported runtime.
// (Import order is the mechanism — see the module comment above.) The write is
// synchronous on purpose: an async write would let the remaining modules evaluate
// and crash inside `undici` before the process could exit.
if (!isNodeVersionSupported(process.versions.node)) {
	writeSync(2, `\n${formatNodeVersionError(process.versions.node)}\n`);
	process.exit(1);
}
