import type { Usage } from "@porcupineai/ai/compat";
import type { SessionEntry } from "./session-manager.ts";
import { createUsageTotals, type UsageTotals } from "./usage-totals.ts";

/**
 * session-usage - In-harness observability for token and cost accounting.
 *
 * Complements the session-scoped aggregation in usage-totals.ts (which scans
 * persisted session entries) with a live, per-turn accumulator that can also be
 * rebuilt from the same persisted entries. The ai package already attributes a
 * concrete cost to every usage record (Usage.cost.total), so this module reuses
 * that value rather than reimplementing per-model pricing.
 *
 * Token accounting is disjoint: `input` holds uncached prompt tokens, and cache
 * activity is counted separately in `cacheRead`/`cacheWrite` (or the named
 * `cacheReadTokens`/`cacheWriteTokens` views when a provider reports them). Both
 * the /usage table and the /cost summary surface this split; it is an estimate,
 * not a bill, and falls back to token-only reporting when a model has no cost config.
 */

/** One recorded model/tool turn within the session. */
export interface SessionTurnUsage {
	turn: number;
	/** Assistant model attribution (provider + model). Undefined for tool/summary usage. */
	provider?: string;
	model?: string;
	/** Concrete response model when the request resolved through a router (e.g. OpenRouter `auto`). */
	responseModel?: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface SessionUsageMeta {
	provider?: string;
	model?: string;
	responseModel?: string;
}

/** Live, per-turn accumulator for the current session. In-memory (not persisted across restarts). */
export class SessionUsageTracker {
	private _turns: SessionTurnUsage[] = [];
	private _counter = 0;

	get turnCount(): number {
		return this._turns.length;
	}

	get turns(): readonly SessionTurnUsage[] {
		return this._turns;
	}

	/** Record one usage sample as a new turn. Returns the recorded turn. */
	record(usage: Usage, meta: SessionUsageMeta = {}): SessionTurnUsage {
		this._counter += 1;
		// Prefer the named disjoint-split views when a provider reports them; they are
		// disjoint from `input` (uncached) and fall back to the canonical short fields.
		const cacheRead = usage.cacheReadTokens ?? usage.cacheRead;
		const cacheWrite = usage.cacheWriteTokens ?? usage.cacheWrite;
		const turn: SessionTurnUsage = {
			turn: this._counter,
			provider: meta.provider,
			model: meta.model,
			responseModel: meta.responseModel,
			input: usage.input,
			output: usage.output,
			cacheRead,
			cacheWrite,
			cost: usage.cost.total,
		};
		this._turns.push(turn);
		return turn;
	}

	/** Totals across every recorded turn. */
	getTotals(): UsageTotals {
		const totals = createUsageTotals();
		for (const turn of this._turns) {
			totals.input += turn.input;
			totals.output += turn.output;
			totals.cacheRead += turn.cacheRead;
			totals.cacheWrite += turn.cacheWrite;
			totals.cost += turn.cost;
		}
		return totals;
	}

	/** Per-model cost/token split, grouped by the effective model key. */
	getPerModel(): SessionTurnUsage[] {
		const byKey = new Map<string, SessionTurnUsage>();
		const order: string[] = [];
		for (const turn of this._turns) {
			const key =
				turn.provider || turn.model ? `${turn.provider}/${turn.responseModel ?? turn.model}` : "Tools/summaries";
			let bucket = byKey.get(key);
			if (!bucket) {
				order.push(key);
				bucket = {
					turn: 0,
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					provider: turn.provider,
					model: turn.model,
					responseModel: turn.responseModel,
				};
				byKey.set(key, bucket);
			}
			bucket.input += turn.input;
			bucket.output += turn.output;
			bucket.cacheRead += turn.cacheRead;
			bucket.cacheWrite += turn.cacheWrite;
			bucket.cost += turn.cost;
		}
		return order
			.map((key) => byKey.get(key)!)
			.filter(
				(bucket) => bucket.cost > 0 || bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite > 0,
			);
	}

