import type { AgentTool, AgentToolUpdateCallback, StreamFn } from "@porcupineai/agent-core";
import { runSubagent, type SubagentProgressEvent, type SubagentResult } from "@porcupineai/agent-core";
import type { Model, TextContent } from "@porcupineai/ai";
import { type Static, Type } from "typebox";
import { subagentLazyPoolNames } from "../../porcupine/lazy-tool-activation.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { formatAgentTag, SubagentNamePool } from "../subagent-names.ts";

export interface SubagentToolSettings {
	model?: string;
	maxSteps: number;
	contextWindow: number;
	maxConcurrent: number;
	/** Effective sub-agent name pool (settings override or buck/fudgy/tinker). */
	names: [string, string, string];
}

export interface SubagentToolOptions {
	/** Live tool registry so the sub-agent can be handed a curated subset of the real tools. */
	getToolRegistry: () => Map<string, AgentTool<any>>;
	/** Resolve a model from a "provider/model" spec; falls back to the parent model when unset. */
	resolveModel: (spec: string | undefined) => Model<any> | undefined;
	/** Parent session stream function (reused for the sub-agent's model calls). */
	getStreamFn: () => StreamFn;
	getApiKey?: () => ((provider: string) => Promise<string | undefined> | string | undefined) | undefined;
	/** Live sub-agent settings from settings.json. */
	getSettings: () => SubagentToolSettings;
	/** Called for every progress event so the TUI can render the footer activity chip. */
	onEvent?: (event: SubagentProgressEvent) => void;
	/** True when the sub-agent capacity (maxConcurrent) is reached. */
	getActiveSubagentRuns?: () => number;
	/** Called when a background sub-agent finishes; the session injects its report. */
	onComplete?: (id: string, result: SubagentResult) => void | Promise<void>;
	/** Called when a background sub-agent starts; registers a cancel handle. */
	onRegister?: (id: string, cancel: () => void) => void;
	/** Claim a human tag for a new run id (session-owned pool). Falls back to a local pool when unset. */
	claimName?: (id: string, preferred?: string, task?: string) => string;
	/** Live agents for the spawn roster (tags + short task excerpts). */
	getActiveAgents?: () => Array<{ tag: string; task: string }>;
	/** Called when a background sub-agent settles; removes its cancel handle. */
	onUnregister?: (id: string) => void;
	/** Web of Thoughts (WoT): shared peer-messaging bus for open agent addressing. */
	getMessageBus?: () => import("../subagent-messaging.ts").SubagentMessageBus | undefined;
	/** WoT: called with a live steer handle so the session can inject messages into this sub-agent's context instantly. */
	onRegisterSteer?: (id: string, steer: (text: string) => void) => void;
}

/**
 * Tools the sub-agent is allowed to use — the whole stack minus interactive
 * and agent-level tools:
 * - subagent: no recursion (a sub-agent must never spawn sub-agents)
 * - ask_question: workers cannot ask the user
 * - computer_use: GUI control is attended-only by design
 * - tasks / projects: agent-level durable state owned by the main agent
 * Skills are reachable via capability_search + read, so sub-agents get the
 * full skill catalog and can match main-agent performance.
 */
const SUBAGENT_TOOL_NAMES = [
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"write",
	"edit",
	"web_search",
	"web_extract",
	"capability_search",
	"session_search",
	"mcp_resources",
	"memory",
	"literature",
] as const;

/**
 * Messaging tools handed to every bus-registered sub-agent (open addressing):
 * any running agent may message any other running agent by @tag, including
 * @porcupine (the main agent). The bus keeps the full audit trail.
 */
