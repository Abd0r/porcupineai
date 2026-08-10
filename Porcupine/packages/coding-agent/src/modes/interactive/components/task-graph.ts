import { Text } from "@porcupineai/tui";
import type { TaskGraphStepStatus, TaskGraphView } from "../../../porcupine/session-orchestrator.ts";
import { theme } from "../theme/theme.ts";

function statusGlyph(status: TaskGraphStepStatus): string {
	switch (status) {
		case "pending":
			return "○";
		case "active":
			return "●";
		case "done":
			return "✓";
		case "failed":
			return "✗";
		case "skipped":
			return "–";
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}

function statusColor(status: TaskGraphStepStatus, text: string): string {
	switch (status) {
		case "active":
			return theme.fg("accent", text);
		case "done":
			return theme.fg("success", text);
		case "failed":
			return theme.fg("error", text);
		case "skipped":
			return theme.fg("dim", text);
		default:
			return theme.fg("muted", text);
	}
}

/**
 * Compact live task graph for Porcupine plan steps.
 * Example:
 *   🧭 Plan  ready
 *     ● use-edit-2  Apply edit to file
 *     ○ use-bash-3  Run tests
 */
export class TaskGraphComponent extends Text {
	private graph: TaskGraphView;

	constructor(graph?: TaskGraphView) {
		super("", 1, 0);
		this.graph = graph ?? { objective: "", status: "idle", steps: [], routeSummary: [] };
		this.updateDisplay();
	}

	setGraph(graph: TaskGraphView): void {
		// Skip work when the graph is unchanged: the base Text cache already returns the
		// previously rendered lines by reference, but only if we don't invalidate it via
		// setText. Guard the rebuild on whether the generated display text would change.
		if (this.graph === graph) return;
		this.graph = graph;
		const rendered = this.renderText();
		if (this.lastRenderedText === rendered) return;
		this.lastRenderedText = rendered;
		this.setText(rendered);
	}

	private lastRenderedText?: string;

	private renderText(): string {
		if (this.graph.status === "idle" || (this.graph.steps.length === 0 && !this.graph.objective)) {
			return "";
		}

		const header = theme.fg(
			"accent",
			theme.bold(`🧭 Plan  ${this.graph.status}${this.graph.objective ? ` — ${this.graph.objective}` : ""}`),
		);
		const lines = [header];

		if (this.graph.routeSummary.length > 0) {
			lines.push(theme.fg("dim", `   route: ${this.graph.routeSummary.slice(0, 6).join(", ")}`));
		}

		for (const step of this.graph.steps) {
			const glyph = statusGlyph(step.status);
			const label = `${glyph} ${step.id}  ${step.objective}`;
			lines.push(`   ${statusColor(step.status, label)}`);
		}

		if (this.graph.status === "blocked") {
			lines.push(theme.fg("warning", "   blocked — continuing with best-effort tools"));
		}

		return lines.join("\n");
	}

	private updateDisplay(): void {
		const rendered = this.renderText();
		if (this.lastRenderedText === rendered) return;
		this.lastRenderedText = rendered;
		this.setText(rendered);
	}
}
