/**
 * Remote slash-command dispatcher for the attended chat bridges.
 *
 * Bridges (Telegram / Discord / iMessage) receive `/command args` lines from
 * authorized actors. The TUI's builtin slash handlers are private and
 * renderer-coupled, so this module reuses the SAME headless engines the TUI
 * handlers delegate to (session state, task store, goal/plan state, x/email
 * command engines, memory/changelog formatters) and returns plain text.
 *
 * Routing rules (mirrors the remote-command audit classification):
 *   - read/query commands   -> run the engine, reply text to the origin chat
 *   - /task run, /cron run  -> queue via the task store and flag a
 *                              notification target (result posts when done)
 *   - TUI selector commands -> declined ("run it in the terminal")
 *   - lifecycle commands    -> hard-declined (never unattended)
 *   - turn-starting builtins that need a live agent turn (goal <text>,
 *     plan <text>, email send, compact) -> declined for now; the exact-text
 *     reflection path is reserved for session-level commands (skills, prompt
 *     templates, extensions) in a later iteration.
 *
 * Every reply is sanitized by redactCommandOutput so engine output can never
 * leak tokens, keys, or passwords to a remote chat. All behavior is
 * dependency-injected so this module is unit-testable without a TUI.
 */

import { formatMemoryReport } from "./memory-command.ts";
import type { PorcupineTaskStore } from "./task-scheduler.ts";

/** Result of dispatching one remote slash command line. */
export type RemoteSlashResult =
	| { kind: "text"; text: string; notificationTarget?: boolean }
	| { kind: "declined"; text: string }
	| { kind: "not-found"; text: string };

/** Live session/engine handles supplied by InteractiveMode. */
export interface RemoteCommandContext {
	/** Agent config directory (task store, memory, drafts). */
	agentDir: string;
	/** Durable local task store (also owned by the session). */
	taskStore: PorcupineTaskStore;
	/** Snapshot of the shared session. */
	session: {
		id: string;
		cwd: string;
		mode: string;
		name?: string;
		activeSubagents?: number;
		uptime?: string;
	};
	// --- Engine callbacks (implemented against live session state) ---
	getStacks?: (query: string) => string;
	getProjects?: (query: string) => string;
	getSubagents?: (arg: string) => Promise<string>;
	getChangelog?: () => string;
	getMemory?: () => string;
	getSessionReport?: () => string;
	getUsageReport?: () => string;
	getX?: (text: string) => Promise<string>;
	getEmail?: (text: string) => Promise<string>;
	getGuide?: (arg: string) => string;
	getGoalStatus?: () => string;
	getPlanStatus?: () => string;
	setReasoning?: (arg: string) => string;
	setAdaptive?: (arg: string) => string;
	setAuto?: (arg: string) => string;
	setSandbox?: (arg: string) => string;
	setVoice?: (arg: string) => string;
	setReasoningShow?: (arg: string) => string;
	setModel?: (arg: string) => string | Promise<string>;
	setName?: (arg: string) => string;
	runInit?: (arg: string) => string;
	runUpdate?: () => Promise<string>;
}

type Declined = { declined: string };
type Handler = (args: string, ctx: RemoteCommandContext) => string | Declined | Promise<string | Declined>;

const TUI_ONLY_REASONS: Record<string, string> = {
	settings: "opens the settings menu",
	"scoped-models": "opens the model selector",
	fork: "shows the session-fork selector",
	tree: "opens the session tree",
	trust: "opens the project trust selector",
	resume: "opens the session selector",
	modes: "opens the interaction-mode selector",
	view: "opens the full-screen markdown viewer",
	hotkeys: "renders the keybinding map in the terminal",
	logout: "opens the OAuth selector",
	export: "opens the export dialog",
	import: "opens the import dialog",
};