function buildMessagingTools(bus: import("../subagent-messaging.ts").SubagentMessageBus, id: string): AgentTool<any>[] {
	return [
		{
			name: "send_message",
			label: "send_message",
			description: `Send a message to any running agent by @tag (e.g. @buck) or id — a peer sub-agent or @porcupine, the main agent. Use check_messages to receive replies.`,
			parameters: Type.Object({
				to: Type.String({ description: "Target agent tag (@buck) or id." }),
				text: Type.String({ description: "Message text (<= 4000 chars)." }),
			}),
			execute: async (_callId: string, params: unknown) => {
				const args = params as { to: string; text: string };
				const result = bus.send(id, args.to, args.text);
				return result.ok
					? { content: [{ type: "text", text: `sent to ${args.to}` }], details: {} }
					: {
							content: [{ type: "text", text: `send failed: ${result.error}` }],
							details: { isError: true },
						};
			},
		},
		{
			name: "check_messages",
			label: "check_messages",
			description:
				"Check for incoming messages from other agents. Returns any messages addressed to you (draining the queue).",
			parameters: Type.Object({}),
			execute: async () => {
				const messages = bus.drainInbox(id);
				const text =
					messages.length === 0
						? "No messages."
						: messages.map((m) => `[from ${bus.displayRef(m.from)}] ${m.text}`).join("\n\n");
				return { content: [{ type: "text", text }], details: { messageCount: messages.length } };
			},
		},
	];
}

/**
 * Spawn-time roster paragraph: who else is active right now, so a new
 * worker never starts blind. Empty when nobody else is active.
 */
export function buildSpawnRoster(peers: Array<{ tag: string; task: string }>): string {
	if (peers.length === 0) return "";
	return `\n\nActive agents right now: @porcupine (main, your parent)${peers.map((peer) => `, ${peer.tag} (${peer.task})`).join("")}. They have been told you just came online.`;
}

const SUBAGENT_SYSTEM_PROMPT = `You are {tag}, a Porcupine sub-agent: a focused, disposable worker with an isolated context window and a hard step/token budget.

Rules:
- Complete the assigned task using the tools provided. Work autonomously and efficiently.
- You have the whole Porcupine stack: filesystem, discovery, shell, web, vcs, build, debug, data, sci, ml, docs, and more. capability_search first, then pick, then use it. Knowing web_search, bash, or read is not a skip. If the match is not obvious, capability_search action=list. Load a matching SKILL.md and follow it. Never guess a tool name.
- Prefer concrete file paths and verified command output. Never invent files, symbols, or test output.
- Keep your report concise: state what was done, key findings, and exact file paths touched.
- Stop as soon as the task is complete. Do not gold-plate — every extra step spends budget.
- Your final message is the report returned to the parent agent.`;

const subagentSchema = Type.Object({
	task: Type.String({
		description:
			"Exact task for the sub-agent. Include the input (paths, text, URLs), what to produce, and where to put results.",
	}),
	notes: Type.Optional(
		Type.String({
			description: "Optional context/constraints for the sub-agent (background, gotchas, do-not-touch paths).",
		}),
	),
	/**
	 * WoT (Web of Thoughts): optional peer-group label (shown in status views).
	 * Messaging is open: any running agent may message any other by @tag.
	 */
	peerGroup: Type.Optional(
		Type.String({
			description: "Optional peer-group label for status views (messaging is open regardless).",
			minLength: 2,
			maxLength: 48,
		}),
	),
	/** Optional tag name for this sub-agent (@name). Falls back to the next free default when taken or invalid. */
	name: Type.Optional(
		Type.String({
			description:
				"Optional tag for this sub-agent (e.g. buck, addressable as @buck). Lowercase letters, digits, hyphens.",
			minLength: 1,
			maxLength: 24,
		}),
	),
});

export type SubagentToolInput = Static<typeof subagentSchema>;

export interface SubagentToolDetails {
	started: boolean;
	ok?: boolean;
	steps?: number;
	contextTokens?: number;
	budgetExhausted?: boolean;
}

function textResult(
	text: string,
	details: Record<string, unknown> = {},
): {
	content: TextContent[];
	details: Record<string, unknown>;
} {
	return { content: [{ type: "text", text }], details };
}

/**
 * Local fallback pool for tool uses without a session-owned pool (tests,
 * headless). Rebuilt when the configured names change.
 */
let fallbackPoolKey = "";
let fallbackPool: SubagentNamePool | undefined;
function fallbackNamePool(names: [string, string, string]): SubagentNamePool {
	const key = JSON.stringify(names);
	if (!fallbackPool || fallbackPoolKey !== key) {
		fallbackPoolKey = key;
		fallbackPool = new SubagentNamePool(names);
	}
	return fallbackPool;
}
function releaseFallbackName(id: string): void {
	fallbackPool?.release(id);
}

