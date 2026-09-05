export {
	type AskQuestionToolDetails,
	type AskQuestionToolInput,
	createAskQuestionTool,
	createAskQuestionToolDefinition,
} from "./ask-question.ts";
export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.ts";
export {
	createBrowserClickTool,
	createBrowserClickToolDefinition,
	createBrowserDiagnosticsTool,
	createBrowserDiagnosticsToolDefinition,
	createBrowserEvaluateTool,
	createBrowserEvaluateToolDefinition,
	createBrowserExtractTool,
	createBrowserExtractToolDefinition,
	createBrowserNavigateTool,
	createBrowserNavigateToolDefinition,
	createBrowserResizeTool,
	createBrowserResizeToolDefinition,
	createBrowserScreenshotTool,
	createBrowserScreenshotToolDefinition,
	createBrowserSnapshotTool,
	createBrowserSnapshotToolDefinition,
	createBrowserTypeTool,
	createBrowserTypeToolDefinition,
	createBrowserWaitTool,
	createBrowserWaitToolDefinition,
} from "./browser.ts";
export {
	type CapabilityCatalogTool,
	type CapabilitySearchToolDetails,
	type CapabilitySearchToolInput,
	type CapabilitySearchToolOptions,
	createCapabilitySearchTool,
	createCapabilitySearchToolDefinition,
} from "./capability-search.ts";
export {
	type ComputerUseToolDetails,
	type ComputerUseToolInput,
	type ComputerUseToolOptions,
	createComputerUseTool,
	createComputerUseToolDefinition,
} from "./computer-use.ts";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
} from "./edit.ts";
export {
	createEmailDraftTool,
	createEmailDraftToolDefinition,
	createEmailListTool,
	createEmailListToolDefinition,
	createEmailReadTool,
	createEmailReadToolDefinition,
	createEmailSendTool,
	createEmailSendToolDefinition,
	type EmailDraftDetails,
	type EmailDraftToolInput,
	type EmailListDetails,
	type EmailListToolInput,
	type EmailReadDetails,
	type EmailReadToolInput,
	type EmailSendDetails,
	type EmailSendToolInput,
	type EmailToolOptions,
} from "./email.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export {
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
} from "./find.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
export {
	createLiteratureTool,
	createLiteratureToolDefinition,
	type LiteratureToolDetails,
	type LiteratureToolInput,
	type LiteratureToolOptions,
} from "./literature.ts";
export {
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
} from "./ls.ts";
export {
	createMemoryTool,
	createMemoryToolDefinition,
	type MemoryToolDetails,
	type MemoryToolInput,
	type MemoryToolOptions,
} from "./memory.ts";
export {
	createProjectsTool,
	createProjectsToolDefinition,
	type ProjectsToolDetails,
	type ProjectsToolInput,
	type ProjectsToolOptions,
} from "./projects.ts";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
} from "./read.ts";
export {
	createSessionSearchTool,
	createSessionSearchToolDefinition,
	type SessionSearchToolDetails,
	type SessionSearchToolInput,
	type SessionSearchToolOptions,
} from "./session-search.ts";
export {
	createShowMarkdownTool,
	createShowMarkdownToolDefinition,
	SHOW_MARKDOWN_MAX_BYTES,
	type ShowMarkdownDetails,
	type ShowMarkdownToolInput,
} from "./show-markdown.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.ts";
export {
	createWebExtractTool,
	createWebExtractToolDefinition,
	extractUrl,
	type WebExtractToolDetails,
	type WebExtractToolInput,
} from "./web-extract.ts";
export {
	type BackendName,
	createWebSearchTool,
	createWebSearchToolDefinition,
	DEFAULT_WEB_SEARCH_ORDER,
	resolveWebSearchOrder,
	runFreeWebSearch,
	type WebSearchHit,
	type WebSearchToolDetails,
	type WebSearchToolInput,
} from "./web-search.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
} from "./write.ts";
export {
	createXDraftTool,
	createXDraftToolDefinition,
	createXPostTool,
	createXPostToolDefinition,
	createXReadTool,
	createXReadToolDefinition,
	createXReplyTool,
	createXReplyToolDefinition,
	createXSearchTool,
	createXSearchToolDefinition,
	type XDraftToolInput,
	type XPostToolInput,
	type XReadToolInput,
	type XReplyToolInput,
	type XSearchToolInput,
	type XToolsOptions,
} from "./x.ts";

