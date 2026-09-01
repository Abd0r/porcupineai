/**
 * Tracks recently written/edited file paths at the session level.
 *
 * This closes the "write-then-execute" bypass of the bash safety gate: an agent
 * can write a destructive script (e.g. contains `rm -rf /`) to a `.sh` file and
 * then run `bash payload.sh`. The bash guard only inspects the command string,
 * so the destructive content in the file goes undetected. By remembering which
 * files were just mutated, the guard can scan a file's content before it is
 * executed and apply the same dangerous-command detector.
 *
 * The map is pruned by age and size so it cannot grow without bound across a
 * long session.
 */

import { relative, resolve } from "node:path";

const MAX_ENTRIES = 4096;
const STALE_MS = 5 * 60 * 1000; // forget very old writes; stale scripts are not fresh agent-authored weapons

const writtenPaths = new Map<string, number>();

function prune(): void {
	const now = Date.now();
	for (const [path, ts] of writtenPaths) {
		if (now - ts > STALE_MS) {
			writtenPaths.delete(path);
		}
	}
	if (writtenPaths.size <= MAX_ENTRIES) return;
	// Drop oldest-first entries beyond the cap.
	const overflow = writtenPaths.size - MAX_ENTRIES;
	const oldest = [...writtenPaths.entries()].sort((a, b) => a[1] - b[1]).slice(0, overflow);
	for (const [path] of oldest) writtenPaths.delete(path);
}

/** Record a successful file mutation so the bash gate can re-scan it if executed. */
export function recordWrittenPath(absPath: string): void {
	prune();
	writtenPaths.set(resolve(absPath), Date.now());
}

/** True when a path is a recently-written/edited file still within the guard window. */
export function isWrittenPath(absPath: string): boolean {
	prune();
	const ts = writtenPaths.get(resolve(absPath));
	if (ts === undefined) return false;
	if (Date.now() - ts > STALE_MS) {
		writtenPaths.delete(resolve(absPath));
		return false;
	}
	return true;
}

/** Number of tracked file paths (exposed for diagnostics/tests). */
export function writtenFileCount(): number {
	prune();
	return writtenPaths.size;
}

/** Forget all tracked writes (mainly for tests and session teardown). */
export function clearWrittenPaths(): void {
	writtenPaths.clear();
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EVALUATOR =
	"\\b(?:ba|z|k|da)?sh\\b|\\bsource\\b|\\b(?:python(?:[23])?|node|bun|deno|perl|ruby|php)\\b|\\.(?:\\s|\\/[^\\s]|$)";

/**
 * Given a bash command run from `cwd`, return the tracked written-file path the
 * command appears to execute — or null when it does not.
 *
 * Recognized invocation shapes:
 *   - shell and common language evaluators (`bash`, `python`, `node`, `bun`, etc.) with a tracked path
 *   - `./path` or `path` used as a standalone executable command
 */
export function findExecutedWrittenScript(command: string, cwd: string): string | null {
	prune();
	const normalized = command.trim();
	if (!normalized) return null;
	const candidates = [...writtenPaths.keys()];
	// Prefer the most recently written scripts first (freshest, most likely an active weapon).
	candidates.sort((a, b) => (writtenPaths.get(b) ?? 0) - (writtenPaths.get(a) ?? 0));
	for (const abs of candidates) {
		const absResolved = resolve(cwd, abs);
		const relativePath = relative(cwd, absResolved);
		const pathVariants = [absResolved, relativePath, `./${relativePath}`].filter(Boolean).map(escapeRegex).join("|");
		// Evaluator+path: `bash payload.sh`, `python scripts/payload.py`, `source /abs/payload.sh`, etc.
		if (new RegExp(`(${EVALUATOR})\\s+(?:${pathVariants})(?:\\s|$|;|&|\\|)`).test(normalized)) {
			return absResolved;
		}
		// A tracked path used as a standalone executable command.
		if (new RegExp(`(?:^|[;&|])\\s*(?:${pathVariants})\\s*(?:$|[;&|])`).test(normalized)) {
			return absResolved;
		}
	}
	return null;
}
