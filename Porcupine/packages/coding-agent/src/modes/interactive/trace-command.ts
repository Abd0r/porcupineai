/**
 * `/trace` trajectory view: surfaces the traceability data every session logs
 * (system_prompt snapshots + per-step request_header envelopes) as a compact
 * human-readable markdown report.
 *
 * Pure logic + markdown formatting only. The interactive-mode handler owns TUI
 * rendering (full-screen viewer). This module is unit-testable with a plain
 * SessionManager and no TUI dependencies.
 */

import type { RequestHeaderEntry, SessionEntry } from "../../core/session-manager.ts";

/** Parsed `/trace [arg]` selector. */
export type TraceSelection =
	| { kind: "last" }
	| { kind: "index"; index: number }
	| { kind: "all" }
	| { kind: "invalid"; reason: string };

/**
 * Parse the argument to `/trace`. Accepts:
 *   - no argument                     -> last step
 *   - a positive integer              -> that step (1-based)
 *   - "all"                           -> one line per step
 * Anything else is invalid.
 */
export function parseTraceSelection(arg: string): TraceSelection {
	const trimmed = arg.trim();
	if (trimmed === "") {
		return { kind: "last" };
	}
	if (trimmed === "all") {
		return { kind: "all" };
	}
	if (/^[0-9]+$/.test(trimmed)) {
		const index = Number(trimmed);
		if (index < 1) {
			return { kind: "invalid", reason: "step index must be a positive integer" };
		}
		return { kind: "index", index };
	}
	return { kind: "invalid", reason: `invalid argument "${trimmed}" (expected <index>, "all", or nothing)` };
}

/** One trajectory step, derived from a single request_header and its paired prompt snapshot. */
export interface TraceStep {
	/** 1-based position among the session's request_header steps. */
	stepIndex: number;
	model: string;
	provider: string | undefined;
	thinkingLevel: string;
	/** sha1 hex of the prompt this step was dispatched with (from the header). */
	promptHash: string;
	toolNames: string[];
	timestamp: string;
	/** Reason of the paired system_prompt snapshot, if one precedes this step. */
	promptReason: string | undefined;
	/** Full assembled prompt text for this step, if a preceding snapshot was found. */
	promptText: string | undefined;
	/** Roles of the session messages logged after this step's dispatch (cheap span). */
	messageRoles: string[];
}

export interface TraceData {
	/** One entry per request_header, in dispatch order. */
	steps: TraceStep[];
	/** Total number of system_prompt snapshots logged (informational). */
	promptCount: number;
}

/**
 * Extract the trajectory from a session's entries.
 *
 * Each request_header is one step. The effective prompt for a step is paired
 * with the last system_prompt snapshot whose timestamp precedes it (the
 * "nearest reason=step one"). If no snapshot precedes it, the step still
 * carries the header's own promptHash as authoritative.
 */
export function extractTrajectory(entries: SessionEntry[]): TraceData {
	const prompts: Array<{
		timestamp: string;
		promptHash: string;
		prompt: string;
		reason: string;
	}> = [];
	const headers: RequestHeaderEntry[] = [];

	// spans[i] = message roles logged after the (i+1)-th request_header, i.e. the
	// cheap "step span" for step i+1.
	const spans: string[][] = [];

	for (const entry of entries) {
		if (entry.type === "system_prompt") {
			prompts.push({
				timestamp: entry.timestamp,
				promptHash: entry.promptHash,
				prompt: entry.prompt,
				reason: entry.reason,
			});
		} else if (entry.type === "request_header") {
			spans.push([]);
			headers.push(entry as RequestHeaderEntry);
		}
	}

	// Map each session message to the most recent request_header span, deduping
	// consecutive same-role messages so the span stays compact.
	let lastHeaderIndex = -1;
	for (const entry of entries) {
		if (entry.type === "request_header") {
			lastHeaderIndex++;
			continue;
		}
		if (entry.type === "message" && lastHeaderIndex >= 0 && spans[lastHeaderIndex]) {
			const role = entry.message.role;
			const span = spans[lastHeaderIndex]!;
			if (span.length === 0 || span[span.length - 1] !== role) {
				span.push(role);
			}
		}
	}

	// Pair each request_header with the last system_prompt at-or-before it. Both
	// arrays are append-ordered, so a single advancing pointer stays correct.
	let promptIdx = 0;
	const steps: TraceStep[] = headers.map((header, index) => {
		while (promptIdx < prompts.length && prompts[promptIdx].timestamp <= header.timestamp) {
			promptIdx++;
		}
		const paired = promptIdx > 0 ? prompts[promptIdx - 1] : undefined;
		return {
			stepIndex: index + 1,
			model: header.model,
			provider: header.provider,
			thinkingLevel: header.thinkingLevel,
			promptHash: header.promptHash,
			toolNames: [...header.toolNames],
			timestamp: header.timestamp,
			promptReason: paired?.reason,
			promptText: paired?.prompt,
			messageRoles: spans[index] ?? [],
		};
	});

	return { steps, promptCount: prompts.length };
}

