import type { Model } from "@porcupineai/ai";
import { Agent } from "../agent.ts";
import { estimateTokens } from "../harness/compaction/compaction.ts";
import { convertToLlm } from "../harness/messages.ts";
import type { AgentMessage, AgentTool, AgentToolResult, StreamFn, ThinkingLevel } from "../types.ts";

/**
 * Porcupine sub-agent system.
 *
 * A sub-agent is an isolated context island: a fresh Agent instance with its
 * own conversation, a curated tool set, and hard budgets (steps + context
 * tokens). The parent agent spawns it via the `subagent` tool and receives a
 * structured result back — no context pollution, no daemon. Multiple
 * sub-agents may run concurrently up to `subagent.maxConcurrent`.
 */

export const DEFAULT_SUBAGENT_MAX_STEPS = 120;
export const DEFAULT_SUBAGENT_CONTEXT_TOKENS = 256_000;
/** Max compaction passes per sub-agent run before the context budget hard-stops. */
export const MAX_SUBAGENT_COMPACTIONS = 3;
/** Compaction triggers when the estimated context crosses this share of the window. */
const SUBAGENT_COMPACT_RATIO = 0.8;
/** Recent-history retention for the compacted context (share of the window). */
const SUBAGENT_KEEP_RATIO = 0.2;

