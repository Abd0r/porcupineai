import type { AgentSession } from "../core/agent-session.ts";
import { BUILTIN_SLASH_COMMANDS } from "../core/slash-commands.ts";
import {
	extractTrajectory,
	formatTraceAll,
	formatTraceStep,
	parseTraceSelection,
	resolveTraceStep,
} from "../modes/interactive/trace-command.ts";
import { formatGuideCommandOutput } from "../porcupine/guide.ts";
import { formatLearningStatus, listLearningEvents, listLearningFeed } from "../porcupine/learning-store.ts";
import { formatMemoryReport } from "../porcupine/memory-command.ts";
import { parseInitCommand, writeProjectContext } from "../porcupine/project-init.ts";
import { formatProjectsCommandOutput } from "../porcupine/project-search.ts";
import { PorcupineTaskStore } from "../porcupine/task-scheduler.ts";
import { getChangelogPath, parseChangelog } from "../utils/changelog.ts";
import { WorkbenchError } from "./workbench-context-files.ts";
import { createSessionSurfaces, type ReasoningMode } from "./workbench-session-surfaces.ts";
import { executeWorkbenchTaskCommand } from "./workbench-task-commands.ts";

export interface WorkbenchCommand {
	name: string;
	description: string;
	availability: "browser" | "terminal" | "turn";
}
export interface WorkbenchCommandResult {
	command: string;
	text: string;
}
const LOCAL = new Set(["new", "settings", "resume", "copy", "reasoning-show", "hotkeys"]);
const ENGINES = new Set([
	"commands",
	"help",
	"guide",
	"name",
	"session",
	"usage",
	"cost",
	"reasoning",
	"thinking",
	"adaptive",
	"auto",
	"modes",
	"model",
	"projects",
	"stacks",
	"subagents",
	"memory",
	"learning",
	"trace",
	"changelog",
	"init",
	"compact",
	"kill",
	"reload",
	"export",
	"task",
	"cron",
]);

