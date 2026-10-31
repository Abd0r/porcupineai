/** Semantic TUI <-> GUI requirements. Presentation can differ; runtime truth cannot. */
export type SurfaceImplementation = "client" | "engine" | "missing";
export type SurfaceParity = "implemented" | "partial" | "missing";
export interface CommandSurfaceRequirement {
	name: string;
	implementation: SurfaceImplementation;
	parity: SurfaceParity;
	acceptance: string;
	gap?: string;
	hidden?: boolean;
}
export interface RuntimeSurfaceRequirement {
	id: string;
	parity: SurfaceParity;
	acceptance: string;
	gap?: string;
}
export interface SurfaceParityReport {
	version: 1;
	ready: boolean;
	commands: readonly CommandSurfaceRequirement[];
	runtime: readonly RuntimeSurfaceRequirement[];
	gaps: Array<{ id: string; parity: SurfaceParity; gap: string }>;
}

function implemented(
	name: string,
	acceptance: string,
	implementation: SurfaceImplementation = "engine",
): CommandSurfaceRequirement {
	return { name, implementation, parity: "implemented", acceptance };
}
function partial(
	name: string,
	acceptance: string,
	gap: string,
	implementation: SurfaceImplementation = "engine",
): CommandSurfaceRequirement {
	return { name, implementation, parity: "partial", acceptance, gap };
}
function missing(name: string, acceptance: string, gap: string, hidden = false): CommandSurfaceRequirement {
	return { name, implementation: "missing", parity: "missing", acceptance, gap, hidden };
}