import type { AgentTool } from "@porcupineai/agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import { createAskQuestionTool, createAskQuestionToolDefinition } from "./ask-question.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import {
	createBrowserClickTool,
	createBrowserClickToolDefinition,
	createBrowserDiagnosticsTool,
	createBrowserDiagnosticsToolDefinition,
	createBrowserEvaluateTool,
	createBrowserEvaluateToolDefinition,
	createBrowserExtractTool,
	createBrowserExtractToolDefinition,
	createBrowserNavigateTool,
	createBrowserNavigateToolDefinition,
	createBrowserResizeTool,
	createBrowserResizeToolDefinition,
	createBrowserScreenshotTool,
	createBrowserScreenshotToolDefinition,
	createBrowserSnapshotTool,
	createBrowserSnapshotToolDefinition,
	createBrowserTypeTool,
	createBrowserTypeToolDefinition,
	createBrowserWaitTool,
	createBrowserWaitToolDefinition,
} from "./browser.ts";
import {
	type CapabilitySearchToolOptions,
	createCapabilitySearchTool,
	createCapabilitySearchToolDefinition,
} from "./capability-search.ts";
import { type ComputerUseToolOptions, createComputerUseTool, createComputerUseToolDefinition } from "./computer-use.ts";
import { createEditTool, createEditToolDefinition, type EditToolOptions } from "./edit.ts";
import {
	createEmailDraftTool,
	createEmailDraftToolDefinition,
	createEmailListTool,
	createEmailListToolDefinition,
	createEmailReadTool,
	createEmailReadToolDefinition,
	createEmailSendTool,
	createEmailSendToolDefinition,
	type EmailToolOptions,
} from "./email.ts";
import { createFindTool, createFindToolDefinition, type FindToolOptions } from "./find.ts";
import { createGrepTool, createGrepToolDefinition, type GrepToolOptions } from "./grep.ts";
import {
	createInspectRuntimeTool,
	createInspectRuntimeToolDefinition,
	type InspectRuntimeToolOptions,
} from "./inspect-runtime.ts";
import { createLiteratureTool, createLiteratureToolDefinition, type LiteratureToolOptions } from "./literature.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createMcpResourcesToolDefinition, createUnavailableMcpResourcesToolDefinition } from "./mcp-resources.ts";
import { createMemoryTool, createMemoryToolDefinition, type MemoryToolOptions } from "./memory.ts";
import { createProjectsTool, createProjectsToolDefinition, type ProjectsToolOptions } from "./projects.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import {
	createSessionSearchTool,
	createSessionSearchToolDefinition,
	type SessionSearchToolOptions,
} from "./session-search.ts";
import { createShowMarkdownTool, createShowMarkdownToolDefinition } from "./show-markdown.ts";
import {
	createCraftSkillTool,
	createCraftSkillToolDefinition,
	createExtractSkillTool,
	createExtractSkillToolDefinition,
} from "./skill-tools.ts";

export {
	createInspectRuntimeTool,
	createInspectRuntimeToolDefinition,
	EXTENSION_API_SURFACE,
	EXTENSION_HOOKS,
	type InspectRuntimeToolDetails,
	type InspectRuntimeToolInput,
	type InspectRuntimeToolOptions,
	type RuntimeInspectCommand,
	type RuntimeInspectExtension,
	type RuntimeInspectState,
	type RuntimeInspectTool,
	registerRuntimeInspector,
} from "./inspect-runtime.ts";
export {
	type CraftSkillToolInput,
	createCraftSkillTool,
	createCraftSkillToolDefinition,
	createExtractSkillTool,
	createExtractSkillToolDefinition,
	type ExtractSkillToolInput,
	type SkillToolDetails,
	type SkillToolOptions,
} from "./skill-tools.ts";