	/** Discard all recorded turns. */
	reset(): void {
		this._turns = [];
		this._counter = 0;
	}

	/** Rebuild a tracker from all persisted session entries (assistant + tool/summary usage). */
	static fromEntries(entries: readonly SessionEntry[]): SessionUsageTracker {
		const tracker = new SessionUsageTracker();
		for (const entry of entries) {
			if (entry.type === "message") {
				if (entry.message.role === "assistant") {
					const message = entry.message;
					tracker.record(message.usage, {
						provider: message.provider,
						model: message.model,
						responseModel: message.responseModel,
					});
				} else if (entry.message.role === "toolResult" && entry.message.usage) {
					tracker.record(entry.message.usage);
				}
			} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
				tracker.record(entry.usage);
			}
		}
		return tracker;
	}
}

function formatNumber(value: number, locale: boolean): string {
	return locale ? value.toLocaleString() : String(value);
}

/**
 * Render a /usage style table of per-turn token counts plus session totals.
 * Returns an ASCII/plain-text table (no theme codes) leaving presentation to the UI layer.
 */
export function formatUsageTable(
	turns: readonly SessionTurnUsage[],
	totals: UsageTotals,
	turnCount: number,
	totalTokens: number,
): string {
	const lines: string[] = [];
	lines.push("Turn | Input | Output | Cache Rd | Cache Wr | Cost");
	lines.push("-----|-------|--------|-----------|----------|------");
	for (const turn of turns) {
		const label =
			turn.responseModel && turn.responseModel !== turn.model
				? `${turn.provider}/${turn.responseModel}`
				: turn.provider && turn.model
					? `${turn.provider}/${turn.model}`
					: "tools/summary";
		lines.push(
			[
				String(turn.turn),
				formatNumber(turn.input, true),
				formatNumber(turn.output, true),
				formatNumber(turn.cacheRead, true),
				formatNumber(turn.cacheWrite, true),
				`$${turn.cost.toFixed(3)} (${label})`,
			].join(" | "),
		);
	}
	lines.push("-----|-------|--------|-----------|----------|------");
	lines.push(
		[
			"     TOTAL",
			formatNumber(totals.input, true),
			formatNumber(totals.output, true),
			formatNumber(totals.cacheRead, true),
			formatNumber(totals.cacheWrite, true),
			`$${totals.cost.toFixed(3)}`,
		].join(" | "),
	);
	lines.push("");
	lines.push(`Turns: ${turnCount} | Total tokens: ${formatNumber(totalTokens, true)}`);
	return lines.join("\n");
}

/** Per-model cost line for the /cost summary. */
export interface CostBreakdownLine {
	key: string;
	cost: number;
	tokens: number;
}

/**
 * Render a /cost summary. Cost figures always come from the ai package's own
 * per-model attribution (Usage.cost.total). When a model exposes no cost data
 * (all zero), the summary reports token totals and marks cost as n/a.
 */
export function formatCostSummary(totals: UsageTotals, perModel: CostBreakdownLine[], hasCost: boolean): string {
	const lines: string[] = [];
	if (hasCost) {
		lines.push(`Estimated session cost: $${totals.cost.toFixed(4)} (estimate, not a bill)`);
		for (const entry of perModel) {
			lines.push(`  ${entry.key}: $${entry.cost.toFixed(4)} (${entry.tokens.toLocaleString()} tokens)`);
		}
	} else {
		lines.push("Estimated session cost: n/a (model provides no cost config)");
		lines.push(`  Input: ${totals.input.toLocaleString()} | Output: ${totals.output.toLocaleString()}`);
		lines.push(
			`  Cache read: ${totals.cacheRead.toLocaleString()} | Cache write: ${totals.cacheWrite.toLocaleString()}`,
		);
	}
	return lines.join("\n");
}
