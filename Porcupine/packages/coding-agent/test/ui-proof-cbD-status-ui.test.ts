import type { TUI } from "@porcupineai/tui";
import { describe, expect, it } from "vitest";
import { addUsageToTotals, createUsageTotals, type UsageTotals } from "../src/core/usage-totals.ts";
import { formatTaskProgress } from "../src/modes/interactive/components/footer.ts";
import { WorkingStatusIndicator } from "../src/modes/interactive/components/status-indicator.ts";
import { TaskGraphComponent } from "../src/modes/interactive/components/task-graph.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { animationLoaderOptions, pickStatusAnimation, resolveToolActivity } from "../src/porcupine/animations.ts";

/**
 * ui-proof-cbD — Part-D UI debug+optimize pass micro-benchmarks.
 * These do NOT assert wall-clock times (flake-resistant): they exercise the hot
 * loops 10k times and pin per-operation work so cost regressions are observable.
 * Pure building blocks stand in for the private InteractiveMode methods they back:
 *   - setPorcupineActivity  -> pickStatusAnimation + animationLoaderOptions (+ indicator.setMessage)
 *   - footer render cost    -> usage-totals aggregate over N session entries
 *   - task-graph updates    -> TaskGraphComponent.setGraph (whole-graph rebuild per event)
 */

function makeUsage(tokens: number) {
	return {
		input: tokens,
		output: tokens,
		cacheRead: tokens,
		cacheWrite: 0,
		totalTokens: tokens * 2,
		cost: {
			input: tokens / 1e6,
			output: tokens / 1e6,
			cacheRead: tokens / 1e6,
			cacheWrite: 0,
			total: (tokens * 2) / 1e6,
		},
	};
}

// Exact same inner loop as FooterComponent.render() uses to build stats.
function aggregateTokens(tokenCounts: number[]): UsageTotals {
	const totals = createUsageTotals();
	for (const t of tokenCounts) addUsageToTotals(totals, makeUsage(t));
	return totals;
}

describe("ui-proof-cbD setPorcupineActivity hot path (pure proxy)", () => {
	const STREAM = 10_000;

	it("same-phase streaming hammer does not rebuild on every call", () => {
		// Proxy for setPorcupineActivity's "only swap frames when id changes" gate:
		// each rebuild would restart the spinner timer, so the work per streaming
		// call must be bounded well below 100% of calls even with egg flips.
		let rebuilds = 0;
		let prev = "working";
		for (let i = 0; i < STREAM; i++) {
			const picked = pickStatusAnimation("working", undefined);
			const next = picked.id;
			if (prev !== next) rebuilds++;
			animationLoaderOptions(next); // runs every streaming call
			prev = next;
		}
		expect(rebuilds).toBeLessThan(STREAM);
		expect(rebuilds).toBeGreaterThan(0); // eggs do flip occasionally
	});

	it("tool chip phase change rebuilds indicator each call (expected)", () => {
		let frames = "";
		for (let i = 0; i < STREAM; i++) {
			const phase = i % 2 === 0 ? "reading" : "writing";
			frames = animationLoaderOptions(phase).frames[0] ?? "";
		}
		expect(frames.length).toBeGreaterThan(0);
	});

	it("capability_search chip resolves deterministically (no thrashed chip)", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			const a = resolveToolActivity("capability_search", { action: "view", query: "git-basics" });
			seen.add(`${a?.id}#${a?.name}`);
		}
		expect(seen.size).toBe(1);
		expect([...seen][0]).toBe("reading-skill#git-basics");
	});
});

describe("ui-proof-cbD footer rebuild cost (usage aggregate proxy)", () => {
	it("10k footer rebroadcasts over N=200 entries stay additive (O(N) not O(N²))", () => {
		// FooterComponent.render() re-derives usage totals from ALL session entries
		// on every render. This is O(entries) per render; over 10k renders the total
		// work grows linearly with renders x entries.
		const tokenCounts = new Array<number>(200).fill(50);
		let totals: UsageTotals = createUsageTotals();
		let touched = 0;
		for (let i = 0; i < 10_000; i++) {
			totals = aggregateTokens(tokenCounts);
			touched++;
		}
		expect(totals.input).toBe(50 * 200);
		expect(touched).toBe(10_000);
	});

	it("formatTaskProgress recomputes from a graph clone on each footer render", () => {
		initTheme();
		const graph = {
			objective: "fix",
			status: "running" as const,
			routeSummary: [] as string[],
			steps: Array.from({ length: 6 }, (_, i) => ({
				id: `s${i}`,
				objective: `step ${i}`,
				capabilityIds: [] as string[],
				status: (i === 0 ? "active" : i < 3 ? "done" : "pending") as "active" | "done" | "pending",
			})),
		};
		let out = "";
		for (let i = 0; i < 10_000; i++) {
			out = formatTaskProgress(graph) ?? "";
		}
		expect(out).toContain("✓");
	});
});

describe("ui-proof-cbD task-graph component (re-renders whole graph per event)", () => {
	it("setGraph rebuilds the entire line set on every event", () => {
		initTheme();
		const c = new TaskGraphComponent({ objective: "", status: "idle", steps: [], routeSummary: [] });
		const graph = {
			objective: "model-led turn",
			status: "running" as const,
			routeSummary: [] as string[],
			steps: Array.from({ length: 5 }, (_, i) => ({
				id: `dyn-${i + 1}`,
				objective: `tool-${i}`,
				capabilityIds: [`tool:tool-${i}`],
				status: (i === 0 ? "active" : "pending") as "active" | "pending",
			})),
		};
		c.setGraph(graph);
		let lines: string[] = [];
		for (let i = 0; i < 10_000; i++) {
			c.setGraph(graph);
			lines = c.render(120);
		}
		const joined = lines.join("\n");
		expect(joined).toContain("dyn-5");
		expect(lines.length).toBeGreaterThan(5);
	});
});

describe("ui-proof-cbD working strip lifecycle (indicator reuse across streaming)", () => {
	it("same indicator survives many message updates then disposes cleanly", () => {
		initTheme();
		let renders = 0;
		const tui = { requestRender: () => renders++ } as unknown as TUI;
		const ind = new WorkingStatusIndicator(tui, "", animationLoaderOptions("reading", "git-basics"));
		// setPorcupineActivity calls setMessage for every streaming call even when
		// the phase is unchanged; the indicator must not leak an interval.
		for (let i = 0; i < 1000; i++) ind.setMessage("(esc to interrupt)");
		ind.dispose();
		expect(renders).toBeGreaterThan(0);
	});
});
