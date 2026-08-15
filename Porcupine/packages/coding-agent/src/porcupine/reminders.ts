/**
 * Attended, session-local reminders for Porcupine.
 *
 * A reminder is scheduled by the user (`/remind <duration> <text>`), by the
 * model (`remind_me` tool), or as a goal nudge (`/goal remind <duration>`),
 * and fires while the interactive session is open and idle. Delivery reuses
 * the existing task-completion chat-bridge notification path — the same fan-out
 * a finished task run uses — so nothing here claims to be a daemon or to run
 * on a closed terminal.
 *
 * Reminders are honest about being attended-only: firing is gated on the same
 * {@link isTaskDrainEligible} idle check the task scheduler uses, and a
 * reminder that goes out of scope while the session is closed is simply not
 * delivered (it may be re-checked when the session is next open and idle, but
 * we never deliver to a closed session).
 *
 * Persistence is deliberately decoupled from the engine: the interactive layer
 * stores reminders as session custom entries (so they survive `/resume`) via
 * {@link ReminderEngine.toEntries} / {@link ReminderEngine.fromEntries}.
 */

import type { TaskRunResultStatus } from "./task-scheduler.ts";

/** Session custom-entry type under which reminders persist. */
export const REMINDERS_SESSION_ENTRY = "porcupine.reminders";
/** Boundary above which a reminder is treated as overdue, to avoid unbounded queues. */
const MAX_REMINDERS = 50;

export interface Reminder {
	id: string;
	text: string;
	dueAt: string; // ISO timestamp
	source: "user" | "goal" | "model";
}

export interface GoalNudgeSource {
	goal: { text: string; status: string; lastVerdict?: string };
	durationMs: number;
}

export type RemindCommand = { kind: "set"; durationMs: number; text: string } | { kind: "invalid"; message: string };

export type GoalRemindCommand = { kind: "set"; durationMs: number } | { kind: "invalid"; message: string };

const USAGE = "Usage: /remind <duration> <text>  (e.g. /remind 5m circle back on the blocker)";
const GOAL_USAGE = "Usage: /goal remind <duration>  (e.g. /goal remind 10m)";

/** Notify object shaped like a task run result, delivered over the bridge fan-out. */
export interface ReminderNotification {
	taskId: string;
	runId: string;
	title: string;
	status: TaskRunResultStatus;
	trigger: { type: "manual" | "cron" };
	summary: string;
}

/** Parse a human duration suffix into milliseconds: 45s, 5m, 2h, 1d, or bare seconds. */
export function parseDuration(raw: string): number | undefined {
	const value = raw.trim().toLowerCase();
	const match = /^(\d+)(s|m|h|d|w)?$/.exec(value);
	if (!match) return undefined;
	const number = Number(match[1]);
	const unit = match[2] ?? "s";
	const multipliers: Record<string, number> = {
		s: 1_000,
		m: 60_000,
		h: 3_600_000,
		d: 86_400_000,
		w: 604_800_000,
	};
	return number * multipliers[unit]!;
}

export function formatDuration(ms: number): string {
	if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
	if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
	if (ms % 60_000 === 0) return `${ms / 60_000}m`;
	return `${Math.round(ms / 1000)}s`;
}

export function parseRemindCommand(text: string): RemindCommand | null {
	const match = /^\/remind(?:\s+(.*))?\s*$/i.exec(text.trim());
	if (!match) return null;
	const argument = match[1]?.trim() ?? "";
	if (!argument) return { kind: "invalid", message: USAGE };
	// `/remind // <text>` ambiguity: someone intent on cleaning could type
	// "/remind just clean", but the first token must parse as a duration, so a
	// bare non-duration is rejected to avoid surprising text-only matches.
	const [rawDuration, ...rest] = argument.split(/\s+/);
	if (!rawDuration) return { kind: "invalid", message: USAGE };
	const durationMs = parseDuration(rawDuration);
	if (durationMs === undefined) return { kind: "invalid", message: USAGE };
	const reminderText = rest.join(" ").trim();
	if (!reminderText) return { kind: "invalid", message: USAGE };
	return { kind: "set", durationMs, text: reminderText };
}
export function parseGoalRemindCommand(text: string): GoalRemindCommand | null {
	const argument = /^\/goal\s+remind\s+(.+)$/i.exec(text.trim())?.[1]?.trim();
	if (argument === undefined) return null;
	const durationMs = parseDuration(argument);
	if (durationMs === undefined) return { kind: "invalid", message: GOAL_USAGE };
	return { kind: "set", durationMs };
}

