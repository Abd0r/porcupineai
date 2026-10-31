import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lockDirSync } from "../core/sync-lock.ts";

export type PorcupineTaskStatus = "ready" | "running" | "completed" | "failed" | "paused" | "cancelled";
export type PorcupineTaskRunStatus = "claimed" | "running" | "completed" | "failed" | "cancelled" | "unknown";
export type TaskRunTrigger =
	| { type: "manual"; claimRunId?: string }
	| { type: "cron"; scheduleId: string; claimRunId?: string }
	| { type: "event"; eventId: string; claimRunId?: string };

/** Terminal states worth notifying a chat bridge about. */
export type TaskRunResultStatus = Extract<PorcupineTaskRunStatus, "completed" | "failed">;

/**
 * Payload delivered when a task run reaches a terminal {@link TaskRunResultStatus}.
 * Drive this toward chat bridges (Telegram / Discord / iMessage) so an
 * attended user learns a scheduled or queued task finished without waiting in
 * the TUI. Carries enough to build a short, human-readable line: task title,
 * status, trigger, and a single-line summary.
 */
export interface TaskRunResultNotification {
	taskId: string;
	runId: string;
	title: string;
	status: TaskRunResultStatus;
	trigger: { type: "manual" | "cron" };
	/** Short one-line message describing the outcome for bridge display. */
	summary: string;
}

/** Build the single-line bridge message for a completed/failed task run. */
export function formatTaskRunResultSummary(input: {
	title: string;
	status: TaskRunResultStatus;
	trigger: { type: "manual" | "cron" };
	detail: string;
}): string {
	const icon = input.status === "completed" ? "✅" : "❌";
	const source = input.trigger.type === "cron" ? "cron" : "manual";
	const detail = input.detail.trim().replace(/\s+/g, " ").slice(0, 120);
	return `${icon} Task "${input.title}" ${input.status} (${source})${detail ? `: ${detail}` : ""}`;
}

/**
 * Whether the attended task drain may adopt a claim right now.
 * A task run may start only while the session is open and fully idle — no live
 * turn, compaction, or bash execution.
 */
export interface TaskDrainEligibility {
	activeTaskRun: boolean;
	streaming: boolean;
	compacting: boolean;
	bashRunning: boolean;
}

export function isTaskDrainEligible(state: TaskDrainEligibility): boolean {
	return !state.activeTaskRun && !state.streaming && !state.compacting && !state.bashRunning;
}

export interface PorcupineTask {
	id: string;
	title: string;
	prompt: string;
	status: PorcupineTaskStatus;
	createdAt: string;
	updatedAt: string;
	runCount: number;
	/** Run this task when the current task completes (chain link). */
	next?: string;
	/** Run this task when the current task fails (chain link). */
	nextOnFail?: string;
	/** Optional condition-based (time-independent) event trigger. */
	trigger?: PorcupineTaskTrigger;
}

/**
 * Condition-based event trigger evaluated by the idle drain. Cheap checks only:
 * hash a file and compare against the last-seen state, or run a short check
 * command and compare its exit code. Time-independent by design.
 */
export type PorcupineTaskTrigger =
	| { type: "file"; path: string; matches?: string; lastHash?: string }
	| { type: "script"; command: string; exitCode: number; lastExitCode?: number };

export interface PorcupineTaskRun {
	id: string;
	taskId: string;
	trigger: TaskRunTrigger;
	status: PorcupineTaskRunStatus;
	createdAt: string;
	claimedAt?: string;
	startedAt: string;
	ownerPid?: number;
	completedAt?: string;
	result?: string;
	error?: string;
}

export interface PorcupineCronSchedule {
	id: string;
	taskId: string;
	expression: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	lastRunAt?: string;
	nextRunAt: string;
	claimedRunId?: string;
}

export type TaskCommand =
	| { kind: "list" }
	| { kind: "add"; title: string; prompt: string }
	| { kind: "show"; taskId: string }
	| { kind: "run"; taskId: string }
	| { kind: "pause"; taskId: string }
	| { kind: "resume"; taskId: string }
	| { kind: "cancel"; taskId: string }
	| { kind: "invalid"; message: string };