export type TraceStepResult =
	| { kind: "step"; step: TraceStep }
	| { kind: "out-of-range"; total: number; requested: number };

/**
 * Resolve a parsed selection to a concrete step. `/trace` (no arg) picks the
 * last step; `/trace <index>` picks that 1-based step, erroring when out of
 * range. Never resolves `all` (callers handle that separately).
 */
export function resolveTraceStep(data: TraceData, selection: TraceSelection): TraceStepResult {
	if (selection.kind === "all" || selection.kind === "invalid") {
		return { kind: "out-of-range", total: data.steps.length, requested: -1 };
	}
	const targetIndex = selection.kind === "last" ? data.steps.length : selection.kind === "index" ? selection.index : 0;
	const step = data.steps.find((s) => s.stepIndex === targetIndex);
	if (!step) {
		return { kind: "out-of-range", total: data.steps.length, requested: targetIndex };
	}
	return { kind: "step", step };
}

/** One line per step: model, thinking level, tools, short prompt hash. */
export function formatTraceAll(data: TraceData): string {
	const header = "# Trajectory\n\n";
	if (data.steps.length === 0) {
		return `${header}No model steps have been logged yet.`;
	}
	const lines = data.steps.map((step) => {
		const provider = step.provider ? ` (${step.provider})` : "";
		const tools = step.toolNames.length > 0 ? `tools=[${step.toolNames.join(", ")}]` : "tools=[]";
		return `- ${step.stepIndex}. ${step.model}${provider} · thinking=${step.thinkingLevel} · ${tools} · prompt=${shortHash(step.promptHash)}`;
	});
	return `${header}${data.promptCount} system prompt snapshot(s), ${data.steps.length} step(s):\n\n${lines.join("\n")}`;
}

export const TRACE_NO_DATA_MESSAGE =
	"Trace data is empty: this session predates traceability (v0.1.69) or has no request headers yet. Start a new turn to log a request_header.";

/** Pointer text telling the reader how to see the full prompt of a short-hash step. */
export function formatPromptPointer(step: TraceStep): string {
	if (step.promptText !== undefined) {
		return `(hash ${shortHash(step.promptHash)} — full text below)`;
	}
	return `(hash ${shortHash(step.promptHash)} — full prompt not in this session; see /trace ${step.stepIndex})`;
}

/**
 * Full markdown report for one step. Bounded output: the full prompt text is
 * only emitted for the requested step, never for an "all" listing.
 */
export function formatTraceStep(data: TraceData, step: TraceStep): string {
	const provider = step.provider ? ` (${step.provider})` : "";
	const lines: string[] = [
		`# Trajectory — Step ${step.stepIndex}`,
		"",
		`**Model:** ${step.model}${provider}`,
		`**Thinking level:** ${step.thinkingLevel}`,
		`**Timestamp:** ${step.timestamp}`,
		`**Prompt hash:** \`${step.promptHash}\``,
	];

	if (step.toolNames.length > 0) {
		lines.push(`**Tool catalog:** ${step.toolNames.join(", ")}`);
	} else {
		lines.push(`**Tool catalog:** (none)`);
	}

	if (step.messageRoles.length > 0) {
		lines.push(`**Messages after this step:** ${step.messageRoles.join(", ")}`);
	}

	if (step.promptText !== undefined) {
		lines.push(
			"",
			`**Effective system prompt** ${step.promptReason ? `(reason: ${step.promptReason})` : ""}:`,
			"",
			"```",
			step.promptText,
			"```",
		);
	} else {
		lines.push("", `**Effective system prompt:** ${formatPromptPointer(step)}`);
	}

	lines.push("", formatStepFooter(data, step));
	return lines.join("\n");
}

function formatStepFooter(data: TraceData, step: TraceStep): string {
	const total = data.steps.length;
	if (step.stepIndex < total) {
		return `Step ${step.stepIndex}/${total}. Next step: /trace ${step.stepIndex + 1}. All steps: /trace all.`;
	}
	return `Step ${step.stepIndex}/${total}. All steps: /trace all.`;
}

/** Short, collision-safe prompt hash preview. */
function shortHash(hash: string): string {
	return hash.length > 7 ? hash.slice(0, 7) : hash;
}
