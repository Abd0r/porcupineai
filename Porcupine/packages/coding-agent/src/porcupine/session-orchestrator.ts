import { join } from "node:path";
import {
	type CapabilityTree,
	type ExecutionPlan,
	PorcupineAgentRuntime,
	type RuntimeEvent,
	type RuntimePrepareResult,
	UserPatternLearningLoop,
} from "@porcupineai/agent-core";
import { createNodeUserPatternLearningAdapters } from "@porcupineai/agent-core/node";
import { createAutonomousCapabilityLearner } from "./capability-learning.ts";
import { extractUserPatternsHeuristic } from "./memory-store.ts";
import { createUserWriteGuard } from "./memory-write-guard.ts";
import { createHeuristicRuntimeAdapters } from "./session-adapters.ts";

export type TaskGraphStepStatus = "pending" | "active" | "done" | "failed" | "skipped";

export interface TaskGraphStepView {
	id: string;
	objective: string;
	capabilityIds: string[];
	status: TaskGraphStepStatus;
}

export interface TaskGraphView {
	objective: string;
	status: "idle" | "planning" | "ready" | "running" | "blocked" | "done" | "failed";
	steps: TaskGraphStepView[];
	routeSummary: string[];
}

export interface PrepareTurnResult {
	prepare: RuntimePrepareResult;
	contextBlock: string;
	taskGraph: TaskGraphView;
}

/** Model-led (non-plan) turns cap their live graph so the UI stays compact. */
const MAX_DYNAMIC_STEPS = 12;

/**
 * Whether a capability id refers to the given tool. Exact id or a path/colon
 * suffix only — never a bare substring ("git" must not match "github").
 */
function capabilityMatches(capabilityId: string, needle: string): boolean {
	const lower = capabilityId.toLowerCase();
	return lower === needle || lower.endsWith(`:${needle}`) || lower.endsWith(`/${needle}`);
}

export interface PorcupineSessionOrchestratorOptions {
	getCapabilities: () => CapabilityTree;
	/** ~/.porcupine/agent or equivalent — used for USER.md + skill learning. */
	configDir?: string;
	/**
	 * Learn durable user patterns into USER.md from preference language.
	 * Default true when configDir is set.
	 */
	enableUserPatterns?: boolean;
	/**
	 * Autonomous capability learning: draft/activate skill stubs on missing/failed capabilities.
	 * Default true when configDir is set.
	 */
	enableCapabilityLearning?: boolean;
	onEvent?: (event: RuntimeEvent) => void | Promise<void>;
}

function emptyGraph(): TaskGraphView {
	return { objective: "", status: "idle", steps: [], routeSummary: [] };
}

function graphFromPrepare(prepare: RuntimePrepareResult): TaskGraphView {
	const steps =
		prepare.plan?.steps.map((step) => ({
			id: step.id,
			objective: step.objective,
			capabilityIds: step.capabilityIds.slice(),
			status: "pending" as const,
		})) ?? [];

	return {
		objective: prepare.intent.objective,
		status: prepare.status === "blocked" ? "blocked" : "ready",
		steps,
		routeSummary: prepare.route.matches.map((match) => match.capability.id),
	};
}