const LIFECYCLE_REASONS: Record<string, string> = {
	kill: "is a terminal interrupt control",
	reload: "reloads the running runtime",
	refresh: "rebuilds the Porcupine runtime",
	restart: "restarts the Porcupine process",
	new: "starts a new session in the terminal",
	quit: "shuts the terminal session down",
	clone: "clones the session in the terminal",
	"extract-stack": "writes skill/tool files from the terminal",
	"craft-stack": "runs deep research from the terminal",
};

const TURN_ONLY_REASONS: Record<string, string> = {
	compact: "starts a new agent turn",
	mcpp: "runs an MCP prompt turn",
};

const DECLINED_REASONS: Record<string, string> = { ...TUI_ONLY_REASONS, ...LIFECYCLE_REASONS, ...TURN_ONLY_REASONS };

/** True when a canonical command name is not executable from a remote bridge. */
export function isRemoteDeclined(command: string): boolean {
	return command in DECLINED_REASONS;
}

const TASK_USAGE = "Usage: /task add <title> :: <prompt> | /task [list|show|run|pause|resume|cancel] <id>";

function taskLines(store: PorcupineTaskStore): string {
	const tasks = store.listTasks();
	if (tasks.length === 0) return "No tasks. Create one with '/task add <title> :: <prompt>'.";
	return tasks.map((task) => `${task.id}: ${task.title} [${task.status}]`).join("\n");
}

