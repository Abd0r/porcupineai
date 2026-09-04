import { Text } from "@porcupineai/tui";
import type { SubagentRunInfo } from "../../../core/agent-session.ts";
import { theme } from "../theme/theme.ts";

export interface SubagentPanelState {
	/** Running sub-agents (one per slot), in spawn order. */
	runs: SubagentRunInfo[];
	/** Total slot capacity (subagent.maxConcurrent). */
	capacity: number;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Advance the spinner glyph on a fixed cadence while any sub-agent is active so
// it keeps spinning even when progress events are sparse. Cleared when inactive.
const SPIN_INTERVAL_MS = 100;

/**
 * Live sub-agent panel — Web of Thoughts (WoT) multi-slot view.
 * Shows N/capacity slots, each with what the sub-agent is working on:
 *
 *   🧵 Sub-agents 2/3
 *     ● sa-abc12  Research on Agent Harness         step 12 · bash
 *     ● sa-def34  Learning System design            step 4 · read
 *     ○ — idle slot
 */
export class SubagentPanelComponent extends Text {
	private state: SubagentPanelState = { runs: [], capacity: 3 };
	private spinIndex = 0;
	private spinTimer: ReturnType<typeof setInterval> | undefined;

	constructor() {
		super("", 1, 0);
	}

	setState(state: SubagentPanelState): void {
		this.state = state;
		if (state.runs.length > 0) this.spinIndex += 1;
		this.updateDisplay();
		if (state.runs.length > 0) {
			this.startSpinTimer();
		} else {
			this.stopSpinTimer();
		}
	}

	private startSpinTimer(): void {
		if (this.spinTimer) return;
		this.spinTimer = setInterval(() => {
			this.spinIndex += 1;
			this.updateDisplay();
		}, SPIN_INTERVAL_MS);
	}

	private stopSpinTimer(): void {
		if (this.spinTimer) {
			clearInterval(this.spinTimer);
			this.spinTimer = undefined;
		}
	}

	get active(): boolean {
		return this.state.runs.length > 0;
	}

	private updateDisplay(): void {
		const { runs, capacity } = this.state;
		const runningCount = runs.filter((run) => run.status === "running").length;
		if (runs.length === 0) {
			this.setText("");
			return;
		}

		const spin = SPINNER[this.spinIndex % SPINNER.length];
		const header = theme.fg("accent", theme.bold(`🧵 Sub-agents ${runningCount}/${capacity}  ${spin}`));
		const lines = [header];

		for (let slot = 0; slot < capacity; slot++) {
			const run = runs[slot];
			if (!run) {
				lines.push(theme.fg("dim", `   ○ — idle slot`));
				continue;
			}
			const glyph =
				run.status === "running"
					? theme.fg("accent", "●")
					: run.status === "done"
						? theme.fg("success", "✓")
						: theme.fg("error", "✗");
			const id = theme.fg("muted", shortId(run.id));
			const detail =
				run.status === "running"
					? theme.fg("muted", `step ${run.steps}${run.lastTool ? ` · ${run.lastTool}` : ""}`)
					: theme.fg("muted", run.status);
			lines.push(`   ${glyph} ${id}  ${truncate(run.task, 48)}   ${detail}`);
		}

		this.setText(lines.join("\n"));
	}
}

function shortId(id: string): string {
	return id.length > 10 ? id.slice(0, 10) : id;
}

/**
 * Plain-text live view for `/subagents`: how many agents are working and
 * their tags. Returns undefined when nothing is live.
 */
export function formatLiveSubagentList(runs: SubagentRunInfo[], capacity: number): string | undefined {
	if (runs.length === 0) return undefined;
	const running = runs.filter((run) => run.status === "running").length;
	const lines = [`Live (${running}/${capacity}):`];
	for (const run of runs) {
		const activity =
			run.status === "running" ? `step ${run.steps}${run.lastTool ? ` · ${run.lastTool}` : ""}` : run.status;
		lines.push(`  @${run.name}  ${activity}  ${run.task}`);
	}
	return lines.join("\n");
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
	return String(tokens);
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// formatTokens is used by the turn-progress detail lines in the session-driven
// path; kept exported for tests that assert token formatting.
export { formatTokens };
