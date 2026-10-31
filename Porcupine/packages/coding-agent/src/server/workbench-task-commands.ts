import { type PorcupineTaskStore, parseCronCommand, parseTaskCommand } from "../porcupine/task-scheduler.ts";
import { WorkbenchError } from "./workbench-context-files.ts";

/** Same grammar and durable store as terminal commands; execution belongs to the idle drain. */
export function executeWorkbenchTaskCommand(store: PorcupineTaskStore, command: string): string {
	const task = parseTaskCommand(command);
	if (task) {
		switch (task.kind) {
			case "invalid":
				throw new WorkbenchError(400, task.message);
			case "list":
				return (
					store
						.listTasks()
						.map((item) => `${item.id} · ${item.status} · ${item.title}`)
						.join("\n") || "No saved tasks. Use /task add <title> :: <prompt>."
				);
			case "add": {
				const saved = store.createTask(task);
				return `Task saved: ${saved.id} · ${saved.title}`;
			}
			case "show": {
				const saved = store.getTask(task.taskId);
				if (!saved) throw new WorkbenchError(404, "Task not found");
				return `${saved.id} · ${saved.status} · ${saved.title}\n${saved.prompt}\n\n${
					store
						.listRuns(saved.id)
						.map(
							(run) =>
								`${run.id} · ${run.status} · ${run.trigger.type}\n${run.result || run.error || "Awaiting execution"}`,
						)
						.join("\n\n") || "No runs yet."
				}`;
			}
			case "run": {
				const run = store.queueTaskRun(task.taskId);
				return `Task queued: ${run.id}. Runs when the open TUI or GUI conversation is idle, using its model and permissions.`;
			}
			case "pause":
			case "resume":
			case "cancel": {
				const status = task.kind === "pause" ? "paused" : task.kind === "cancel" ? "cancelled" : "ready";
				store.setTaskStatus(task.taskId, status);
				return `Task ${task.taskId}: ${status}.${task.kind === "resume" ? " Resume attached Cron routines separately with /cron resume <id>." : ""}`;
			}
		}
	}
	const cron = parseCronCommand(command);
	if (!cron) throw new WorkbenchError(400, "Expected /task or /cron");
	switch (cron.kind) {
		case "invalid":
			throw new WorkbenchError(400, cron.message);
		case "list":
			return (
				store
					.listSchedules()
					.map(
						(item) =>
							`${item.id} · ${item.enabled ? "active" : "paused"} · ${item.taskId}\n${item.expression} (UTC) · next ${item.nextRunAt}`,
					)
					.join("\n\n") || "No Cron routines. Use /cron add <task-id> :: <five-field UTC expression>."
			);
		case "add": {
			const saved = store.createSchedule(cron);
			return `Cron saved: ${saved.id} · next ${saved.nextRunAt} (UTC). Runs only while a TUI or GUI conversation is open and idle.`;
		}
		case "run": {
			const saved = store.listSchedules().find((item) => item.id === cron.scheduleId);
			if (!saved) throw new WorkbenchError(404, "Cron routine not found");
			const run = store.queueTaskRun(saved.taskId);
			return `Manual run queued: ${run.id}. The routine's next scheduled occurrence is unchanged.`;
		}
		case "pause":
		case "resume": {
			const saved = store.setScheduleEnabled(cron.scheduleId, cron.kind === "resume");
			return `Cron ${saved.id}: ${saved.enabled ? "active" : "paused"}.`;
		}
		case "remove":
			store.removeSchedule(cron.scheduleId);
			return `Cron removed: ${cron.scheduleId}.`;
	}
}