/** No fallback classification: adding a TUI command requires an explicit decision here. */
export const COMMAND_SURFACE_REQUIREMENTS: readonly CommandSurfaceRequirement[] = [
	implemented("guide", "Render the same workflow guide and topic selection without a model call."),
	partial(
		"settings",
		"Read and persist every applicable runtime setting; browser appearance may differ.",
		"Appearance, models, limits and context exist; the remaining TUI settings need GUI controls.",
		"client",
	),
	implemented(
		"model",
		"Select the same provider/model and preserve the conversation; use a browser picker when no argument is supplied.",
	),
	missing(
		"scoped-models",
		"Edit and persist the model cycling scope with the same model validation.",
		"The GUI model picker does not expose the TUI's scoped-model selection.",
	),
	partial(
		"export",
		"Export real HTML or JSONL, preserve session entries and support quoted paths.",
		"Host HTML/JSONL export works; direct browser export downloads still need a dedicated action.",
	),
	missing(
		"import",
		"Import JSONL into a resumable session with validated cwd, collision handling and lifecycle hooks.",
		"GUI upload/import and runtime replacement are not wired.",
	),
	missing(
		"share",
		"Preview and explicitly approve the same secret-gist session sharing action.",
		"The GUI has no session-sharing preview or publishing action.",
	),
	implemented(
		"copy",
		"Copy the last completed assistant answer; preserve the draft and report clipboard failures.",
		"client",
	),
	implemented("name", "Persist the selected conversation's display name without changing its identity or history."),
	implemented("session", "Read the real session identity, cwd, message counts, model context and policy."),
	implemented("trace", "Resolve the same step or all-steps trajectory from persisted session entries."),
	implemented("usage", "Render shared per-turn token usage and session totals from persisted and live accounting."),
	implemented("cost", "Render shared model-attributed costs and token fallback when pricing is unavailable."),
	implemented("changelog", "Read packaged release notes without invoking the agent or fetching unrelated content."),
	implemented(
		"kill",
		"Abort the current run, bash and subagents; report actual terminal states and preserve completed history.",
	),
	missing(
		"view",
		"Open a user-selected Markdown resource with safe rendering, math, scrolling and a close action.",
		"Resource previews exist, but /view is not connected to the browser viewer.",
	),
	implemented(
		"hotkeys",
		"Show the browser's equivalent keyboard actions without advertising terminal-only key sequences.",
		"client",
	),
	missing(
		"fork",
		"Fork before a selected user message, retain ancestry, run lifecycle hooks and restore the selected text as a draft.",
		"GUI message selection and runtime fork/navigation are missing.",
	),
	missing(
		"clone",
		"Clone the selected leaf into an independent conversation without modifying the original.",
		"GUI cloning is not connected to the shared session runtime.",
	),
	missing(
		"tree",
		"Inspect branches and switch the active leaf without losing saved history, tools or context.",
		"The GUI does not expose session tree navigation.",
	),
	missing(
		"trust",
		"Persist a deliberate project trust decision and reload resources through the shared trust policy.",
		"There is no GUI project trust selector or matching runtime replacement flow.",
	),
	missing(
		"login",
		"Configure provider API-key, subscription or OAuth authentication without secrets entering chat, logs or replay.",
		"Secure provider authentication forms and OAuth progress are not wired into the GUI.",
	),
	missing(
		"logout",
		"Remove the selected provider's stored authentication and refresh model availability without exposing credentials.",
		"Provider logout and credential-state refresh are not available in the GUI.",
	),
	implemented(
		"new",
		"Create a new conversation while keeping the original saved and its unsent draft isolated.",
		"client",
	),
	implemented("compact", "Use the session's compaction engine and preserve the full saved transcript for replay."),
	implemented(
		"resume",
		"Discover and resume the same saved session, model context and identity; retain another chat's draft.",
		"client",
	),
	partial(
		"reload",
		"Reload applicable resources for future turns without changing schemas already resolved for a running turn.",
		"Session resource reload works; browser catalog refresh and extension UI rebinding need acceptance coverage.",
	),
	missing(
		"refresh",
		"Rebuild services and resume the same saved session, honouring cancellation and extension lifecycle hooks.",
		"The server adapter cannot yet rebind itself after a full runtime refresh.",
	),
	missing(
		"restart",
		"Restart the host and reconnect to the same saved session without replaying unfinished tasks.",
		"GUI host restart, launch-token rotation and reconnection are not implemented.",
	),
	implemented(
		"reasoning",
		"Use the same supported reasoning levels and adaptive policy; reject unsupported model levels.",
	),
	implemented("thinking", "Alias reasoning through the same shared model-level validation and state."),
	implemented(
		"reasoning-show",
		"Remember reasoning disclosure without changing model effort or permission policy.",
		"client",
	),
	implemented("auto", "Change the same Ask/Normal/Auto policy; Auto retains the fail-closed safety gate."),
	missing(
		"sandbox",
		"Enable, disable and inspect the same Gondolin isolation lifecycle with truthful platform support.",
		"The GUI does not host Gondolin sandbox lifecycle controls.",
	),
	missing(
		"update",
		"Check the shared version source and show truthful update instructions without silently installing software.",
		"The GUI has no explicit version-check command handler.",
	),
	implemented("modes", "Read or change the same Ask/Normal/Auto policy and require idle state for changes."),
	implemented("adaptive", "Change adaptive reasoning independently of autonomy and persist through session state."),
	implemented(
		"stacks",
		"Search the shared hierarchical capability tree including stack:id queries and availability explanations.",
	),
	partial(
		"subagents",
		"Inspect live workers, recall saved run metadata and transcripts, and continue a saved run when requested.",
		"Live workers and saved metadata recall work; complete transcript/continuation controls are missing.",
	),
	missing(
		"voice",
		"Record speech, transcribe, submit and play speech through explicit accessible controls and the same voice settings.",
		"Browser recording, local STT/TTS endpoints and voice lifecycle are not wired.",
	),
	implemented(
		"projects",
		"Discover and search the same canonical project workspaces without duplicating their storage.",
	),
	partial(
		"learning",
		"Inspect the same learning graph, history and governed proposals without activating unverified changes.",
		"GUI status/history/feed exist, but graph selection and refinement actions are not equivalent.",
	),
	implemented(
		"memory",
		"Read the shared durable user/environment memory report without rewriting memory or emitting secrets.",
	),
	implemented("init", "Use the shared compact context-file writer and preserve its overwrite/merge semantics."),
	missing(
		"plan",
		"Route capabilities, enforce the inspection-only fence, and save a verified plan artifact with status and clear actions.",
		"Goal/plan display exists, but the /plan artifact workflow is not wired in the GUI.",
	),
	missing(
		"remind",
		"Persist reminders with the session and deliver due reminders once while the attached session is idle.",
		"The GUI task drain does not restore or deliver session reminders.",
	),
	implemented(
		"task",
		"Use one durable task store and append-only run history, including pause, cancel and explicit queued execution.",
	),
	implemented(
		"cron",
		"Claim occurrences atomically, use UTC schedules and the attended session's model/permissions, and never replay unknown runs.",
	),
	missing(
		"email",
		"Use shared mailbox/draft operations and require an explicit send action with visible recipient and content.",
		"GUI email command dispatch and a reviewable send flow are not implemented.",
	),
	missing(
		"extract-stack",
		"Extract a local document through the shared capability-authoring and validation flow, preserving provenance.",
		"The GUI does not dispatch document-to-capability extraction.",
	),
	missing(
		"craft-stack",
		"Research and draft a capability through the same governed creation/validation flow and refresh future discovery.",
		"The GUI does not dispatch research-to-capability authoring.",
	),
	missing(
		"quit",
		"Stop the host cleanly, settle pending approvals, retain saved state and show a disconnected client.",
		"Stopping from the host terminal works; the GUI has no host shutdown command.",
	),
	missing(
		"x",
		"Use shared search/drafts and explicitly review recipient/content before posting or replying.",
		"GUI X command dispatch and reviewable publishing controls are not implemented.",
	),
	missing(
		"refine",
		"Review and refine learned capability proposals through the governed learning path.",
		"The TUI refinement dispatch has no equivalent GUI command.",
	),
	missing(
		"mcpp",
		"Discover and invoke namespaced MCP prompts with validated arguments through the same manager.",
		"The /mcpp: namespace and argument collection are not exposed in GUI discovery.",
	),
	missing(
		"debug",
		"Inspect real runtime diagnostics without including credentials or changing conversation state.",
		"The terminal debug view has no GUI diagnostics adapter.",
		true,
	),
	missing(
		"arminsayshi",
		"Provide the explicit hidden command's equivalent optional presentation without changing runtime state.",
		"This hidden TUI presentation has no browser adapter.",
		true,
	),
	missing(
		"dementedelves",
		"Provide the explicit hidden command's equivalent optional presentation without changing runtime state.",
		"This hidden TUI presentation has no browser adapter.",
		true,
	),
	implemented(
		"commands",
		"Discover commands with implementation status and never present an unwired action as successful.",
	),
	implemented("help", "Alias command discovery and show honest GUI availability and partial behavior."),
	implemented(
		"parity",
		"Inspect the versioned TUI/GUI contract and every remaining implementation gap without a model call.",
	),
];