import {
	createRemindMeTool,
	createRemindMeToolDefinition,
	type RemindMeToolOptions,
} from "../../porcupine/remind-me-tool.ts";
import { createPlanTool, createPlanToolDefinition, type PlanToolOptions } from "./plan.ts";
import {
	createSendToSubagentToolDefinition,
	createStopSubagentToolDefinition,
	createSubagentToolDefinition,
	createUnavailableSendToSubagentToolDefinition,
	createUnavailableStopSubagentToolDefinition,
	createUnavailableSubagentToolDefinition,
	type SubagentToolOptions,
} from "./subagent.ts";
import { createTasksTool, createTasksToolDefinition, type TasksToolOptions } from "./tasks.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { createWebExtractTool, createWebExtractToolDefinition } from "./web-extract.ts";
import { createWebSearchTool, createWebSearchToolDefinition } from "./web-search.ts";
import { createWriteTool, createWriteToolDefinition, type WriteToolOptions } from "./write.ts";
import {
	createXDraftTool,
	createXDraftToolDefinition,
	createXPostTool,
	createXPostToolDefinition,
	createXReadTool,
	createXReadToolDefinition,
	createXReplyTool,
	createXReplyToolDefinition,
	createXSearchTool,
	createXSearchToolDefinition,
	type XToolsOptions,
} from "./x.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName =
	| "ask_question"
	| "read"
	| "bash"
	| "edit"
	| "write"
	| "grep"
	| "find"
	| "ls"
	| "web_search"
	| "web_extract"
	| "computer_use"
	| "capability_search"
	| "memory"
	| "session_search"
	| "plan"
	| "tasks"
	| "projects"
	| "literature"
	| "subagent"
	| "send_to_subagent"
	| "stop_subagent"
	| "mcp_resources"
	| "remind_me"
	| "show_markdown"
	| "x_search"
	| "x_read"
	| "x_draft"
	| "x_post"
	| "x_reply"
	| "email_list"
	| "email_read"
	| "email_draft"
	| "email_send"
	| "browser_navigate"
	| "browser_click"
	| "browser_type"
	| "browser_extract"
	| "browser_screenshot"
	| "browser_evaluate"
	| "browser_snapshot"
	| "browser_resize"
	| "browser_wait"
	| "browser_diagnostics"
	| "extract_skill"
	| "craft_skill"
	| "inspect_runtime";
export const allToolNames: Set<ToolName> = new Set([
	"ask_question",
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"web_search",
	"web_extract",
	"computer_use",
	"capability_search",
	"memory",
	"session_search",
	"plan",
	"tasks",
	"projects",
	"literature",
	"subagent",
	"send_to_subagent",
	"stop_subagent",
	"mcp_resources",
	"remind_me",
	"show_markdown",
	"x_search",
	"x_read",
	"x_draft",
	"x_post",
	"x_reply",
	"email_list",
	"email_read",
	"email_draft",
	"email_send",
	"browser_navigate",
	"browser_click",
	"browser_type",
	"browser_extract",
	"browser_screenshot",
	"browser_evaluate",
	"browser_snapshot",
	"browser_resize",
	"browser_wait",
	"browser_diagnostics",
	"extract_skill",
	"craft_skill",
	"inspect_runtime",
]);

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	write?: WriteToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
	computer_use?: ComputerUseToolOptions;
	capability_search?: CapabilitySearchToolOptions;
	memory?: MemoryToolOptions;
	session_search?: SessionSearchToolOptions;
	plan?: PlanToolOptions;
	tasks?: TasksToolOptions;
	remind?: RemindMeToolOptions;
	projects?: ProjectsToolOptions;
	literature?: LiteratureToolOptions;
	subagent?: SubagentToolOptions;
	sendToSubagent?: import("./subagent.ts").SendToSubagentToolOptions;
	stopSubagent?: import("./subagent.ts").StopSubagentToolOptions;
	mcpResources?: import("./mcp-resources.ts").McpResourcesToolOptions;
	x?: XToolsOptions;
	email?: EmailToolOptions;
	inspectRuntime?: InspectRuntimeToolOptions;
	browser?: BrowserToolOptions;
}