/** Uses the runtime's real registries and engines; never sends unsupported builtins to the model. */
export function createWorkbenchCommands(session: AgentSession, agentDir: string) {
	const surfaces = createSessionSurfaces(session);
	const catalog = (): WorkbenchCommand[] => {
		const builtins = [
			{ name: "commands", description: "List commands and their availability" },
			{ name: "help", description: "List commands and their availability" },
			...BUILTIN_SLASH_COMMANDS,
		].map((command) => ({
			name: command.name,
			description: command.description,
			availability:
				LOCAL.has(command.name) || ENGINES.has(command.name) ? ("browser" as const) : ("terminal" as const),
		}));
		const dynamic = [
			...session.extensionRunner.getRegisteredCommands().map((command) => ({
				name: command.invocationName,
				description: command.description || "Extension command",
			})),
			...session.promptTemplates.map((prompt) => ({
				name: prompt.name,
				description: prompt.description || "Prompt template",
			})),
			...session.resourceLoader
				.getSkills()
				.skills.map((skill) => ({ name: `skill:${skill.name}`, description: skill.description })),
		];
		const names = new Set(builtins.map((command) => command.name));
		return [
			...builtins,
			...dynamic
				.filter((command) => !names.has(command.name))
				.map((command) => ({ ...command, availability: "turn" as const })),
		];
	};
	const execute = async (command: string): Promise<WorkbenchCommandResult> => {
		const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(command.trim());
		if (!match) throw new WorkbenchError(400, "Start a command with /");
		const name = match[1]!.toLowerCase(),
			args = match[2]?.trim() || "",
			found = catalog().find((item) => item.name === name);
		if (!found) throw new WorkbenchError(400, `Unknown command /${name}. Use /commands.`);
		if (session.isStreaming && name !== "kill") throw new WorkbenchError(409, "Wait for the current turn to finish");
		let text: string;
		if (found.availability === "terminal") text = `/${name} requires the Porcupine terminal. ${found.description}.`;
		else if (found.availability === "turn") {
			await session.prompt(command);
			text = `Executed /${name}.`;
		} else
			switch (name) {
				case "commands":
				case "help":
					text = catalog()
						.map(
							(item) =>
								`/${item.name} — ${item.description}${item.availability === "terminal" ? " (terminal only)" : ""}`,
						)
						.join("\n");
					break;
				case "guide":
					text = formatGuideCommandOutput(command);
					break;
				case "task":
				case "cron":
					text = executeWorkbenchTaskCommand(new PorcupineTaskStore(agentDir), command);
					break;
				case "name":
					if (!args) throw new WorkbenchError(400, "Usage: /name <name>");
					session.setSessionName(args.slice(0, 120));
					text = `Conversation named ${session.sessionName}.`;
					break;
				case "session": {
					const stats = session.getSessionStats();
					text = `${session.sessionName || "Conversation"}\nID: ${stats.sessionId}\nWorkspace: ${session.sessionManager.getCwd()}\nMessages: ${stats.totalMessages}\nTool calls: ${stats.toolCalls}\nReasoning: ${session.getReasoningMode()}\nMode: ${session.interactionMode}`;
					break;
				}
				case "usage":
				case "cost": {
					const stats = session.getSessionStats();
					text = `Input: ${stats.tokens.input}\nOutput: ${stats.tokens.output}\nCache read: ${stats.tokens.cacheRead}\nCache write: ${stats.tokens.cacheWrite}\nTotal tokens: ${stats.tokens.total}\nEstimated cost: $${stats.cost.toFixed(6)}`;
					break;
				}
				case "reasoning":
				case "thinking":
					if (args) surfaces.configure({ reasoningMode: args as ReasoningMode });
					text = `Reasoning: ${session.getReasoningMode()}`;
					break;
				case "adaptive":
					if (args && !["on", "off", "status"].includes(args))
						throw new WorkbenchError(400, "Usage: /adaptive [on|off|status]");
					if (args !== "status")
						session.setAdaptiveReasoning(args === "on" || (!args && !session.isAdaptiveReasoningEnabled));
					text = `Adaptive reasoning: ${session.isAdaptiveReasoningEnabled ? "on" : "off"}`;
					break;
				case "modes":
					if (args) {
						if (!["ask", "normal", "auto"].includes(args))
							throw new WorkbenchError(400, "Usage: /modes [ask|normal|auto]");
						surfaces.configure({ interactionMode: args as "ask" | "normal" | "auto" });
					}
					text = `Interaction mode: ${session.interactionMode}`;
					break;
				case "auto":
					if (args && !["on", "off", "status"].includes(args))
						throw new WorkbenchError(400, "Usage: /auto [on|off|status]");
					if (args !== "status")
						surfaces.configure({
							interactionMode:
								args === "on" || (!args && session.interactionMode !== "auto") ? "auto" : "normal",
						});
					text = `Interaction mode: ${session.interactionMode}`;
					break;
				case "model": {
					const split = args.indexOf("/");
					if (split < 1) throw new WorkbenchError(400, "Usage: /model <provider/model>");
					await surfaces.setSessionModel(args.slice(0, split), args.slice(split + 1));
					text = `Model: ${args}`;
					break;
				}
				case "projects":
					text = formatProjectsCommandOutput(session.sessionManager.getCwd(), args);
					break;
				case "stacks": {
					const entries = [
						...surfaces.getCatalog("skills", args, 0, 100).entries,
						...surfaces.getCatalog("tools", args, 0, 100).entries,
					];
					text =
						entries.map((entry) => `${entry.kind}: ${entry.name} — ${entry.description}`).join("\n") ||
						"No matching capabilities.";
					break;
				}
				case "subagents":
					text =
						session.subagentState.runs.map((run) => `@${run.name}: ${run.task} [${run.status}]`).join("\n") ||
						"No subagents in this session.";
					break;
				case "memory":
					text = formatMemoryReport(agentDir);
					break;
				case "learning":
					text =
						args === "history"
							? JSON.stringify(listLearningEvents(agentDir), null, 2)
							: args === "feed"
								? JSON.stringify(listLearningFeed(agentDir), null, 2)
								: formatLearningStatus(agentDir);
					break;
				case "trace": {
					const data = extractTrajectory(session.sessionManager.getEntries()),
						selection = parseTraceSelection(args);
					if (selection.kind === "invalid") throw new WorkbenchError(400, selection.reason);
					if (selection.kind === "all") text = formatTraceAll(data);
					else {
						const result = resolveTraceStep(data, selection);
						text = result.kind === "step" ? formatTraceStep(data, result.step) : "No matching trajectory step.";
					}
					break;
				}
				case "changelog":
					text =
						parseChangelog(getChangelogPath())
							.slice(0, 3)
							.map((entry) => entry.content)
							.join("\n\n") || "No changelog available.";
					break;
				case "init": {
					const parsed = parseInitCommand(command);
					if (!parsed || parsed.kind === "invalid") throw new WorkbenchError(400, "Usage: /init [--force]");
					const result = writeProjectContext(session.sessionManager.getCwd(), { force: parsed.force });
					text = result.message || `${result.status}: ${result.path}`;
					break;
				}
				case "compact":
					await session.compact(args || undefined);
					text = "Session context compacted. Saved conversation history is retained.";
					break;
				case "kill":
					session.abortBash();
					session.cancelAllSubagents();
					await session.abort();
					text = "Stopped the agent and cancelled its workers.";
					break;
				case "reload":
					await session.reload();
					text = "Resources reloaded for future turns.";
					break;
				case "export":
					text = `Exported session: ${await session.exportToHtml(args || undefined)}`;
					break;
				default:
					text = `Open /${name} from the browser controls.`;
			}
		const result = { command, text };
		session.sessionManager.appendCustomEntry("workbench.command", result);
		session.sessionManager.forceFlushToDisk();
		return result;
	};
	return { catalog, execute };
}