/** Browser-safe UUID (no node:crypto import: the agent package bundles for browsers). */
function newUuid(): string {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
	return `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
/** Lower bound for the recommended 128K–256K sub-agent context window. */
export const SUBAGENT_CONTEXT_WINDOW_MIN = 128_000;
export const SUBAGENT_CONTEXT_WINDOW_MAX = 256_000;

export interface SubagentOptions {
	/** The task the sub-agent must complete. */
	task: string;
	/** Optional additional context (notes, constraints) injected before the task. */
	notes?: string;
	/** Model to run the sub-agent on (cheap/small model recommended, user-configurable). */
	model: Model<any>;
	/** Stream function wiring (reused from the parent session). */
	streamFn: StreamFn;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	/** Curated tool set for the sub-agent. */
	tools: AgentTool<any>[];
	/** System prompt describing the sub-agent's role and constraints. */
	systemPrompt: string;
	/** Maximum tool-call steps before the sub-agent stops gracefully. */
	maxSteps?: number;
	/** Maximum estimated context tokens before the sub-agent stops gracefully. */
	maxContextTokens?: number;
	thinkingLevel?: ThinkingLevel;
	/** Unique id forwarded to providers (cache-aware backends). */
	sessionId?: string;
	/** Progress callback wired to the TUI sub-agent panel. */
	onProgress?: (event: SubagentProgressEvent) => void;
	/**
	 * WoT: called with a steer function once the sub-agent's Agent is created.
	 * The parent can inject messages into the sub-agent's LIVE context instantly
	 * (steering messages are polled by the running loop before each response).
	 */
	registerSteer?: (steer: (text: string) => void) => void;
	/** Abort signal: cancels the sub-agent run. */
	signal?: AbortSignal;
}

export interface SubagentUsage {
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
}

export interface SubagentResult {
	ok: boolean;
	/** Final assistant text message (may be empty if budget stopped the run). */
	summary: string;
	/** Number of tool-call steps executed. */
	steps: number;
	usage: SubagentUsage;
	/** Full transcript of the sub-agent's isolated conversation. */
	messages: AgentMessage[];
	/** True when the run stopped because a budget (steps or context) was hit. */
	budgetExhausted: boolean;
	/** True when the run was cancelled via the abort signal. */
	cancelled?: boolean;
	error?: string;
}

export type SubagentProgressEvent =
	| { type: "start"; subagentId?: string; task: string; maxSteps: number; maxContextTokens: number }
	| { type: "step"; subagentId?: string; step: number; toolName: string; args?: unknown }
	| { type: "turn"; subagentId?: string; step: number; contextTokens: number }
	| { type: "compacting"; subagentId?: string; step: number; contextTokens: number }
	| { type: "done"; subagentId?: string; result: SubagentResult };

/**
 * Wrap a tool with a step counter. The counter is enforced at the tool-call
 * boundary so a runaway sub-agent can never exceed its budget: when the call
 * would cross maxSteps, the wrapper returns an aborted result BEFORE the
 * underlying tool executes (checking after onStep was too late — the
 * over-budget tool still ran).
 */
function withStepCounter(tool: AgentTool<any>, onStep: (toolName: string, args?: unknown) => boolean): AgentTool<any> {
	return {
		...tool,
		execute: async (...args: Parameters<AgentTool<any>["execute"]>): Promise<AgentToolResult<any>> => {
			const overBudget = onStep(tool.name, args[1]);
			if (overBudget) {
				return {
					content: [{ type: "text", text: "aborted: step budget exceeded" }],
					details: {},
				};
			}
			return tool.execute(...args);
		},
	};
}

function estimateContextTokens(systemPrompt: string, messages: AgentMessage[]): number {
	let total = Math.ceil(systemPrompt.length / 4);
	for (const message of messages) {
		total += estimateTokens(message);
	}
	return total;
}

function summarize(messages: AgentMessage[]): string {
	// Last assistant message text is the sub-agent's final answer.
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		const text = (message.content ?? [])
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (text.length > 0) return text;
	}
	return "";
}

function defaultSystemPrompt(taskLabel: string): string {
	return [
		"You are a Porcupine sub-agent: a focused, disposable worker with an isolated context window.",
		`Your task: ${taskLabel}`,
		"",
		"- Complete the task using the provided tools. Work autonomously.",
		"- Keep responses concise. Prefer concrete file paths and verified command output.",
		"- You have a hard step and context budget. Stop as soon as the task is done — do not gold-plate.",
		"- Your final message is the report returned to the parent agent: state what was done, key findings, and exact file paths touched.",
	].join("\n");
}

export async function runSubagent(options: SubagentOptions): Promise<SubagentResult> {
	const maxSteps = options.maxSteps ?? DEFAULT_SUBAGENT_MAX_STEPS;
	const maxContextTokens = options.maxContextTokens ?? DEFAULT_SUBAGENT_CONTEXT_TOKENS;
	const systemPrompt = options.systemPrompt || defaultSystemPrompt(options.task.slice(0, 120));
	let steps = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let budgetHit = false;
	let stopRun: (() => void) | undefined;
	// Sub-agent compaction state: like the main agent, but self-contained — when
	// the estimated context crosses the threshold, summarize the conversation
	// with the sub-agent's own model and continue with [summary + recent tail]
	// instead of hard-stopping at the context wall. Steps, usage, abort, and
	// steering span the whole run across segments.
	let compactionCount = 0;
	let compactionRequested = false;
	let compactedContext: AgentMessage[] = [];
	const fullMessages: AgentMessage[] = [];

	options.onProgress?.({
		type: "start",
		task: options.task,
		maxSteps,
		maxContextTokens,
	});

	const toolWrappers = options.tools.map((tool) =>
		withStepCounter(tool, (toolName, toolArgs) => {
			steps += 1;
			const overBudget = steps > maxSteps;
			if (overBudget) {
				budgetHit = true;
				stopRun?.();
			}
			options.onProgress?.({ type: "step", step: steps, toolName, args: toolArgs });
			return overBudget;
		}),
	);

	const agent = new Agent({
		initialState: {
			model: options.model,
			systemPrompt,
			tools: toolWrappers,
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		streamFn: options.streamFn,
		getApiKey: options.getApiKey,
		sessionId: options.sessionId ? `${options.sessionId}/subagent` : undefined,
	});

	// WoT: hand the parent a live steer handle so messages can be injected into
	// this sub-agent's context instantly (the loop polls the steering queue).
	options.registerSteer?.((text: string) => {
		agent.steer({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});
	});

	agent.subscribe((event) => {
		if (event.type === "turn_end") {
			const contextTokens = estimateContextTokens(systemPrompt, agent.state.messages);
			inputTokens = Math.max(inputTokens, contextTokens);
			const content =
				event.message && "content" in event.message && Array.isArray(event.message.content)
					? event.message.content
					: [];
			outputTokens += content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.reduce((total, part) => total + part.text.length, 0);
			if (contextTokens > maxContextTokens * SUBAGENT_COMPACT_RATIO) {
				if (compactionCount < MAX_SUBAGENT_COMPACTIONS) {
					compactionCount += 1;
					compactionRequested = true;
					options.onProgress?.({ type: "compacting", step: steps, contextTokens });
				} else {
					// Compaction could not keep up: hard stop at the context wall.
					budgetHit = true;
				}
				stopRun?.();
			}
			options.onProgress?.({ type: "turn", step: steps, contextTokens });
		}
	});

	stopRun = () => agent.abort();

	// Consume the abort signal: a cancel (e.g. user Escape, session abort) stops
	// the sub-agent mid-run. If the signal is already aborted, never start it.
	let aborted = options.signal?.aborted ?? false;
	const onAbort = () => {
		aborted = true;
		stopRun?.();
	};
	if (!options.signal?.aborted) {
		options.signal?.addEventListener("abort", onAbort, { once: true });
	}

	let promptError: unknown;
	try {
		while (!aborted) {
			compactionRequested = false;
			if (fullMessages.length === 0) {
				await agent.prompt(options.notes ? `${options.notes}\n\n${options.task}` : options.task);
			} else {
				await agent.prompt(compactedContext);
			}
			if (!compactionRequested) break;
			// This segment ended because the context threshold was crossed:
			// summarize it, retain the recent tail, and resume the same task.
			const segment = agent.state.messages;
			fullMessages.push(...segment);
			try {
				const summary = await summarizeSubagentConversation(
					segment,
					options.model,
					options.streamFn,
					maxContextTokens,
					options.signal,
				);
				compactedContext = [
					{
						role: "user",
						content: [{ type: "text", text: `[Compacted summary of earlier work]\n${summary}` }],
						timestamp: Date.now(),
					},
					...keepRecentTail(segment, maxContextTokens),
				];
				agent.reset();
			} catch (error) {
				// Summarization failed: fall back to the hard context stop.
				budgetHit = true;
				promptError = error;
				break;
			}
		}
	} catch (error) {
		promptError = error;
	}
	options.signal?.removeEventListener("abort", onAbort);
	fullMessages.push(...agent.state.messages);
	const messages = fullMessages;
	// The StreamFn contract encodes model/API failures as an assistant message
	// with stopReason "error" (it does not throw), so promptError alone misses
	// them: without this, a sub-agent whose LLM call failed was reported
	// ok:true with an empty summary. Surface the last assistant error.
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
	const llmError = lastAssistant?.errorMessage ?? (lastAssistant?.stopReason === "error" ? "model error" : undefined);
	const failed = budgetHit || aborted || promptError !== undefined || llmError !== undefined;
	const result: SubagentResult = {
		ok: !failed,
		summary: summarize(messages),
		steps,
		usage: {
			inputTokens,
			outputTokens: Math.ceil(outputTokens / 4),
			contextTokens: estimateContextTokens(systemPrompt, messages),
		},
		messages,
		budgetExhausted: budgetHit,
		cancelled: aborted,
		error: aborted
			? "sub-agent cancelled"
			: budgetHit
				? `sub-agent budget exhausted (${maxSteps} steps, ${maxContextTokens} ctx)`
				: llmError !== undefined
					? `sub-agent failed: ${llmError}`
					: promptError instanceof Error
						? promptError.message
						: promptError !== undefined
							? String(promptError)
							: undefined,
	};
	options.onProgress?.({ type: "done", result });
	return result;
}

/** Clamp a user-configured sub-agent context window into the supported 128K–256K range. */
export function normalizeContextWindow(value: number | undefined): number {
	if (value === undefined || Number.isNaN(value)) return DEFAULT_SUBAGENT_CONTEXT_TOKENS;
	return Math.min(SUBAGENT_CONTEXT_WINDOW_MAX, Math.max(SUBAGENT_CONTEXT_WINDOW_MIN, Math.round(value)));
}

/**
 * Summarize a sub-agent conversation with its own model (a standalone,
 * cache-isolated call) so the compacted context stays self-contained.
 */
async function summarizeSubagentConversation(
	messages: AgentMessage[],
	model: Model<any>,
	streamFn: StreamFn | undefined,
	maxContextTokens: number,
	signal?: AbortSignal,
): Promise<string> {
	if (!streamFn) throw new Error("sub-agent compaction requires a stream function");
	const prompt = [
		"You are summarizing a sub-agent's conversation for context compaction.",
		"Produce a dense, factual summary: the task, everything decided and done so far, exact file paths and findings, and unresolved items.",
		"Keep it under 500 words. Do not add anything not present in the conversation.",
	].join("\n");
	const stream = await streamFn(
		model,
		{ systemPrompt: prompt, messages: convertToLlm(messages), tools: [] },
		{
			maxTokens: Math.min(Math.floor(0.8 * Math.floor(maxContextTokens * SUBAGENT_KEEP_RATIO)), 2000),
			signal,
			cacheRetention: "none",
			sessionId: newUuid(),
		},
	);
	const message = await stream.result();
	if (message.errorMessage || message.stopReason === "error") {
		throw new Error(message.errorMessage ?? "summarization failed");
	}
	const text = (message.content ?? [])
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
	if (!text) throw new Error("summarization returned no text");
	return text;
}

/** Retain the recent tail of a conversation within the keep-recent token budget. */
function keepRecentTail(messages: AgentMessage[], maxContextTokens: number): AgentMessage[] {
	// The tail must fit inside the headroom below the compaction threshold, so
	// a compacted context can never re-trigger compaction immediately.
	const headroom = Math.floor(maxContextTokens * (1 - SUBAGENT_COMPACT_RATIO));
	const budget = Math.min(
		Math.max(8000, Math.min(80000, Math.floor(maxContextTokens * SUBAGENT_KEEP_RATIO))),
		headroom,
	);
	let used = 0;
	const tail: AgentMessage[] = [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]!;
		const tokens = estimateTokens(message);
		if (used + tokens > budget && tail.length > 0) break;
		tail.unshift(message);
		used += tokens;
	}
	return tail;
}
