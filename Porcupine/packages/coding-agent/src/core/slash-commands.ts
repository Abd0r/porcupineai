import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{
		name: "guide",
		description: "Learn Porcupine workflows and capabilities",
		argumentHint: "[topic]",
	},
	{ name: "settings", description: "Open settings menu" },
	{
		name: "model",
		description: "Select model (opens selector UI)",
		argumentHint: "<provider/model>",
	},
	{
		name: "scoped-models",
		description: "Enable/disable models for Ctrl+P cycling",
	},
	{
		name: "export",
		description: "Export session (HTML default, or specify path: .html/.jsonl)",
	},
	{
		name: "import",
		description: "Import and resume a session from a JSONL file",
	},
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{
		name: "trace",
		description: "Show the model trajectory (per-step prompt hash, model, thinking, tools)",
		argumentHint: "[<step>|all]",
	},
	// anchor: usage-and-cost
	{ name: "usage", description: "Show per-turn token usage and totals for this session" },
	{ name: "cost", description: "Show estimated token cost for this session" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "kill", description: "Instantly stop everything: the current run, bash, and sub-agents" },
	{ name: "view", description: "Open a markdown file in the full-screen viewer", argumentHint: "<path>" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{
		name: "fork",
		description: "Create a new fork from a previous user message",
	},
	{
		name: "clone",
		description: "Duplicate the current session at the current position",
	},
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{
		name: "trust",
		description: "Save project trust decision for future sessions",
	},
	{
		name: "login",
		description: "Configure provider authentication",
		argumentHint: "<provider>",
	},
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "resume", description: "Resume a different session" },
	{
		name: "reload",
		description: "Reload keybindings, extensions, skills, prompts, themes, and context files",
	},
	{
		name: "refresh",
		description: "Rebuild whole Porcupine runtime and resume this session",
		argumentHint: "[skill|all]",
	},
	{
		name: "restart",
		description: "Fully restart Porcupine process and resume this session",
	},
	{
		name: "reasoning",
		description: "Select reasoning mode (thinking levels + adaptive)",
		argumentHint: "[off|minimal|low|medium|high|xhigh|max|adaptive]",
	},
	{
		name: "thinking",
		description: "Alias for /reasoning",
		argumentHint: "[off|minimal|low|medium|high|xhigh|max|adaptive]",
	},
	{
		name: "reasoning-show",
		description: "Show or hide reasoning blocks",
		argumentHint: "[yes|no]",
	},
	{
		name: "auto",
		description: "Auto Mode: LLM safety gate for flagged bash (session toggle)",
		argumentHint: "[on|off|status]",
	},
	{
		name: "sandbox",
		description: "Sandbox mode: route built-in tools into a Gondolin micro-VM",
		argumentHint: "[on|off|status]",
	},
	{
		name: "update",
		description: "Check for a newer Porcupine release and show how to install it",
	},
	{
		name: "modes",
		description: "Choose Ask, Normal, or Auto interaction mode",
	},
	{
		name: "adaptive",
		description: "Adaptive Reasoning toggle (or use /reasoning adaptive)",
		argumentHint: "[on|off|status]",
	},
	{ name: "stacks", description: "Show tools/skills stack tree or search it", argumentHint: "[query|stack:id]" },
	{
		name: "subagents",
		description: "List recent sub-agent sessions, or view one transcript",
		argumentHint: "[sessionId]",
	},

	{
		name: "voice",
		description: "Voice Mode: push-to-talk with Space (Moonshine STT + Kokoro TTS)",
		argumentHint: "[on|off|status]",
	},
	{
		name: "projects",
		description: "List or search Project workspaces",
		argumentHint: "[query]",
	},
	{
		name: "learning",
		description: "Show autonomous learning evidence graph",
		argumentHint: "[graph|history]",
	},
	{
		name: "memory",
		description: "Show what Porcupine has stored about you and the environment",
	},
	{
		name: "init",
		description: "Generate/merge a compact AGENTS.md project context file",
		argumentHint: "[--force]",
	},
	{
		name: "goal",
		description: "Set a persistent session goal",
		argumentHint: "<text>|[status|pause|resume|clear]",
	},
	{
		name: "plan",
		description: "Generate and save a capability-aware plan",
		argumentHint: "<text>|[status|clear]",
	},
	{
		name: "remind",
		description: "Schedule an attended reminder that fires while this session is open and idle",
		argumentHint: "<duration> <text>",
	},
	{
		name: "task",
		description: "Create, run, and manage durable local tasks",
		argumentHint: "add <title> :: <prompt>|[list|show|run|pause|resume|cancel] <id>",
	},
	{
		name: "cron",
		description: "Schedule a durable local task while this session is open",
		argumentHint: "add <task-id> :: <cron>|[list|run|pause|resume|remove] <id>",
	},
	{
		name: "email",
		description: "Ambient-awareness email over IMAP/SMTP (status, drafts, inbox, read, draft, send)",
		argumentHint: "[status|drafts|inbox|read <id>|draft --to x --subject y --body z|send <draftId>]",
	},
	{
		name: "extract-stack",
		description:
			"Distill a local document (.md/.txt/.pdf) into a reusable skill/tool under the agent-home skills dir",
		argumentHint: "<path> [--name <n>] [--stack <s>] [--tool]",
	},
	{
		name: "craft-stack",
		description: "Deep-research a topic with free web search, then craft a discoverable skill/tool",
		argumentHint: "<name> --desc <description> [--stack <s>] [--tool]",
	},
	{ name: "quit", description: `Quit ${APP_NAME}` },
	{
		name: "x",
		description: "X (Twitter) free tools: status, search, tweet, draft, drafts, post, reply",
		argumentHint: "status|search <q>|tweet <id|url>|draft <text>|drafts|post <i>|reply <url> <i>",
	},
];