export function formatPlanContextBlock(prepare: RuntimePrepareResult): string {
	const lines = ["[Porcupine orchestration]", `Objective: ${prepare.intent.objective}`, `Status: ${prepare.status}`];

	if (prepare.route.matches.length > 0) {
		lines.push(`Routed capabilities: ${prepare.route.matches.map((match) => match.capability.id).join(", ")}`);
	}

	if (prepare.userLearning?.status === "updated") {
		lines.push(
			`User patterns learned: ${prepare.userLearning.accepted.map((p) => p.fact).join("; ") || "(updated)"}`,
		);
	}

	if (prepare.learning?.status === "activated") {
		lines.push(
			`Capability learning activated: ${prepare.learning.proposal?.id ?? "skill"} — ${prepare.learning.proposal?.summary ?? ""}`,
		);
	} else if (prepare.learning?.status === "rejected") {
		lines.push(`Capability learning rejected: ${prepare.learning.reasons.join("; ")}`);
	}

	if (prepare.status === "blocked") {
		lines.push(`Blocked on missing capabilities: ${prepare.missingCapabilityQueries.join(", ") || "(none listed)"}`);
		lines.push("Continue with best available tools and say what is missing if blocked.");
		return lines.join("\n");
	}

	if (prepare.plan && prepare.plan.steps.length > 0) {
		lines.push("Plan:");
		for (const [index, step] of prepare.plan.steps.entries()) {
			lines.push(`  ${index + 1}. [${step.id}] ${step.objective} {${step.capabilityIds.join(", ")}}`);
		}
		lines.push("Follow this plan unless the user request clearly requires a better path. Verify outcomes.");
	}

	return lines.join("\n");
}

export function summarizePlan(plan: ExecutionPlan | undefined): string {
	if (!plan?.steps?.length) return "(no plan)";
	return plan.steps.map((s, i) => `${i + 1}. ${s.objective}`).join("\n");
}

/**
 * Session-facing Porcupine controller: prepare each turn, track task graph, hand off execution to the agent.
 */
export class PorcupineSessionOrchestrator {
	private readonly getCapabilities: () => CapabilityTree;
	private readonly configDir?: string;
	private readonly enableUserPatterns: boolean;
	private readonly enableCapabilityLearning: boolean;
	private readonly onEvent?: (event: RuntimeEvent) => void | Promise<void>;
	private taskGraph: TaskGraphView = emptyGraph();
	private lastPrepare?: RuntimePrepareResult;
	/** True while the current turn has an explicit /plan graph (steps are authoritative). */
	private explicitPlan = false;

	constructor(options: PorcupineSessionOrchestratorOptions) {
		this.getCapabilities = options.getCapabilities;
		this.configDir = options.configDir;
		// Memory/user modeling is AGENT-DECIDED via the memory tool. Automatic
		// user-pattern and capability learning is opt-in only (explicitly
		// enabled by a surface), never on by default — auto-saves fill junk.
		this.enableUserPatterns = options.enableUserPatterns ?? false;
		this.enableCapabilityLearning = options.enableCapabilityLearning ?? false;
		this.onEvent = options.onEvent;
	}

	getTaskGraph(): TaskGraphView {
		return {
			...this.taskGraph,
			steps: this.taskGraph.steps.map((step) => ({ ...step, capabilityIds: step.capabilityIds.slice() })),
			routeSummary: this.taskGraph.routeSummary.slice(),
		};
	}

	getLastPrepare(): RuntimePrepareResult | undefined {
		return this.lastPrepare;
	}

	private createRuntime(): PorcupineAgentRuntime {
		const capabilities = this.getCapabilities();
		const adapters = createHeuristicRuntimeAdapters(capabilities);

		let userPatternLearner: UserPatternLearningLoop | undefined;
		if (this.enableUserPatterns && this.configDir) {
			const rootDir = this.configDir;
			const adapters = createNodeUserPatternLearningAdapters({
				rootDir,
				async extract(message: string) {
					return extractUserPatternsHeuristic(message);
				},
			});
			// Snapshot + content-hash guard USER.md before autonomous user-pattern writes
			// so a rollback refuses to clobber a later independent edit.
			const writeGuard = createUserWriteGuard(rootDir, (relative) => join(rootDir, relative));
			userPatternLearner = new UserPatternLearningLoop({
				...adapters,
				writeUserFile: writeGuard.wrapUserWrite(adapters.writeUserFile.bind(adapters)),
			});
		}

		const capabilityLearner =
			this.enableCapabilityLearning && this.configDir
				? createAutonomousCapabilityLearner(this.configDir)
				: undefined;

		return new PorcupineAgentRuntime({
			capabilities,
			adapters,
			userPatternLearner,
			capabilityLearner,
			onEvent: this.onEvent,
		});
	}