export function createSubagentToolDefinition(options: SubagentToolOptions): ToolDefinition {
	const getActiveSubagentRuns = options.getActiveSubagentRuns ?? (() => 0);
	return {
		name: "subagent",
		label: "subagent",
		description:
			"Start a focused sub-agent in the background: fresh context window (128K–256K), the full tool stack minus agent-level tools (no sub-spawning, no GUI, no user questions), hard step budget. Returns IMMEDIATELY with an id — the main agent keeps working while the sub-agent runs. When the sub-agent finishes, its report is injected into the session INSTANTLY: steered into the running turn if you are mid-task, or a fresh turn is started if you are idle — the report lands in your context without waiting for the next user prompt. Up to subagent.maxConcurrent run at a time (default 3). Each run gets a @tag (buck/fudgy/tinker by default, or pass `name`) returned with its id. WoT (Web of Thoughts): every sub-agent carries send_message/check_messages and any running agent may message any other by @tag, including @porcupine (you); use send_to_subagent to steer a running sub-agent yourself.",
		promptSnippet: "Spawn an isolated sub-agent for a focused task",
		promptGuidelines: [
			"Use subagent for self-contained work that would otherwise pollute the main context (long research, big refactors, multi-file drafts).",
			"Give an exact task: input paths/URLs, what to produce, and where to put results. Add notes for constraints.",
			"subagent returns immediately and runs in the background: continue your own work, and the report is injected into your context the moment it finishes (steer if mid-turn, fresh turn if idle) — then fold the result into your work.",
			"The sub-agent shares your cwd, permission policy, and safety gates. It cannot spawn sub-agents and cannot ask the user questions.",
			"You can STOP a running sub-agent directly with stop_subagent (by id, or all of them) when it is stuck, off-track, or no longer needed — a stopped run reports '\u23f9 cancelled'. The user can also cancel all running sub-agents with Escape on an empty editor. Run abort always stops a runaway sub-agent at its budget.",
			"Up to subagent.maxConcurrent sub-agents run at a time (default 3; set it in settings or just ask).",
			"WoT: every sub-agent can message any other by @tag (and @porcupine reaches you); use send_to_subagent to steer a running sub-agent. peerGroup is an optional status label.",
			"It runs on its own model (cheap by default, set via subagent.model).",
		],
		parameters: subagentSchema,
		async execute(
			_toolCallId: string,
			args: SubagentToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<unknown> | undefined,
			_ctx: ExtensionContext,
		) {
			const settings = options.getSettings();
			const activeRuns = getActiveSubagentRuns();
			if (activeRuns >= settings.maxConcurrent) {
				return textResult(
					`Sub-agent capacity reached (${activeRuns}/${settings.maxConcurrent} running). Wait for one to finish, or raise subagent.maxConcurrent in settings.`,
					{ started: false },
				);
			}

			const model = options.resolveModel(settings.model);
			if (!model) {
				return textResult(
					`Could not resolve sub-agent model${settings.model ? ` "${settings.model}"` : ""}. Set subagent.model in settings (e.g. "opencode-go/deepseek-v4-flash") or fix the provider.`,
					{ started: false },
				);
			}

			const registry = options.getToolRegistry();
			const tools = SUBAGENT_TOOL_NAMES.map((name) => registry.get(name)).filter(
				(tool): tool is AgentTool<any> => tool !== undefined,
			);
			// Dormant pool for worker lazy activation: registry tools outside the
			// curated set, minus worker-excluded names (agent-level lifecycle +
			// sensitive tier). Workers can never guess their way into tasks,
			// projects, computer_use, or outbound sends.
			const lazyTools = subagentLazyPoolNames(
				registry.keys(),
				tools.map((tool) => tool.name),
			)
				.map((name) => registry.get(name))
				.filter((tool): tool is AgentTool<any> => tool !== undefined);
			const streamFn = options.getStreamFn();
			const getApiKey = options.getApiKey?.();

			// Every bus-registered sub-agent carries send/check tools (open addressing).
			// peerGroup is an optional status label, not a messaging gate.
			const peerGroup = args.peerGroup?.trim();
			const bus = options.getMessageBus?.();

			// BACKGROUND execution: the tool returns immediately with an id; the
			// main agent keeps working while the sub-agent runs. When the sub-agent
			// finishes, options.onComplete injects its report into the session
			// (visible in the TUI and in the main agent's next-turn context).
			const id = `sa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			const name = options.claimName
				? options.claimName(id, args.name, args.task)
				: fallbackNamePool(settings.names).claim(id, args.name);
			const tag = formatAgentTag(name);
			if (bus) bus.register(id, peerGroup && peerGroup.length > 0 ? peerGroup : "open", name);
			const controller = new AbortController();

			const emit = (event: SubagentProgressEvent) => {
				// Progress goes to the dedicated sub-agent channel (footer activity
				// chip + thread counter). Never
				// forward via onUpdate — the TUI treats onUpdate as a partial tool
				// result and would crash rendering content-less progress events.
				options.onEvent?.({ ...event, subagentId: id });
			};

			const roster = (options.getActiveAgents?.() ?? []).filter((peer) => peer.tag !== tag);
			const systemPrompt =
				SUBAGENT_SYSTEM_PROMPT.replace("{tag}", tag) +
				(bus
					? `\n\nYou can message any running agent by @tag via send_message and read incoming via check_messages — a peer sub-agent or @porcupine, the main agent who spawned you. Address peers by @tag, never by guessing ids.`
					: "") +
				buildSpawnRoster(roster);
			const promise = runSubagent({
				task: args.task,
				notes: args.notes,
				model,
				streamFn,
				getApiKey,
				lazyTools,
				tools: bus ? [...tools, ...buildMessagingTools(bus, id)] : tools,
				systemPrompt,
				maxSteps: settings.maxSteps,
				maxContextTokens: settings.contextWindow,
				signal: controller.signal,
				onProgress: emit,
				registerSteer: (steer) => {
					// WoT: the session can inject messages into this sub-agent's live
					// context instantly (steering queue polled by the running loop).
					options.onRegisterSteer?.(id, steer);
				},
			});
			// Register a cancel handle so the session can stop this sub-agent
			// (Escape / session abort). Removed once the run settles.
			options.onRegister?.(id, () => controller.abort());
			void promise
				.then((result) => {
					// Report injection is SEPARATE from the sub-agent run: if the
					// onComplete callback (which injects the report into the session)
					// throws, that must NOT fabricate a failed result for a sub-agent
					// that actually succeeded (BUG-9). Swallow the report error only.
					Promise.resolve()
						.then(() => options.onComplete?.(id, result))
						.catch((reportError: unknown) => {
							console.error(`[subagent ${id}] report-injection failed:`, reportError);
						});
				})
				.catch((runError) => {
					// Only a genuinely failed/errored sub-agent run reaches here — not a
					// report-injection failure.
					options.onEvent?.({
						type: "done",
						subagentId: id,
						result: {
							ok: false,
							summary: "",
							steps: 0,
							usage: { inputTokens: 0, outputTokens: 0, contextTokens: 0 },
							messages: [],
							budgetExhausted: false,
							error: runError instanceof Error ? runError.message : String(runError),
						},
					});
				})
				.finally(() => {
					// Unregister from the bus FIRST so a send to a settled id is
					// refused ("unknown agent") instead of queued into a dead inbox;
					// then drop the steerer/cancel handles.
					if (bus) bus.unregister(id);
					if (!options.claimName) releaseFallbackName(id);
					options.onUnregister?.(id);
				});

			return {
				content: [
					{
						type: "text",
						text: `Sub-agent started (${tag}, id: ${id}) — ${
							settings.model ?? "parent model"
						}, max ${settings.maxSteps} steps, ~${settings.contextWindow.toLocaleString()} ctx. Message or stop it by tag (${tag}) or id. Continue working normally; its report will be added to this conversation when it finishes.`,
					},
				],
				details: {
					started: true,
					id,
					name,
					tag,
					background: true,
				},
			};
		},
	};
}

/**
 * Fallback definition for callers without a session (no registry/model access).
 * Always reports that sub-agents are unavailable in this context.
 */
export function createUnavailableSubagentToolDefinition(): ToolDefinition {
	return {
		name: "subagent",
		label: "subagent",
		description: "Run a focused task in an isolated sub-agent (fresh context, curated tools, budgeted steps).",
		parameters: subagentSchema,
		async execute() {
			return textResult("Sub-agents are not available in this context.", { started: false });
		},
	};
}

// ---------------------------------------------------------------------------
// WoT: main → sub instant messaging
// ---------------------------------------------------------------------------

export interface SendToSubagentToolOptions {
	/** Inject a message into a running sub-agent's live context. Returns false when the ref is not running. */
	send: (to: string, text: string) => boolean;
	/** Live running sub-agent tags (for the error message). */
	getActiveRefs: () => string[];
}

/** Main agent → running sub-agent: message is steered into its context instantly. */
export function createSendToSubagentToolDefinition(options: SendToSubagentToolOptions): ToolDefinition {
	return {
		name: "send_to_subagent",
		label: "send_to_subagent",
		description:
			"Send a message to a running sub-agent by @tag or id. It is injected into the sub-agent's LIVE context instantly — the sub-agent acts on it at its next step. Use it to steer a worker mid-task (refine the target, ask for a status, redirect). Only works for sub-agents spawned earlier in this session.",
		parameters: Type.Object({
			to: Type.String({ description: "Running sub-agent tag (@buck) or id." }),
			text: Type.String({ description: "Message text (<= 4000 chars)." }),
		}),
		async execute(_toolCallId: string, params: unknown) {
			const args = params as { to: string; text: string };
			if (!options.send(args.to, args.text)) {
				const active = options.getActiveRefs();
				return textResult(
					`No running sub-agent "${args.to}". Active: ${active.join(", ") || "none"} — only running sub-agents can be messaged.`,
					{ ok: false },
				);
			}
			return textResult(`Injected message into sub-agent ${args.to}.`);
		},
	};
}

/** Fallback for contexts without a session — messaging is unavailable. */
export function createUnavailableSendToSubagentToolDefinition(): ToolDefinition {
	return {
		name: "send_to_subagent",
		label: "send_to_subagent",
		description: "Send a message to a running sub-agent (injected into its live context).",
		parameters: Type.Object({
			to: Type.String(),
			text: Type.String(),
		}),
		async execute() {
			return textResult("Sub-agent messaging is not available in this context.", { ok: false });
		},
	};
}

// ---------------------------------------------------------------------------
// Main agent → stop running sub-agents
// ---------------------------------------------------------------------------

export interface StopSubagentToolOptions {
	/** Stop one sub-agent by tag or id. False when it already settled. */
	stop: (id: string) => boolean;
	/** Stop ALL running sub-agents; returns how many were stopped. */
	stopAll: () => number;
	/** Live running sub-agent tags (for the error message). */
	getActiveRefs: () => string[];
}

/** Main agent → running sub-agents: stop one or all immediately (cancels the run). */
export function createStopSubagentToolDefinition(options: StopSubagentToolOptions): ToolDefinition {
	return {
		name: "stop_subagent",
		label: "stop_subagent",
		description:
			"Stop one or all running sub-agents immediately. Pass a @tag or id to stop a single worker, or omit it to stop ALL. A stopped run reports '⏹ cancelled' instead of completing — use it when a worker is stuck, off-track, or no longer needed. Only works for sub-agents spawned earlier in this session.",
		parameters: Type.Object({
			id: Type.Optional(
				Type.String({ description: "Sub-agent tag (@buck) or id to stop. Omit to stop ALL running sub-agents." }),
			),
		}),
		async execute(_toolCallId: string, params: unknown) {
			const args = params as { id?: string };
			if (args.id) {
				if (!options.stop(args.id)) {
					const active = options.getActiveRefs();
					return textResult(`No running sub-agent "${args.id}". Active: ${active.join(", ") || "none"}.`, {
						stopped: 0,
					});
				}
				return textResult(`⏹ Stopped sub-agent ${args.id}.`, { stopped: 1 });
			}
			const count = options.stopAll();
			return textResult(
				count > 0 ? `⏹ Stopped ${count} sub-agent${count === 1 ? "" : "s"}.` : "No running sub-agents to stop.",
				{ stopped: count },
			);
		},
	};
}

/** Fallback for contexts without a session. */
export function createUnavailableStopSubagentToolDefinition(): ToolDefinition {
	return {
		name: "stop_subagent",
		label: "stop_subagent",
		description: "Stop one or all running sub-agents (cancels their run).",
		parameters: Type.Object({ id: Type.Optional(Type.String()) }),
		async execute() {
			return textResult("Sub-agents are not available in this context.", { stopped: 0 });
		},
	};
}
