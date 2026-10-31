import type { AssistantMessage } from "@porcupineai/ai";
import type { AgentSession } from "../core/agent-session.ts";
import { PorcupineTaskStore, type TaskRunTrigger } from "../porcupine/task-scheduler.ts";
import type { ServeApiSession } from "./http-api.ts";
import { WorkbenchError } from "./workbench-context-files.ts";

interface AttachedSession {
	session: AgentSession;
	api: ServeApiSession;
	foreground: number;
}

/** One attended drain per serve host. Uses the same durable claims as the TUI. */
export class AttendedTaskRunner {
	private readonly store: PorcupineTaskStore;
	private readonly timer: ReturnType<typeof setInterval>;
	private wakeup: ReturnType<typeof setTimeout> | undefined;
	private readonly registrations = new Map<AgentSession, { entry: AttachedSession; unsubscribe: () => void }>();
	private selected: AttachedSession | undefined;
	private active: AttachedSession | undefined;
	private pending: Promise<void> | undefined;
	private closed = false;
	private abortRequested = false;

	constructor(agentDir: string) {
		this.store = new PorcupineTaskStore(agentDir);
		this.timer = setInterval(() => this.wake(), 15_000);
		this.timer.unref();
	}

	register(session: AgentSession, api: ServeApiSession): ServeApiSession {
		const entry = { session, api, foreground: 0 };
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "agent_end") this.wake();
		});
		this.registrations.set(session, { entry, unsubscribe });
		return {
			...api,
			setClientSurface: (surface) => {
				api.setClientSurface?.(surface);
				if (surface === "web") {
					this.selected = entry;
					this.wake();
				} else if (this.selected === entry) this.selected = undefined;
			},
			isStreaming: () => this.active === entry || api.isStreaming(),
			getControls: api.getControls
				? () => ({ ...api.getControls!(), busy: this.isBusy(session) || !session.isIdle || session.isCompacting })
				: undefined,
			configure: api.configure
				? (patch) => {
						if (this.isBusy(session)) throw new WorkbenchError(409, "Wait for the current turn to finish");
						return api.configure!(patch);
					}
				: undefined,
			setSessionModel: api.setSessionModel
				? async (provider, id) => {
						if (this.isBusy(session)) throw new WorkbenchError(409, "Wait for the current turn to finish");
						entry.foreground++;
						try {
							return await api.setSessionModel!(provider, id);
						} finally {
							entry.foreground--;
							this.wake();
						}
					}
				: undefined,
			abort: async () => {
				if (this.active === entry) this.abortRequested = true;
				await api.abort();
			},
			runCommand: api.runCommand
				? async (text) => {
						if (this.active === entry && !/^\/kill\s*$/.test(text))
							throw new WorkbenchError(409, "Wait for the scheduled task to finish");
						if (this.active === entry && /^\/kill\s*$/.test(text)) this.abortRequested = true;
						entry.foreground++;
						try {
							return await api.runCommand!(text);
						} finally {
							entry.foreground--;
							this.wake();
						}
					}
				: undefined,
			sendUserMessage: async (text, attachments) => {
				if (this.active === entry)
					throw new WorkbenchError(409, "A scheduled task is starting; queue the prompt instead");
				entry.foreground++;
				try {
					await api.sendUserMessage(text, attachments);
				} finally {
					entry.foreground--;
					this.wake();
				}
			},
			queueFollowUp: api.queueFollowUp
				? async (text, attachments) => {
						if (this.active === entry && !session.isStreaming)
							throw new WorkbenchError(409, "Wait for the scheduled task to start before queueing a prompt");
						entry.foreground++;
						try {
							await api.queueFollowUp!(text, attachments);
						} finally {
							entry.foreground--;
							this.wake();
						}
					}
				: undefined,
		};
	}

	private wake(): void {
		if (this.closed || this.wakeup) return;
		// agent_end precedes the session's idle transition; drain on the next turn.
		this.wakeup = setTimeout(() => {
			this.wakeup = undefined;
			void this.tick().catch((error: unknown) => {
				process.stderr.write(`Task drain failed: ${error instanceof Error ? error.message : String(error)}\n`);
			});
		}, 0);
		this.wakeup.unref();
	}

	async tick(now = new Date()): Promise<void> {
		const entry = this.selected;
		if (this.closed || this.active || !entry) return;
		const { session } = entry;
		if (
			entry.foreground ||
			session.clientSurface !== "web" ||
			!session.model ||
			!session.isIdle ||
			session.isCompacting ||
			session.isBashRunning ||
			session.pendingMessageCount > 0 ||
			session.subagentState.runs.some((run) => run.status === "running")
		)
			return;
		this.active = entry;
		this.abortRequested = false;
		this.pending = this.execute(entry, now);
		try {
			await this.pending;
		} finally {
			this.active = undefined;
			this.pending = undefined;
		}
	}

	private async execute({ session, api }: AttachedSession, now: Date): Promise<void> {
		const [schedule] = this.store.claimDueSchedules(now, 1);
		let taskId: string | undefined;
		let trigger: TaskRunTrigger | undefined;
		if (schedule) {
			taskId = schedule.taskId;
			trigger = { type: "cron", scheduleId: schedule.id, claimRunId: schedule.claimedRunId };
		} else {
			// Do not evaluate shell/file event triggers outside the TUI's existing path.
			const queued = [...this.store.listRuns()]
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.find((run) => {
					if (run.status !== "claimed" || run.trigger.type !== "manual") return false;
					const task = this.store.getTask(run.taskId);
					return task && task.status !== "paused" && task.status !== "cancelled" && task.status !== "running";
				});
			taskId = queued?.taskId;
			if (queued) trigger = { ...queued.trigger, claimRunId: queued.id };
		}
		if (!taskId || !trigger) return;
		const task = this.store.getTask(taskId);
		if (!task) return;
		let runId: string;
		try {
			runId = this.store.startRun(taskId, trigger).id;
		} catch (error) {
			// Another TUI/GUI process may have adopted the queued claim first.
			// failClaimedRun never changes a claim already adopted by the winner.
			if (trigger.type === "cron" && trigger.claimRunId)
				this.store.failClaimedRun(trigger.claimRunId, error instanceof Error ? error.message : String(error));
			return;
		}
		let result: AssistantMessage | undefined;
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "agent_start" && (this.closed || this.abortRequested)) void session.abort();
			if (event.type === "message_end" && event.message.role === "assistant") result = event.message;
		});
		try {
			await api.sendUserMessage(
				`## Porcupine Task: ${task.title}\n\n${task.prompt}\n\nVerify the outcome and report a concise result when the task is complete.`,
			);
			const text = result?.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.trim();
			if (this.closed || this.abortRequested || !result || result.stopReason !== "stop" || !text)
				throw new Error(
					this.closed
						? "Task stopped with the GUI server."
						: result?.errorMessage || "Task ended without a successful final report.",
				);
			this.store.completeRun(runId, text.slice(0, 2000));
		} catch (error) {
			this.store.failRun(runId, error instanceof Error ? error.message : String(error));
		} finally {
			unsubscribe();
			this.wake();
		}
	}

	isBusy(session: AgentSession): boolean {
		return this.active?.session === session || Boolean(this.registrations.get(session)?.entry.foreground);
	}

	unregister(session: AgentSession): void {
		if (this.selected?.session === session) this.selected = undefined;
		this.registrations.get(session)?.unsubscribe();
		this.registrations.delete(session);
	}

	/** Prevent new claims before closing HTTP connections and permission responders. */
	stop(): void {
		this.closed = true;
		this.selected = undefined;
		clearInterval(this.timer);
		clearTimeout(this.wakeup);
		for (const { unsubscribe } of this.registrations.values()) unsubscribe();
		this.registrations.clear();
	}

	async close(): Promise<void> {
		this.stop();
		if (this.active) await this.active.session.abort();
		await this.pending;
	}
}