export type CronCommand =
	| { kind: "list" }
	| { kind: "add"; taskId: string; expression: string }
	| { kind: "run"; scheduleId: string }
	| { kind: "pause"; scheduleId: string }
	| { kind: "resume"; scheduleId: string }
	| { kind: "remove"; scheduleId: string }
	| { kind: "invalid"; message: string };

interface TaskStoreData {
	version: 1;
	tasks: PorcupineTask[];
	runs: PorcupineTaskRun[];
	schedules: PorcupineCronSchedule[];
}

const TASKS_DIR = "tasks";
const TASKS_FILE = "tasks.json";
const MAX_CRON_SEARCH_MINUTES = 366 * 24 * 60;
const TASK_USAGE = "Usage: /task add <title> :: <prompt> | /task [list|show|run|pause|resume|cancel] <id>";
const CRON_USAGE =
	"Usage: /cron add <task-id> :: <minute hour day month weekday> | /cron [list|run|pause|resume|remove] <id>";

function parseCommand(text: string, command: string): string | null {
	const match = new RegExp(`^\\/${command}(?:\\s+(.*))?\\s*$`, "i").exec(text.trim());
	return match === null ? null : (match[1]?.trim() ?? "");
}

export function parseTaskCommand(text: string): TaskCommand | null {
	const argument = parseCommand(text, "task");
	if (argument === null) return null;
	if (!argument || argument === "list" || argument === "status") {
		return { kind: "list" };
	}
	const [verb, ...rest] = argument.split(/\s+/);
	if (verb === "add") {
		const [title, prompt] = rest.join(" ").split(/\s+::\s+/, 2);
		return title?.trim() && prompt?.trim()
			? { kind: "add", title: title.trim(), prompt: prompt.trim() }
			: { kind: "invalid", message: TASK_USAGE };
	}
	if (["show", "run", "pause", "resume", "cancel"].includes(verb ?? "") && rest.length === 1) {
		return {
			kind: verb as "show" | "run" | "pause" | "resume" | "cancel",
			taskId: rest[0]!,
		};
	}
	return { kind: "invalid", message: TASK_USAGE };
}

function defaultStore(): TaskStoreData {
	return { version: 1, tasks: [], runs: [], schedules: [] };
}

function storePath(agentDir: string): string {
	return join(agentDir, TASKS_DIR, TASKS_FILE);
}