export interface ReminderEngineOptions {
	/** Current wall-clock provider; defaults to Date.now(). Overridable for tests. */
	now?: () => number;
	/**
	 * Deliver one fired reminder. This is the reuse point for the task-completion
	 * bridge fan-out; it must NOT run on a closed session.
	 */
	notify: (notification: ReminderNotification) => void;
}

export interface ReminderTickState {
	activeTaskRun: boolean;
	streaming: boolean;
	compacting: boolean;
	bashRunning: boolean;
}

let counter = 0;
function nextId(prefix: string): string {
	counter += 1;
	return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Session-local reminder engine. Not a daemon: reminders are delivered only
 * when {@link tick} is called with an idle (drain-eligible) state.
 */
export class ReminderEngine {
	private reminders: Reminder[] = [];
	private readonly now: () => number;
	private readonly notify: (notification: ReminderNotification) => void;

	constructor(options: ReminderEngineOptions) {
		this.now = options.now ?? (() => Date.now());
		this.notify = options.notify;
	}

	get remindersSnapshot(): readonly Reminder[] {
		return [...this.reminders];
	}

	/** Schedule a reminder; returns the created reminder or undefined when over quota. */
	schedule(input: { text: string; durationMs: number; source: Reminder["source"] }): Reminder | undefined {
		const text = input.text.trim();
		if (!text) return undefined;
		const dueAt = new Date(this.now() + input.durationMs).toISOString();
		const reminder: Reminder = {
			id: nextId("rem"),
			text,
			dueAt,
			source: input.source,
		};
		this.reminders.push(reminder);
		if (this.reminders.length > MAX_REMINDERS) {
			this.reminders = this.reminders.slice(-MAX_REMINDERS);
		}
		return reminder;
	}

	/**
	 * A goal nudge is a reminder with source "goal" that re-fires the goal's
	 * status text through the same bridge fan-out. Never fires when closed.
	 */
	scheduleGoalNudge(source: GoalNudgeSource): Reminder | undefined {
		const text = [
			`Standing goal status: ${source.goal.status}${
				source.goal.lastVerdict ? ` (last verdict: ${source.goal.lastVerdict})` : ""
			}`,
			source.goal.text,
			"Revisit this goal now that you are back.",
		].join(" · ");
		return this.schedule({ text, durationMs: source.durationMs, source: "goal" });
	}

	/** True when a reminder is due at `at`. */
	isDue(at: Date): boolean {
		const timestamp = at.getTime();
		return this.reminders.some((reminder) => new Date(reminder.dueAt).getTime() <= timestamp);
	}

	/**
	 * Check for due reminders and deliver them, but only while the session is
	 * drain-eligible (open and idle). Returns the number of reminders fired this
	 * tick.
	 */
	tick(state: ReminderTickState, at: Date = new Date(this.now())): number {
		const eligible = !state.activeTaskRun && !state.streaming && !state.compacting && !state.bashRunning;
		if (!eligible) return 0;
		const timestamp = at.getTime();
		let fired = 0;
		this.reminders = this.reminders.filter((reminder) => {
			if (new Date(reminder.dueAt).getTime() > timestamp) return true;
			this.deliver(reminder);
			fired += 1;
			return false;
		});
		return fired;
	}

	private deliver(reminder: Reminder): void {
		try {
			this.notify({
				taskId: `reminder-${reminder.id}`,
				runId: reminder.id,
				title: "Reminder",
				status: "completed",
				trigger: { type: "manual" },
				summary: `Reminder: ${reminder.text}`,
			});
		} catch {
			// A throwing notifier must never wedge the reminder engine.
		}
	}

	/** Serialized form for persistence as a session custom entry. */
	toEntries(): { version: 1; reminders: Reminder[] } {
		return { version: 1, reminders: [...this.reminders] };
	}

	/** Rehydrate from a persisted custom entry; ignores malformed payloads. */
	fromEntries(value: unknown): void {
		if (!value || typeof value !== "object") return;
		const data = value as { version?: unknown; reminders?: unknown };
		if (data.version !== 1 || !Array.isArray(data.reminders)) return;
		const loaded: Reminder[] = [];
		for (const candidate of data.reminders) {
			if (
				candidate &&
				typeof candidate === "object" &&
				typeof (candidate as Reminder).id === "string" &&
				typeof (candidate as Reminder).text === "string" &&
				typeof (candidate as Reminder).dueAt === "string" &&
				((candidate as Reminder).source === "user" ||
					(candidate as Reminder).source === "goal" ||
					(candidate as Reminder).source === "model")
			) {
				loaded.push(candidate as Reminder);
			}
		}
		this.reminders = loaded;
	}

	clear(): void {
		this.reminders = [];
	}
}
