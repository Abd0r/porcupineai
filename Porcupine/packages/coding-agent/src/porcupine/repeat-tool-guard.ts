/**
 * Repeat-tool guard.
 *
 * Implements dsh's "repeat-tool-reminder" pattern as a pure, testable unit.
 * Tracks consecutive identical tool invocations and, once the call count
 * crosses configured thresholds, returns an escalating advisory string instead
 * of silently passing a likely-runaway loop. Never vetoes or rewrites a call —
 * it only observes and advises. The caller owns one instance per session so
 * per-session keying is implicit.
 */

export interface RepeatToolGuardConfig {
	/**
	 * Consecutive-call counts at which to emit an advisory. The i-th threshold
	 * produces a successively stronger message. Defaults to [3, 5, 8].
	 */
	thresholds?: number[];
	/**
	 * Tool names that are never counted (bookkeeping tools such as todo_write).
	 */
	exclude?: string[];
}

export interface RepeatToolGuard {
	/**
	 * Record one invocation. Returns an advisory string when the identical run
	 * count crosses a threshold, otherwise null.
	 */
	observe(toolName: string, args: unknown): string | null;
}

const DEFAULT_THRESHOLDS = [3, 5, 8];

/**
 * Canonicalize arbitrary tool args into a stable string key.
 *
 * Deep key-sort then JSON.stringify (mirrors dsh). Handles non-JSON values
 * defensively: functions, undefined, BigInt, and cyclic references are replaced
 * with stable placeholders so the guard never throws on a weird payload.
 */
export function canonicalizeArgs(args: unknown): string {
	if (args === undefined) return "undefined";
	if (args === null) return "null";

	const stack: unknown[] = [];
	const seen = new Set<unknown>();

	const normalize = (value: unknown): unknown => {
		if (typeof value === "bigint") return `__bigint__:${value.toString()}`;
		if (typeof value === "function") return "__function__";
		if (value === undefined) return "__undefined__";

		if (Array.isArray(value)) {
			if (seen.has(value)) return "__cyclic__";
			if (stack.indexOf(value) !== -1) return "__cyclic__";
			seen.add(value);
			stack.push(value);
			const result = value.map(normalize);
			stack.pop();
			return result;
		}

		if (typeof value === "object") {
			if (seen.has(value)) return "__cyclic__";
			if (stack.indexOf(value) !== -1) return "__cyclic__";
			seen.add(value);
			stack.push(value);
			const sorted: Array<[string, unknown]> = Object.keys(value as Record<string, unknown>)
				.sort()
				.map((key) => [key, normalize((value as Record<string, unknown>)[key])]);
			stack.pop();

			const out: Record<string, unknown> = {};
			for (const [key, val] of sorted) out[key] = val;
			return out;
		}

		return value;
	};

	return JSON.stringify(normalize(args));
}

/**
 * Create a repeat-tool guard instance.
 */
export function createRepeatToolGuard(config?: RepeatToolGuardConfig): RepeatToolGuard {
	const thresholds = [...(config?.thresholds ?? DEFAULT_THRESHOLDS)].sort((a, b) => a - b);
	const excluded = new Set(config?.exclude ?? []);

	let lastKey: string | null = null;
	let runCount = 0;

	const messageFor = (toolName: string, count: number): string => {
		if (count === thresholds[0]) {
			return `note: tool ${toolName} called ${count} times with identical arguments; if this is not intentional, consider a different approach`;
		}
		if (count === thresholds[1]) {
			return `warning: tool ${toolName} called ${count} times with identical arguments. This looks like a repeating loop; verify you are making progress before calling again.`;
		}
		return `hard loop warning: tool ${toolName} called ${count} times with identical arguments and no argument change. You are very likely stuck in a loop. Stop and try a different strategy (for example read the file once and plan, instead of repeatedly calling ${toolName}).`;
	};

	return {
		observe(toolName: string, args: unknown): string | null {
			if (excluded.has(toolName)) return null;

			const key = `${toolName}:${canonicalizeArgs(args)}`;
			if (key !== lastKey) {
				lastKey = key;
				runCount = 1;
				return null;
			}

			runCount += 1;
			if (thresholds.includes(runCount)) {
				return messageFor(toolName, runCount);
			}
			return null;
		},
	};
}