function atomicWrite(filePath: string, content: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const temporary = join(dirname(filePath), `.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, filePath);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function readStore(agentDir: string): TaskStoreData {
	const filePath = storePath(agentDir);
	if (!existsSync(filePath)) return defaultStore();
	const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
	if (
		!parsed ||
		typeof parsed !== "object" ||
		(parsed as { version?: unknown }).version !== 1 ||
		!Array.isArray((parsed as { tasks?: unknown }).tasks) ||
		!Array.isArray((parsed as { runs?: unknown }).runs) ||
		!Array.isArray((parsed as { schedules?: unknown }).schedules)
	) {
		throw new Error(`Invalid task store: ${filePath}`);
	}
	return parsed as TaskStoreData;
}

function parseField(field: string, min: number, max: number, fieldName: string): Set<number> {
	const values = new Set<number>();
	for (const part of field.split(",")) {
		const [rangePart, stepPart] = part.split("/");
		if (part.split("/").length > 2 || !rangePart) {
			throw new Error(`Invalid ${fieldName} cron field: ${field}`);
		}
		const step = stepPart === undefined ? 1 : Number(stepPart);
		if (!Number.isInteger(step) || step < 1) {
			throw new Error(`Invalid ${fieldName} cron step: ${field}`);
		}

		let start = min;
		let end = max;
		if (rangePart !== "*") {
			const range = rangePart.split("-");
			if (range.length === 1) {
				start = Number(range[0]);
				end = start;
			} else if (range.length === 2) {
				start = Number(range[0]);
				end = Number(range[1]);
			} else {
				throw new Error(`Invalid ${fieldName} cron range: ${field}`);
			}
		}
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
			throw new Error(`Invalid ${fieldName} cron field: ${field}`);
		}
		for (let value = start; value <= end; value += step) values.add(value);
	}
	return values;
}

interface CronMatcher {
	minutes: Set<number>;
	hours: Set<number>;
	daysOfMonth: Set<number>;
	months: Set<number>;
	daysOfWeek: Set<number>;
	dayOfMonthWildcard: boolean;
	dayOfWeekWildcard: boolean;
}

function parseCron(expression: string): CronMatcher {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new Error("Cron expressions need five fields: minute hour day-of-month month day-of-week.");
	}
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
	const normalizedDayOfWeek = dayOfWeek.replace(/\b7\b/g, "0");
	return {
		minutes: parseField(minute, 0, 59, "minute"),
		hours: parseField(hour, 0, 23, "hour"),
		daysOfMonth: parseField(dayOfMonth, 1, 31, "day-of-month"),
		months: parseField(month, 1, 12, "month"),
		daysOfWeek: parseField(normalizedDayOfWeek, 0, 6, "day-of-week"),
		dayOfMonthWildcard: dayOfMonth === "*",
		dayOfWeekWildcard: dayOfWeek === "*",
	};
}

function matchesCron(date: Date, matcher: CronMatcher): boolean {
	if (
		!matcher.minutes.has(date.getUTCMinutes()) ||
		!matcher.hours.has(date.getUTCHours()) ||
		!matcher.months.has(date.getUTCMonth() + 1)
	) {
		return false;
	}

	const dayOfMonthMatches = matcher.daysOfMonth.has(date.getUTCDate());
	const dayOfWeekMatches = matcher.daysOfWeek.has(date.getUTCDay());
	const dayMatches =
		matcher.dayOfMonthWildcard || matcher.dayOfWeekWildcard
			? dayOfMonthMatches && dayOfWeekMatches
			: dayOfMonthMatches || dayOfWeekMatches;
	return dayMatches;
}

/** Returns the first UTC cron occurrence strictly after `after`. */
export function nextCronTime(expression: string, after: Date): Date {
	const matcher = parseCron(expression);
	const candidate = new Date(after);
	candidate.setUTCSeconds(0, 0);
	candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
	for (let minute = 0; minute < MAX_CRON_SEARCH_MINUTES; minute += 1) {
		if (matchesCron(candidate, matcher)) return new Date(candidate);
		candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
	}
	throw new Error(`Cron expression has no occurrence in the next year: ${expression}`);
}

export function parseCronCommand(text: string): CronCommand | null {
	const argument = parseCommand(text, "cron");
	if (argument === null) return null;
	if (!argument || argument === "list" || argument === "status") return { kind: "list" };
	const [verb, ...rest] = argument.split(/\s+/);
	if (verb === "add") {
		const [taskId, expression] = rest.join(" ").split(/\s+::\s+/, 2);
		if (!taskId?.trim() || !expression?.trim()) {
			return { kind: "invalid", message: CRON_USAGE };
		}
		try {
			nextCronTime(expression.trim(), new Date());
			return {
				kind: "add",
				taskId: taskId.trim(),
				expression: expression.trim(),
			};
		} catch (error) {
			return {
				kind: "invalid",
				message: `${error instanceof Error ? error.message : String(error)}\n${CRON_USAGE}`,
			};
		}
	}
	if (["run", "pause", "resume", "remove", "delete"].includes(verb ?? "") && rest.length === 1) {
		return {
			kind: verb === "delete" ? "remove" : (verb as "run" | "pause" | "resume" | "remove"),
			scheduleId: rest[0]!,
		};
	}
	return { kind: "invalid", message: CRON_USAGE };
}

function getTask(data: TaskStoreData, id: string): PorcupineTask {
	const task = data.tasks.find((candidate) => candidate.id === id);
	if (!task) throw new Error(`Task not found: ${id}`);
	return task;
}

/**
 * Guard for a chain link: the target must exist and the link must not create a
 * cycle (a path back to the source task via any chain links).
 */
function cleanLink(data: TaskStoreData, sourceId: string, targetId: string, label: string): void {
	targetId = targetId.trim();
	if (!targetId) return;
	if (targetId === sourceId) throw new Error(`Chain cycle rejected: ${label} cannot reference itself.`);
	getTask(data, targetId);
	const stack = [targetId];
	const visited = new Set<string>();
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (current === sourceId) throw new Error(`Chain cycle rejected: ${label} would loop back.`);
		if (visited.has(current)) continue;
		visited.add(current);
		const candidate = data.tasks.find((task) => task.id === current);
		if (!candidate) continue;
		if (candidate.next) stack.push(candidate.next);
		if (candidate.nextOnFail) stack.push(candidate.nextOnFail);
	}
}

export class PorcupineTaskStore {
	readonly agentDir: string;
	private data: TaskStoreData;
	private taskRunResultNotifier: ((notification: TaskRunResultNotification) => void) | undefined;

	constructor(agentDir: string) {
		this.agentDir = agentDir;
		this.data = readStore(agentDir);
		this.recoverInterruptedRuns();
	}

	/**
	 * Register a callback invoked when a run reaches a terminal completed/failed
	 * state after it is finalized and persisted. No-op (silently skipped) when no
	 * callback is set or when {@link notifyOnTaskCompletion} is disabled by the
	 * caller. Kept out of the store's save path: it is fire-and-forget fan-out.
	 */
	setTaskRunResultNotifier(notifier: ((notification: TaskRunResultNotification) => void) | undefined): void {
		this.taskRunResultNotifier = notifier;
	}

	private save(): void {
		atomicWrite(storePath(this.agentDir), `${JSON.stringify(this.data, null, 2)}\n`);
	}

	/**
	 * Reload, mutate, and atomically save while holding the store-directory lock.
	 * This prevents a TUI Cron tick and a second Porcupine process from clobbering
	 * each other's lifecycle updates.
	 */
	private mutate<T>(operation: () => T): T {
		const filePath = storePath(this.agentDir);
		const directory = dirname(filePath);
		mkdirSync(directory, { recursive: true });
		const release = lockDirSync(directory, {
			lockfilePath: join(directory, ".tasks.lock"),
			realpath: false,
			stale: 30_000,
		});
		try {
			this.data = readStore(this.agentDir);
			const result = operation();
			this.save();
			return result;
		} finally {
			release();
		}
	}

	/** Mark incomplete runs left by a terminated Porcupine process as auditable. */
	private recoverInterruptedRuns(): void {
		this.mutate(() => {
			const abandoned = this.data.runs.filter((run) => run.status === "claimed" || run.status === "running");
			if (abandoned.length === 0) return;
			const now = new Date().toISOString();
			for (const run of abandoned) {
				if (run.ownerPid !== undefined) {
					try {
						process.kill(run.ownerPid, 0);
						continue;
					} catch (error) {
						// EPERM (or an inconclusive check) is not evidence of process exit.
						if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
					}
				}
				run.status = "unknown";
				run.completedAt = now;
				run.error = "Porcupine exited before this task run finished.";
				const trigger = run.trigger;
				if (trigger.type === "cron") {
					const schedule = this.data.schedules.find((candidate) => candidate.id === trigger.scheduleId);
					if (schedule?.claimedRunId === run.id) {
						delete schedule.claimedRunId;
						schedule.updatedAt = now;
					}
				}
				const task = this.data.tasks.find((candidate) => candidate.id === run.taskId);
				if (task?.status === "running") {
					task.status = "ready";
					task.updatedAt = now;
				}
			}
		});
	}

	getTask(id: string): PorcupineTask | undefined {
		this.data = readStore(this.agentDir);
		return this.data.tasks.find((task) => task.id === id);
	}

	listTasks(): readonly PorcupineTask[] {
		this.data = readStore(this.agentDir);
		return [...this.data.tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	listRuns(taskId?: string): readonly PorcupineTaskRun[] {
		this.data = readStore(this.agentDir);
		return this.data.runs
			.filter((run) => taskId === undefined || run.taskId === taskId)
			.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
	}

	listSchedules(): readonly PorcupineCronSchedule[] {
		this.data = readStore(this.agentDir);
		return [...this.data.schedules].sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
	}

	createTask(input: {
		title: string;
		prompt: string;
		next?: string;
		nextOnFail?: string;
		trigger?: PorcupineTaskTrigger | null;
	}): PorcupineTask {
		const title = input.title.trim();
		const prompt = input.prompt.trim();
		if (!title || !prompt) throw new Error("Task title and prompt are required.");
		return this.mutate(() => {
			const now = new Date().toISOString();
			const task: PorcupineTask = {
				id: `task-${randomUUID().slice(0, 8)}`,
				title,
				prompt,
				status: "ready",
				createdAt: now,
				updatedAt: now,
				runCount: 0,
			};
			this.applyChainOptions(task.id, task, input);
			this.data.tasks.push(task);
			return task;
		});
	}

	/**
	 * Update a task's chain links (next / nextOnFail) and/or its event trigger.
	 * Passing `null` for a link clears it. Guarded against cycles: a chain that
	 * would loop back onto the task itself is rejected.
	 */
	patchTask(input: {
		id: string;
		next?: string | null;
		nextOnFail?: string | null;
		trigger?: PorcupineTaskTrigger | null;
	}): PorcupineTask {
		return this.mutate(() => {
			const task = getTask(this.data, input.id);
			const now = new Date().toISOString();
			this.applyChainOptions(task.id, task, input);
			task.updatedAt = now;
			return task;
		});
	}

	/** Returns tasks carrying an event trigger plus their last-seen state. */
	listTriggeredTasks(): readonly (PorcupineTask & { lastState?: string })[] {
		this.data = readStore(this.agentDir);
		return this.data.tasks
			.filter((task) => task.trigger !== undefined)
			.map((task) => ({
				...task,
				lastState: task.trigger!.type === "file" ? task.trigger!.lastHash : `${task.trigger!.lastExitCode}`,
			}));
	}

	/**
	 * Apply chain links and trigger from a create/patch input onto a task while
	 * validating references and guarding against cycles.
	 */
	private applyChainOptions(
		taskId: string,
		task: PorcupineTask,
		input: {
			next?: string | null;
			nextOnFail?: string | null;
			trigger?: PorcupineTaskTrigger | null;
		},
	): void {
		const next = input.next === undefined ? task.next : input.next;
		const nextOnFail = input.nextOnFail === undefined ? task.nextOnFail : input.nextOnFail;
		if (input.next !== undefined) {
			if (next !== null && next !== undefined) cleanLink(this.data, taskId, next, "next");
			task.next = next ?? undefined;
		}
		if (input.nextOnFail !== undefined) {
			if (nextOnFail !== null && nextOnFail !== undefined) cleanLink(this.data, taskId, nextOnFail, "nextOnFail");
			task.nextOnFail = nextOnFail ?? undefined;
		}
		if (input.trigger !== undefined) task.trigger = input.trigger ?? undefined;
	}

	setTaskStatus(id: string, status: Extract<PorcupineTaskStatus, "ready" | "paused" | "cancelled">): PorcupineTask {
		return this.mutate(() => {
			const task = getTask(this.data, id);
			const now = new Date().toISOString();
			task.status = status;
			task.updatedAt = now;
			if (status === "paused" || status === "cancelled") {
				for (const schedule of this.data.schedules) {
					if (schedule.taskId === task.id) {
						schedule.enabled = false;
						schedule.updatedAt = now;
					}
				}
			}
			return task;
		});
	}

	startRun(taskId: string, trigger: TaskRunTrigger): PorcupineTaskRun {
		return this.mutate(() => {
			const task = getTask(this.data, taskId);
			if (task.status === "paused" || task.status === "cancelled") {
				throw new Error(`Task ${task.id} is ${task.status}.`);
			}
			if (this.data.runs.some((run) => run.taskId === taskId && run.status === "running"))
				throw new Error(`Task ${task.id} is already running.`);
			const now = new Date().toISOString();
			let run: PorcupineTaskRun;
			if (trigger.claimRunId) {
				const claimed = this.data.runs.find((candidate) => candidate.id === trigger.claimRunId);
				if (!claimed || claimed.taskId !== taskId || claimed.status !== "claimed") {
					throw new Error("Claimed run is no longer available.");
				}
				run = claimed;
				run.status = "running";
				run.ownerPid = process.pid;
			} else {
				run = {
					id: `run-${randomUUID().slice(0, 8)}`,
					taskId,
					trigger,
					status: "running",
					createdAt: now,
					startedAt: now,
					ownerPid: process.pid,
				};
				this.data.runs.push(run);
			}
			task.status = "running";
			task.runCount += 1;
			task.updatedAt = now;
			return run;
		});
	}

	/**
	 * Queue a task run for the next idle drain (agent-requested or tool-requested).
	 * Creates a `claimed` manual run — like a cron claim, it is adopted by
	 * {@link startRun} when the session is idle, and abandoned claims become
	 * `unknown` on process restart via {@link recoverInterruptedRuns}.
	 */
	queueTaskRun(taskId: string): PorcupineTaskRun {
		return this.mutate(() => {
			const task = getTask(this.data, taskId);
			if (task.status === "paused" || task.status === "cancelled") {
				throw new Error(`Task ${task.id} is ${task.status}.`);
			}
			const now = new Date().toISOString();
			const run: PorcupineTaskRun = {
				id: `run-${randomUUID().slice(0, 8)}`,
				taskId,
				trigger: { type: "manual" },
				status: "claimed",
				createdAt: now,
				claimedAt: now,
				startedAt: now,
				ownerPid: process.pid,
			};
			this.data.runs.push(run);
			return run;
		});
	}

	/**
	 * Claimed manual/event runs awaiting execution by the idle drain (oldest
	 * first). Evaluating pending event triggers happens first so condition-based
	 * tasks drain through the same attended-only adoption path as queued runs.
	 */
	claimQueuedRuns(maximumClaims = Number.POSITIVE_INFINITY): readonly PorcupineTaskRun[] {
		const pendingEvent = this.claimEventTriggeredRuns(maximumClaims);
		this.data = readStore(this.agentDir);
		const merged = new Map<string, PorcupineTaskRun>();
		for (const run of pendingEvent) merged.set(run.id, run);
		for (const run of this.data.runs) {
			if (run.status === "claimed" && (run.trigger.type === "manual" || run.trigger.type === "event")) {
				merged.set(run.id, { ...run });
			}
		}
		return [...merged.values()]
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
			.slice(0, maximumClaims);
	}

	/**
	 * Evaluate pending event-triggered tasks and claim a run for each whose
	 * condition currently fires (file content changed; script exited with the
	 * expected code). Cheap checks only. Keeps the attended-only drain intact: the
	 * returned claimed runs are adopted only when the session is idle.
	 */
	claimEventTriggeredRuns(maximumClaims = Number.POSITIVE_INFINITY): readonly PorcupineTaskRun[] {
		return this.mutate(() => {
			const now = new Date().toISOString();
			const claimed: PorcupineTaskRun[] = [];
			for (const task of this.data.tasks) {
				if (claimed.length >= maximumClaims) break;
				if (!task.trigger || task.status === "paused" || task.status === "cancelled") continue;
				const check = this.checkTrigger(task.trigger);
				if (check.fired) {
					const run: PorcupineTaskRun = {
						id: `run-${randomUUID().slice(0, 8)}`,
						taskId: task.id,
						trigger: { type: "event", eventId: task.id },
						status: "claimed",
						createdAt: now,
						claimedAt: now,
						startedAt: now,
						ownerPid: process.pid,
					};
					this.data.runs.push(run);
					claimed.push({ ...run });
				}
				if (task.trigger.type === "file") {
					task.trigger.lastHash = check.state;
				} else if (task.trigger.type === "script") {
					task.trigger.lastExitCode = check.exitCode;
				}
				task.updatedAt = now;
			}
			return claimed;
		});
	}

	/**
	 * Cheap condition check for one event trigger. File triggers hash content and
	 * report fired only when the hash differs from the last-seen hash; a script
	 * trigger reports fired when its command exits with the expected code.
	 */
	private checkTrigger(trigger: PorcupineTaskTrigger): { fired: boolean; state: string; exitCode: number } {
		if (trigger.type === "file") {
			const path = trigger.path;
			if (!existsSync(path)) return { fired: false, state: "missing", exitCode: -1 };
			const content = readFileSync(path, "utf8");
			const hash = createHash("sha256").update(content).digest("hex");
			const matches = trigger.matches ? new RegExp(trigger.matches).test(content) : true;
			const fired = matches && trigger.lastHash !== undefined && trigger.lastHash !== hash;
			return { fired, state: hash, exitCode: -1 };
		}
		const exitCode = this.runCheckCommand(trigger.command);
		// Fire on the first check (no prior baseline recorded) and whenever the exit
		// code changed from the last-seen one, but never on a re-run of the same code
		// — mirroring the file trigger's lastHash change-detection guard.
		const changed = trigger.lastExitCode === undefined || trigger.lastExitCode !== exitCode;
		const fired = changed && exitCode === trigger.exitCode;
		return { fired, state: `${exitCode}`, exitCode };
	}

	/** Execute the trigger check command with a short timeout, returning its exit code. */
	private runCheckCommand(command: string): number {
		try {
			execFileSync(command, { shell: true, timeout: 3_000, stdio: "ignore" });
			return 0;
		} catch (error) {
			return (error as { status?: number }).status ?? 1;
		}
	}

	/**
	 * Mark a claimed run that could never be adopted as failed, and release its
	 * schedule claim so the next occurrence can fire again. No-op when the run is
	 * no longer in `claimed` state (e.g. another process already adopted it).
	 */
	failClaimedRun(runId: string, error: string): boolean {
		return this.mutate(() => {
			const run = this.data.runs.find((candidate) => candidate.id === runId);
			if (!run || run.status !== "claimed") return false;
			const now = new Date().toISOString();
			run.status = "failed";
			run.completedAt = now;
			run.error = error;
			const trigger = run.trigger;
			if (trigger.type === "cron") {
				const schedule = this.data.schedules.find((candidate) => candidate.id === trigger.scheduleId);
				if (schedule?.claimedRunId === run.id) {
					delete schedule.claimedRunId;
					schedule.updatedAt = now;
				}
			}
			return true;
		});
	}

	completeRun(runId: string, result: string): PorcupineTaskRun {
		return this.finishRun(runId, "completed", { result });
	}

	failRun(runId: string, error: string): PorcupineTaskRun {
		return this.finishRun(runId, "failed", { error });
	}

	private finishRun(
		runId: string,
		status: Extract<PorcupineTaskRunStatus, "completed" | "failed" | "cancelled">,
		output: { result?: string; error?: string },
	): PorcupineTaskRun {
		let notification: TaskRunResultNotification | undefined;
		const run = this.mutate(() => {
			const run = this.data.runs.find((candidate) => candidate.id === runId);
			if (!run) throw new Error(`Task run not found: ${runId}`);
			if (run.status !== "running") {
				throw new Error(`Task run ${runId} is already ${run.status}.`);
			}
			const now = new Date().toISOString();
			run.status = status;
			run.completedAt = now;
			run.result = output.result;
			run.error = output.error;
			const task = getTask(this.data, run.taskId);
			const recurring = this.data.schedules.some((schedule) => schedule.taskId === task.id && schedule.enabled);
			// An explicit user pause/cancel mid-run wins over the terminal-state
			// bookkeeping — never flip a cancelled/paused task back to completed.
			if (task.status !== "paused" && task.status !== "cancelled") {
				task.status = recurring ? "ready" : status === "completed" ? "completed" : "failed";
			}
			task.updatedAt = now;
			const trigger = run.trigger;
			if (trigger.type === "cron") {
				const schedule = this.data.schedules.find((candidate) => candidate.id === trigger.scheduleId);
				if (schedule?.claimedRunId === run.id) {
					delete schedule.claimedRunId;
					schedule.updatedAt = now;
				}
			}
			// Task chaining: on completion enqueue the linked-after task; on failure
			// enqueue the next-on-fail task. Skipped silently when the link is
			// missing or the target is paused/cancelled.
			if (status === "completed" && task.next) {
				this.enqueueChain(task.next);
			} else if (status === "failed" && task.nextOnFail) {
				this.enqueueChain(task.nextOnFail);
			}
			if (status === "completed" || status === "failed") {
				const detail = status === "completed" ? (output.result ?? "") : (output.error ?? "");
				const triggerType = run.trigger.type === "cron" ? "cron" : "manual";
				notification = {
					taskId: task.id,
					runId: run.id,
					title: task.title,
					status,
					trigger: { type: triggerType },
					summary: formatTaskRunResultSummary({
						title: task.title,
						status,
						trigger: { type: triggerType },
						detail,
					}),
				};
			}
			return run;
		});
		// Fan out the run-result notification only AFTER the terminal state is
		// persisted (mutate() above already saved), and swallow any throw so a
		// failing notifier can never block (or corrupt) the store's save path.
		// Synchronous after save: callers/tests that inspect notifications right
		// after finishRun resolve still see them.
		if (notification && this.taskRunResultNotifier) {
			try {
				this.taskRunResultNotifier(notification);
			} catch {
				// A throwing notifier must never break persistence or the caller.
			}
		}
		return run;
	}

	createSchedule(input: { taskId: string; expression: string }): PorcupineCronSchedule {
		const expression = input.expression.trim();
		return this.mutate(() => {
			getTask(this.data, input.taskId);
			const now = new Date();
			const schedule: PorcupineCronSchedule = {
				id: `cron-${randomUUID().slice(0, 8)}`,
				taskId: input.taskId,
				expression,
				enabled: true,
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
				nextRunAt: nextCronTime(expression, now).toISOString(),
			};
			this.data.schedules.push(schedule);
			return schedule;
		});
	}

	setScheduleEnabled(id: string, enabled: boolean): PorcupineCronSchedule {
		return this.mutate(() => {
			const schedule = this.data.schedules.find((candidate) => candidate.id === id);
			if (!schedule) throw new Error(`Cron schedule not found: ${id}`);
			schedule.enabled = enabled;
			const now = new Date();
			schedule.updatedAt = now.toISOString();
			if (enabled && new Date(schedule.nextRunAt) <= now) {
				schedule.nextRunAt = nextCronTime(schedule.expression, now).toISOString();
			}
			return schedule;
		});
	}

	removeSchedule(id: string): void {
		this.mutate(() => {
			const index = this.data.schedules.findIndex((schedule) => schedule.id === id);
			if (index === -1) throw new Error(`Cron schedule not found: ${id}`);
			this.data.schedules.splice(index, 1);
		});
	}

	/** Claims due schedules and advances their next run before execution. */
	claimDueSchedules(
		now: Date = new Date(),
		maximumClaims = Number.POSITIVE_INFINITY,
	): readonly PorcupineCronSchedule[] {
		return this.mutate(() => {
			const claimed: PorcupineCronSchedule[] = [];
			const timestamp = now.toISOString();
			for (const schedule of this.data.schedules) {
				if (claimed.length >= maximumClaims) break;
				if (!schedule.enabled || schedule.claimedRunId || new Date(schedule.nextRunAt) > now) {
					continue;
				}
				const task = getTask(this.data, schedule.taskId);
				if (task.status === "paused" || task.status === "cancelled") continue;
				if (this.data.runs.some((run) => run.taskId === task.id && run.status === "running")) continue;
				const run: PorcupineTaskRun = {
					id: `run-${randomUUID().slice(0, 8)}`,
					taskId: task.id,
					trigger: { type: "cron", scheduleId: schedule.id },
					status: "claimed",
					createdAt: timestamp,
					claimedAt: timestamp,
					startedAt: timestamp,
					ownerPid: process.pid,
				};
				this.data.runs.push(run);
				schedule.claimedRunId = run.id;
				schedule.lastRunAt = timestamp;
				schedule.nextRunAt = nextCronTime(schedule.expression, now).toISOString();
				schedule.updatedAt = timestamp;
				claimed.push({ ...schedule });
			}
			return claimed;
		});
	}

	/** Queue a chained task for the next idle drain (no-op when skipped). */
	private enqueueChain(targetId: string): void {
		const target = this.data.tasks.find((task) => task.id === targetId);
		if (!target) return;
		if (target.status === "paused" || target.status === "cancelled") return;
		const now = new Date().toISOString();
		const run: PorcupineTaskRun = {
			id: `run-${randomUUID().slice(0, 8)}`,
			taskId: target.id,
			trigger: { type: "manual" },
			status: "claimed",
			createdAt: now,
			claimedAt: now,
			startedAt: now,
			ownerPid: process.pid,
		};
		this.data.runs.push(run);
	}
}