/** Options for the browser tool family (visual layer for text-only models). */
export interface BrowserToolOptions {
	/** True when the active model cannot see images; browser_snapshot adds an OCR layer. */
	isTextOnlyModel?: () => boolean;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	const definition = createAllToolDefinitions(cwd, options)[toolName];
	if (!definition) throw new Error(`Unknown tool name: ${toolName}`);
	return definition;
}
export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	const tool = createAllTools(cwd, options)[toolName];
	if (!tool) throw new Error(`Unknown tool name: ${toolName}`);
	return tool;
}

function createCapabilityCatalogDefinition(cwd: string, options?: ToolsOptions): ToolDef {
	return createCapabilitySearchToolDefinition({
		cwd,
		...options?.capability_search,
		getTools: options?.capability_search?.getTools ?? (() => Object.values(createAllToolDefinitions(cwd, options))),
	});
}

function createCapabilityCatalogTool(cwd: string, options?: ToolsOptions): Tool {
	return createCapabilitySearchTool({
		cwd,
		...options?.capability_search,
		getTools: options?.capability_search?.getTools ?? (() => Object.values(createAllToolDefinitions(cwd, options))),
	});
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createAskQuestionToolDefinition(),
		createReadToolDefinition(cwd, options?.read),
		createBashToolDefinition(cwd, options?.bash),
		createEditToolDefinition(cwd, options?.edit),
		createWriteToolDefinition(cwd, options?.write),
		createWebSearchToolDefinition(),
		createWebExtractToolDefinition(),
		createComputerUseToolDefinition(options?.computer_use),
		createCapabilityCatalogDefinition(cwd, options),
		createMemoryToolDefinition(options?.memory),
		createProjectsToolDefinition(options?.projects),
		createSessionSearchToolDefinition({ cwd, ...options?.session_search }),
		createPlanToolDefinition(options?.plan),
		createTasksToolDefinition(options?.tasks),
		createRemindMeToolDefinition(options?.remind),
		createLiteratureToolDefinition(options?.literature),
		createShowMarkdownToolDefinition(cwd),
		createXSearchToolDefinition(options?.x),
		createXReadToolDefinition(options?.x),
		createXDraftToolDefinition(options?.x),
		createXPostToolDefinition(options?.x),
		createXReplyToolDefinition(options?.x),
		createEmailListToolDefinition(options?.email),
		createEmailReadToolDefinition(options?.email),
		createEmailDraftToolDefinition(options?.email),
		createEmailSendToolDefinition(options?.email),
	];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createAskQuestionToolDefinition(),
		createReadToolDefinition(cwd, options?.read),
		createGrepToolDefinition(cwd, options?.grep),
		createFindToolDefinition(cwd, options?.find),
		createLsToolDefinition(cwd, options?.ls),
		createWebSearchToolDefinition(),
		createWebExtractToolDefinition(),
		createComputerUseToolDefinition(options?.computer_use),
		createCapabilityCatalogDefinition(cwd, options),
		createMemoryToolDefinition(options?.memory),
		createProjectsToolDefinition(options?.projects),
		createSessionSearchToolDefinition({ cwd, ...options?.session_search }),
		createShowMarkdownToolDefinition(cwd),
	];
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		ask_question: createAskQuestionToolDefinition(),
		read: createReadToolDefinition(cwd, options?.read),
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd, options?.edit),
		write: createWriteToolDefinition(cwd, options?.write),
		grep: createGrepToolDefinition(cwd, options?.grep),
		find: createFindToolDefinition(cwd, options?.find),
		ls: createLsToolDefinition(cwd, options?.ls),
		web_search: createWebSearchToolDefinition(),
		web_extract: createWebExtractToolDefinition(),
		computer_use: createComputerUseToolDefinition(options?.computer_use),
		capability_search: createCapabilitySearchToolDefinition({
			cwd,
			...options?.capability_search,
			getTools:
				options?.capability_search?.getTools ?? (() => Object.values(createAllToolDefinitions(cwd, options))),
		}),
		memory: createMemoryToolDefinition(options?.memory),
		projects: createProjectsToolDefinition(options?.projects),
		session_search: createSessionSearchToolDefinition({ cwd, ...options?.session_search }),
		plan: createPlanToolDefinition(options?.plan),
		tasks: createTasksToolDefinition(options?.tasks),
		remind_me: createRemindMeToolDefinition(options?.remind),
		literature: createLiteratureToolDefinition(options?.literature),
		show_markdown: createShowMarkdownToolDefinition(cwd),
		subagent: options?.subagent
			? createSubagentToolDefinition(options.subagent)
			: createUnavailableSubagentToolDefinition(),
		send_to_subagent: options?.sendToSubagent
			? createSendToSubagentToolDefinition(options.sendToSubagent)
			: createUnavailableSendToSubagentToolDefinition(),
		stop_subagent: options?.stopSubagent
			? createStopSubagentToolDefinition(options.stopSubagent)
			: createUnavailableStopSubagentToolDefinition(),
		mcp_resources: options?.mcpResources
			? createMcpResourcesToolDefinition(options.mcpResources)
			: createUnavailableMcpResourcesToolDefinition(),
		inspect_runtime: createInspectRuntimeToolDefinition(options?.inspectRuntime),
		x_search: createXSearchToolDefinition(options?.x),
		x_read: createXReadToolDefinition(options?.x),
		x_draft: createXDraftToolDefinition(options?.x),
		x_post: createXPostToolDefinition(options?.x),
		x_reply: createXReplyToolDefinition(options?.x),
		email_list: createEmailListToolDefinition(options?.email),
		email_read: createEmailReadToolDefinition(options?.email),
		email_draft: createEmailDraftToolDefinition(options?.email),
		email_send: createEmailSendToolDefinition(options?.email),
		browser_navigate: createBrowserNavigateToolDefinition(),
		browser_click: createBrowserClickToolDefinition(),
		browser_type: createBrowserTypeToolDefinition(),
		browser_extract: createBrowserExtractToolDefinition(),
		browser_screenshot: createBrowserScreenshotToolDefinition(),
		browser_evaluate: createBrowserEvaluateToolDefinition(),
		browser_snapshot: createBrowserSnapshotToolDefinition({ isTextOnlyModel: options?.browser?.isTextOnlyModel }),
		browser_resize: createBrowserResizeToolDefinition(),
		browser_wait: createBrowserWaitToolDefinition(),
		browser_diagnostics: createBrowserDiagnosticsToolDefinition(),
		extract_skill: createExtractSkillToolDefinition(),
		craft_skill: createCraftSkillToolDefinition(),
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createAskQuestionTool(),
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
		createWebSearchTool(),
		createWebExtractTool(),
		createComputerUseTool(options?.computer_use),
		createCapabilityCatalogTool(cwd, options),
		createMemoryTool(options?.memory),
		createProjectsTool(options?.projects),
		createSessionSearchTool({ cwd, ...options?.session_search }),
		createPlanTool(options?.plan),
		createTasksTool(options?.tasks),
		createRemindMeTool(options?.remind),
		createLiteratureTool(options?.literature),
		createShowMarkdownTool(cwd),
		createXSearchTool(options?.x),
		createXReadTool(options?.x),
		createXDraftTool(options?.x),
		createXPostTool(options?.x),
		createXReplyTool(options?.x),
		createEmailListTool(options?.email),
		createEmailReadTool(options?.email),
		createEmailDraftTool(options?.email),
		createEmailSendTool(options?.email),
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createAskQuestionTool(),
		createReadTool(cwd, options?.read),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
		createWebSearchTool(),
		createWebExtractTool(),
		createComputerUseTool(options?.computer_use),
		createCapabilityCatalogTool(cwd, options),
		createMemoryTool(options?.memory),
		createProjectsTool(options?.projects),
		createSessionSearchTool({ cwd, ...options?.session_search }),
		createShowMarkdownTool(cwd),
	];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		ask_question: createAskQuestionTool(),
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd, options?.edit),
		write: createWriteTool(cwd, options?.write),
		grep: createGrepTool(cwd, options?.grep),
		find: createFindTool(cwd, options?.find),
		ls: createLsTool(cwd, options?.ls),
		web_search: createWebSearchTool(),
		web_extract: createWebExtractTool(),
		computer_use: createComputerUseTool(options?.computer_use),
		capability_search: createCapabilitySearchTool({
			cwd,
			...options?.capability_search,
			getTools:
				options?.capability_search?.getTools ?? (() => Object.values(createAllToolDefinitions(cwd, options))),
		}),
		memory: createMemoryTool(options?.memory),
		projects: createProjectsTool(options?.projects),
		session_search: createSessionSearchTool({ cwd, ...options?.session_search }),
		plan: createPlanTool(options?.plan),
		tasks: createTasksTool(options?.tasks),
		remind_me: createRemindMeTool(options?.remind),
		literature: createLiteratureTool(options?.literature),
		show_markdown: createShowMarkdownTool(cwd),
		subagent: wrapToolDefinition(
			options?.subagent ? createSubagentToolDefinition(options.subagent) : createUnavailableSubagentToolDefinition(),
		),
		send_to_subagent: wrapToolDefinition(
			options?.sendToSubagent
				? createSendToSubagentToolDefinition(options.sendToSubagent)
				: createUnavailableSendToSubagentToolDefinition(),
		),
		stop_subagent: wrapToolDefinition(
			options?.stopSubagent
				? createStopSubagentToolDefinition(options.stopSubagent)
				: createUnavailableStopSubagentToolDefinition(),
		),
		mcp_resources: wrapToolDefinition(
			options?.mcpResources
				? createMcpResourcesToolDefinition(options.mcpResources)
				: createUnavailableMcpResourcesToolDefinition(),
		),
		inspect_runtime: createInspectRuntimeTool(options?.inspectRuntime),
		x_search: createXSearchTool(options?.x),
		x_read: createXReadTool(options?.x),
		x_draft: createXDraftTool(options?.x),
		x_post: createXPostTool(options?.x),
		x_reply: createXReplyTool(options?.x),
		email_list: createEmailListTool(options?.email),
		email_read: createEmailReadTool(options?.email),
		email_draft: createEmailDraftTool(options?.email),
		email_send: createEmailSendTool(options?.email),
		browser_navigate: createBrowserNavigateTool(),
		browser_click: createBrowserClickTool(),
		browser_type: createBrowserTypeTool(),
		browser_extract: createBrowserExtractTool(),
		browser_screenshot: createBrowserScreenshotTool(),
		browser_evaluate: createBrowserEvaluateTool(),
		browser_snapshot: createBrowserSnapshotTool(),
		browser_resize: createBrowserResizeTool(),
		browser_wait: createBrowserWaitTool(),
		browser_diagnostics: createBrowserDiagnosticsTool(),
		extract_skill: createExtractSkillTool(),
		craft_skill: createCraftSkillTool(),
	};
}