async function taskHandler(args: string, ctx: RemoteCommandContext): Promise<string | Declined> {
	const text = `/task${args ? ` ${args}` : ""}`.trim();
	if (/^\/task\s+(add|list|show|run|pause|resume|cancel)\b/i.test(text) === false && text !== "/task") {
		return TASK_USAGE;
	}
	const verb = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
	if (verb === "add") {
		const [title, prompt] = args
			.trim()
			.slice(3)
			.split(/\s+::\s+/, 2);
		if (!title?.trim() || !prompt?.trim()) return TASK_USAGE;
		const task = ctx.taskStore.createTask({ title: title.trim(), prompt: prompt.trim() });
		return `Task "${task.title}" created (${task.id}).`;
	}
	if (verb === "list" || verb === "" || verb === "status") {
		return taskLines(ctx.taskStore);
	}
	if (verb === "show") {
		const id = args.trim().slice(4).trim();
		const task = ctx.taskStore.getTask(id);
		if (!task) return `Unknown task id: ${id}. Type '/task list' to list tasks.`;
		const runs = ctx.taskStore.listRuns(id);
		const latest = runs[0];
		const runLine = latest ? `\nLatest run: ${latest.status}` : "\nLatest run: none yet";
		return `${task.id}: ${task.title} [${task.status}]${runLine}`;
	}
	if (verb === "run") {
		const id = args.trim().slice(3).trim();
		const task = ctx.taskStore.getTask(id);
		if (!task) return `Unknown task id: ${id}. Type '/task list' to list tasks.`;
		if (task.status === "paused" || task.status === "cancelled") {
			return `Task ${id} is ${task.status} and cannot be queued.`;
		}
		try {
			ctx.taskStore.queueTaskRun(id);
			return `Queued "${task.title}" — the result will be posted here when it finishes.`;
		} catch (error) {
			return `Could not queue task ${id}: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	if (["pause", "resume", "cancel"].includes(verb)) {
		const id = args.trim().slice(verb.length).trim();
		const task = ctx.taskStore.getTask(id);
		if (!task) return `Unknown task id: ${id}. Type '/task list' to list tasks.`;
		try {
			if (verb === "pause") ctx.taskStore.setTaskStatus(id, "paused");
			else if (verb === "resume") ctx.taskStore.setTaskStatus(id, "ready");
			else ctx.taskStore.setTaskStatus(id, "cancelled");
			return `Task "${task.title}" ${verb === "pause" ? "paused" : verb === "resume" ? "resumed" : "cancelled"}.`;
		} catch (error) {
			return `Could not ${verb} task ${id}: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	return TASK_USAGE;
}

async function cronHandler(args: string, ctx: RemoteCommandContext): Promise<string | Declined> {
	const verb = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
	if (verb === "list" || verb === "") {
		const schedules = ctx.taskStore.listSchedules();
		if (schedules.length === 0) {
			return "No cron schedules. Add one with '/cron add <task-id> :: <cron-expression>'.";
		}
		return schedules
			.map(
				(schedule) =>
					`${schedule.id}: ${schedule.taskId} @ ${schedule.expression} [${schedule.enabled ? "enabled" : "paused"}]`,
			)
			.join("\n");
	}
	return declinedFor("cron", "remote cron mutation is not available yet");
}

function goalHandler(args: string, ctx: RemoteCommandContext): string | Declined {
	const verb = args.trim().toLowerCase();
	if (verb === "status" || verb === "") return ctx.getGoalStatus?.() ?? "No active goal.";
	return declinedFor("goal", "starts a new agent turn (set or continue a goal)");
}

function planHandler(args: string, ctx: RemoteCommandContext): string | Declined {
	const verb = args.trim().toLowerCase();
	if (verb === "status" || verb === "") return ctx.getPlanStatus?.() ?? "No plan in progress.";
	return declinedFor("plan", "starts a new agent turn (generate a plan)");
}

function modelHandler(args: string, ctx: RemoteCommandContext): Promise<string | Declined> {
	const model = args.trim();
	if (!model) return Promise.resolve(declinedFor("model", "opens the TUI model selector without an argument"));
	return Promise.resolve(ctx.setModel?.(model) ?? `Model set to ${model}`);
}

function defaultSessionReport(ctx: RemoteCommandContext): string {
	const lines = [`session: ${ctx.session.id}`, `cwd: ${ctx.session.cwd}`, `mode: ${ctx.session.mode}`];
	if (ctx.session.name) lines.push(`name: ${ctx.session.name}`);
	if (ctx.session.activeSubagents !== undefined) lines.push(`active sub-agents: ${ctx.session.activeSubagents}`);
	if (ctx.session.uptime) lines.push(`uptime: ${ctx.session.uptime}`);
	return lines.join("\n");
}

/** Core handlers keyed by canonical command name (no leading slash). */
const HANDLERS: Record<string, Handler> = {
	session: (_, ctx) => ctx.getSessionReport?.() ?? defaultSessionReport(ctx),
	usage: (_, ctx) => ctx.getUsageReport?.() ?? "Usage totals are not available from the remote session.",
	cost: (_, ctx) => ctx.getUsageReport?.() ?? "Cost totals are not available from the remote session.",
	changelog: (_, ctx) => ctx.getChangelog?.() ?? "Changelog is not available.",
	memory: (_, ctx) => ctx.getMemory?.() ?? formatMemoryReport(ctx.agentDir),
	stacks: (args, ctx) => ctx.getStacks?.(args) ?? "The stack tree is not available from the remote session.",
	projects: (args, ctx) => ctx.getProjects?.(args) ?? "Projects are not available from the remote session.",
	subagents: (args, ctx) =>
		ctx.getSubagents?.(args) ?? Promise.resolve("Sub-agent sessions are not available from the remote session."),
	guide: (args, ctx) => ctx.getGuide?.(args) ?? "Guide is not available.",
	x: (args, ctx) => ctx.getX?.(`/x${args ? ` ${args}` : ""}`) ?? "X is not configured for remote access.",
	email: (args, ctx) => {
		const verb = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
		if (verb === "send") return declinedFor("email send", "sends mail and needs terminal approval");
		return ctx.getEmail?.(`/email${args ? ` ${args}` : ""}`) ?? "Email is not configured for remote access.";
	},
	task: taskHandler,
	cron: cronHandler,
	goal: goalHandler,
	plan: planHandler,
	reasoning: (args, ctx) => ctx.setReasoning?.(args) ?? "Reasoning is not available from the remote session.",
	thinking: (args, ctx) => ctx.setReasoning?.(args) ?? "Reasoning is not available from the remote session.",
	"reasoning-show": (args, ctx) =>
		ctx.setReasoningShow?.(args) ?? "Reasoning visibility is not available from the remote session.",
	adaptive: (args, ctx) => ctx.setAdaptive?.(args) ?? "Adaptive reasoning is not available from the remote session.",
	auto: (args, ctx) => ctx.setAuto?.(args) ?? "Auto mode is not available from the remote session.",
	sandbox: (args, ctx) => ctx.setSandbox?.(args) ?? "Sandbox status is not available from the remote session.",
	voice: (args, ctx) => ctx.setVoice?.(args) ?? "Voice mode is not available from the remote session.",
	model: modelHandler,
	name: (args, ctx) => {
		const name = args.trim();
		if (!name) return "Usage: /name <session name>";
		return ctx.setName?.(name) ?? `Session name set to "${name}".`;
	},
	init: (args, ctx) => ctx.runInit?.(args) ?? "Project context generation is not available from the remote session.",
	update: (_, ctx) => ctx.runUpdate?.() ?? Promise.resolve("Update check is not available from the remote session."),
};

function declinedFor(command: string, reason: string): Declined {
	return { declined: `"/${command}" ${reason} — run it in the Porcupine terminal.` };
}

function declinedReply(command: string, reason: string): string {
	return `"/${command}" ${reason} — run it in the Porcupine terminal.`;
}

/**
 * Dispatch a canonical remote command line (e.g. "/task list", "/x search q").
 * The bridge has already resolved platform aliases and passed authorization.
 */
export async function dispatchRemoteSlash(commandLine: string, ctx: RemoteCommandContext): Promise<RemoteSlashResult> {
	const trimmed = commandLine.trim();
	if (!trimmed.startsWith("/")) {
		return { kind: "not-found", text: "Send a command starting with '/' — type '/commands' to list them." };
	}

	const spaceIndex = trimmed.indexOf(" ");
	const rawName = (spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)).toLowerCase();
	const args = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();

	if (rawName === "commands" || rawName === "help" || rawName === "status" || rawName === "start") {
		// Handled locally by the bridges (bridge control surface).
		return { kind: "not-found", text: `"/${rawName}" is handled by the bridge itself.` };
	}

	const reason = DECLINED_REASONS[rawName];
	if (reason !== undefined) {
		return { kind: "declined", text: declinedReply(rawName, reason) };
	}

	const handler = HANDLERS[rawName];
	if (!handler) {
		return { kind: "not-found", text: `Unknown command "/${rawName}". Type '/commands' to list available commands.` };
	}

	try {
		const result = await handler(args, ctx);
		if (typeof result === "object" && result !== null && "declined" in result) {
			return { kind: "declined", text: redactCommandOutput(result.declined) };
		}
		const output = typeof result === "string" ? result : String(result ?? "");
		const sanitized = redactCommandOutput(output);
		// /task run and /cron run queue work whose completion should be
		// reported back to the originating chat.
		const notificationTarget = rawName === "task" && /^run\b/.test(args);
		return { kind: "text", text: sanitized || "(no output)", notificationTarget };
	} catch (error) {
		return {
			kind: "text",
			text: `Command failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Mask common secret shapes so engine output can never leak credentials into
 * a remote chat: `token=...`, `api_key=...`, `password=...`, `Bearer <jwt>`,
 * and `Bot <digits>:<token>` style values.
 */
export function redactCommandOutput(text: string): string {
	return text
		.replace(/(token|api[_-]?key|secret|password|passwd)\s*[=:]\s*\S+/gi, "$1=[redacted]")
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		.replace(/\bBot\s+\d{6,}:[A-Za-z0-9_-]{20,}/g, "Bot [redacted]");
}
