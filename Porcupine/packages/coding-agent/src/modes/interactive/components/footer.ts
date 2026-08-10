import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@porcupineai/tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { addUsageToTotals, createUsageTotals, type UsageTotals } from "../../../core/usage-totals.ts";
import { formatInteractionModeBadge } from "../../../porcupine/interaction-mode.ts";
import type { TaskGraphStepView, TaskGraphView } from "../../../porcupine/session-orchestrator.ts";
import { theme } from "../theme/theme.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
/**
 * Format plan-step progress for the footer: "1✓ 2▶ 3 4" for a few steps,
 * "3/10 ✓" once the plan grows. Returns undefined when there is no plan or no
 * steps, so no task tracker is shown at all.
 */
export function formatTaskProgress(graph: TaskGraphView | undefined, stepLimit = 6): string | undefined {
	const steps: readonly TaskGraphStepView[] = graph?.steps ?? [];
	if (steps.length === 0) return undefined;

	const stepChip = (step: TaskGraphStepView, index: number): string => {
		const n = String(index + 1);
		switch (step.status) {
			case "done":
				return theme.fg("success", `${n}✓`);
			case "failed":
				return theme.fg("error", `${n}✗`);
			case "active":
				return theme.fg("accent", `${n}▶`);
			default:
				return theme.fg("dim", n);
		}
	};

	if (steps.length <= stepLimit) {
		return steps.map(stepChip).join(" ");
	}
	const done = steps.filter((step) => step.status === "done").length;
	const activeIndex = steps.findIndex((step) => step.status === "active");
	const activeNote = activeIndex >= 0 ? ` (step ${activeIndex + 1})` : "";
	return `${done}/${steps.length} ✓${activeNote}`;
}