	async prepareTurn(prompt: string, signal?: AbortSignal): Promise<PrepareTurnResult> {
		this.taskGraph = {
			objective: prompt.trim().slice(0, 240),
			status: "planning",
			steps: [],
			routeSummary: [],
		};

		const runtime = this.createRuntime();
		const prepare = await runtime.prepare(prompt, signal);
		this.lastPrepare = prepare;
		this.taskGraph = graphFromPrepare(prepare);
		this.explicitPlan = true;

		const contextBlock = formatPlanContextBlock(prepare);

		return {
			prepare,
			contextBlock,
			taskGraph: this.getTaskGraph(),
		};
	}

	markStep(stepId: string, status: TaskGraphStepStatus): void {
		const idx = this.taskGraph.steps.findIndex((step) => step.id === stepId);
		if (idx < 0) return;
		const steps = this.taskGraph.steps.slice();
		steps[idx] = { ...steps[idx]!, status };
		this.taskGraph = { ...this.taskGraph, steps };
	}

	setGraphStatus(status: TaskGraphView["status"]): void {
		this.taskGraph = { ...this.taskGraph, status };
	}

	/** Mark the prepared graph as actively executing. */
	markRunning(): void {
		if (this.taskGraph.steps.length === 0 && this.taskGraph.status === "idle") return;
		this.taskGraph = { ...this.taskGraph, status: "running" };
	}

	/**
	 * Start of a new ordinary (non-plan) turn: drop the previous turn's graph so
	 * the footer tracker and chat graph reflect only the current turn. Explicit
	 * plan graphs are rebuilt by prepareTurn() anyway.
	 */
	resetDynamicGraph(): void {
		this.explicitPlan = false;
		if (this.taskGraph.status !== "idle") {
			this.taskGraph = emptyGraph();
		}
	}

	/**
	 * Model-led turns (no explicit plan): build a live task graph from actual
	 * tool calls. Consecutive same-tool calls collapse into one step (a phase);
	 * a new step starts when the tool changes, capped at MAX_DYNAMIC_STEPS.
	 * No-op while an explicit plan graph is active (plan steps are authoritative).
	 */
	ensureDynamicStep(toolName: string): void {
		if (this.explicitPlan) return;
		const needle = toolName.toLowerCase();
		const existing = this.taskGraph.steps;
		const last = existing[existing.length - 1];

		// Same tool as the last phase and already active is a true no-op: the
		// only branch that would run would re-set the same step to "active", so
		// early-return before any allocation. Preserves the observable graph.
		if (last && last.status === "active" && last.capabilityIds.some((id) => id === `tool:${needle}`)) {
			return;
		}

		// Copy-on-write the *tail only*: reuse the unchanged prefix step references.
		// Step objects are never mutated in place (every mutable path spreads into a
		// new object) and getTaskGraph() deep-clones, so sharing references across
		// internal graph snapshots is safe and produces the same observable graph
		// while turning the per-call O(n) full-array clone into O(1) allocations.
		const prefix = existing.slice(0, -1);
		let steps: TaskGraphStepView[];

		if (last?.capabilityIds.some((id) => id === `tool:${needle}`)) {
			// Same tool as the last phase — reactivate it (a continuation).
			steps = [...prefix, { ...last, status: "active" }];
		} else if (existing.length < MAX_DYNAMIC_STEPS) {
			steps = [
				...existing,
				{
					id: `dyn-${existing.length + 1}`,
					objective: needle,
					capabilityIds: [`tool:${needle}`],
					status: "active",
				},
			];
		} else {
			// Cap reached: the last step already belongs to a different tool. Repoint
			// it to the current tool so the live graph is not factually wrong about
			// which capability is active (still keeps the graph compact at the cap).
			steps = [...prefix, { ...last!, objective: needle, capabilityIds: [`tool:${needle}`], status: "active" }];
		}

		this.taskGraph = {
			objective: this.taskGraph.objective || "model-led turn",
			status: "running",
			steps,
			routeSummary: [],
		};
	}

