import type { AgentSession } from "../core/agent-session.ts";
import { BUILTIN_SLASH_COMMANDS } from "../core/slash-commands.ts";
import {
	COMMAND_SURFACE_REQUIREMENTS,
	getSurfaceParityReport,
	type SurfaceImplementation,
	type SurfaceParity,
	type SurfaceParityReport,
} from "../core/surface-contract.ts";
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
import { buildCapabilityTreeFromSession } from "../porcupine/session-capabilities.ts";
import { formatStacksCommandOutput } from "../porcupine/stacks.ts";
import { formatSubagentSessionList, formatSubagentSessionView } from "../porcupine/subagent-session-format.ts";
import { listSubagentSessions } from "../porcupine/subagent-sessions.ts";
import { PorcupineTaskStore } from "../porcupine/task-scheduler.ts";
import { getChangelogPath, parseChangelog } from "../utils/changelog.ts";
import { WorkbenchError } from "./workbench-context-files.ts";
import { createSessionSurfaces, type ReasoningMode } from "./workbench-session-surfaces.ts";
import { executeWorkbenchTaskCommand } from "./workbench-task-commands.ts";

export interface WorkbenchCommand {
	name: string;
	description: string;
	availability: "browser" | "unavailable" | "turn";
	implementation?: SurfaceImplementation;
	parity?: SurfaceParity;
	acceptance?: string;
	gap?: string;
	hidden?: boolean;
}
export interface WorkbenchCommandResult {
	command: string;
	text: string;
	parity?: SurfaceParityReport;
}

/** Uses the runtime's real registries and engines; never sends unsupported builtins to the model. */
export function createWorkbenchCommands(session: AgentSession, agentDir: string) {
	const surfaces = createSessionSurfaces(session);
	const catalog = (): WorkbenchCommand[] => {
		const descriptions = new Map(
			[
				{ name: "commands", description: "List commands and their availability" },
				{ name: "help", description: "List commands and their availability" },
				{ name: "parity", description: "Inspect the TUI/GUI contract and remaining gaps" },
				...BUILTIN_SLASH_COMMANDS,
			].map((command) => [command.name, command.description]),
		);
		const builtins = COMMAND_SURFACE_REQUIREMENTS.map((rule) => ({
			...rule,
			description: descriptions.get(rule.name) || rule.acceptance,
			availability: rule.implementation === "missing" ? ("unavailable" as const) : ("browser" as const),
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
				.map((command) => ({
					...command,
					availability: "turn" as const,
					parity: "partial" as const,
					gap: "Prompt/template execution is shared; extension-specific browser UI requirements still need verification.",
				})),
		];
	};
	const execute = async (command: string): Promise<WorkbenchCommandResult> => {
		const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(command.trim());
		if (!match) throw new WorkbenchError(400, "Start a command with /");
		const name = match[1]!.toLowerCase(),
			args = match[2]?.trim() || "",
			found =
				catalog().find((item) => item.name === name) ||
				(name.startsWith("mcpp:") ? catalog().find((item) => item.name === "mcpp") : undefined);
		if (!found) throw new WorkbenchError(400, `Unknown command /${name}. Use /commands.`);
		if (session.isStreaming && name !== "kill") throw new WorkbenchError(409, "Wait for the current turn to finish");
		let text: string;
		let parity: SurfaceParityReport | undefined;
		if (found.implementation === "missing")
			throw new WorkbenchError(501, `/${name} is not wired in the GUI yet. ${found.gap}`);
		if (found.implementation === "client")
			throw new WorkbenchError(400, `/${name} is handled by the browser composer and controls.`);
		if (found.availability === "turn") {
			await session.prompt(command);
			text = `Executed /${name}.`;
		} else
			switch (name) {
				case "commands":
				case "help":
					text = catalog()
						.map(
							(item) =>
								`/${item.name} — ${item.description}${item.parity === "missing" ? " (GUI not wired)" : item.parity === "partial" ? " (partial GUI support)" : ""}`,
						)
						.join("\n");
					break;
				case "parity":
					parity = getSurfaceParityReport();
					text = `TUI/GUI parity is ${parity.ready ? "implemented; runtime and visual certification still required" : "not complete"}.\nContract v${parity.version}: ${parity.commands.length} commands, ${parity.runtime.length} runtime requirements.\nImplementation status is not proof of testing.\n\n${parity.gaps.map((gap) => `${gap.id} [${gap.parity}]\n${gap.gap}`).join("\n\n")}`;
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
					text = session.renderUsageCommand();
					break;
				case "cost":
					text = session.renderCostCommand();
					break;
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
					const active = new Set(session.getActiveToolNames());
					const tree = buildCapabilityTreeFromSession({
						tools: session.getAllTools().map((tool) => ({ ...tool, available: active.has(tool.name) })),
						skills: session.resourceLoader.getSkills().skills.map((skill) => ({ ...skill, available: true })),
					});
					text = formatStacksCommandOutput(tree, args);
					break;
				}
				case "subagents": {
					const saved = await listSubagentSessions(session.sessionManager.getSessionDir());
					text = args
						? formatSubagentSessionView(saved, args)
						: [
								session.subagentState.runs.map((run) => `@${run.name}: ${run.task} [${run.status}]`).join("\n"),
								formatSubagentSessionList(saved),
							]
								.filter(Boolean)
								.join("\n\n");
					break;
				}
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
				case "export": {
					const path = /^(?:"([^"]+)"|'([^']+)'|(\S+))$/.exec(args);
					if (args && !path)
						throw new WorkbenchError(400, "Usage: /export [path.html|path.jsonl]; quote paths with spaces");
					const output = path ? path[1] || path[2] || path[3] : undefined;
					text = `Exported session: ${output?.toLowerCase().endsWith(".jsonl") ? session.exportToJsonl(output) : await session.exportToHtml(output)}`;
					break;
				}
				default:
					throw new WorkbenchError(501, `No GUI handler is registered for /${name}.`);
			}
		const result: WorkbenchCommandResult = { command, text, ...(parity ? { parity } : {}) };
		session.sessionManager.appendCustomEntry("workbench.command", result);
		session.sessionManager.forceFlushToDisk();
		return result;
	};
	return { catalog, execute };
}