export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private getTaskGraph?: () => TaskGraphView | undefined;
	/** Live animated sub-agent chip frame ("🤖(📄 Extracting, 🌐 Searching)"), from interactive-mode. */
	private getSubagentChip?: () => string | undefined;

	// Usage aggregation cache. The session is append-only, so the aggregates over all
	// entries are stable as long as the tail is unchanged. We keyed on the flattened
	// identity of the entry sequence: its length plus the reference of its last entry (a
	// new append changes the length, the last reference, or both). This makes the O(entries)
	// cost of every footer render pay only when the session actually grows.
	private cachedEntriesLength = -1;
	private cachedLastEntry?: object;
	private cachedUsageTotals?: UsageTotals;
	private cachedLatestCacheHitRate?: number;

	constructor(
		session: AgentSession,
		footerData: ReadonlyFooterDataProvider,
		getTaskGraph?: () => TaskGraphView | undefined,
		getSubagentChip?: () => string | undefined,
	) {
		this.session = session;
		this.footerData = footerData;
		this.getTaskGraph = getTaskGraph;
		this.getSubagentChip = getSubagentChip;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const state = this.session.state;

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages).
		// The entries sequence is append-only, so cache the O(entries) aggregation keyed by
		// sequence identity (entries.length + last-entry reference) and only recompute on growth.
		const entries = this.session.sessionManager.getEntries();
		const entriesLength = entries.length;
		const lastEntry: object | undefined = entries[entriesLength - 1];
		let usageTotals: UsageTotals;
		let latestCacheHitRate: number | undefined;
		if (entriesLength === this.cachedEntriesLength && lastEntry === this.cachedLastEntry) {
			usageTotals = this.cachedUsageTotals!;
			latestCacheHitRate = this.cachedLatestCacheHitRate;
		} else {
			usageTotals = createUsageTotals();
			latestCacheHitRate = undefined;

			for (const entry of entries) {
				if (entry.type === "message" && entry.message.role === "assistant") {
					addUsageToTotals(usageTotals, entry.message.usage);

					const latestPromptTokens =
						entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
					latestCacheHitRate =
						latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
				} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
					addUsageToTotals(usageTotals, entry.message.usage);
				} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
					addUsageToTotals(usageTotals, entry.usage);
				}
			}
			this.cachedEntriesLength = entriesLength;
			this.cachedLastEntry = lastEntry;
			this.cachedUsageTotals = usageTotals;
			this.cachedLatestCacheHitRate = latestCacheHitRate;
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Replace home directory with ~
		let pwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

		// Add git branch if available
		const branch = this.footerData.getGitBranch();
		if (branch) {
			pwd = `${pwd} (${branch})`;
		}

		// Add session name if set
		const sessionName = this.session.sessionManager.getSessionName();
		if (sessionName) {
			pwd = `${pwd} • ${sessionName}`;
		}

		// Build stats line
		const statsParts = [];
		if (usageTotals.input) statsParts.push(`↑${formatTokens(usageTotals.input)}`);
		if (usageTotals.output) statsParts.push(`↓${formatTokens(usageTotals.output)}`);
		if (usageTotals.cacheRead) statsParts.push(`R${formatTokens(usageTotals.cacheRead)}`);
		if (usageTotals.cacheWrite) statsParts.push(`W${formatTokens(usageTotals.cacheWrite)}`);
		if ((usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
			statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
		}

		// Kimi Coding is subscription-backed despite using API-key authentication.
		const usingSubscription = state.model
			? state.model.provider === "kimi-coding" || this.session.modelRuntime.isUsingOAuth(state.model.provider)
			: false;
		if (usageTotals.cost || usingSubscription) {
			const costStr = `$${usageTotals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
			statsParts.push(costStr);
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay =
			contextPercent === "?"
				? `?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		statsParts.push(contextPercentStr);
		if (areExperimentalFeaturesEnabled()) {
			statsParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
		}

		let statsLeft = statsParts.join(" ");

		// Add model name on the right side, plus thinking level if model supports it
		const modelName = state.model?.id || "no-model";

		let statsLeftWidth = visibleWidth(statsLeft);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			statsLeft = truncateToWidth(statsLeft, width, "...");
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;

		// Add thinking level indicator if model supports reasoning
		const modeLabel = formatInteractionModeBadge(this.session.interactionMode);
		let rightSideWithoutProvider = `${modelName} • ${modeLabel}`;
		if (state.model?.reasoning) {
			if (this.session.isAdaptiveReasoningEnabled) {
				const last = this.session.adaptiveLastResolved;
				const adaptiveLabel = last ? `adaptive→${last}` : "adaptive";
				rightSideWithoutProvider = `${modelName} • ${modeLabel} • ${adaptiveLabel}`;
			} else {
				const thinkingLevel = state.thinkingLevel || "off";
				rightSideWithoutProvider =
					thinkingLevel === "off"
						? `${modelName} • ${modeLabel} • thinking off`
						: `${modelName} • ${modeLabel} • ${thinkingLevel}`;
			}
		}

		// Prepend the provider in parentheses if there are multiple providers and there's enough room
		let rightSide = rightSideWithoutProvider;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			rightSide = `(${state.model!.provider}) ${rightSideWithoutProvider}`;
			if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
				// Too wide, fall back
				rightSide = rightSideWithoutProvider;
			}
		}

		// Live sub-agent chip + thread counter to the LEFT of the provider/model:
		// "🤖(📄 Extracting, 🌐 Searching) • 🧵 0/3 • (opencode-go) …" — the animated
		// chip comes from interactive-mode (frame cycles while workers run).
		const rightParts: string[] = [];
		const subagentChip = this.getSubagentChip?.();
		if (subagentChip) rightParts.push(subagentChip);
		const subagentState = this.session.subagentState;
		if (subagentState && subagentState.capacity > 0) {
			const runningSubagents = subagentState.runs.filter((run) => run.status === "running").length;
			rightParts.push(`🧵 ${runningSubagents}/${subagentState.capacity}`);
		}
		if (rightSide) rightParts.push(rightSide);
		if (rightParts.length > 0) {
			rightSide = rightParts.join(" • ");
		}

		const rightSideWidth = visibleWidth(rightSide);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		// Middle task tracker — only when a plan with steps exists (0 steps → nothing).
		const taskProgress = formatTaskProgress(this.getTaskGraph?.());
		const taskProgressWidth = taskProgress ? visibleWidth(taskProgress) : 0;

		let rightSideFinal = rightSide;
		let rightSideFinalWidth = rightSideWidth;
		let effectiveTaskProgress = taskProgress;
		if (effectiveTaskProgress && totalNeeded + taskProgressWidth > width) {
			// Not enough room for stats + tracker + model — drop the tracker first.
			effectiveTaskProgress = undefined;
		}
		if (totalNeeded > width) {
			// Stats + model still don't fit — truncate the right side (unchanged behavior).
			const availableForRight = Math.max(0, width - statsLeftWidth - minPadding);
			if (availableForRight > 0) {
				rightSideFinal = truncateToWidth(rightSide, availableForRight, "");
				rightSideFinalWidth = visibleWidth(rightSideFinal);
			}
		}

		const dimStatsLeft = theme.fg("dim", statsLeft);
		const dimRight = theme.fg("dim", rightSideFinal);
		const taskProgressWidthFinal = effectiveTaskProgress ? visibleWidth(effectiveTaskProgress) : 0;
		// The tracker adds a separator space before it — count it so the stats line
		// is exactly one terminal column wide, not width+1.
		const separatorWidth = effectiveTaskProgress ? 1 : 0;
		const padding = " ".repeat(
			Math.max(0, width - statsLeftWidth - taskProgressWidthFinal - rightSideFinalWidth - separatorWidth),
		);
		const statsLine = effectiveTaskProgress
			? `${dimStatsLeft} ${effectiveTaskProgress}${padding}${dimRight}`
			: `${dimStatsLeft}${padding}${dimRight}`;

		// Apply dim to each part separately. statsLeft may contain color codes (for context %)
		// Dim statsLeft and rightSide separately: statsLeft may contain color codes
		// (for context %) that end with a reset, which would clear an outer dim wrapper.
		// The task tracker keeps its own success/accent/error colors.
		const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
		const lines = [pwdLine, statsLine];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