export const RUNTIME_SURFACE_REQUIREMENTS: readonly RuntimeSurfaceRequirement[] = [
	{
		id: "session-handoff",
		parity: "partial",
		acceptance:
			"Preserve session ID, branch, history, model context and policy in both directions across a saved-session handoff.",
		gap: "Saved history/context/identity round-trip is verified; conversation-local interaction policy and adaptive state still need durable handoff and acceptance coverage.",
	},
	{
		id: "streaming",
		parity: "implemented",
		acceptance:
			"Render structured reasoning, text, tools, failures and completion in chronological order; replay retains supplied evidence.",
	},
	{
		id: "steering",
		parity: "implemented",
		acceptance:
			"Inject queued prompts at the next safe model/tool boundary, retain FIFO and attachment data, and reject stale cancellation.",
	},
	{
		id: "permissions",
		parity: "implemented",
		acceptance:
			"Share Ask/Normal/Auto guards, scope decisions to their session and nonce, and deny pending approvals on shutdown.",
	},
	{
		id: "tool-execution",
		parity: "implemented",
		acceptance:
			"Use identical registered tools and policy guards, with actual arguments, results and failure state visible on both surfaces.",
	},
	{
		id: "extension-ui",
		parity: "partial",
		acceptance:
			"Adapt extension confirm, select, input, editor, notifications and custom presentations with cancellation semantics.",
		gap: "Agent confirmations are wired; arbitrary extension dialogs, editors and TUI components need browser adapters.",
	},
	{
		id: "dynamic-commands",
		parity: "partial",
		acceptance:
			"Discover and execute extension commands, templates, skills and MCP prompts with source metadata and exact arguments.",
		gap: "Templates, skills and extension command discovery exist; extension UI requirements and MCP prompt dispatch remain incomplete.",
	},
	{
		id: "manual-shell",
		parity: "missing",
		acceptance:
			"Run ! commands through shared shell guards and stream output; !! excludes results from model context, and Stop cancels execution.",
		gap: "GUI input currently treats ! and !! as ordinary agent prompts instead of explicit user shell commands.",
	},
	{
		id: "event-triggered-tasks",
		parity: "missing",
		acceptance:
			"Evaluate supported file/script triggers through an attended policy-controlled path and atomically adopt each run once.",
		gap: "GUI drains Cron/manual/chained runs, but file/script event-trigger checks remain TUI-only.",
	},
	{
		id: "task-cron",
		parity: "implemented",
		acceptance:
			"Share definitions, schedules, atomic claims and terminal history; preserve live owners and mark dead unfinished owners unknown.",
	},
	{
		id: "mcp-lifecycle",
		parity: "partial",
		acceptance:
			"Start, authenticate, list, reconnect and refresh MCP tools/resources/prompts under the same trust and permission rules.",
		gap: "A complete serve-host MCP lifecycle and GUI authentication/reconnection acceptance suite is missing.",
	},
	{
		id: "configuration",
		parity: "partial",
		acceptance:
			"Persist all shared runtime settings through the same stores; keep browser-only appearance separate from model and permission state.",
		gap: "The GUI settings tabs expose a subset of the terminal settings catalog.",
	},
	{
		id: "custom-agent-home",
		parity: "partial",
		acceptance:
			"Use the configured agent home consistently for auth, settings, task tools, schedules, resources and saved sessions.",
		gap: "Serve commands use the configured home; all tool factories and surface handoffs need isolated-home regression coverage.",
	},
	{
		id: "context-and-learning",
		parity: "partial",
		acceptance:
			"Share governed memory/learning evidence, reload future context intentionally, and never silently activate unvalidated proposals.",
		gap: "Basic context and memory surfaces exist; full learning/refinement UI and refresh lifecycle remain incomplete.",
	},
	{
		id: "files-and-visuals",
		parity: "implemented",
		acceptance:
			"Share attachments, paths and saved visual payloads; GUI previews and TUI text fallbacks retain the same data and bounds.",
	},
	{
		id: "keyboard-and-editor",
		parity: "partial",
		acceptance:
			"Provide accessible equivalents for history, multiline editing, draft recovery, queue editing, cancellation and external-editor workflows.",
		gap: "GUI draft/IME/queue support exists; full TUI editor/history and external-editor equivalents need coverage.",
	},
	{
		id: "reconnect",
		parity: "implemented",
		acceptance:
			"Reconnect without duplicate turns, stale drafts, lost approvals or cross-session events; disconnected controls fail visibly.",
	},
	{
		id: "appearance",
		parity: "implemented",
		acceptance:
			"Preserve Pixel/System defaults and saved preferences; verify equivalent features in all five themes, dark/light and reduced-motion layouts.",
	},
];

export function getSurfaceParityReport(): SurfaceParityReport {
	const gaps = [
		...COMMAND_SURFACE_REQUIREMENTS.map((rule) => ({
			id: `command:${rule.name}`,
			parity: rule.parity,
			gap: rule.gap || "",
		})),
		...RUNTIME_SURFACE_REQUIREMENTS.map((rule) => ({
			id: `runtime:${rule.id}`,
			parity: rule.parity,
			gap: rule.gap || "",
		})),
	].filter((rule) => rule.parity !== "implemented");
	return {
		version: 1,
		ready: gaps.length === 0,
		commands: COMMAND_SURFACE_REQUIREMENTS,
		runtime: RUNTIME_SURFACE_REQUIREMENTS,
		gaps,
	};
}