	/**
	 * Activate the first pending plan step that references this tool name
	 * (match against capability id suffixes like tool:edit / stacks/.../edit).
	 */
	markStepForTool(toolName: string): void {
		const needle = toolName.toLowerCase();
		const steps = this.taskGraph.steps;
		const idx = steps.findIndex(
			(step) => step.status === "pending" && step.capabilityIds.some((id) => capabilityMatches(id, needle)),
		);
		if (idx < 0) {
			// No pending step references this tool: the steps are untouched and we
			// only flip the graph status to running (same observable result as
			// copying the array and re-assigning it).
			this.taskGraph = { ...this.taskGraph, status: "running" };
			return;
		}
		const stepsCopy = steps.slice();
		stepsCopy[idx] = { ...stepsCopy[idx]!, status: "active" };
		this.taskGraph = { ...this.taskGraph, status: "running", steps: stepsCopy };
	}

	/** Complete the active (or matching pending) step for a finished tool call. */
	markToolFinished(toolName: string, isError: boolean): void {
		const needle = toolName.toLowerCase();
		const status: TaskGraphStepStatus = isError ? "failed" : "done";
		const steps = this.taskGraph.steps;
		const idx = steps.findIndex(
			(step) => step.status === "active" && step.capabilityIds.some((id) => capabilityMatches(id, needle)),
		);
		if (idx < 0) {
			// No step matches this tool — do NOT complete an unrelated active step.
			// Leaving the graph unchanged is less wrong than advancing the wrong step.
			return;
		}
		const stepsCopy = steps.slice();
		stepsCopy[idx] = { ...stepsCopy[idx]!, status };
		const graphStatus = isError
			? "failed"
			: stepsCopy.every((s) => s.status === "done" || s.status === "skipped")
				? "done"
				: "running";
		this.taskGraph = { ...this.taskGraph, status: graphStatus, steps: stepsCopy };
	}

	/** True when any visible step already failed. Used to keep turn outcome honest. */
	hasFailedSteps(): boolean {
		return this.taskGraph.steps.some((step) => step.status === "failed");
	}

	/**
	 * Finish the turn; remaining pending steps become skipped on success.
	 * A turn with an already-failed step never reports done, even when the
	 * caller passes success=true (for example legacy unconditional calls).
	 */
	markTurnComplete(success: boolean): void {
		const hasFailure = this.taskGraph.steps.some((step) => step.status === "failed");
		const ok = success && !hasFailure;
		const steps = this.taskGraph.steps.map((step) => {
			if (step.status === "pending" || step.status === "active") {
				return { ...step, status: (ok ? "skipped" : "failed") as TaskGraphStepStatus };
			}
			return { ...step, capabilityIds: step.capabilityIds.slice() };
		});
		this.taskGraph = {
			...this.taskGraph,
			status: ok ? "done" : "failed",
			steps,
		};
	}

	/** Full analyze→plan→execute→verify path (non-interactive / tests). */
	async runAutonomous(prompt: string, signal?: AbortSignal) {
		const runtime = this.createRuntime();
		const result = await runtime.run(prompt, signal);
		if (result.plan) {
			this.taskGraph = {
				objective: result.intent.objective,
				status: result.status === "completed" ? "done" : result.status === "blocked" ? "blocked" : "failed",
				steps: result.plan.steps.map((step) => ({
					id: step.id,
					objective: step.objective,
					capabilityIds: step.capabilityIds.slice(),
					status:
						result.status === "completed"
							? ("done" as const)
							: result.results.find((r) => r.stepId === step.id)?.success === false
								? ("failed" as const)
								: ("done" as const),
				})),
				routeSummary: result.route.matches.map((m) => m.capability.id),
			};
		}
		return result;
	}
}
