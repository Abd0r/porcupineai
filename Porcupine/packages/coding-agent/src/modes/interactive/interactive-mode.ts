/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage, CapabilityTree } from "@porcupineai/agent-core";
import type { AuthEvent, AuthPrompt } from "@porcupineai/ai";
import type { AssistantMessage, ImageContent, Message, Model } from "@porcupineai/ai/compat";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	EditorComponent,
	Keybinding,
	KeyId,
	MarkdownTheme,
	OverlayHandle,
	OverlayOptions,
	SlashCommand,
	Terminal,
} from "@porcupineai/tui";
import * as TuiLayouts from "@porcupineai/tui";
import {
	CombinedAutocompleteProvider,
	type Component,
	Container,
	fuzzyFilter,
	getCapabilities,
	hyperlink,
	Markdown,
	matchesKey,
	ProcessTerminal,
	Spacer,
	setKeybindings,
	Text,
	TruncatedText,
	type TUI,
	TuiAltScreen,
	TuiMainScreen,
	visibleWidth,
} from "@porcupineai/tui";
import chalk from "chalk";
import { spawn, spawnSync } from "child_process";
import {
	APP_NAME,
	APP_TITLE,
	CONFIG_DIR_NAME,
	getAgentDir,
	getAuthPath,
	getDebugLogPath,
	getDocsPath,
	getPackageDir,
	getShareViewerUrl,
	VERSION,
} from "../../config.ts";
import { type AgentSession, type AgentSessionEvent, parseSkillBlock } from "../../core/agent-session.ts";
import { type AgentSessionRuntime, SessionImportFileNotFoundError } from "../../core/agent-session-runtime.ts";
import {
	CACHE_TTL_MS,
	type CacheMiss,
	collectCacheMisses,
	computeCacheWaste,
	detectCacheMiss,
} from "../../core/cache-stats.ts";
import type {
	AutocompleteProviderFactory,
	EditorFactory,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionRunner,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	MarkdownTransformer,
	ProjectTrustContext,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import { FooterDataProvider, type ReadonlyFooterDataProvider } from "../../core/footer-data-provider.ts";
import { configureHttpDispatcher, formatHttpIdleTimeoutMs } from "../../core/http-dispatcher.ts";
import { type AppKeybinding, KeybindingsManager } from "../../core/keybindings.ts";
import { createCompactionSummaryMessage } from "../../core/messages.ts";
import {
	defaultModelPerProvider,
	findExactModelReferenceMatch,
	resolveModelScope,
	resolveModelScopeWithDiagnostics,
} from "../../core/model-resolver.ts";
import { DefaultPackageManager } from "../../core/package-manager.ts";
import type { ResourceDiagnostic } from "../../core/resource-loader.ts";
import { formatMissingSessionCwdPrompt, MissingSessionCwdError } from "../../core/session-cwd.ts";
import { type SessionEntry, SessionManager, sessionEntryToContextMessages } from "../../core/session-manager.ts";
import type { UiMode } from "../../core/settings-manager.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import { isInstallTelemetryEnabled } from "../../core/telemetry.ts";
import { resolveReadPathAsync } from "../../core/tools/path-utils.ts";
import { SHOW_MARKDOWN_MAX_BYTES } from "../../core/tools/show-markdown.ts";
import type { TruncationResult } from "../../core/tools/truncate.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../../core/trust-manager.ts";
import { getUsageCostBreakdown } from "../../core/usage-totals.ts";
import {
	type AnimationId,
	type AnimationLoaderOptions,
	animationLoaderOptions,
	DOT_FRAMES,
	formatAnimationMessage,
	getAnimation,
	isToolDrivenAnimation,
	normalizeAnimationId,
	pickStatusAnimation,
	resolveAnimationFromToolName,
	resolveToolActivity,
} from "../../porcupine/animations.ts";
import { getPorcupineBlockWordmark, PORCUPINE_BLOCK_WORDMARK_COLOR } from "../../porcupine/branding.ts";
import { drainConsoleGuard, installConsoleGuard, uninstallConsoleGuard } from "../../porcupine/console-guard.ts";
import { loadAgentEnvFile } from "../../porcupine/env-file.ts";
import {
	buildGoalContinuation,
	buildPlanPrompt,
	DEFAULT_GOAL_MAX_TURNS,
	formatGoalStatus,
	formatPlanStatus,
	GOAL_PLAN_SESSION_ENTRY,
	type GoalPlanState,
	isGoalContinuation,
	isGoalPlanState,
	isPlanPrompt,
	judgeGoalResponse,
	parseGoalCommand,
	parsePlanCommand,
} from "../../porcupine/goal-plan-state.ts";
import { formatGuideCommandOutput } from "../../porcupine/guide.ts";
import { formatInteractionModeBadge } from "../../porcupine/interaction-mode.ts";
import {
	buildLearningGraph,
	checkAndRollbackRegressions,
	type LearningToolEvidence,
	listLearningEvents,
	listLearningFeed,
	processPostTurnLearning,
} from "../../porcupine/learning-store.ts";
import { formatMemoryReport } from "../../porcupine/memory-command.ts";
import { buildPersonalityReminder, isTrivialChatTurn, userRequestedPlanning } from "../../porcupine/personality.ts";
import { writeProjectContext } from "../../porcupine/project-init.ts";
import { formatProjectsCommandOutput } from "../../porcupine/project-search.ts";
import { runRefiner } from "../../porcupine/refiner.ts";
import {
	dispatchRemoteSlash,
	type RemoteCommandContext,
	type RemoteSlashResult,
} from "../../porcupine/remote-command-dispatcher.ts";
import type { RemoteCommandDescriptor } from "../../porcupine/remote-slash-commands.ts";
import { artifactChangeFromToolCall, buildCapabilityTreeFromSession } from "../../porcupine/session-bridge.ts";
import { PorcupineSessionOrchestrator } from "../../porcupine/session-orchestrator.ts";

/** Autonomous refiner pass: at most once per 10 minutes per session. */
const AUTO_REFINE_COOLDOWN_MS = 10 * 60 * 1000;

/** Pull plain text out of an AssistantMessage (model runtime one-shot result). */
function extractTextFromAssistantMessage(message: {
	content?: string | Array<{ type?: string; text?: string } | undefined> | null;
}): string {
	const content = message.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: string; text: string } => Boolean(block && block.type === "text" && block.text))
		.map((block) => block.text)
		.join("\n")
		.trim();
}

import { readSecret } from "../../core/keyring.ts";
import { DiscordBridge } from "../../porcupine/discord-bridge.ts";
import { createEmailClient, EMAIL_KEYRING_SERVICE } from "../../porcupine/email.ts";
import { buildEmailCommandOutput, parseEmailCommand } from "../../porcupine/email-command.ts";
import { IMessageBridge } from "../../porcupine/imessage-bridge.ts";
import { formatStacksCommandOutput } from "../../porcupine/stacks.ts";
import {
	isTaskDrainEligible,
	PorcupineTaskStore,
	parseCronCommand,
	parseTaskCommand,
	type TaskRunResultNotification,
	type TaskRunTrigger,
} from "../../porcupine/task-scheduler.ts";
import { extractAssistantText, formatBridgeStatus, TelegramBridge } from "../../porcupine/telegram-bridge.ts";
import { getDeviceName, resolveMacMicIndex, startRecording } from "../../porcupine/voice/recorder.ts";
import { VoiceMode } from "../../porcupine/voice/voice-mode.ts";
import { getProductEnvironment } from "../../product-environment.ts";
import { getChangelogPath, getNewEntries, normalizeChangelogLinks, parseChangelog } from "../../utils/changelog.ts";
import { copyToClipboard, readClipboardText } from "../../utils/clipboard.ts";
import { extensionForImageMimeType, readClipboardImage } from "../../utils/clipboard-image.ts";
import { parseGitUrl } from "../../utils/git.ts";
import { openBrowser } from "../../utils/open-browser.ts";
import { getCwdRelativePath } from "../../utils/paths.ts";
import { getPorcupineUserAgent } from "../../utils/porcupine-user-agent.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { ensureTool } from "../../utils/tools-manager.ts";
import {
	checkForNewPorcupineVersion,
	getInstalledPackageName,
	type LatestPorcupineRelease,
} from "../../utils/version-check.ts";
import { ArminComponent } from "./components/armin.ts";
import { ArtifactChangeComponent } from "./components/artifact-change.ts";
import { AssistantMessageComponent } from "./components/assistant-message.ts";
import { BashExecutionComponent } from "./components/bash-execution.ts";
import { BorderedLoader } from "./components/bordered-loader.ts";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.ts";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.ts";
import { CustomEditor } from "./components/custom-editor.ts";
import { CustomEntryComponent } from "./components/custom-entry.ts";
import { CustomMessageComponent } from "./components/custom-message.ts";
import { DaxnutsComponent } from "./components/daxnuts.ts";
import { DynamicBorder } from "./components/dynamic-border.ts";
import { EarendilAnnouncementComponent } from "./components/earendil-announcement.ts";
import { ExtensionEditorComponent } from "./components/extension-editor.ts";
import { ExtensionInputComponent } from "./components/extension-input.ts";
import { ExtensionSelectorComponent } from "./components/extension-selector.ts";
import { FooterComponent, formatTokens } from "./components/footer.ts";
import { InteractionModeSelectorComponent } from "./components/interaction-mode-selector.ts";
import { formatKeyText, keyDisplayText, keyHint, keyText, rawKeyHint } from "./components/keybinding-hints.ts";
import {
	LearningFeedComponent,
	LearningGraphComponent,
	LearningHistoryComponent,
} from "./components/learning-graph.ts";
import { LoginDialogComponent } from "./components/login-dialog.ts";
import { ModelSelectorComponent } from "./components/model-selector.ts";
import {
	type AuthSelectorProvider,
	formatAuthSelectorProviderType,
	OAuthSelectorComponent,
} from "./components/oauth-selector.ts";
import { ScopedModelsSelectorComponent } from "./components/scoped-models-selector.ts";
import { SessionSelectorComponent } from "./components/session-selector.ts";
import { SettingsSelectorComponent } from "./components/settings-selector.ts";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	IdleStatus,
	RetryStatusIndicator,
	type StatusIndicator,
	WorkingStatusIndicator,
} from "./components/status-indicator.ts";
import { TaskGraphComponent } from "./components/task-graph.ts";
import {
	formatReasoningModeLabel,
	parseReasoningModeArg,
	type ReasoningMode,
	ThinkingSelectorComponent,
} from "./components/thinking-selector.ts";
import { ToolExecutionComponent } from "./components/tool-execution.ts";
import { TreeSelectorComponent } from "./components/tree-selector.ts";
import { TrustSelectorComponent } from "./components/trust-selector.ts";
import { UserMessageComponent } from "./components/user-message.ts";
import { UserMessageSelectorComponent } from "./components/user-message-selector.ts";
import { editInExternalEditor } from "./external-editor.ts";
import { parseLearningCommand } from "./learning-command.ts";
import { getModelSearchText } from "./model-search.ts";
import { parseReasoningVisibilityCommand } from "./reasoning-visibility.ts";
import { parseRefreshCommand } from "./refresh-command.ts";
import { buildRestartArgv, parseRestartCommand } from "./restart-command.ts";
import { parseStackCommandArgs } from "./stack-command.ts";
import {
	getAvailableThemes,
	getAvailableThemesWithPaths,
	getEditorTheme,
	getMarkdownTheme,
	getThemeByName,
	onThemeChange,
	setRegisteredThemes,
	stopThemeWatcher,
	Theme,
	type ThemeColor,
	theme,
} from "./theme/theme.ts";
import { InteractiveThemeController } from "./theme/theme-controller.ts";

/** Interface for components that can be expanded/collapsed */
interface Expandable {
	setExpanded(expanded: boolean): void;
}

function isExpandable(obj: unknown): obj is Expandable {
	return typeof obj === "object" && obj !== null && "setExpanded" in obj && typeof obj.setExpanded === "function";
}

class ExpandableText extends Text implements Expandable {
	private readonly getCollapsedText: () => string;
	private readonly getExpandedText: () => string;

	constructor(
		getCollapsedText: () => string,
		getExpandedText: () => string,
		expanded = false,
		paddingX = 0,
		paddingY = 0,
	) {
		super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
		this.getCollapsedText = getCollapsedText;
		this.getExpandedText = getExpandedText;
	}

	setExpanded(expanded: boolean): void {
		this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
	}
}

type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

type RenderSessionItem = AgentMessage | Extract<SessionEntry, { type: "custom" }>;

function isCustomSessionEntry(item: RenderSessionItem): item is Extract<SessionEntry, { type: "custom" }> {
	return "type" in item && item.type === "custom";
}

const DEAD_TERMINAL_ERROR_CODES = new Set(["EIO", "EPIPE", "ENOTCONN"]);

function isDeadTerminalError(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("code" in error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	return code !== undefined && DEAD_TERMINAL_ERROR_CODES.has(code);
}

const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
	"Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage. Disable this warning in /settings.";

function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
	return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

function isUnknownModel(model: Model<any> | undefined): boolean {
	return !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown";
}

function quoteIfNeeded(value: string): string {
	if (value.length > 0 && !/[^a-zA-Z0-9_\-./~:@]/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatResumeCommand(sessionManager: SessionManager): string | undefined {
	if (!process.stdout.isTTY) return undefined;
	if (!sessionManager.isPersisted()) return undefined;

	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile || !fs.existsSync(sessionFile)) return undefined;

	const args = [APP_NAME];
	if (!sessionManager.usesDefaultSessionDir()) {
		args.push("--session-dir", quoteIfNeeded(sessionManager.getSessionDir()));
	}
	args.push("--session", sessionManager.getSessionId());
	return args.join(" ");
}

function hasDefaultModelProvider(providerId: string): providerId is keyof typeof defaultModelPerProvider {
	return providerId in defaultModelPerProvider;
}

type LoginProviderCompletionOption = {
	id: string;
	name: string;
	authTypes: AuthSelectorProvider["authType"][];
};

const AUTH_TYPE_ORDER = { oauth: 0, api_key: 1 } satisfies Record<AuthSelectorProvider["authType"], number>;

function createFuzzyAutocompleteItems<T>(
	items: T[],
	prefix: string,
	getSearchText: (item: T) => string,
	toAutocompleteItem: (item: T) => AutocompleteItem,
): AutocompleteItem[] | null {
	const filtered = fuzzyFilter(items, prefix, getSearchText);
	if (filtered.length === 0) return null;
	return filtered.map(toAutocompleteItem);
}

function getLoginProviderCompletionOptions(
	providerOptions: readonly AuthSelectorProvider[],
): LoginProviderCompletionOption[] {
	const byId = new Map<string, LoginProviderCompletionOption>();
	for (const provider of providerOptions) {
		const existing = byId.get(provider.id);
		if (existing) {
			if (!existing.authTypes.includes(provider.authType)) {
				existing.authTypes.push(provider.authType);
				existing.authTypes.sort((a, b) => AUTH_TYPE_ORDER[a] - AUTH_TYPE_ORDER[b]);
			}
			continue;
		}
		byId.set(provider.id, {
			id: provider.id,
			name: provider.name,
			authTypes: [provider.authType],
		});
	}
	return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getLoginProviderSearchText(provider: LoginProviderCompletionOption): string {
	const authTypes = provider.authTypes
		.map((authType) => `${authType} ${formatAuthSelectorProviderType(authType)}`)
		.join(" ");
	return `${provider.id} ${provider.name} ${authTypes}`;
}

function formatLoginProviderCompletionDescription(provider: LoginProviderCompletionOption): string {
	const authTypes = provider.authTypes.map(formatAuthSelectorProviderType).join("/");
	return provider.name === provider.id ? authTypes : `${provider.name} · ${authTypes}`;
}

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
	/** Providers that were migrated to auth.json (shows warning) */
	migratedProviders?: string[];
	/** Warning message if session model couldn't be restored */
	modelFallbackMessage?: string;
	/** Cwd to trust after reload if it gained a .porcupine directory during this implicitly trusted session. */
	autoTrustOnReloadCwd?: string;
	/** Initial message to send on startup (can include @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** Additional messages to send after the initial message */
	initialMessages?: string[];
	/** Force verbose startup (overrides quietStartup setting) */
	verbose?: boolean;
	/** UI layout mode. */
	uiMode?: UiMode;
}

interface InteractiveTuiOptions {
	uiMode: UiMode;
	showHardwareCursor: boolean;
	logDirectory: string;
	terminal?: Terminal;
}

/** Composition root for selecting the interactive terminal renderer. */
/**
 * Extract the last assistant text turn from the agent's current message state.
 * Used to persist the real outcome of a task run instead of a canned string.
 * Returns "" when the latest assistant turn has no text (e.g. aborted mid-run).
 */
export function extractTaskRunResultText(messages: readonly AgentMessage[] | undefined): string {
	if (!messages) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!message || message.role !== "assistant") continue;
		const content = message.content;
		if (Array.isArray(content)) {
			const text = content
				.map((block) =>
					block && typeof block === "object" && (block as { type?: string }).type === "text"
						? String((block as { text?: string }).text ?? "")
						: "",
				)
				.join(" ")
				.trim();
			if (text) return text.slice(0, 2000);
			// Assistant turn without text (e.g. only tool calls) — keep walking back.
			continue;
		}
		const text = String(content ?? "").trim();
		if (text) return text.slice(0, 2000);
	}
	return "";
}

export function createInteractiveTui(options: InteractiveTuiOptions): TUI {
	const terminal = options.terminal ?? new ProcessTerminal();
	if (options.uiMode === "fullscreen") {
		return new TuiAltScreen(terminal, options.showHardwareCursor, options.logDirectory, { openUrl: openBrowser });
	}
	return new TuiMainScreen(terminal, options.showHardwareCursor, options.logDirectory);
}

/**
 * Minimal surface every remote bridge (Telegram / Discord / iMessage) exposes
 * so the interactive mode can race confirm/select/input across all channels
 * and forward terminal responses to whichever bridge started the turn.
 */
interface RemoteBridgeLike {
	isRunning: boolean;
	remoteConfirm(title: string, message: string): Promise<boolean> | undefined;
	select(
		title: string,
		options: string[],
		tui: (title: string, options: string[]) => Promise<string | undefined>,
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined>;
	input(
		title: string,
		tui: (title: string) => Promise<string | undefined>,
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined>;
	handleTurnStart(message: AgentMessage): void;
	handleAgentEnd(messages: readonly AgentMessage[], willRetry: boolean): Promise<void>;
	notifyTaskResult(text: string): Promise<void>;
}

export class InteractiveMode {
	private runtimeHost: AgentSessionRuntime;
	private ui: TUI;
	private loadedResourcesContainer: Container;
	private chatContainer: Container;
	private documentContainer: Container;
	private transcriptScrollView: TuiLayouts.ScrollView | undefined;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private defaultEditor: CustomEditor;
	private editor: EditorComponent;
	private editorComponentFactory: EditorFactory | undefined;
	private autocompleteProvider: AutocompleteProvider | undefined;
	private autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
	private fdPath: string | undefined;
	private editorContainer: Container;
	/** When true, setCustomEditorComponent must not swap editorContainer (refresh/reload box is showing). */
	private editorSurfaceLocked = false;
	private footer: FooterComponent;
	private footerContainer: Container;
	private footerDataProvider: FooterDataProvider;
	// Stored so the same manager can be injected into custom editors, selectors, and extension UI.
	private keybindings: KeybindingsManager;
	private version: string;
	/** Newer release found by the startup update check ("🆕 X available" badge). */
	private latestVersion: string | undefined;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private pendingUserInputs: string[] = [];
	private activeStatusIndicator: StatusIndicator | undefined = undefined;
	private readonly idleStatus = new IdleStatus();
	private workingMessage: string | undefined = undefined;
	private workingVisible = true;
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: written by setWorkingIndicator/setPorcupineActivity to cache the current working indicator for the activity-strip render pipeline
	private workingIndicatorOptions?: WorkingIndicatorOptions;
	private activityPhase: AnimationId = "working";
	/** Sticky easter-egg id while Working/Thinking so rare labels don't thrash. */
	private activityEasterEgg: AnimationId | undefined = undefined;
	/** Optional target name on the activity chip (e.g. the skill being read). */
	private activityName: string | undefined = undefined;
	private extensionActivityOverride: AnimationId | undefined = undefined;
	private extensionToolComponentsHidden = false;
	private readonly defaultHiddenThinkingLabel = "Thinking...";
	private hiddenThinkingLabel = this.defaultHiddenThinkingLabel;

	private lastSigintTime = 0;
	private lastEscapeTime = 0;
	private changelogMarkdown: string | undefined = undefined;
	private startupNoticesShown = false;
	private anthropicSubscriptionWarningShown = false;

	// Status line tracking (for mutating immediately-sequential status updates)
	private lastStatusSpacer: Spacer | undefined = undefined;
	private lastStatusText: Text | undefined = undefined;

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | undefined = undefined;
	/** Last streaming-parse timestamp: mid-stream markdown parses are throttled. */
	private streamingLastParseAt: number | undefined;
	/** Minimum interval between mid-stream markdown re-parses (ms). */
	private static readonly STREAMING_PARSE_INTERVAL_MS = 120;
	private streamingMessage: AssistantMessage | undefined = undefined;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	/** Live Porcupine capability catalog (tools + skills) for routing/analysis. */
	private capabilityTree: CapabilityTree = buildCapabilityTreeFromSession({
		tools: [],
	});
	private orchestrator = new PorcupineSessionOrchestrator({
		getCapabilities: () => this.capabilityTree,
		configDir: getAgentDir(),
		// USER.md extraction also runs after agent_settled so it records completed
		// interaction evidence rather than mutating state before a response exists.
		enableUserPatterns: false,
		// Capability learning is collected after agent_settled, once tool results
		// and verification outcomes exist. Pre-turn activation has no such evidence.
		enableCapabilityLearning: false,
		onEvent: (event) => {
			void this.handlePorcupineRuntimeEvent(event);
		},
	});
	private taskGraphComponent: TaskGraphComponent | undefined;
	private subagentPanelUnsubscribe: (() => void) | undefined;
	private learningUserText: string | undefined;
	private learningToolEvidence: LearningToolEvidence[] = [];
	/** Global cooldown for the autonomous refiner pass (see AUTO_REFINE_COOLDOWN_MS). */
	private lastAutoRefineAt = 0;
	/** Remote bridges: phone/chat messages mirror into the shared session. */
	private telegramBridge: TelegramBridge | undefined;
	private discordBridge: DiscordBridge | undefined;
	private imessageBridge: IMessageBridge | undefined;
	private remoteBridgeUnsubscribe: (() => void) | undefined;
	/** Voice Mode: push-to-talk (Space) → Moonshine STT → prompt; Kokoro TTS speaks replies. */
	private voiceMode: VoiceMode | undefined;
	private voiceEnabled = false;
	/** User-owned durable objective and plan snapshots for the active session. */
	private goalPlanState: GoalPlanState = {};
	/** Durable local task definitions and their immutable run history. */
	private readonly taskStore = new PorcupineTaskStore(getAgentDir());
	/** A live session can safely execute only one task run at a time. */
	private activeTaskRunId: string | undefined;
	/** CC-style cron is live only while this interactive session is open. */
	private cronTimer: ReturnType<typeof setInterval> | undefined;
	/** True only while the just-finished turn was part of a goal loop. */
	private goalTurnInFlight = false;
	/** True only while the just-finished turn is producing a /plan artifact. */
	private planTurnInFlight = false;

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Thinking block visibility state
	private hideThinkingBlock = false;
	private outputPad = 1;

	// Skill commands: command name -> skill file path
	private skillCommands = new Map<string, string>();

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;
	private signalCleanupHandlers: Array<() => void> = [];

	// Track if editor is in bash mode (text starts with !)
	private isBashMode = false;

	// Track current bash execution component
	private bashComponent: BashExecutionComponent | undefined = undefined;

	// Track pending bash components (shown in pending area, moved to chat on submit)
	private pendingBashComponents: BashExecutionComponent[] = [];

	// Auto-compaction state
	private autoCompactionEscapeHandler?: () => void;

	// Auto-retry state
	private retryEscapeHandler?: () => void;

	// Messages queued while compaction is running
	private compactionQueuedMessages: CompactionQueuedMessage[] = [];

	// Shutdown state
	private shutdownRequested = false;

	// Extension UI state
	private extensionSelector: ExtensionSelectorComponent | undefined = undefined;
	private extensionInput: ExtensionInputComponent | undefined = undefined;
	private extensionEditor: ExtensionEditorComponent | undefined = undefined;
	private extensionTerminalInputUnsubscribers = new Set<() => void>();

	// Extension widgets (components rendered above/below the editor)
	private extensionWidgetsAbove = new Map<string, Component & { dispose?(): void }>();
	private extensionWidgetsBelow = new Map<string, Component & { dispose?(): void }>();
	private widgetContainerAbove!: Container;
	private widgetContainerBelow!: Container;

	// Custom footer from extension (undefined = use built-in footer)
	private customFooter: (Component & { dispose?(): void }) | undefined = undefined;

	// Header container that holds the built-in or custom header
	private headerContainer: Container;

	// Built-in header (logo + keybinding hints + changelog)
	private builtInHeader: Component | undefined = undefined;

	// Custom header from extension (undefined = use built-in header)
	private customHeader: (Component & { dispose?(): void }) | undefined = undefined;

	private options: InteractiveModeOptions;
	private autoTrustOnReloadCwd: string | undefined;
	private themeController: InteractiveThemeController;

	// Convenience accessors
	private get session(): AgentSession {
		return this.runtimeHost.session;
	}
	private get agent() {
		return this.session.agent;
	}
	private get sessionManager() {
		return this.session.sessionManager;
	}
	private get settingsManager() {
		return this.session.settingsManager;
	}

	constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions = {}) {
		this.runtimeHost = runtimeHost;
		const uiMode = options.uiMode ?? this.settingsManager.getUiMode();
		this.options = { ...options, uiMode };
		this.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
		this.runtimeHost.setBeforeSessionInvalidate(() => {
			this.resetExtensionUI();
		});
		this.runtimeHost.setRebindSession(async () => {
			await this.rebindCurrentSession({ renderBeforeBind: true });
		});
		this.version = VERSION;
		this.ui = createInteractiveTui({
			uiMode,
			showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
			logDirectory: getAgentDir(),
		});
		this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
		this.wireModeConfirmations();
		this.headerContainer = new Container();
		this.loadedResourcesContainer = new Container();
		this.chatContainer = new Container();
		this.documentContainer = new Container();
		this.documentContainer.addChild(this.headerContainer);
		this.documentContainer.addChild(this.loadedResourcesContainer);
		this.documentContainer.addChild(this.chatContainer);
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.widgetContainerAbove = new Container();
		this.widgetContainerBelow = new Container();
		this.keybindings = KeybindingsManager.create();
		setKeybindings(this.keybindings);
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
			paddingX: editorPaddingX,
			autocompleteMaxVisible,
		});
		this.editor = this.defaultEditor;
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor as Component);
		this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
		this.footer = new FooterComponent(
			this.session,
			this.footerDataProvider,
			() => this.orchestrator.getTaskGraph(),
			() => this.getSubagentFooterChip(),
		);
		this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
		// Sub-agent panel: show 1/3-width progress while a sub-agent runs; on
		// success keep the completion summary visible for a brief settle window
		// before collapsing back to full-width main transcript.
		this.subscribeToSubagents();
		this.footerContainer = new Container();
		this.footerContainer.addChild(this.footer);

		// Load hide thinking block setting
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
		this.outputPad = this.settingsManager.getOutputPad();

		// Register themes from resource loader and initialize
		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		this.themeController = new InteractiveThemeController(
			this.ui,
			this.settingsManager,
			(message) => this.showError(message),
			() => this.updateEditorBorderColor(),
		);
	}

	private getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
		if (!sourceInfo) {
			return undefined;
		}

		const scopePrefix = sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
		const source = sourceInfo.source.trim();

		if (source === "auto" || source === "local" || source === "cli") {
			return scopePrefix;
		}

		if (source.startsWith("npm:")) {
			return `${scopePrefix}:${source}`;
		}

		const gitSource = parseGitUrl(source);
		if (gitSource) {
			const ref = gitSource.ref ? `@${gitSource.ref}` : "";
			return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
		}

		return scopePrefix;
	}

	private prefixAutocompleteDescription(description: string | undefined, sourceInfo?: SourceInfo): string | undefined {
		const sourceTag = this.getAutocompleteSourceTag(sourceInfo);
		if (!sourceTag) {
			return description;
		}
		return description ? `[${sourceTag}] ${description}` : `[${sourceTag}]`;
	}

	private getBuiltInCommandConflictDiagnostics(extensionRunner: ExtensionRunner): ResourceDiagnostic[] {
		const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
		return extensionRunner
			.getRegisteredCommands()
			.filter((command) => builtinNames.has(command.name))
			.map((command) => ({
				type: "warning" as const,
				message:
					command.invocationName === command.name
						? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
						: `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
				path: command.sourceInfo.path,
			}));
	}

	private createBaseAutocompleteProvider(): AutocompleteProvider {
		// Define commands for autocomplete
		const slashCommands: SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
			name: command.name,
			description: command.description,
			...(command.argumentHint && { argumentHint: command.argumentHint }),
		}));

		const modelCommand = slashCommands.find((command) => command.name === "model");
		if (modelCommand) {
			modelCommand.getArgumentCompletions = async (prefix: string): Promise<AutocompleteItem[] | null> => {
				// Get available models (scoped or from registry)
				const models =
					this.session.scopedModels.length > 0
						? this.session.scopedModels.map((s) => s.model)
						: await this.session.modelRuntime.getAvailable();

				if (models.length === 0) return null;

				// Create items with provider/id format
				const items = models.map((m) => ({
					id: m.id,
					provider: m.provider,
					name: m.name,
					label: `${m.provider}/${m.id}`,
				}));

				return createFuzzyAutocompleteItems(items, prefix, getModelSearchText, (item) => ({
					value: item.label,
					label: item.id,
					description: item.provider,
				}));
			};
		}

		const loginCommand = slashCommands.find((command) => command.name === "login");
		if (loginCommand) {
			loginCommand.getArgumentCompletions = (prefix: string): AutocompleteItem[] | null => {
				const providers = getLoginProviderCompletionOptions(this.getLoginProviderOptions());
				return createFuzzyAutocompleteItems(providers, prefix, getLoginProviderSearchText, (provider) => ({
					value: provider.id,
					label: provider.id,
					description: formatLoginProviderCompletionDescription(provider),
				}));
			};
		}

		// Convert prompt templates to SlashCommand format for autocomplete
		const templateCommands: SlashCommand[] = this.session.promptTemplates.map((cmd) => ({
			name: cmd.name,
			description: this.prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
			...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
		}));

		// Convert extension commands to SlashCommand format
		const builtinCommandNames = new Set(slashCommands.map((c) => c.name));
		const extensionCommands: SlashCommand[] = this.session.extensionRunner
			.getRegisteredCommands()
			.filter((cmd) => !builtinCommandNames.has(cmd.name))
			.map((cmd) => ({
				name: cmd.invocationName,
				description: this.prefixAutocompleteDescription(cmd.description, cmd.sourceInfo),
				getArgumentCompletions: cmd.getArgumentCompletions,
			}));

		// Build skill commands from session.skills (if enabled)
		this.skillCommands.clear();
		const skillCommandList: SlashCommand[] = [];
		if (this.settingsManager.getEnableSkillCommands()) {
			for (const skill of this.session.resourceLoader.getSkills().skills) {
				const commandName = `skill:${skill.name}`;
				this.skillCommands.set(commandName, skill.filePath);
				skillCommandList.push({
					name: commandName,
					description: this.prefixAutocompleteDescription(skill.description, skill.sourceInfo),
				});
			}
		}

		return new CombinedAutocompleteProvider(
			[...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList],
			this.sessionManager.getCwd(),
			this.fdPath,
		);
	}

	private setupAutocompleteProvider(): void {
		let provider = this.createBaseAutocompleteProvider();
		const triggerCharacters: string[] = [];
		for (const wrapProvider of this.autocompleteProviderWrappers) {
			provider = wrapProvider(provider);
			triggerCharacters.push(...(provider.triggerCharacters ?? []));
		}
		if (triggerCharacters.length > 0) {
			provider.triggerCharacters = [...new Set(triggerCharacters)];
		}

		this.autocompleteProvider = provider;
		this.defaultEditor.setAutocompleteProvider(provider);
		if (this.editor !== this.defaultEditor) {
			this.editor.setAutocompleteProvider?.(provider);
		}
	}

	private showStartupNoticesIfNeeded(): void {
		if (this.startupNoticesShown) {
			return;
		}
		this.startupNoticesShown = true;

		if (!this.changelogMarkdown) {
			return;
		}

		if (this.chatContainer.children.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new DynamicBorder());
		if (this.settingsManager.getCollapseChangelog()) {
			const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
			const latestVersion = versionMatch ? versionMatch[1] : this.version;
			const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
			this.chatContainer.addChild(new Text(condensedText, 1, 0));
		} else {
			this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Markdown(this.changelogMarkdown.trim(), 1, 0, this.getMarkdownThemeWithSettings()),
			);
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(new DynamicBorder());
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		this.registerSignalHandlers();

		// Load changelog (only show new entries, skip for resumed sessions)
		this.changelogMarkdown = this.getChangelogForDisplay();

		// Ensure fd and rg are available (downloads if missing, adds to PATH via getBinDir)
		// Both are needed: fd for autocomplete, rg for grep tool and bash commands
		const [fdPath] = await Promise.all([ensureTool("fd"), ensureTool("rg")]);
		this.fdPath = fdPath;

		if (this.session.scopedModels.length > 0 && (this.options.verbose || !this.settingsManager.getQuietStartup())) {
			const modelList = this.session.scopedModels
				.map((sm) => {
					const thinkingStr = sm.thinkingLevel ? `:${sm.thinkingLevel}` : "";
					return `${sm.model.id}${thinkingStr}`;
				})
				.join(", ");
			const cycleKeys = this.keybindings.getKeys("app.model.cycleForward");
			const cycleHint =
				cycleKeys.length > 0
					? theme.fg("muted", ` (${formatKeyText(cycleKeys.join("/"), { capitalize: true })} to cycle)`)
					: "";
			console.log(theme.fg("dim", `Model scope: ${modelList}${cycleHint}`));
		}

		// Populate stable regions before selecting the renderer-specific composition.
		this.renderWidgets(); // Initialize with default spacer
		if (TuiLayouts.isViewportTUI(this.ui)) {
			this.transcriptScrollView = new TuiLayouts.ScrollView(this.documentContainer, {
				follow: "end",
				primary: true,
				overscroll: "chain",
				scrollbar: this.settingsManager.getFullscreenScrollbar(),
				scrollbarStyle: (text) => theme.bg("scrollbarThumb", text),
			});
			const dock = new TuiLayouts.VStack([
				{ component: this.pendingMessagesContainer, shrink: 1, minSize: 0 },
				// Keep at least 2 rows so the animated status strip cannot be layout-crushed to 0.
				{ component: this.statusContainer, shrink: 0, minSize: 2 },
				{ component: this.widgetContainerAbove, shrink: 1, minSize: 0 },
				{ component: this.editorContainer, shrink: 1, minSize: 3 },
				{ component: this.widgetContainerBelow, shrink: 1, minSize: 0 },
				{ component: this.footerContainer, shrink: 1, minSize: 1 },
			]);
			this.ui.setLayoutRoot(
				new TuiLayouts.VStack([
					{
						component: this.transcriptScrollView,
						basis: 0,
						grow: 2,
						shrink: 1,
						minSize: 1,
					},
					{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
				]),
			);
		} else {
			this.ui.addChild(this.documentContainer);
			this.ui.addChild(this.pendingMessagesContainer);
			this.ui.addChild(this.statusContainer);
			this.ui.addChild(this.widgetContainerAbove);
			this.ui.addChild(this.editorContainer);
			this.ui.addChild(this.widgetContainerBelow);
			this.ui.addChild(this.footerContainer);
		}
		this.ui.setFocus(this.editor);

		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();

		// Start the UI before initializing extensions so session_start handlers can use interactive dialogs
		this.ui.start();
		this.isInitialized = true;
		this.refreshCapabilityTree();
		this.restoreGoalPlanState();
		this.cronTimer = setInterval(() => this.tickCronSchedules(), 15_000);

		await this.themeController.applyFromSettings();

		// Add header with keybindings from config (unless silenced)
		if (this.options.verbose || !this.settingsManager.getQuietStartup()) {
			const renderLogo = () => {
				const blockWordmark = getPorcupineBlockWordmark(this.ui.terminal.columns);
				if (!blockWordmark) {
					return (
						theme.bold(theme.fg("accent", APP_NAME)) +
						theme.fg("dim", ` v${this.version}`) +
						this.renderUpdateBadge()
					);
				}
				return (
					chalk.bold(chalk.hex(PORCUPINE_BLOCK_WORDMARK_COLOR)(blockWordmark)) +
					theme.fg("dim", `\n${APP_NAME} v${this.version}`) +
					this.renderUpdateBadge()
				);
			};

			// Build startup instructions using keybinding hint helpers
			const hint = (keybinding: AppKeybinding, description: string) => keyHint(keybinding, description);

			const expandedInstructions = [
				hint("app.interrupt", "to interrupt"),
				hint("app.clear", "to clear"),
				rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
				hint("app.exit", "to exit (empty)"),
				hint("app.suspend", "to suspend"),
				keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
				hint("app.thinking.cycle", "to cycle thinking level"),
				rawKeyHint(`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`, "to cycle models"),
				hint("app.model.select", "to select model"),
				hint("app.tools.expand", "to expand tools"),
				hint("app.thinking.toggle", "to expand thinking"),
				hint("app.editor.external", "for external editor"),
				rawKeyHint("/", "for commands"),
				rawKeyHint("!", "to run bash"),
				rawKeyHint("!!", "to run bash (no context)"),
				hint("app.message.followUp", "to queue follow-up"),
				hint("app.message.dequeue", "to edit all queued messages"),
				hint("app.clipboard.pasteImage", "to paste image (with text fallback)"),
				rawKeyHint("drop files", "to attach"),
			].join("\n");
			const compactInstructions = [
				hint("app.interrupt", "interrupt"),
				rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
				rawKeyHint("/", "commands"),
				rawKeyHint("!", "bash"),
				hint("app.tools.expand", "more"),
			].join(theme.fg("muted", " · "));
			const compactOnboarding = theme.fg(
				"dim",
				`Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
			);
			const onboarding = theme.fg(
				"dim",
				`Porcupine can explain its own features and look up its docs. Ask it how to use or extend Porcupine.`,
			);
			this.builtInHeader = new ExpandableText(
				() => `${renderLogo()}\n${compactInstructions}\n${compactOnboarding}\n\n${onboarding}`,
				() => `${renderLogo()}\n${expandedInstructions}\n\n${onboarding}`,
				this.getStartupExpansionState(),
				1,
				0,
			);

			// Setup UI layout
			this.headerContainer.addChild(new Spacer(1));
			this.headerContainer.addChild(this.builtInHeader);
			this.headerContainer.addChild(new Spacer(1));
		} else {
			// Minimal header when silenced
			this.builtInHeader = new Text("", 0, 0);
			this.headerContainer.addChild(this.builtInHeader);
		}
		this.ui.requestRender();

		// Initialize extensions first so resources are shown before messages
		await this.rebindCurrentSession();

		// Render initial messages AFTER showing loaded resources
		this.renderInitialMessages();

		// Set up theme file watcher
		onThemeChange(() => {
			this.ui.invalidate();
			this.updateEditorBorderColor();
			this.ui.requestRender();
		});

		// Set up git branch watcher (uses provider instead of footer)
		this.footerDataProvider.onBranchChange(() => {
			this.ui.requestRender();
		});

		// Initialize available provider count for footer display
		await this.updateAvailableProviderCount();
	}

	/**
	 * Update terminal title with session name and cwd.
	 */
	private updateTerminalTitle(): void {
		const cwdBasename = path.basename(this.sessionManager.getCwd());
		const sessionName = this.sessionManager.getSessionName();
		if (sessionName) {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
		} else {
			this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
		}
	}

	/**
	 * Run the interactive mode. This is the main entry point.
	 * Initializes the UI, shows warnings, processes initial messages, and starts the interactive loop.
	 */
	async run(): Promise<void> {
		await this.init();
		// Route background bridge/library writes away from the raw stderr frame
		// while the full-screen TUI is up. Restored in stop().
		installConsoleGuard();
		this.startRemoteBridges();

		if (!getProductEnvironment("OFFLINE")) {
			void this.session.modelRuntime
				.refresh()
				.then(() => this.updateAvailableProviderCount())
				.catch(() => {});
		}

		// Start version check asynchronously (npm registry / GitHub, cached 24h)
		if (this.settingsManager.getUpdateCheck()) {
			checkForNewPorcupineVersion(this.version, {
				cacheTtlMs: this.settingsManager.getUpdateCheckIntervalMs(),
			}).then((newRelease) => {
				if (newRelease) {
					this.latestVersion = newRelease.version;
					this.showNewVersionNotification(newRelease);
				}
			});
		}

		// Start package update check asynchronously
		this.checkForPackageUpdates()
			.then((updates) => {
				if (updates.length > 0) {
					this.showPackageUpdateNotification(updates);
				}
			})
			.finally(() => {
				// On Windows, npm can overwrite the shared console title while checking
				// extension package versions. Restore Porcupine's title after the startup check.
				if (process.platform === "win32" && this.isInitialized) {
					this.updateTerminalTitle();
				}
			});

		// Check tmux keyboard setup asynchronously
		this.checkTmuxKeyboardSetup().then((warning) => {
			if (warning) {
				this.showWarning(warning);
			}
		});

		// Show startup warnings
		const { migratedProviders, modelFallbackMessage, initialMessage, initialImages, initialMessages } = this.options;

		if (migratedProviders && migratedProviders.length > 0) {
			this.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
		}

		const modelsJsonError = this.session.modelRuntime.getError();
		if (modelsJsonError) {
			this.showError(`models.json error: ${modelsJsonError}`);
		}

		if (modelFallbackMessage) {
			this.showWarning(modelFallbackMessage);
		}

		void this.maybeWarnAboutAnthropicSubscriptionAuth();

		// Process initial messages
		if (initialMessage) {
			try {
				await this.promptWithPorcupine(initialMessage, {
					images: initialImages,
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}

		if (initialMessages) {
			for (const message of initialMessages) {
				try {
					await this.promptWithPorcupine(message);
				} catch (error: unknown) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
					this.showError(errorMessage);
				}
			}
		}

		// Main interactive loop
		while (true) {
			const userInput = await this.getUserInput();
			try {
				await this.promptWithPorcupine(userInput);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
				this.showError(errorMessage);
			}
		}
	}

	private async checkForPackageUpdates(): Promise<string[]> {
		if (getProductEnvironment("OFFLINE")) {
			return [];
		}

		try {
			const packageManager = new DefaultPackageManager({
				cwd: this.sessionManager.getCwd(),
				agentDir: getAgentDir(),
				settingsManager: this.settingsManager,
			});
			const updates = await packageManager.checkForAvailableUpdates();
			return updates.map((update) => update.displayName);
		} catch {
			return [];
		}
	}

	private async checkTmuxKeyboardSetup(): Promise<string | undefined> {
		if (!process.env.TMUX) return undefined;

		const runTmuxShow = (option: string): Promise<string | undefined> => {
			return new Promise((resolve) => {
				const proc = spawn("tmux", ["show", "-gv", option], {
					stdio: ["ignore", "pipe", "ignore"],
				});
				let stdout = "";
				const timer = setTimeout(() => {
					proc.kill();
					resolve(undefined);
				}, 2000);

				proc.stdout?.on("data", (data) => {
					stdout += data.toString();
				});
				proc.on("error", () => {
					clearTimeout(timer);
					resolve(undefined);
				});
				proc.on("close", (code) => {
					clearTimeout(timer);
					resolve(code === 0 ? stdout.trim() : undefined);
				});
			});
		};

		const [extendedKeys, extendedKeysFormat] = await Promise.all([
			runTmuxShow("extended-keys"),
			runTmuxShow("extended-keys-format"),
		]);

		// If we couldn't query tmux (timeout, sandbox, etc.), don't warn
		if (extendedKeys === undefined) return undefined;

		if (extendedKeys !== "on" && extendedKeys !== "always") {
			return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
		}

		if (extendedKeysFormat === "xterm") {
			return "tmux extended-keys-format is xterm. Porcupine works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
		}

		return undefined;
	}

	/**
	 * Get changelog entries to display on startup.
	 * Only shows new entries since last seen version, skips for resumed sessions.
	 */
	private getChangelogForDisplay(): string | undefined {
		// Skip changelog for resumed/continued sessions (already have messages)
		if (this.session.state.messages.length > 0) {
			return undefined;
		}

		const lastVersion = this.settingsManager.getLastChangelogVersion();
		const changelogPath = getChangelogPath();
		const entries = parseChangelog(changelogPath);

		if (!lastVersion) {
			// Fresh install - record the version, send telemetry, don't show changelog
			this.settingsManager.setLastChangelogVersion(VERSION);
			this.reportInstallTelemetry(VERSION);
			return undefined;
		}

		const newEntries = getNewEntries(entries, lastVersion);
		if (newEntries.length > 0) {
			this.settingsManager.setLastChangelogVersion(VERSION);
			this.reportInstallTelemetry(VERSION);
			return newEntries.map((e) => normalizeChangelogLinks(e.content, e)).join("\n\n");
		}

		return undefined;
	}

	private reportInstallTelemetry(version: string): void {
		if (getProductEnvironment("OFFLINE")) {
			return;
		}

		if (!isInstallTelemetryEnabled(this.settingsManager)) {
			return;
		}

		// Porcupine does not phone home by default. Keep the opt-in gate for
		// compatibility, but never hardcode an upstream product endpoint.
		const reportUrl = getProductEnvironment("INSTALL_TELEMETRY_URL");
		if (!reportUrl) {
			return;
		}

		void fetch(`${reportUrl}${encodeURIComponent(version)}`, {
			headers: {
				"User-Agent": getPorcupineUserAgent(version),
			},
			signal: AbortSignal.timeout(5000),
		})
			.then(() => undefined)
			.catch(() => undefined);
	}

	private getMarkdownThemeWithSettings(): MarkdownTheme {
		return {
			...getMarkdownTheme(),
			codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
		};
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	private formatDisplayPath(p: string): string {
		const home = os.homedir();
		let result = p;

		// Replace home directory with ~
		if (result.startsWith(home)) {
			result = `~${result.slice(home.length)}`;
		}

		return result;
	}

	private formatExtensionDisplayPath(path: string): string {
		let result = this.formatDisplayPath(path);
		result = result.replace(/\/index\.ts$/, "").replace(/\/index\.js$/, "");
		return result;
	}

	private formatContextPath(p: string): string {
		const cwd = path.resolve(this.sessionManager.getCwd());
		const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
		const relativePath = getCwdRelativePath(absolutePath, cwd);
		if (relativePath !== undefined) {
			return relativePath;
		}

		return this.formatDisplayPath(absolutePath);
	}

	private getStartupExpansionState(): boolean {
		return this.options.verbose || this.toolOutputExpanded;
	}

	/**
	 * Get a short path relative to the package root for display.
	 */
	private getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
		const normalizedFullPath = fullPath.replace(/\\/g, "/");
		const baseDir = sourceInfo?.baseDir;
		if (baseDir && this.isPackageSource(sourceInfo)) {
			const normalizedBaseDir = baseDir.replace(/\\/g, "/");
			const npmRootMatch = normalizedBaseDir.match(/^(.*\/node_modules)\/(@?[^/]+(?:\/[^/]+)?)$/);
			// If fullPath is under the same node_modules root as baseDir, preserve that relative topology.
			if (npmRootMatch?.[1] && normalizedFullPath.startsWith(`${npmRootMatch[1]}/`)) {
				return path.posix.relative(normalizedBaseDir, normalizedFullPath);
			}

			const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
			if (
				relativePath &&
				relativePath !== "." &&
				!relativePath.startsWith("..") &&
				!relativePath.startsWith(`..${path.sep}`) &&
				!path.isAbsolute(relativePath)
			) {
				return relativePath.replace(/\\/g, "/");
			}
		}

		const source = sourceInfo?.source ?? "";
		const npmMatch = normalizedFullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
		if (npmMatch && source.startsWith("npm:")) {
			return npmMatch[2];
		}

		const gitMatch = normalizedFullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
		if (gitMatch && source.startsWith("git:")) {
			return gitMatch[1];
		}

		return this.formatDisplayPath(fullPath);
	}

	private getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
		const shortPath = this.getShortPath(resourcePath, sourceInfo);
		const normalizedPath = shortPath.replace(/\\/g, "/");
		const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
		if (segments.length > 0) {
			return segments[segments.length - 1]!;
		}
		return shortPath;
	}

	private getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
		const source = sourceInfo?.source ?? "";
		if (source.startsWith("npm:")) {
			return source.slice("npm:".length) || source;
		}

		const gitSource = parseGitUrl(source);
		if (gitSource) {
			return gitSource.path || source;
		}

		return source;
	}

	private getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
		if (!this.isPackageSource(sourceInfo)) {
			return this.getCompactPathLabel(resourcePath, sourceInfo);
		}

		const sourceLabel = this.getCompactPackageSourceLabel(sourceInfo);
		if (!sourceLabel) {
			return this.getCompactPathLabel(resourcePath, sourceInfo);
		}

		const shortPath = this.getShortPath(resourcePath, sourceInfo).replace(/\\/g, "/");
		const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
		const parsedPath = path.posix.parse(packagePath);

		if (parsedPath.name === "index") {
			return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
		}

		return `${sourceLabel}:${packagePath}`;
	}

	private getCompactDisplayPathSegments(resourcePath: string): string[] {
		return this.formatDisplayPath(resourcePath)
			.replace(/\\/g, "/")
			.split("/")
			.filter((segment) => segment.length > 0 && segment !== "~");
	}

	private getCompactNonPackageExtensionLabel(
		resourcePath: string,
		index: number,
		allPaths: Array<{ path: string; segments: string[] }>,
	): string {
		const segments = allPaths[index]?.segments;
		if (!segments || segments.length === 0) {
			return this.getCompactPathLabel(resourcePath);
		}

		for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
			const candidate = segments.slice(-segmentCount).join("/");
			const isUnique = allPaths.every((item, itemIndex) => {
				if (itemIndex === index) {
					return true;
				}
				return item.segments.slice(-segmentCount).join("/") !== candidate;
			});

			if (isUnique) {
				return candidate;
			}
		}

		return segments.join("/");
	}

	private getCompactExtensionLabels(extensions: Array<{ path: string; sourceInfo?: SourceInfo }>): string[] {
		const nonPackageExtensions = extensions
			.map((extension) => {
				const segments = this.getCompactDisplayPathSegments(extension.path);
				const lastSegment = segments[segments.length - 1];
				if (segments.length > 1 && (lastSegment === "index.ts" || lastSegment === "index.js")) {
					segments.pop();
				}
				return {
					path: extension.path,
					sourceInfo: extension.sourceInfo,
					segments,
				};
			})
			.filter((extension) => !this.isPackageSource(extension.sourceInfo));

		return extensions.map((extension) => {
			if (this.isPackageSource(extension.sourceInfo)) {
				return this.getCompactExtensionLabel(extension.path, extension.sourceInfo);
			}

			const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
			if (nonPackageIndex === -1) {
				return this.getCompactPathLabel(extension.path, extension.sourceInfo);
			}

			return this.getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
		});
	}

	private getDisplaySourceInfo(sourceInfo?: SourceInfo): {
		label: string;
		scopeLabel?: string;
		color: "accent" | "muted";
	} {
		const source = sourceInfo?.source ?? "local";
		const scope = sourceInfo?.scope ?? "project";
		if (source === "local") {
			if (scope === "user") {
				return { label: "user", color: "muted" };
			}
			if (scope === "project") {
				return { label: "project", color: "muted" };
			}
			if (scope === "temporary") {
				return { label: "path", scopeLabel: "temp", color: "muted" };
			}
			return { label: "path", color: "muted" };
		}

		if (source === "cli") {
			return {
				label: "path",
				scopeLabel: scope === "temporary" ? "temp" : undefined,
				color: "muted",
			};
		}

		const scopeLabel =
			scope === "user" ? "user" : scope === "project" ? "project" : scope === "temporary" ? "temp" : undefined;
		return { label: source, scopeLabel, color: "accent" };
	}

	private getScopeGroup(sourceInfo?: SourceInfo): "user" | "project" | "path" {
		const source = sourceInfo?.source ?? "local";
		const scope = sourceInfo?.scope ?? "project";
		if (source === "cli" || scope === "temporary") return "path";
		if (scope === "user") return "user";
		if (scope === "project") return "project";
		return "path";
	}

	private isPackageSource(sourceInfo?: SourceInfo): boolean {
		const source = sourceInfo?.source ?? "";
		return source.startsWith("npm:") || source.startsWith("git:");
	}

	private buildScopeGroups(items: Array<{ path: string; sourceInfo?: SourceInfo }>): Array<{
		scope: "user" | "project" | "path";
		paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
		packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
	}> {
		const groups: Record<
			"user" | "project" | "path",
			{
				scope: "user" | "project" | "path";
				paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
				packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
			}
		> = {
			user: { scope: "user", paths: [], packages: new Map() },
			project: { scope: "project", paths: [], packages: new Map() },
			path: { scope: "path", paths: [], packages: new Map() },
		};

		for (const item of items) {
			const groupKey = this.getScopeGroup(item.sourceInfo);
			const group = groups[groupKey];
			const source = item.sourceInfo?.source ?? "local";

			if (this.isPackageSource(item.sourceInfo)) {
				const list = group.packages.get(source) ?? [];
				list.push(item);
				group.packages.set(source, list);
			} else {
				group.paths.push(item);
			}
		}

		return [groups.project, groups.user, groups.path].filter(
			(group) => group.paths.length > 0 || group.packages.size > 0,
		);
	}

	private formatScopeGroups(
		groups: Array<{
			scope: "user" | "project" | "path";
			paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
			packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
		}>,
		options: {
			formatPath: (item: { path: string; sourceInfo?: SourceInfo }) => string;
			formatPackagePath: (item: { path: string; sourceInfo?: SourceInfo }, source: string) => string;
		},
	): string {
		const lines: string[] = [];

		for (const group of groups) {
			lines.push(`  ${theme.fg("accent", group.scope)}`);

			const sortedPaths = [...group.paths].sort((a, b) => a.path.localeCompare(b.path));
			for (const item of sortedPaths) {
				lines.push(theme.fg("dim", `    ${options.formatPath(item)}`));
			}

			const sortedPackages = Array.from(group.packages.entries()).sort(([a], [b]) => a.localeCompare(b));
			for (const [source, items] of sortedPackages) {
				lines.push(`    ${theme.fg("mdLink", source)}`);
				const sortedPackagePaths = [...items].sort((a, b) => a.path.localeCompare(b.path));
				for (const item of sortedPackagePaths) {
					lines.push(theme.fg("dim", `      ${options.formatPackagePath(item, source)}`));
				}
			}
		}

		return lines.join("\n");
	}

	private findSourceInfoForPath(p: string, sourceInfos: Map<string, SourceInfo>): SourceInfo | undefined {
		const exact = sourceInfos.get(p);
		if (exact) return exact;

		let current = p;
		while (current.includes("/")) {
			current = current.substring(0, current.lastIndexOf("/"));
			const parent = sourceInfos.get(current);
			if (parent) return parent;
		}

		return undefined;
	}

	private formatPathWithSource(p: string, sourceInfo?: SourceInfo): string {
		if (sourceInfo) {
			const shortPath = this.getShortPath(p, sourceInfo);
			const { label, scopeLabel } = this.getDisplaySourceInfo(sourceInfo);
			const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
			return `${labelText} ${shortPath}`;
		}
		return this.formatDisplayPath(p);
	}

	private formatDiagnostics(diagnostics: readonly ResourceDiagnostic[], sourceInfos: Map<string, SourceInfo>): string {
		const lines: string[] = [];

		// Group collision diagnostics by name
		const collisions = new Map<string, ResourceDiagnostic[]>();
		const otherDiagnostics: ResourceDiagnostic[] = [];

		for (const d of diagnostics) {
			if (d.type === "collision" && d.collision) {
				const list = collisions.get(d.collision.name) ?? [];
				list.push(d);
				collisions.set(d.collision.name, list);
			} else {
				otherDiagnostics.push(d);
			}
		}

		// Format collision diagnostics grouped by name
		for (const [name, collisionList] of collisions) {
			const first = collisionList[0]?.collision;
			if (!first) continue;
			lines.push(theme.fg("warning", `  "${name}" collision:`));
			lines.push(
				theme.fg(
					"dim",
					`    ${theme.fg("success", "✓")} ${this.formatPathWithSource(first.winnerPath, this.findSourceInfoForPath(first.winnerPath, sourceInfos))}`,
				),
			);
			for (const d of collisionList) {
				if (d.collision) {
					lines.push(
						theme.fg(
							"dim",
							`    ${theme.fg("warning", "✗")} ${this.formatPathWithSource(d.collision.loserPath, this.findSourceInfoForPath(d.collision.loserPath, sourceInfos))} (skipped)`,
						),
					);
				}
			}
		}

		for (const d of otherDiagnostics) {
			if (d.path) {
				const formattedPath = this.formatPathWithSource(d.path, this.findSourceInfoForPath(d.path, sourceInfos));
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${formattedPath}`));
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `    ${d.message}`));
			} else {
				lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${d.message}`));
			}
		}

		return lines.join("\n");
	}

	private showLoadedResources(options?: {
		extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
		force?: boolean;
		showDiagnosticsWhenQuiet?: boolean;
	}): void {
		// Resource rendering is idempotent; chat clears no longer clear this separate container.
		this.loadedResourcesContainer.clear();

		const showListing = options?.force || this.options.verbose || !this.settingsManager.getQuietStartup();
		const showDiagnostics = showListing || options?.showDiagnosticsWhenQuiet === true;
		if (!showListing && !showDiagnostics) {
			return;
		}

		const sectionHeader = (name: string, color: ThemeColor = "mdHeading") => theme.fg(color, `[${name}]`);
		const formatCompactList = (items: string[], options?: { sort?: boolean }): string => {
			const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
			if (options?.sort !== false) {
				labels.sort((a, b) => a.localeCompare(b));
			}
			return theme.fg("dim", `  ${labels.join(", ")}`);
		};
		const addLoadedSection = (
			name: string,
			collapsedBody: string,
			expandedBody = collapsedBody,
			color: ThemeColor = "mdHeading",
		): void => {
			const section = new ExpandableText(
				() => `${sectionHeader(name, color)}\n${collapsedBody}`,
				() => `${sectionHeader(name, color)}\n${expandedBody}`,
				this.getStartupExpansionState(),
				0,
				0,
			);
			this.loadedResourcesContainer.addChild(section);
			this.loadedResourcesContainer.addChild(new Spacer(1));
		};

		const skillsResult = this.session.resourceLoader.getSkills();
		const promptsResult = this.session.resourceLoader.getPrompts();
		const themesResult = this.session.resourceLoader.getThemes();
		const extensions =
			options?.extensions ??
			this.session.resourceLoader
				.getExtensions()
				.extensions.filter((extension) => !extension.hidden)
				.map((extension) => ({
					path: extension.path,
					sourceInfo: extension.sourceInfo,
				}));
		const sourceInfos = new Map<string, SourceInfo>();
		for (const extension of extensions) {
			if (extension.sourceInfo) {
				sourceInfos.set(extension.path, extension.sourceInfo);
			}
		}
		for (const skill of skillsResult.skills) {
			if (skill.sourceInfo) {
				sourceInfos.set(skill.filePath, skill.sourceInfo);
			}
		}
		for (const prompt of promptsResult.prompts) {
			if (prompt.sourceInfo) {
				sourceInfos.set(prompt.filePath, prompt.sourceInfo);
			}
		}
		for (const loadedTheme of themesResult.themes) {
			if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
				sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
			}
		}

		if (showListing) {
			const systemPromptSource = this.session.resourceLoader.getSystemPromptSource();
			const contextFiles = [
				...(systemPromptSource ? [systemPromptSource] : []),
				...this.session.resourceLoader.getAppendSystemPromptSources(),
				...this.session.resourceLoader.getAgentsFiles().agentsFiles,
			];
			if (contextFiles.length > 0) {
				this.loadedResourcesContainer.addChild(new Spacer(1));
				const contextList = contextFiles
					.map((f) => theme.fg("dim", `  ${this.formatDisplayPath(f.path)}`))
					.join("\n");
				const contextCompactList = formatCompactList(
					contextFiles.map((contextFile) => this.formatContextPath(contextFile.path)),
					{ sort: false },
				);
				addLoadedSection("Context", contextCompactList, contextList);
			}

			const skills = skillsResult.skills;
			if (skills.length > 0) {
				const groups = this.buildScopeGroups(
					skills.map((skill) => ({
						path: skill.filePath,
						sourceInfo: skill.sourceInfo,
					})),
				);
				const skillList = this.formatScopeGroups(groups, {
					formatPath: (item) => this.formatDisplayPath(item.path),
					formatPackagePath: (item) => this.getShortPath(item.path, item.sourceInfo),
				});
				const skillCompactList = formatCompactList(skills.map((skill) => skill.name));
				addLoadedSection("Skills", skillCompactList, skillList);
			}

			const templates = this.session.promptTemplates;
			if (templates.length > 0) {
				const groups = this.buildScopeGroups(
					templates.map((template) => ({
						path: template.filePath,
						sourceInfo: template.sourceInfo,
					})),
				);
				const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
				const templateList = this.formatScopeGroups(groups, {
					formatPath: (item) => {
						const template = templateByPath.get(item.path);
						return template ? `/${template.name}` : this.formatDisplayPath(item.path);
					},
					formatPackagePath: (item) => {
						const template = templateByPath.get(item.path);
						return template ? `/${template.name}` : this.formatDisplayPath(item.path);
					},
				});
				const promptCompactList = formatCompactList(templates.map((template) => `/${template.name}`));
				addLoadedSection("Prompts", promptCompactList, templateList);
			}

			if (extensions.length > 0) {
				const groups = this.buildScopeGroups(extensions);
				const extList = this.formatScopeGroups(groups, {
					formatPath: (item) => this.formatExtensionDisplayPath(item.path),
					formatPackagePath: (item) =>
						this.formatExtensionDisplayPath(this.getShortPath(item.path, item.sourceInfo)),
				});
				const extensionCompactList = formatCompactList(this.getCompactExtensionLabels(extensions));
				addLoadedSection("Extensions", extensionCompactList, extList, "mdHeading");
			}

			// Show loaded themes (excluding built-in)
			const loadedThemes = themesResult.themes;
			const customThemes = loadedThemes.filter((t) => t.sourcePath);
			if (customThemes.length > 0) {
				const groups = this.buildScopeGroups(
					customThemes.map((loadedTheme) => ({
						path: loadedTheme.sourcePath!,
						sourceInfo: loadedTheme.sourceInfo,
					})),
				);
				const themeList = this.formatScopeGroups(groups, {
					formatPath: (item) => this.formatDisplayPath(item.path),
					formatPackagePath: (item) => this.getShortPath(item.path, item.sourceInfo),
				});
				const themeCompactList = formatCompactList(
					customThemes.map(
						(loadedTheme) =>
							loadedTheme.name ?? this.getCompactPathLabel(loadedTheme.sourcePath!, loadedTheme.sourceInfo),
					),
				);
				addLoadedSection("Themes", themeCompactList, themeList);
			}
		}

		if (showDiagnostics) {
			const skillDiagnostics = skillsResult.diagnostics;
			if (skillDiagnostics.length > 0) {
				const warningLines = this.formatDiagnostics(skillDiagnostics, sourceInfos);
				this.loadedResourcesContainer.addChild(
					new Text(`${theme.fg("warning", "[Skill conflicts]")}\n${warningLines}`, 0, 0),
				);
				this.loadedResourcesContainer.addChild(new Spacer(1));
			}

			const promptDiagnostics = promptsResult.diagnostics;
			if (promptDiagnostics.length > 0) {
				const warningLines = this.formatDiagnostics(promptDiagnostics, sourceInfos);
				this.loadedResourcesContainer.addChild(
					new Text(`${theme.fg("warning", "[Prompt conflicts]")}\n${warningLines}`, 0, 0),
				);
				this.loadedResourcesContainer.addChild(new Spacer(1));
			}

			const extensionDiagnostics: ResourceDiagnostic[] = [];
			const extensionErrors = this.session.resourceLoader.getExtensions().errors;
			if (extensionErrors.length > 0) {
				for (const error of extensionErrors) {
					extensionDiagnostics.push({
						type: "error",
						message: error.error,
						path: error.path,
					});
				}
			}

			const commandDiagnostics = this.session.extensionRunner.getCommandDiagnostics();
			extensionDiagnostics.push(...commandDiagnostics);
			extensionDiagnostics.push(...this.getBuiltInCommandConflictDiagnostics(this.session.extensionRunner));

			const shortcutDiagnostics = this.session.extensionRunner.getShortcutDiagnostics();
			extensionDiagnostics.push(...shortcutDiagnostics);

			if (extensionDiagnostics.length > 0) {
				const warningLines = this.formatDiagnostics(extensionDiagnostics, sourceInfos);
				this.loadedResourcesContainer.addChild(
					new Text(`${theme.fg("warning", "[Extension issues]")}\n${warningLines}`, 0, 0),
				);
				this.loadedResourcesContainer.addChild(new Spacer(1));
			}

			const themeDiagnostics = themesResult.diagnostics;
			if (themeDiagnostics.length > 0) {
				const warningLines = this.formatDiagnostics(themeDiagnostics, sourceInfos);
				this.loadedResourcesContainer.addChild(
					new Text(`${theme.fg("warning", "[Theme conflicts]")}\n${warningLines}`, 0, 0),
				);
				this.loadedResourcesContainer.addChild(new Spacer(1));
			}
		}
	}

	/**
	 * Initialize the extension system with TUI-based UI context.
	 */
	private async bindCurrentSessionExtensions(): Promise<void> {
		const uiContext = this.createExtensionUIContext();
		await this.session.bindExtensions({
			uiContext,
			mode: "tui",
			abortHandler: () => {
				this.restoreQueuedMessagesToEditor({ abort: true });
			},
			commandContextActions: {
				waitForIdle: () => this.session.waitForIdle(),
				newSession: async (options) => {
					this.clearStatusIndicator();
					try {
						return await this.runtimeHost.newSession(options);
					} catch (error: unknown) {
						return this.handleFatalRuntimeError("Failed to create session", error);
					}
				},
				fork: async (entryId, options) => {
					try {
						const result = await this.runtimeHost.fork(entryId, options);
						if (!result.cancelled) {
							this.editor.setText(result.selectedText ?? "");
							this.showStatus("Forked to new session");
						}
						return { cancelled: result.cancelled };
					} catch (error: unknown) {
						return this.handleFatalRuntimeError("Failed to fork session", error);
					}
				},
				navigateTree: async (targetId, options) => {
					const result = await this.session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					if (result.cancelled) {
						return { cancelled: true };
					}

					this.chatContainer.clear();
					this.renderInitialMessages();
					if (result.editorText && !this.editor.getText().trim()) {
						this.editor.setText(result.editorText);
					}
					this.showStatus("Navigated to selected point");
					void this.flushCompactionQueue({ willRetry: false });
					return { cancelled: false };
				},
				switchSession: async (sessionPath, options) => {
					return this.handleResumeSession(sessionPath, options);
				},
				reload: async () => {
					await this.handleReloadCommand();
				},
			},
			shutdownHandler: () => {
				this.shutdownRequested = true;
				if (this.session.isIdle) {
					void this.shutdown();
				}
			},
			onError: (error) => {
				this.showExtensionError(error.extensionPath, error.error, error.stack);
			},
		});

		setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
		this.setupAutocompleteProvider();

		const extensionRunner = this.session.extensionRunner;
		this.setupExtensionShortcuts(extensionRunner);
		this.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
		this.showStartupNoticesIfNeeded();
	}

	private applyFullscreenScrollbarSetting(): void {
		this.transcriptScrollView?.setScrollbar(this.settingsManager.getFullscreenScrollbar());
	}

	private applyRuntimeSettings(): void {
		configureHttpDispatcher(this.settingsManager.getHttpIdleTimeoutMs());
		this.applyFullscreenScrollbarSetting();
		this.footer.setSession(this.session);
		this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
		this.footerDataProvider.setCwd(this.sessionManager.getCwd());
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
		this.outputPad = this.settingsManager.getOutputPad();
		this.ui.setShowHardwareCursor(this.settingsManager.getShowHardwareCursor());
		const clearOnShrink = this.settingsManager.getClearOnShrink();
		this.ui.setClearOnShrink(clearOnShrink);
		if (!clearOnShrink && !this.activeStatusIndicator) {
			this.statusContainer.clear();
		}
		const editorPaddingX = this.settingsManager.getEditorPaddingX();
		const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
		this.defaultEditor.setPaddingX(editorPaddingX);
		this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
		if (this.editor !== this.defaultEditor) {
			this.editor.setPaddingX?.(editorPaddingX);
			this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
		}
	}

	/** Start every configured remote bridge (Telegram / Discord / iMessage). */
	private startRemoteBridges(): void {
		this.startTelegramBridgeIfConfigured();
		this.startDiscordBridgeIfConfigured();
		this.startImessageBridgeIfConfigured();
		// Forward terminal responses to whichever bridge started the turn.
		this.remoteBridgeUnsubscribe = this.session.subscribe((event) => {
			if (event.type === "message_start" && event.message.role === "user") {
				for (const bridge of this.remoteBridges) bridge.handleTurnStart(event.message);
			} else if (event.type === "agent_end") {
				for (const bridge of this.remoteBridges) {
					void bridge.handleAgentEnd(event.messages, event.willRetry);
				}
			}
		});
		this.wireTaskRunResultNotifications();
	}

	/**
	 * Tear down every running remote bridge so background WS/heartbeat churn
	 * cannot corrupt the TUI frame while the runtime is being torn down and
	 * rebuilt (e.g. during /refresh). No-op when no bridge is running.
	 */
	private stopRemoteBridges(): void {
		this.remoteBridgeUnsubscribe?.();
		this.remoteBridgeUnsubscribe = undefined;
		for (const bridge of [this.telegramBridge, this.discordBridge, this.imessageBridge]) {
			void bridge?.stop().catch(() => {});
		}
		this.telegramBridge = undefined;
		this.discordBridge = undefined;
		this.imessageBridge = undefined;
	}

	/**
	 * Notify running chat bridges when a task run reaches a terminal state,
	 * unless the user disabled {@link Settings.notifyOnTaskCompletion}
	 * (default on). Attended-only: bridges are already restricted to the running
	 * interactive session, and with no bridge connected the notifier is a no-op.
	 */
	private wireTaskRunResultNotifications(): void {
		this.taskStore.setTaskRunResultNotifier((notification: TaskRunResultNotification) => {
			if (!this.settingsManager.getNotifyOnTaskCompletion()) return;
			const bridges = this.remoteBridges;
			if (bridges.length === 0) return;
			for (const bridge of bridges) {
				void bridge.notifyTaskResult(notification.summary);
			}
		});
	}

	/**
	 * Canonical slash-command descriptors for the remote bridges: builtins +
	 * prompt templates + skills + extension commands (same sources as the TUI
	 * autocomplete, so the remote menu never drifts from the terminal).
	 */
	private buildRemoteCommandDescriptors(): RemoteCommandDescriptor[] {
		const descriptors: RemoteCommandDescriptor[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
			name: command.name,
			kind: "builtin",
			description: command.description,
			...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
		}));
		for (const template of this.session.promptTemplates) {
			descriptors.push({ name: template.name, kind: "prompt", description: template.description });
		}
		for (const skill of this.session.resourceLoader.getSkills().skills) {
			descriptors.push({ name: `skill:${skill.name}`, kind: "skill", description: skill.description });
		}
		for (const command of this.session.extensionRunner.getRegisteredCommands()) {
			descriptors.push({
				name: command.invocationName,
				kind: "extension",
				description: command.description,
			});
		}
		return descriptors;
	}

	/**
	 * Run one canonical remote command line against the shared session and the
	 * headless engines the TUI handlers delegate to. Never opens TUI selectors
	 * and never bypasses the existing authorization/approval gates.
	 */
	private async dispatchRemoteCommand(commandLine: string): Promise<RemoteSlashResult> {
		const context: RemoteCommandContext = {
			agentDir: getAgentDir(),
			taskStore: this.taskStore,
			session: {
				id: this.sessionManager.getSessionId(),
				cwd: this.sessionManager.getCwd(),
				mode: this.session.interactionMode,
				name: this.sessionManager.getSessionName() ?? undefined,
				activeSubagents: this.session.runningSubagentCount > 0 ? this.session.runningSubagentCount : undefined,
			},
			getStacks: (query) => {
				this.refreshCapabilityTree();
				return formatStacksCommandOutput(this.capabilityTree, query);
			},
			getProjects: (query) => formatProjectsCommandOutput(this.sessionManager.getCwd(), query),
			getSubagents: async (arg) => {
				const { listSubagentSessions } = await import("../../porcupine/subagent-sessions.ts");
				const { formatSubagentSessionList, formatSubagentSessionView } = await import(
					"../../porcupine/subagent-session-format.ts"
				);
				const sessions = await listSubagentSessions(this.sessionManager.getSessionDir());
				return arg ? formatSubagentSessionView(sessions, arg) : formatSubagentSessionList(sessions);
			},
			getChangelog: () => this.remoteChangelogText(),
			getMemory: () => formatMemoryReport(getAgentDir()),
			getSessionReport: () => this.remoteSessionReport(),
			getUsageReport: () => this.remoteUsageReport(),
			getX: async (text) => {
				const { runXCommand } = await import("../../porcupine/x-command.ts");
				return (await runXCommand(text)).output;
			},
			getEmail: async (text) => {
				const command = parseEmailCommand(text);
				if (!command || command.kind === "invalid") {
					return command?.kind === "invalid"
						? command.message
						: "Usage: /email [status|drafts|inbox|read|draft|send]";
				}
				const settings = this.settingsManager.getEmailSettings();
				if (!settings) {
					return "Email is not configured. See the email docs to set up IMAP/SMTP.";
				}
				try {
					return await buildEmailCommandOutput(command, {
						configured: true,
						connectInfo: {
							host: settings.host ?? "",
							user: settings.user ?? "",
							draftsFolder: settings.draftsFolder ?? "Drafts",
							sentFolder: settings.sentFolder ?? "Sent Mail",
						},
						getClient: async () => {
							const pass = await readSecret(getAgentDir(), EMAIL_KEYRING_SERVICE, settings.user ?? "");
							return createEmailClient({
								host: settings.host ?? "",
								port: settings.port ?? (settings.secure === false ? 143 : 993),
								secure: settings.secure ?? true,
								user: settings.user ?? "",
								pass,
								draftsFolder: settings.draftsFolder ?? "Drafts",
								sentFolder: settings.sentFolder ?? "Sent Mail",
								timeoutMs: settings.timeoutMs ?? 15000,
							});
						},
					});
				} catch (error) {
					return `Email command failed: ${error instanceof Error ? error.message : String(error)}`;
				}
			},
			getGuide: (arg) => formatGuideCommandOutput(arg ? `/guide ${arg}` : "/guide"),
			getGoalStatus: () => formatGoalStatus(this.goalPlanState.goal),
			getPlanStatus: () => formatPlanStatus(this.goalPlanState.plan),
			setReasoning: (arg) => this.remoteSetReasoning(arg),
			setAdaptive: (arg) => this.remoteSetAdaptive(arg),
			setAuto: (arg) => this.remoteSetAuto(arg),
			setModel: async (arg) => this.remoteSetModel(arg),
			setName: (name) => {
				this.session.setSessionName(name);
				return `Session name set to "${name}".`;
			},
			runInit: (arg) => this.remoteRunInit(arg),
			runUpdate: async () => {
				const current = this.version;
				const latest = await checkForNewPorcupineVersion(current, { cacheTtlMs: 0 }).catch(() => undefined);
				if (!latest) return `You're up to date — ${APP_NAME} v${current}.`;
				this.latestVersion = latest.version;
				const pkg = latest.packageName ?? getInstalledPackageName();
				return [
					`Current: v${current}`,
					`Latest:  v${latest.version} available`,
					"",
					`To update: npm install -g --ignore-scripts ${pkg ?? "@porcupineai/coding-agent"}`,
				].join("\n");
			},
		};
		return dispatchRemoteSlash(commandLine, context);
	}

	/** Plain-text session report (no TUI theme markup). */
	private remoteSessionReport(): string {
		const stats = this.session.getSessionStats();
		const name = this.sessionManager.getSessionName();
		const lines = [`session: ${stats.sessionId}`];
		if (name) lines.push(`name: ${name}`);
		lines.push(`file: ${stats.sessionFile ?? "In-memory"}`);
		lines.push(
			`messages: ${stats.totalMessages} (${stats.userMessages} user / ${stats.assistantMessages} assistant)`,
		);
		lines.push(`tools: ${stats.toolCalls} calls, ${stats.toolResults} results`);
		const { input, cacheRead, cacheWrite, output, total } = stats.tokens;
		const promptTokens = input + cacheRead + cacheWrite;
		lines.push(
			`tokens: ${total.toLocaleString()} total (${promptTokens.toLocaleString()} in / ${output.toLocaleString()} out)`,
		);
		if (promptTokens > 0 && (cacheRead > 0 || cacheWrite > 0)) {
			lines.push(`cache hits: ${((cacheRead / promptTokens) * 100).toFixed(1)}%`);
		}
		if (stats.cost > 0) lines.push(`cost: $${stats.cost.toFixed(3)}`);
		return lines.join("\n");
	}

	/** Plain-text usage/cost report for /usage and /cost. */
	private remoteUsageReport(): string {
		const stats = this.session.getSessionStats();
		const { input, cacheRead, cacheWrite, output, total } = stats.tokens;
		const promptTokens = input + cacheRead + cacheWrite;
		const lines = [
			`tokens: ${total.toLocaleString()} total (${promptTokens.toLocaleString()} in / ${output.toLocaleString()} out)`,
		];
		if (promptTokens > 0 && (cacheRead > 0 || cacheWrite > 0)) {
			lines.push(
				`cache hits: ${((cacheRead / promptTokens) * 100).toFixed(1)}% (${cacheRead.toLocaleString()} cached)`,
			);
		}
		if (stats.cost > 0) lines.push(`cost: $${stats.cost.toFixed(3)}`);
		return lines.join("\n");
	}

	/** Plain-text changelog (newest first, no TUI theme markup). */
	private remoteChangelogText(): string {
		const allEntries = parseChangelog(getChangelogPath());
		if (allEntries.length === 0) return "No changelog entries found.";
		return allEntries
			.reverse()
			.map((entry) => normalizeChangelogLinks(entry.content, entry))
			.join("\n\n");
	}

	/** Remote /reasoning: status or set a concrete/adaptive mode (no selector). */
	private remoteSetReasoning(arg: string): string {
		const modeArg = arg.trim().toLowerCase();
		if (modeArg === "status" || modeArg === "?" || modeArg === "") {
			const current = this.session.getReasoningMode();
			return `Reasoning: ${current} | available: ${this.session.getAvailableReasoningModes().join(", ")}`;
		}
		if (!this.session.supportsThinking()) {
			return "Current model does not support thinking/reasoning levels.";
		}
		const parsed = parseReasoningModeArg(modeArg);
		if (!parsed) {
			return "Usage: /reasoning [off|minimal|low|medium|high|xhigh|max|adaptive] or /reasoning status";
		}
		if (parsed !== "adaptive" && !this.session.getAvailableThinkingLevels().includes(parsed)) {
			return `Level "${parsed}" is not supported by this model.`;
		}
		const applied = this.session.setReasoningMode(parsed);
		return `Reasoning: ${applied}`;
	}

	/** Remote /adaptive [on|off|status]. */
	private remoteSetAdaptive(arg: string): string {
		const modeArg = arg.trim().toLowerCase();
		const enabled = this.session.getReasoningMode() === "adaptive";
		if (modeArg === "status" || modeArg === "") return `Adaptive reasoning: ${enabled ? "on" : "off"}`;
		if (modeArg === "on" || modeArg === "true") {
			this.session.setAdaptiveReasoning(true);
			return "Adaptive reasoning: on";
		}
		if (modeArg === "off" || modeArg === "false") {
			this.session.setAdaptiveReasoning(false);
			return "Adaptive reasoning: off";
		}
		return "Usage: /adaptive [on|off|status]";
	}

	/** Remote /auto [on|off|status]. */
	private remoteSetAuto(arg: string): string {
		const modeArg = arg.trim().toLowerCase();
		if (modeArg === "status" || modeArg === "") return `Auto mode: ${this.session.isAutoModeEnabled ? "on" : "off"}`;
		if (modeArg === "on" || modeArg === "true") {
			this.session.setAutoMode(true);
			return "Auto mode: on";
		}
		if (modeArg === "off" || modeArg === "false") {
			this.session.setAutoMode(false);
			return "Auto mode: off";
		}
		return "Usage: /auto [on|off|status]";
	}

	/** Remote /model <provider/model>: resolve and set, no selector. */
	private async remoteSetModel(arg: string): Promise<string> {
		const model = await this.findExactModelMatch(arg);
		if (!model) return `No model matched "${arg}". Run '/model' in the terminal to browse models.`;
		try {
			await this.session.setModel(model);
			return `Model set to ${model.id}.`;
		} catch (error) {
			return `Model change failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/** Remote /init [--force]: generate the project context file. */
	private remoteRunInit(arg: string): string {
		const result = writeProjectContext(this.sessionManager.getCwd(), { force: arg.includes("--force") });
		if (result.status === "unchanged") return "Project context is already up to date.";
		if (result.status === "created" || result.status === "merged") return `${result.path} updated.`;
		return "Project context generation failed.";
	}

	/** Start the Telegram bridge when PORCUPINE_TELEGRAM_TOKEN is configured. */
	private startTelegramBridgeIfConfigured(): void {
		const token = process.env.PORCUPINE_TELEGRAM_TOKEN;
		if (!token) {
			return;
		}
		const allowlist = (process.env.PORCUPINE_TELEGRAM_ALLOW ?? "")
			.split(",")
			.map((part) => Number(part.trim()))
			.filter((id) => Number.isFinite(id));
		const userAllowlist = (process.env.PORCUPINE_TELEGRAM_USER_ALLOW ?? "")
			.split(",")
			.map((part) => Number(part.trim()))
			.filter((id) => Number.isFinite(id));
		this.telegramBridge = new TelegramBridge({
			token,
			allowlist,
			userAllowlist,
			prompt: (text, options) =>
				this.session.prompt(text, { streamingBehavior: options?.streamingBehavior ?? "followUp" }),
			confirmTui: (title, message) => this.showExtensionConfirm(title, message),
			getStatus: () =>
				formatBridgeStatus(
					this.sessionManager.getSessionId(),
					this.sessionManager.getCwd(),
					this.session.interactionMode,
				),
			getCommands: () => this.buildRemoteCommandDescriptors(),
			dispatch: (commandLine) => this.dispatchRemoteCommand(commandLine),
		});
		void this.telegramBridge
			.start()
			.then(() => {
				this.showStatus(
					`Telegram bridge polling (${allowlist.length > 0 ? `${allowlist.length} allowed chat${allowlist.length === 1 ? "" : "s"}` : "no chats allowed yet"}). Set PORCUPINE_TELEGRAM_ALLOW to authorize chat ids.`,
				);
			})
			.catch((error: unknown) => {
				this.showWarning(
					`Telegram bridge failed to start: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	}

	/** Start the Discord bridge when PORCUPINE_DISCORD_TOKEN is configured. */
	private startDiscordBridgeIfConfigured(): void {
		const token = process.env.PORCUPINE_DISCORD_TOKEN;
		if (!token) {
			return;
		}
		const allowlist = (process.env.PORCUPINE_DISCORD_ALLOW ?? "")
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		const userAllowlist = (process.env.PORCUPINE_DISCORD_USER_ALLOW ?? "")
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		this.discordBridge = new DiscordBridge({
			token,
			allowlist,
			userAllowlist,
			prompt: (text, options) =>
				this.session.prompt(text, { streamingBehavior: options?.streamingBehavior ?? "followUp" }),
			getStatus: () =>
				formatBridgeStatus(
					this.sessionManager.getSessionId(),
					this.sessionManager.getCwd(),
					this.session.interactionMode,
				),
			getCommands: () => this.buildRemoteCommandDescriptors(),
			dispatch: (commandLine) => this.dispatchRemoteCommand(commandLine),
		});
		void this.discordBridge
			.start()
			.then(() => {
				this.showStatus(
					`Discord bridge connected (${allowlist.length} allowed channel${allowlist.length === 1 ? "" : "s"}, ${userAllowlist.length} allowed user${userAllowlist.length === 1 ? "" : "s"}). Set PORCUPINE_DISCORD_ALLOW and PORCUPINE_DISCORD_USER_ALLOW to authorize both.`,
				);
			})
			.catch((error: unknown) => {
				this.showWarning(
					`Discord bridge failed to start: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	}

	/** Start the iMessage bridge when PORCUPINE_IMESSAGE_ALLOW is configured (macOS only). */
	private startImessageBridgeIfConfigured(): void {
		const allowlist = (process.env.PORCUPINE_IMESSAGE_ALLOW ?? "")
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		const senderAllowlist = (process.env.PORCUPINE_IMESSAGE_SENDER_ALLOW ?? "")
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		if (allowlist.length === 0) {
			return;
		}
		this.imessageBridge = new IMessageBridge({
			allowlist,
			senderAllowlist,
			prompt: (text, options) =>
				this.session.prompt(text, { streamingBehavior: options?.streamingBehavior ?? "followUp" }),
			getStatus: () =>
				formatBridgeStatus(
					this.sessionManager.getSessionId(),
					this.sessionManager.getCwd(),
					this.session.interactionMode,
				),
			getCommands: () => this.buildRemoteCommandDescriptors(),
			dispatch: (commandLine) => this.dispatchRemoteCommand(commandLine),
		});
		void this.imessageBridge
			.start()
			.then(() => {
				this.showStatus(
					`iMessage bridge polling (${allowlist.length} allowed chat${allowlist.length === 1 ? "" : "s"}). Set PORCUPINE_IMESSAGE_ALLOW to change.`,
				);
			})
			.catch((error: unknown) => {
				this.showWarning(
					`iMessage bridge failed to start: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	}

	/** Running remote bridges, used to race confirm/select/input across channels. */
	private get remoteBridges(): RemoteBridgeLike[] {
		const bridges: RemoteBridgeLike[] = [];
		if (this.telegramBridge?.isRunning) bridges.push(this.telegramBridge);
		if (this.discordBridge?.isRunning) bridges.push(this.discordBridge);
		if (this.imessageBridge?.isRunning) bridges.push(this.imessageBridge);
		return bridges;
	}

	private rebindGeneration = 0;

	private async rebindCurrentSession(options: { renderBeforeBind?: boolean } = {}): Promise<void> {
		const session = this.session;
		const generation = ++this.rebindGeneration;

		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.applyRuntimeSettings();
		this.wireModeConfirmations();

		if (options.renderBeforeBind) {
			this.renderCurrentSessionState();
			this.subscribeToAgent();
			this.subscribeToSubagents();
		}

		await this.bindCurrentSessionExtensions();

		if (this.session !== session) {
			// The bind replaced the session. Re-wire confirmations and subscribe
			// to the NEW session's agent events — but only if a newer rebind has
			// not already taken ownership (its renderBeforeBind subscribed to the
			// now-current session). Without the generation guard, an overlapping
			// stale rebind would double-subscribe the new session.
			this.wireModeConfirmations();
			this.subscribeToSubagents();
			if (generation === this.rebindGeneration) {
				this.subscribeToAgent();
			}
			return;
		}

		if (!options.renderBeforeBind) {
			this.subscribeToAgent();
			this.subscribeToSubagents();
		}

		await this.updateAvailableProviderCount();
		this.updateEditorBorderColor();
		this.updateTerminalTitle();
	}

	/** Ask-mode and flagged-Normal commands confirm through the TUI selector + every running remote bridge. */
	private wireModeConfirmations(): void {
		this.session.setConfirmCallback(async (title, message) => {
			const decisions: Promise<boolean>[] = [this.showExtensionConfirm(title, message)];
			for (const bridge of this.remoteBridges) {
				const remote = bridge.remoteConfirm(title, message);
				if (remote) decisions.push(remote);
			}
			return Promise.race(decisions);
		});
	}

	private async handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
		const message = error instanceof Error ? error.message : String(error);
		this.showError(`${prefix}: ${message}`);
		stopThemeWatcher();
		this.stop();
		process.exit(1);
	}

	private renderCurrentSessionState(): void {
		this.loadedResourcesContainer.clear();
		this.chatContainer.clear();
		this.taskGraphComponent = undefined;
		this.pendingMessagesContainer.clear();
		this.compactionQueuedMessages = [];
		this.streamingComponent = undefined;
		this.streamingMessage = undefined;
		this.pendingTools.clear();
		this.renderInitialMessages();
	}

	/**
	 * Get a registered tool definition by name (for custom rendering).
	 */
	private getRegisteredToolDefinition(toolName: string) {
		return this.session.getToolDefinition(toolName);
	}

	private getMarkdownTransformers(): MarkdownTransformer[] {
		return this.session.extensionRunner.getMarkdownTransformers();
	}

	/**
	 * Set up keyboard shortcuts registered by extensions.
	 */
	private setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
		const shortcuts = extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig());
		if (shortcuts.size === 0) return;

		// Create a context for shortcut handlers
		const createContext = (): ExtensionContext => ({
			ui: this.createExtensionUIContext(),
			mode: "tui",
			hasUI: true,
			cwd: this.sessionManager.getCwd(),
			sessionManager: this.sessionManager,
			modelRegistry: extensionRunner.getModelRegistry(),
			model: this.session.model,
			scopedModels: this.session.scopedModels,
			thinkingLevel: this.session.thinkingLevel,
			isIdle: () => this.session.isIdle,
			isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
			signal: this.session.agent.signal,
			abort: () => {
				this.restoreQueuedMessagesToEditor({ abort: true });
			},
			hasPendingMessages: () => this.session.pendingMessageCount > 0,
			shutdown: () => {
				this.shutdownRequested = true;
			},
			getContextUsage: () => this.session.getContextUsage(),
			compact: (options) => {
				void (async () => {
					try {
						const result = await this.session.compact(options?.customInstructions);
						options?.onComplete?.(result);
					} catch (error) {
						const err = error instanceof Error ? error : new Error(String(error));
						options?.onError?.(err);
					}
				})();
			},
			getSystemPrompt: () => this.session.systemPrompt,
		});

		// Set up the extension shortcut handler on the default editor
		this.defaultEditor.onExtensionShortcut = (data: string) => {
			for (const [shortcutStr, shortcut] of shortcuts) {
				// Cast to KeyId - extension shortcuts use the same format
				if (matchesKey(data, shortcutStr as KeyId)) {
					// Run handler async, don't block input
					Promise.resolve(shortcut.handler(createContext())).catch((err) => {
						this.showError(`Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`);
					});
					return true;
				}
			}
			return false;
		};
	}

	/**
	 * Set extension status text in the footer.
	 */
	private setExtensionStatus(key: string, text: string | undefined): void {
		this.footerDataProvider.setExtensionStatus(key, text);
		if (typeof text === "string") {
			const activityMatch = text.match(/\[activity:\s*([^\]]+)\]/);
			if (activityMatch) {
				const phase = normalizeAnimationId(activityMatch[1].trim());
				if (getAnimation(phase)) {
					// Apply the extension phase first, then set the override
					// so subsequent tool events keep it intact.
					this.setPorcupineActivity(phase);
					this.extensionActivityOverride = phase;
					this.extensionToolComponentsHidden = true;
					return;
				}
			}
		}
		if (!text) {
			this.clearExtensionActivityOverride();
		}
		this.ui.requestRender();
	}

	private showStatusIndicator(indicator: StatusIndicator): void {
		this.activeStatusIndicator?.dispose();
		this.activeStatusIndicator = indicator;
		this.statusContainer.clear();
		this.statusContainer.addChild(indicator);
	}

	private clearStatusIndicator(kind?: StatusIndicator["kind"]): void {
		if (kind && this.activeStatusIndicator?.kind !== kind) {
			return;
		}
		const hadActiveStatusIndicator = this.activeStatusIndicator !== undefined;
		this.activeStatusIndicator?.dispose();
		this.activeStatusIndicator = undefined;
		this.statusContainer.clear();
		if (hadActiveStatusIndicator && this.options.uiMode === "regular" && this.ui.getClearOnShrink()) {
			this.statusContainer.addChild(this.idleStatus);
		}
	}

	private setWorkingVisible(visible: boolean): void {
		this.workingVisible = visible;
		if (!visible) {
			this.clearStatusIndicator("working");
			this.ui.requestRender();
			return;
		}
		if (this.session.isStreaming && this.activeStatusIndicator?.kind !== "working") {
			this.setPorcupineActivity(this.activityPhase, {
				showInterruptHint: !this.workingMessage,
			});
		}
		this.ui.requestRender();
	}

	private setWorkingIndicator(options?: WorkingIndicatorOptions): void {
		if (!this.workingVisible) return;
		// undefined / empty call = restore Porcupine animation for the current phase.
		// Never fall back to the stock braille DEFAULT_FRAMES spinner.
		const restored = options ?? animationLoaderOptions(this.activityPhase, this.activityName);
		this.workingIndicatorOptions = restored;
		if (this.activeStatusIndicator?.kind === "working") {
			this.activeStatusIndicator.setIndicator(restored);
			if (!options) {
				const customHint = this.workingMessage?.trim();
				const agentActive =
					this.session.isStreaming ||
					this.session.isCompacting ||
					this.pendingTools.size > 0 ||
					this.session.isBashRunning;
				const parts: string[] = [];
				if (customHint) parts.push(customHint);
				if (agentActive) parts.push("(esc to interrupt)");
				this.activeStatusIndicator.setMessage(
					formatAnimationMessage(this.activityPhase, {
						hint: parts.length > 0 ? parts.join(" ") : undefined,
					}),
				);
			}
		} else if (this.session.isStreaming || this.pendingTools.size > 0) {
			this.showStatusIndicator(new WorkingStatusIndicator(this.ui, "", restored));
		}
		this.ui.requestRender();
	}

	/**
	 * Map a tool call to its status chip. Known tools get their phase (Reading /
	 * Searching for skills / …); any unmapped tool gets "🧰 Using <tool>" so the
	 * user always sees WHAT the main agent is doing, like the normal Working /
	 * Thinking chips.
	 */
	private toolChip(toolName: string | undefined | null, args?: unknown): { phase: AnimationId; name?: string } {
		const toolActivity = resolveToolActivity(toolName, args);
		if (toolActivity) return { phase: toolActivity.id, name: toolActivity.name };
		const fallback = resolveAnimationFromToolName(toolName);
		if (fallback === "working") return { phase: "using-tool", name: toolName || undefined };
		return { phase: fallback };
	}

	/** True for messaging tools (send_to_subagent / WoT send_message, check_messages). */
	private isMessagingToolName(toolName: string | undefined | null): boolean {
		return toolName === "send_to_subagent" || toolName === "send_message" || toolName === "check_messages";
	}

	/**
	 * Sub-agent strip chip: "🤖(📄 Extracting)" / "🤖(🧠 Thinking)" / "🤖 Sub-agent".
	 * The parenthesized activity reuses the same chip resolution as the main agent,
	 * so reading skills, searching, messaging, and generic tools all show their own
	 * emoji and label.
	 */
	/**
	 * Sub-agent strip chip in SLOT ORDER: "🤖(Sub 1, Sub 2, Sub 3)" — position 1
	 * is always the first sub-agent's activity, position 2 the second, etc.
	 * e.g. "🤖(📄 Extracting)" (one), "🤖(📄 Extracting, 🌐 Searching)" (two),
	 * "🤖(🧠 Thinking)", or "🤖 Sub-agent" at start. Each activity reuses the
	 * same chip resolution as the main agent.
	 */
	/**
	 * Animated sub-agent chip for the FOOTER (beside the 🧵 thread counter).
	 * Frames cycle on a timer while any worker runs; the status strip stays the
	 * main agent's.
	 */
	private subagentFooterFrames: string[] | undefined;
	private subagentFooterIndex = 0;
	private subagentFooterTimer: ReturnType<typeof setInterval> | undefined;
	// Fingerprint of the last-built footer chip content. Sub-agent progress
	// events fire densely (many `step`/`turn` events per second), but the footer
	// chip text only changes when a run's phase / tool / relevant tool args
	// change. We cache the chip rebuild on this cheap key so unchanged events
	// skip the subagentActivityIndicator/toolChip/resolveToolActivity + string
	// allocations entirely (the 320ms footer timer still animates the dots).
	private subagentFooterChipKey = "";

	private getSubagentFooterChip(): string | undefined {
		if (!this.subagentFooterFrames || this.subagentFooterFrames.length === 0) return undefined;
		return this.subagentFooterFrames[this.subagentFooterIndex % this.subagentFooterFrames.length];
	}

	private startSubagentFooterTimer(): void {
		if (this.subagentFooterTimer) return;
		this.subagentFooterTimer = setInterval(() => {
			if (!this.subagentFooterFrames || this.subagentFooterFrames.length === 0) return;
			this.subagentFooterIndex = (this.subagentFooterIndex + 1) % this.subagentFooterFrames.length;
			this.ui.requestRender();
		}, 320);
	}

	private stopSubagentFooterTimer(): void {
		if (this.subagentFooterTimer) {
			clearInterval(this.subagentFooterTimer);
			this.subagentFooterTimer = undefined;
		}
	}

	/**
	 * Cheap fingerprint of the run state that drives the footer chip. The chip
	 * is a pure function of each run's { phase, lastTool } plus the tool-arg
	 * fields resolveToolActivity reads (path/action/kind/query), in slot order.
	 * When this key is unchanged across consecutive progress events, the chip
	 * frames are guaranteed identical, so the costly rebuild can be skipped.
	 */
	private subagentFooterKey(
		runs: Array<{ id: string; phase?: string; lastTool?: string; lastToolArgs?: unknown }>,
	): string {
		let key = "";
		for (const run of runs) {
			const a = (run.lastToolArgs ?? {}) as Record<string, unknown>;
			const path = typeof a.path === "string" ? a.path : "";
			const action = typeof a.action === "string" ? a.action : "";
			const kind = typeof a.kind === "string" ? a.kind : "";
			const query = typeof a.query === "string" ? a.query : "";
			key += `${run.id}|${run.phase ?? ""}|${run.lastTool ?? ""}|${path}|${action}|${kind}|${query};`;
		}
		return key;
	}

	private subagentActivityIndicator(
		runs: Array<{
			lastTool?: string;
			lastToolArgs?: unknown;
			phase?: "tool" | "thinking" | "compacting";
		}>,
	): AnimationLoaderOptions | undefined {
		if (runs.length === 0) return undefined;
		const parts: string[] = [];
		for (const run of runs) {
			if (run.phase === "tool" && run.lastTool) {
				const chip = this.toolChip(run.lastTool, run.lastToolArgs);
				const anim = getAnimation(chip.phase);
				parts.push(`${anim.emoji} ${chip.name ? `${anim.label}: ${chip.name}` : anim.label}`);
			} else if (run.phase === "thinking") {
				parts.push("🧠 Thinking");
			} else if (run.phase === "compacting") {
				parts.push("🧹 Compacting");
			} else {
				parts.push("🤖");
			}
		}
		const chipBase = parts.every((part) => part === "🤖") ? "🤖 Sub-agent" : `🤖(${parts.join(", ")})`;
		return { frames: DOT_FRAMES.map((dots) => `${chipBase}${dots}`), intervalMs: 320 };
	}

	/**
	 * Drive the status strip from porcupine/animations.ts.
	 * @param options.force — allow replacing a live tool chip (read/write/edit/…).
	 *   Soft callers (orchestrator phases, streaming chunks) must NOT force.
	 */
	private setPorcupineActivity(
		phase: AnimationId,
		options?: { showInterruptHint?: boolean; force?: boolean; name?: string },
	): void {
		// Respect an explicit extension activity override while it is active.
		if (this.extensionActivityOverride !== undefined && phase !== this.extensionActivityOverride) {
			return;
		}

		if (!this.workingVisible) {
			return;
		}

		const requested = normalizeAnimationId(phase);
		const requestedName = options?.name?.trim() || undefined;

		// HARD LOCK: while tools are running, ignore soft Working/Thinking/egg noise.
		// Orchestrator `step:start` / streaming chunks used to stomp Reading/Writing/Editing.
		if (
			!options?.force &&
			this.pendingTools.size > 0 &&
			isToolDrivenAnimation(this.activityPhase) &&
			!isToolDrivenAnimation(requested)
		) {
			return;
		}

		// Easter eggs for Working / Thinking — sticky per phase (~4 of 10).
		const picked = pickStatusAnimation(requested, this.activityEasterEgg);
		this.activityEasterEgg = picked.stickyEgg;
		const next = picked.id;
		const phaseChanged = this.activityPhase !== next || this.activityName !== requestedName;
		this.activityPhase = next;
		this.activityName = requestedName;

		// Animated frames already include "📖  Reading". Message is only the hint.
		// Always show "(esc to interrupt)" while active — no middle-dot, always "esc" not "escape".
		const agentActive =
			this.session.isStreaming ||
			this.session.isCompacting ||
			this.pendingTools.size > 0 ||
			this.session.isBashRunning;
		const showInterrupt =
			options?.showInterruptHint === true || (options?.showInterruptHint !== false && agentActive);
		const customHint = this.workingMessage?.trim();
		const parts: string[] = [];
		if (customHint) parts.push(customHint);
		if (showInterrupt) parts.push("(esc to interrupt)");
		const message = formatAnimationMessage(next, {
			hint: parts.length > 0 ? parts.join(" ") : undefined,
		});
		const indicator = animationLoaderOptions(next, requestedName);
		this.workingIndicatorOptions = indicator;

		const canShow = agentActive || this.activeStatusIndicator?.kind === "working";

		if (this.activeStatusIndicator?.kind === "working") {
			// Only swap frames when the animation id changes — streaming updates
			// must not restart the cycle at frame 0.
			if (phaseChanged) {
				this.activeStatusIndicator.setIndicator(indicator);
			}
			this.activeStatusIndicator.setMessage(message);
		} else if (canShow) {
			this.showStatusIndicator(new WorkingStatusIndicator(this.ui, message, indicator));
		}
		// Keep keyboard focus on the editor so esc-to-interrupt always works.
		if (
			this.editor &&
			!this.editorSurfaceLocked &&
			!this.extensionSelector &&
			!this.extensionInput &&
			!this.extensionEditor &&
			(this.session.isStreaming || this.pendingTools.size > 0 || this.session.isBashRunning) &&
			!this.isEditorFocused()
		) {
			this.ui.setFocus(this.editor as Component);
		}
		// Never force: the diff handles the strip change; a forced render would
		// reset the render baseline and full-clear the screen on every chip
		// change (the flicker). Phase changes are rare; the throttle is irrelevant.
		this.ui.requestRender();
	}

	private clearExtensionActivityOverride(): void {
		if (this.extensionActivityOverride === undefined) return;
		this.extensionActivityOverride = undefined;
		this.extensionToolComponentsHidden = false;
		// Restore to the current tool-derived phase, or Working if idle.
		if (this.pendingTools.size > 0) {
			this.setPorcupineActivity(this.activityPhase);
		} else {
			this.setPorcupineActivity("working");
		}
	}

	/** True when the tool name belongs to a loaded extension (not a built-in). */
	private isExtensionTool(toolName: string): boolean {
		const runner = this.session?.extensionRunner;
		if (!runner) return false;
		return runner.getAllRegisteredTools().some((tool) => tool.definition.name === toolName);
	}

	private setHiddenThinkingLabel(label?: string): void {
		this.hiddenThinkingLabel = label ?? this.defaultHiddenThinkingLabel;
		for (const child of this.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHiddenThinkingLabel(this.hiddenThinkingLabel);
			}
		}
		if (this.streamingComponent) {
			this.streamingComponent.setHiddenThinkingLabel(this.hiddenThinkingLabel);
		}
		this.ui.requestRender();
	}

	/**
	 * Set an extension widget (string array or custom component).
	 */
	private setExtensionWidget(
		key: string,
		content: string[] | ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
		options?: ExtensionWidgetOptions,
	): void {
		const placement = options?.placement ?? "aboveEditor";
		const removeExisting = (map: Map<string, Component & { dispose?(): void }>) => {
			const existing = map.get(key);
			if (existing?.dispose) existing.dispose();
			map.delete(key);
		};

		removeExisting(this.extensionWidgetsAbove);
		removeExisting(this.extensionWidgetsBelow);

		if (content === undefined) {
			this.renderWidgets();
			return;
		}

		let component: Component & { dispose?(): void };

		if (Array.isArray(content)) {
			// Wrap string array in a Container with Text components
			const container = new Container();
			for (const line of content.slice(0, InteractiveMode.MAX_WIDGET_LINES)) {
				container.addChild(new Text(line, 1, 0));
			}
			if (content.length > InteractiveMode.MAX_WIDGET_LINES) {
				container.addChild(new Text(theme.fg("muted", "... (widget truncated)"), 1, 0));
			}
			component = container;
		} else {
			// Factory function - create component
			component = content(this.ui, theme);
		}

		const targetMap = placement === "belowEditor" ? this.extensionWidgetsBelow : this.extensionWidgetsAbove;
		targetMap.set(key, component);
		this.renderWidgets();
	}

	private clearExtensionWidgets(): void {
		for (const widget of this.extensionWidgetsAbove.values()) {
			widget.dispose?.();
		}
		for (const widget of this.extensionWidgetsBelow.values()) {
			widget.dispose?.();
		}
		this.extensionWidgetsAbove.clear();
		this.extensionWidgetsBelow.clear();
		this.renderWidgets();
	}

	private resetExtensionUI(): void {
		if (this.extensionSelector) {
			this.hideExtensionSelector();
		}
		if (this.extensionInput) {
			this.hideExtensionInput();
		}
		if (this.extensionEditor) {
			this.hideExtensionEditor();
		}
		this.ui.hideOverlay();
		this.clearExtensionTerminalInputListeners();
		this.setExtensionFooter(undefined);
		this.setExtensionHeader(undefined);
		this.clearExtensionWidgets();
		this.footerDataProvider.clearExtensionStatuses();
		this.footer.invalidate();
		this.autocompleteProviderWrappers = [];
		this.setCustomEditorComponent(undefined);
		this.setupAutocompleteProvider();
		this.defaultEditor.onExtensionShortcut = undefined;
		this.updateTerminalTitle();
		this.workingMessage = undefined;
		this.workingVisible = true;
		this.activityEasterEgg = undefined;
		// Don't paint a status chip during extension UI reset unless a turn is live.
		if (this.session.isStreaming || this.pendingTools.size > 0) {
			this.setPorcupineActivity("working", { showInterruptHint: true });
		}
		this.setHiddenThinkingLabel();
	}

	// Maximum total widget lines to prevent viewport overflow
	private static readonly MAX_WIDGET_LINES = 10;

	/**
	 * Render all extension widgets to the widget container.
	 */
	private renderWidgets(): void {
		if (!this.widgetContainerAbove || !this.widgetContainerBelow) return;
		this.renderWidgetContainer(this.widgetContainerAbove, this.extensionWidgetsAbove, true, true);
		this.renderWidgetContainer(this.widgetContainerBelow, this.extensionWidgetsBelow, false, false);
		this.ui.requestRender();
	}

	private renderWidgetContainer(
		container: Container,
		widgets: Map<string, Component & { dispose?(): void }>,
		spacerWhenEmpty: boolean,
		leadingSpacer: boolean,
	): void {
		container.clear();

		if (widgets.size === 0) {
			if (spacerWhenEmpty) {
				container.addChild(new Spacer(1));
			}
			return;
		}

		if (leadingSpacer) {
			container.addChild(new Spacer(1));
		}
		for (const component of widgets.values()) {
			container.addChild(component);
		}
	}

	/**
	 * Set a custom footer component, or restore the built-in footer.
	 */
	private setExtensionFooter(
		factory:
			| ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
			| undefined,
	): void {
		// Dispose existing custom footer
		if (this.customFooter?.dispose) {
			this.customFooter.dispose();
		}

		this.footerContainer.clear();
		if (factory) {
			// Create and add custom footer, passing the data provider
			this.customFooter = factory(this.ui, theme, this.footerDataProvider);
			this.footerContainer.addChild(this.customFooter);
		} else {
			// Restore built-in footer
			this.customFooter = undefined;
			this.footerContainer.addChild(this.footer);
		}

		this.ui.requestRender();
	}

	/**
	 * Set a custom header component, or restore the built-in header.
	 */
	private setExtensionHeader(factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined): void {
		// Header may not be initialized yet if called during early initialization
		if (!this.builtInHeader) {
			return;
		}

		// Dispose existing custom header
		if (this.customHeader?.dispose) {
			this.customHeader.dispose();
		}

		// Find the index of the current header in the header container
		const currentHeader = this.customHeader || this.builtInHeader;
		const index = this.headerContainer.children.indexOf(currentHeader);

		if (factory) {
			// Create and add custom header
			this.customHeader = factory(this.ui, theme);
			if (isExpandable(this.customHeader)) {
				this.customHeader.setExpanded(this.toolOutputExpanded);
			}
			if (index !== -1) {
				this.headerContainer.children[index] = this.customHeader;
			} else {
				// If not found (e.g. builtInHeader was never added), add at the top
				this.headerContainer.children.unshift(this.customHeader);
			}
		} else {
			// Restore built-in header
			this.customHeader = undefined;
			if (isExpandable(this.builtInHeader)) {
				this.builtInHeader.setExpanded(this.toolOutputExpanded);
			}
			if (index !== -1) {
				this.headerContainer.children[index] = this.builtInHeader;
			}
		}

		this.ui.requestRender();
	}

	private addExtensionTerminalInputListener(
		handler: (data: string) => { consume?: boolean; data?: string } | undefined,
	): () => void {
		const unsubscribe = this.ui.addInputListener(handler);
		this.extensionTerminalInputUnsubscribers.add(unsubscribe);
		return () => {
			unsubscribe();
			this.extensionTerminalInputUnsubscribers.delete(unsubscribe);
		};
	}

	private clearExtensionTerminalInputListeners(): void {
		for (const unsubscribe of this.extensionTerminalInputUnsubscribers) {
			unsubscribe();
		}
		this.extensionTerminalInputUnsubscribers.clear();
	}

	/**
	 * Create the ExtensionUIContext for extensions.
	 */
	private createProjectTrustContext(cwd: string): ProjectTrustContext {
		const ui = this.createExtensionUIContext();
		return {
			cwd,
			mode: "tui",
			hasUI: true,
			ui: {
				select: ui.select,
				confirm: ui.confirm,
				input: ui.input,
				notify: ui.notify,
			},
		};
	}

	private createExtensionUIContext(): ExtensionUIContext {
		return {
			// When any remote bridge is live, dialogs race TUI + every channel (first
			// response wins); the closures read the bridges at call time so this
			// works regardless of when a bridge starts. The TUI prompt is created
			// ONCE and shared so the selector/input does not open N times.
			select: (title, options, opts) => {
				const bridges = this.remoteBridges;
				if (bridges.length === 0) return this.showExtensionSelector(title, options, opts);
				const tuiPromise = this.showExtensionSelector(title, options, opts);
				const candidates: Promise<string | undefined>[] = [tuiPromise];
				for (const bridge of bridges) {
					candidates.push(bridge.select(title, options, () => tuiPromise, opts));
				}
				return Promise.race(candidates);
			},
			confirm: (title, message, opts) => this.showExtensionConfirm(title, message, opts),
			input: (title, placeholder, opts) => {
				const bridges = this.remoteBridges;
				if (bridges.length === 0) return this.showExtensionInput(title, placeholder, opts);
				const tuiPromise = this.showExtensionInput(title, placeholder, opts);
				const candidates: Promise<string | undefined>[] = [tuiPromise];
				for (const bridge of bridges) {
					candidates.push(bridge.input(title, () => tuiPromise, opts));
				}
				return Promise.race(candidates);
			},
			notify: (message, type) => this.showExtensionNotify(message, type),
			onTerminalInput: (handler) => this.addExtensionTerminalInputListener(handler),
			setStatus: (key, text) => this.setExtensionStatus(key, text),
			setWorkingMessage: (message) => {
				this.workingMessage = message;
				if (this.activeStatusIndicator?.kind === "working") {
					// Frames already carry the label; optional custom text + (esc to interrupt).
					const customHint = message?.trim();
					const agentActive =
						this.session.isStreaming ||
						this.session.isCompacting ||
						this.pendingTools.size > 0 ||
						this.session.isBashRunning;
					const parts: string[] = [];
					if (customHint) parts.push(customHint);
					if (agentActive) parts.push("(esc to interrupt)");
					this.activeStatusIndicator.setMessage(parts.join(" "));
				}
				this.ui.requestRender();
			},
			setWorkingVisible: (visible) => this.setWorkingVisible(visible),
			setWorkingIndicator: (options) => this.setWorkingIndicator(options),
			setHiddenThinkingLabel: (label) => this.setHiddenThinkingLabel(label),
			setWidget: (key, content, options) => this.setExtensionWidget(key, content, options),
			setFooter: (factory) => this.setExtensionFooter(factory),
			setHeader: (factory) => this.setExtensionHeader(factory),
			setTitle: (title) => this.ui.terminal.setTitle(title),
			custom: (factory, options) => this.showExtensionCustom(factory, options),
			pasteToEditor: (text) => this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
			setEditorText: (text) => this.editor.setText(text),
			getEditorText: () => this.editor.getExpandedText?.() ?? this.editor.getText(),
			editor: (title, prefill) => this.showExtensionEditor(title, prefill),
			addAutocompleteProvider: (factory) => {
				this.autocompleteProviderWrappers.push(factory);
				this.setupAutocompleteProvider();
			},
			setEditorComponent: (factory) => this.setCustomEditorComponent(factory),
			getEditorComponent: () => this.editorComponentFactory,
			get theme() {
				return theme;
			},
			getAllThemes: () => getAvailableThemesWithPaths(),
			getTheme: (name) => getThemeByName(name),
			setTheme: (themeOrName) => {
				if (themeOrName instanceof Theme) {
					return this.themeController.setThemeInstance(themeOrName);
				}
				const result = this.themeController.setThemeName(themeOrName);
				if (result.success) {
					if (this.settingsManager.getTheme() !== themeOrName) {
						this.settingsManager.setTheme(themeOrName);
					}
				}
				return result;
			},
			getToolsExpanded: () => this.toolOutputExpanded,
			setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
		};
	}

	/**
	 * Show a selector for extensions.
	 */
	private showExtensionSelector(
		title: string,
		options: string[],
		opts?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return new Promise((resolve) => {
			if (opts?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const onAbort = () => {
				this.hideExtensionSelector();
				resolve(undefined);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			this.extensionSelector = new ExtensionSelectorComponent(
				title,
				options,
				(option) => {
					opts?.signal?.removeEventListener("abort", onAbort);
					this.hideExtensionSelector();
					resolve(option);
				},
				() => {
					opts?.signal?.removeEventListener("abort", onAbort);
					this.hideExtensionSelector();
					resolve(undefined);
				},
				{
					tui: this.ui,
					timeout: opts?.timeout,
					onToggleToolsExpanded: () => this.toggleToolOutputExpansion(),
				},
			);

			this.editorContainer.clear();
			this.editorContainer.addChild(this.extensionSelector);
			this.ui.setFocus(this.extensionSelector);
			this.ui.requestRender();
		});
	}

	/**
	 * Hide the extension selector.
	 */
	private hideExtensionSelector(): void {
		this.extensionSelector?.dispose();
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.extensionSelector = undefined;
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Show a confirmation dialog for extensions.
	 */
	private async showExtensionConfirm(
		title: string,
		message: string,
		opts?: ExtensionUIDialogOptions,
	): Promise<boolean> {
		const result = await this.showExtensionSelector(`${title}\n${message}`, ["Yes", "No"], opts);
		return result === "Yes";
	}

	private async promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
		const confirmed = await this.showExtensionConfirm(
			"Session cwd not found",
			formatMissingSessionCwdPrompt(error.issue),
		);
		return confirmed ? error.issue.fallbackCwd : undefined;
	}

	/**
	 * Show a text input for extensions.
	 */
	private showExtensionInput(
		title: string,
		placeholder?: string,
		opts?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return new Promise((resolve) => {
			if (opts?.signal?.aborted) {
				resolve(undefined);
				return;
			}

			const onAbort = () => {
				this.hideExtensionInput();
				resolve(undefined);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			this.extensionInput = new ExtensionInputComponent(
				title,
				placeholder,
				(value) => {
					opts?.signal?.removeEventListener("abort", onAbort);
					this.hideExtensionInput();
					resolve(value);
				},
				() => {
					opts?.signal?.removeEventListener("abort", onAbort);
					this.hideExtensionInput();
					resolve(undefined);
				},
				{ tui: this.ui, timeout: opts?.timeout },
			);

			this.editorContainer.clear();
			this.editorContainer.addChild(this.extensionInput);
			this.ui.setFocus(this.extensionInput);
			this.ui.requestRender();
		});
	}

	/**
	 * Hide the extension input.
	 */
	private hideExtensionInput(): void {
		this.extensionInput?.dispose();
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.extensionInput = undefined;
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Show a multi-line editor for extensions (with Ctrl+G support).
	 */
	private showExtensionEditor(title: string, prefill?: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			this.extensionEditor = new ExtensionEditorComponent(
				this.ui,
				this.keybindings,
				title,
				prefill,
				(value) => {
					this.hideExtensionEditor();
					resolve(value);
				},
				() => {
					this.hideExtensionEditor();
					resolve(undefined);
				},
				undefined,
				this.settingsManager.getExternalEditorCommand(),
			);

			this.editorContainer.clear();
			this.editorContainer.addChild(this.extensionEditor);
			this.ui.setFocus(this.extensionEditor);
			this.ui.requestRender();
		});
	}

	/**
	 * Hide the extension editor.
	 */
	private hideExtensionEditor(): void {
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.extensionEditor = undefined;
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Set a custom editor component from an extension.
	 * Pass undefined to restore the default editor.
	 */
	private setCustomEditorComponent(factory: EditorFactory | undefined): void {
		this.editorComponentFactory = factory;

		// Save text from current editor before switching
		const currentText = this.editor.getText();

		// During /refresh or /reload the editor surface holds a status box — only
		// update the editor object; dismiss* will mount it when the box goes away.
		const mountInContainer = !this.editorSurfaceLocked;
		if (mountInContainer) {
			this.editorContainer.clear();
		}

		if (factory) {
			// Create the custom editor with tui, theme, and keybindings
			const newEditor = factory(this.ui, getEditorTheme(), this.keybindings);

			// Wire up callbacks from the default editor
			newEditor.onSubmit = this.defaultEditor.onSubmit;
			newEditor.onChange = this.defaultEditor.onChange;

			// Copy text from previous editor
			newEditor.setText(currentText);

			// Copy appearance settings if supported
			if (newEditor.borderColor !== undefined) {
				newEditor.borderColor = this.defaultEditor.borderColor;
			}
			if (newEditor.setPaddingX !== undefined) {
				newEditor.setPaddingX(this.defaultEditor.getPaddingX());
			}
			if (newEditor.setAutocompleteMaxVisible !== undefined) {
				newEditor.setAutocompleteMaxVisible(this.defaultEditor.getAutocompleteMaxVisible());
			}

			// Set autocomplete if supported
			if (newEditor.setAutocompleteProvider && this.autocompleteProvider) {
				newEditor.setAutocompleteProvider(this.autocompleteProvider);
			}

			// If extending CustomEditor, copy app-level handlers
			// Use duck typing since instanceof fails across jiti module boundaries
			const customEditor = newEditor as unknown as Record<string, unknown>;
			if ("actionHandlers" in customEditor && customEditor.actionHandlers instanceof Map) {
				if (!customEditor.onEscape) {
					customEditor.onEscape = () => this.defaultEditor.onEscape?.();
				}
				if (!customEditor.onCtrlD) {
					customEditor.onCtrlD = () => this.defaultEditor.onCtrlD?.();
				}
				if (!customEditor.onPasteImage) {
					customEditor.onPasteImage = () => this.defaultEditor.onPasteImage?.();
				}
				if (!customEditor.onExtensionShortcut) {
					customEditor.onExtensionShortcut = (data: string) => this.defaultEditor.onExtensionShortcut?.(data);
				}
				// Copy action handlers (clear, suspend, model switching, etc.)
				for (const [action, handler] of this.defaultEditor.actionHandlers) {
					(customEditor.actionHandlers as Map<string, () => void>).set(action, handler);
				}
			}

			this.editor = newEditor;
		} else {
			// Restore default editor with text from custom editor
			this.defaultEditor.setText(currentText);
			this.editor = this.defaultEditor;
		}

		if (mountInContainer) {
			this.editorContainer.addChild(this.editor as Component);
			this.ui.setFocus(this.editor as Component);
		}
		this.ui.requestRender();
	}

	/**
	 * Show a notification for extensions.
	 */
	private showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.showError(message);
		} else if (type === "warning") {
			this.showWarning(message);
		} else {
			this.showStatus(message);
		}
	}

	/** Show a custom component with keyboard focus. Overlay mode renders on top of existing content. */
	private async showExtensionCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
		options?: {
			overlay?: boolean;
			overlayOptions?: OverlayOptions | (() => OverlayOptions);
			onHandle?: (handle: OverlayHandle) => void;
		},
	): Promise<T> {
		const savedText = this.editor.getText();
		const isOverlay = options?.overlay ?? false;
		// Same guard as showMarkdownViewer: never stack a second overlay on top
		// of an open one (focus stealing + z-order corruption).
		if (isOverlay && this.ui.hasOverlay()) {
			this.showWarning("Another dialog is already open.");
			return undefined as T;
		}

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.editor.setText(savedText);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		return new Promise((resolve, reject) => {
			let component: Component & { dispose?(): void };
			let closed = false;

			const close = (result: T) => {
				if (closed) return;
				closed = true;
				if (isOverlay) this.ui.hideOverlay();
				else restoreEditor();
				// Note: both branches above already call requestRender
				resolve(result);
				try {
					component?.dispose?.();
				} catch {
					/* ignore dispose errors */
				}
			};

			Promise.resolve(factory(this.ui, theme, this.keybindings, close))
				.then((c) => {
					if (closed) return;
					component = c;
					if (isOverlay) {
						// Resolve overlay options - can be static or dynamic function
						const resolveOptions = (): OverlayOptions | undefined => {
							if (options?.overlayOptions) {
								const opts =
									typeof options.overlayOptions === "function"
										? options.overlayOptions()
										: options.overlayOptions;
								return opts;
							}
							// Fallback: use component's width property if available
							const w = (component as { width?: number }).width;
							return w ? { width: w } : undefined;
						};
						const handle = this.ui.showOverlay(component, resolveOptions());
						// Expose handle to caller for visibility control
						options?.onHandle?.(handle);
					} else {
						this.editorContainer.clear();
						this.editorContainer.addChild(component);
						this.ui.setFocus(component);
						this.ui.requestRender();
					}
				})
				.catch((err) => {
					if (closed) return;
					if (!isOverlay) restoreEditor();
					reject(err);
				});
		});
	}

	/**
	 * Show an extension error in the UI.
	 */
	private showExtensionError(extensionPath: string, error: string, stack?: string): void {
		const errorMsg = `Extension "${extensionPath}" error: ${error}`;
		const errorText = new Text(theme.fg("error", errorMsg), 1, 0);
		this.chatContainer.addChild(errorText);
		if (stack) {
			// Show stack trace in dim color, indented
			const stackLines = stack
				.split("\n")
				.slice(1) // Skip first line (duplicates error message)
				.map((line) => theme.fg("dim", `  ${line.trim()}`))
				.join("\n");
			if (stackLines) {
				this.chatContainer.addChild(new Text(stackLines, 1, 0));
			}
		}
		this.ui.requestRender();
	}

	// =========================================================================
	// Key Handlers
	// =========================================================================

	/** True when the live editor currently has TUI focus (including custom editors). */
	private isEditorFocused(): boolean {
		const ed = this.editor as { focused?: boolean };
		return ed.focused === true;
	}

	/**
	 * Escape / app.interrupt behavior shared by the editor and a global fallback
	 * when focus has left the editor during a run.
	 */
	private handleInterruptKey(): void {
		if (this.session.isStreaming) {
			this.restoreQueuedMessagesToEditor({ abort: true });
			// Ensure the editor can receive keys again after abort.
			this.ui.setFocus(this.editor as Component);
			return;
		}
		if (this.session.isBashRunning) {
			this.session.abortBash();
			this.ui.setFocus(this.editor as Component);
			return;
		}
		if (this.isBashMode) {
			this.editor.setText("");
			this.isBashMode = false;
			this.updateEditorBorderColor();
			return;
		}
		// Escape with idle background sub-agents stops them (empty editor).
		if (!this.editor.getText().trim() && this.session.cancelAllSubagents()) {
			this.showStatus("⏹ Sub-agents cancelled");
			this.ui.setFocus(this.editor as Component);
			return;
		}
		if (!this.editor.getText().trim()) {
			// Double-escape with empty editor triggers /tree, /fork, or nothing based on setting
			const action = this.settingsManager.getDoubleEscapeAction();
			if (action !== "none") {
				const now = Date.now();
				if (now - this.lastEscapeTime < 500) {
					if (action === "tree") {
						this.showTreeSelector();
					} else {
						this.showUserMessageSelector();
					}
					this.lastEscapeTime = 0;
				} else {
					this.lastEscapeTime = now;
				}
			}
		}
	}

	private setupKeyHandlers(): void {
		// Set up handlers on defaultEditor - they use this.editor for text access
		// so they work correctly regardless of which editor is active
		this.defaultEditor.onEscape = () => {
			this.handleInterruptKey();
		};

		// Voice Mode push-to-talk: a plain Space press (empty editor) toggles
		// recording when /voice is enabled. Consumed so it never types into the
		// editor. Terminals send no keyup, so Space is a toggle, not hold-to-talk.
		this.ui.addInputListener((data) => {
			if (!this.voiceEnabled || data !== " " || !this.isEditorFocused()) {
				return undefined;
			}
			if (this.editor.getText().trim().length > 0) {
				return undefined; // user is typing — space types normally
			}
			if (this.session.isStreaming || this.session.isBashRunning || this.session.isCompacting) {
				this.showStatus("Agent is busy — your voice command will be sent after this turn");
				return { consume: true };
			}
			void this.toggleVoiceCapture();
			return { consume: true };
		});

		// Global interrupt: esc must work even if focus left the editor (status box,
		// refresh banner, extension widget, etc.). When the editor is focused it already
		// handles app.interrupt — skip so autocomplete cancel still works.
		// Call the live onEscape (compaction/retry may temporarily replace it).
		this.ui.addInputListener((data) => {
			if (!this.keybindings.matches(data, "app.interrupt")) {
				return undefined;
			}
			if (this.isEditorFocused()) {
				return undefined;
			}
			if (
				this.session.isStreaming ||
				this.session.isBashRunning ||
				this.session.isCompacting ||
				this.activeStatusIndicator?.kind === "retry" ||
				this.activeStatusIndicator?.kind === "compaction"
			) {
				this.defaultEditor.onEscape?.();
				return { consume: true };
			}
			return undefined;
		});

		// Register app action handlers
		this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
		this.defaultEditor.onCtrlD = () => this.handleCtrlD();
		this.defaultEditor.onAction("app.suspend", () => this.handleCtrlZ());
		this.defaultEditor.onAction("app.thinking.cycle", () => this.cycleThinkingLevel());
		this.defaultEditor.onAction("app.model.cycleForward", () => this.cycleModel("forward"));
		this.defaultEditor.onAction("app.model.cycleBackward", () => this.cycleModel("backward"));

		// Global debug handler on TUI (works regardless of focus)
		this.ui.onDebug = () => this.handleDebugCommand();
		this.defaultEditor.onAction("app.model.select", () => this.showModelSelector());
		this.defaultEditor.onAction("app.tools.expand", () => this.toggleToolOutputExpansion());
		this.defaultEditor.onAction("app.thinking.toggle", () => this.toggleThinkingBlockVisibility());
		this.defaultEditor.onAction("app.editor.external", () => void this.handleOpenExternalEditor());
		this.defaultEditor.onAction("app.message.copy", () => void this.handleCopyCommand());
		this.defaultEditor.onAction("app.message.followUp", () => this.handleFollowUp());
		this.defaultEditor.onAction("app.message.dequeue", () => this.handleDequeue());
		this.defaultEditor.onAction("app.session.new", () => this.handleClearCommand());
		this.defaultEditor.onAction("app.session.tree", () => this.showTreeSelector());
		this.defaultEditor.onAction("app.session.fork", () => this.showUserMessageSelector());
		this.defaultEditor.onAction("app.session.resume", () => this.showSessionSelector());

		this.defaultEditor.onChange = (text: string) => {
			const wasBashMode = this.isBashMode;
			this.isBashMode = text.trimStart().startsWith("!");
			if (wasBashMode !== this.isBashMode) {
				this.updateEditorBorderColor();
			}
		};

		// Handle clipboard paste (triggered on Ctrl+V). Images are attached by path;
		// otherwise, paste plain text from the system clipboard.
		this.defaultEditor.onPasteImage = () => {
			void this.handleClipboardPaste();
		};
	}

	private async handleClipboardPaste(): Promise<void> {
		try {
			const image = await readClipboardImage();
			if (image) {
				const tmpDir = os.tmpdir();
				const ext = extensionForImageMimeType(image.mimeType) ?? "png";
				const fileName = `porcupine-clipboard-${crypto.randomUUID()}.${ext}`;
				const filePath = path.join(tmpDir, fileName);
				fs.writeFileSync(filePath, Buffer.from(image.bytes));

				this.editor.insertTextAtCursor?.(filePath);
				this.ui.requestRender();
				return;
			}

			const text = await readClipboardText();
			if (text) {
				this.editor.insertTextAtCursor?.(text);
				this.ui.requestRender();
			}
		} catch {
			// Silently ignore clipboard errors (may not have permission, etc.)
		}
	}

	private setupEditorSubmitHandler(): void {
		this.defaultEditor.onSubmit = async (text: string) => {
			text = text.trim();
			if (!text) return;

			// Handle commands
			if (text === "/settings") {
				this.showSettingsSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/scoped-models") {
				this.editor.setText("");
				await this.showModelsSelector();
				return;
			}
			if (text === "/model" || text.startsWith("/model ")) {
				const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
				this.editor.setText("");
				await this.handleModelCommand(searchTerm);
				return;
			}
			if (text === "/export" || text.startsWith("/export ")) {
				await this.handleExportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/import" || text.startsWith("/import ")) {
				await this.handleImportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/share") {
				await this.handleShareCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/copy") {
				await this.handleCopyCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/name" || text.startsWith("/name ")) {
				this.handleNameCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/session") {
				this.handleSessionCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/changelog") {
				this.handleChangelogCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/hotkeys") {
				this.handleHotkeysCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/fork") {
				this.showUserMessageSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/clone") {
				this.editor.setText("");
				await this.handleCloneCommand();
				return;
			}
			if (text === "/tree") {
				this.showTreeSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/trust") {
				this.showTrustSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/login" || text.startsWith("/login ")) {
				const providerRef = text.startsWith("/login ") ? text.slice(7).trim() : undefined;
				this.editor.setText("");
				await this.handleLoginCommand(providerRef);
				return;
			}
			if (text === "/logout") {
				this.showOAuthSelector("logout");
				this.editor.setText("");
				return;
			}

			if (text === "/kill") {
				this.editor.setText("");
				this.handleKillCommand();
				return;
			}
			if (text.startsWith("/view ")) {
				const viewPath = text.slice("/view ".length).trim();
				this.editor.setText("");
				if (!viewPath) {
					this.showWarning("Usage: /view <path>");
					return;
				}
				await this.handleViewCommand(viewPath);
				return;
			}

			if (text === "/guide" || text.startsWith("/guide ")) {
				this.handleGuideCommand(text);
				this.editor.setText("");
				return;
			}
			const reasoningVisibilityCommand = parseReasoningVisibilityCommand(text);
			if (reasoningVisibilityCommand) {
				this.editor.setText("");
				this.handleReasoningVisibilityCommand(reasoningVisibilityCommand);
				return;
			}
			const learningCommand = parseLearningCommand(text);
			if (learningCommand) {
				this.editor.setText("");
				this.handleLearningCommand(learningCommand);
				return;
			}
			if (text === "/refine" || text.startsWith("/refine ")) {
				this.editor.setText("");
				await this.handleRefineCommand();
				return;
			}
			if (text.startsWith("/mcpp:")) {
				this.editor.setText("");
				await this.handleMcpPromptCommand(text);
				return;
			}
			const goalCommand = parseGoalCommand(text);
			if (goalCommand) {
				this.editor.setText("");
				this.handleGoalCommand(goalCommand);
				return;
			}
			const planCommand = parsePlanCommand(text);
			if (planCommand) {
				this.editor.setText("");
				await this.handlePlanCommand(planCommand);
				return;
			}
			const taskCommand = parseTaskCommand(text);
			if (taskCommand) {
				this.editor.setText("");
				await this.handleTaskCommand(taskCommand);
				return;
			}
			const emailCommand = parseEmailCommand(text);
			if (emailCommand) {
				this.editor.setText("");
				await this.handleEmailCommand(emailCommand);
				return;
			}
			const cronCommand = parseCronCommand(text);
			if (cronCommand) {
				this.editor.setText("");
				await this.handleCronCommand(cronCommand);
				return;
			}
			if (
				text === "/reasoning" ||
				text.startsWith("/reasoning ") ||
				text === "/thinking" ||
				text.startsWith("/thinking ")
			) {
				this.editor.setText("");
				this.handleReasoningCommand(text);
				return;
			}
			if (text === "/new") {
				this.editor.setText("");
				await this.handleClearCommand();
				return;
			}
			if (text === "/modes") {
				this.showInteractionModeSelector();
				this.editor.setText("");
				return;
			}
			if (text.startsWith("/modes ")) {
				this.showWarning("Usage: /modes");
				this.editor.setText("");
				return;
			}
			if (text === "/auto" || text.startsWith("/auto ")) {
				this.handleAutoModeCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/sandbox" || text.startsWith("/sandbox ")) {
				this.editor.setText("");
				await this.handleSandboxCommand(text);
				return;
			}
			if (text === "/update") {
				this.editor.setText("");
				await this.handleUpdateCommand();
				return;
			}
			if (text === "/adaptive" || text.startsWith("/adaptive ")) {
				this.handleAdaptiveReasoningCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/stacks" || text.startsWith("/stacks ")) {
				this.handleStacksCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/extract-stack" || text.startsWith("/extract-stack ")) {
				this.editor.setText("");
				await this.handleExtractStackCommand(text);
				return;
			}
			if (text === "/craft-stack" || text.startsWith("/craft-stack ")) {
				this.editor.setText("");
				await this.handleCraftStackCommand(text);
				return;
			}
			if (text === "/projects" || text.startsWith("/projects ")) {
				this.handleProjectsCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/subagents" || text.startsWith("/subagents ")) {
				this.editor.setText("");
				void this.handleSubagentsCommand(text);
				return;
			}
			if (text === "/x" || text.startsWith("/x ")) {
				this.handleXCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/voice" || text.startsWith("/voice ")) {
				this.handleVoiceCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/compact" || text.startsWith("/compact ")) {
				const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
				this.editor.setText("");
				await this.handleCompactCommand(customInstructions);
				return;
			}
			if (text === "/reload") {
				this.editor.setText("");
				await this.handleReloadCommand();
				return;
			}
			const refreshCommand = parseRefreshCommand(text);
			if (refreshCommand) {
				this.editor.setText("");
				if (refreshCommand.kind === "invalid") {
					this.showWarning(refreshCommand.message);
				} else {
					await this.handleRefreshCommand();
				}
				return;
			}
			const restartCommand = parseRestartCommand(text);
			if (restartCommand) {
				this.editor.setText("");
				if (restartCommand.kind === "invalid") {
					this.showWarning(restartCommand.message);
				} else {
					await this.handleRestartCommand();
				}
				return;
			}
			if (text === "/debug") {
				this.handleDebugCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/arminsayshi") {
				this.handleArminSaysHi();
				this.editor.setText("");
				return;
			}
			if (text === "/dementedelves") {
				this.handleDementedDelves();
				this.editor.setText("");
				return;
			}
			if (text === "/resume") {
				this.showSessionSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/quit") {
				this.editor.setText("");
				await this.shutdown();
				return;
			}

			// Handle bash command (! for normal, !! for excluded from context)
			if (text.startsWith("!")) {
				const isExcluded = text.startsWith("!!");
				const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
				if (command) {
					if (this.session.isBashRunning) {
						this.showWarning("A bash command is already running. Press Esc to cancel it first.");
						this.editor.setText(text);
						return;
					}
					this.editor.addToHistory?.(text);
					await this.handleBashCommand(command, isExcluded);
					this.isBashMode = false;
					this.updateEditorBorderColor();
					return;
				}
			}

			// Queue input during compaction (extension commands execute immediately)
			if (this.session.isCompacting) {
				if (this.isExtensionCommand(text)) {
					this.editor.addToHistory?.(text);
					this.editor.setText("");
					await this.session.prompt(text);
				} else {
					this.queueCompactionMessage(text, "steer");
				}
				return;
			}

			// If streaming, use prompt() with steer behavior
			// This handles extension commands (execute immediately), prompt template expansion, and queueing
			if (this.session.isStreaming) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await this.session.prompt(text, { streamingBehavior: "steer" });
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
				return;
			}

			// Normal message submission
			// First, move any pending bash components to chat
			this.flushPendingBashComponents();

			if (this.onInputCallback) {
				this.onInputCallback(text);
			} else {
				this.pendingUserInputs.push(text);
			}
			this.editor.addToHistory?.(text);
		};
	}

	/**
	 * Subscribe to sub-agent progress events for the footer activity chip.
	 * Must be re-called on every session rebind — rebindCurrentSession swaps
	 * this.session, so a subscription captured in init() would go dead.
	 */
	private subscribeToSubagents(): void {
		this.subagentPanelUnsubscribe?.();
		this.subagentPanelUnsubscribe = this.session.onSubagentEvent(() => {
			const state = this.session.subagentState;
			// Footer sub-agent activity chip (the ONLY sub-agent UI): animate
			// "🤖(📄 Extracting, 🌐 Searching)" beside the 🧵 thread counter while
			// any worker runs. The status strip stays the main agent's.
			if (state.runs.length > 0 && this.session.runningSubagentCount > 0) {
				// Events fire densely, but the chip text only changes when a run's
				// phase / tool / tool-args change. Reuse the last-built frames when
				// the state is unchanged; keep the index reset + timer so the visual
				// rendering stays byte-for-byte identical to the prior per-event rebuild.
				const key = this.subagentFooterKey(state.runs);
				if (key !== this.subagentFooterChipKey) {
					this.subagentFooterChipKey = key;
					const indicator = this.subagentActivityIndicator(state.runs);
					this.subagentFooterFrames = indicator?.frames ?? undefined;
				}
				this.subagentFooterIndex = 0;
				this.startSubagentFooterTimer();
			} else {
				this.stopSubagentFooterTimer();
				this.subagentFooterFrames = undefined;
				this.subagentFooterChipKey = "";
			}
			this.ui.requestRender();
		});
	}

	private subscribeToAgent(): void {
		// Self-cleaning: drop any prior agent subscription first so rebinds can
		// never double-subscribe or leak a listener on the replaced session.
		this.unsubscribe?.();
		this.unsubscribe = this.session.subscribe(async (event) => {
			await this.handleEvent(event);
		});
	}

	/** Rebuild the Porcupine capability tree from the active session tools and skills. */
	private refreshCapabilityTree(): void {
		const tools = this.session.getAllTools().map((tool) => ({
			name: tool.name,
			description: tool.description,
			available: this.session.getActiveToolNames().includes(tool.name),
		}));
		const skills = this.session.resourceLoader.getSkills().skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			filePath: skill.filePath,
			stack: skill.stack,
			tags: skill.tags,
			available: true,
		}));
		this.capabilityTree = buildCapabilityTreeFromSession({ tools, skills });
	}

	private handleStacksCommand(text: string): void {
		this.refreshCapabilityTree();
		const query = text.replace(/^\/stacks\b/i, "").trim();
		const output = formatStacksCommandOutput(this.capabilityTree, query);
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("accent", "Stacks"), 1, 0));
		this.chatContainer.addChild(new Text(output, 1, 0));
		this.ui.requestRender();
	}

	private handleProjectsCommand(text: string): void {
		const query = text.replace(/^\/projects\b/i, "").trim();
		const output = formatProjectsCommandOutput(this.sessionManager.getCwd(), query);
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("accent", "Projects"), 1, 0));
		this.chatContainer.addChild(new Text(output, 1, 0));
		this.ui.requestRender();
	}

	/**
	 * /subagents [sessionId]
	 * Read-only recall of persisted sub-agent sessions. Without an id, lists the
	 * most recent runs; with an id, prints that run's transcript summary.
	 */
	private async handleSubagentsCommand(text: string): Promise<void> {
		const arg = text.replace(/^\/subagents\b/i, "").trim();
		try {
			const { listSubagentSessions } = await import("../../porcupine/subagent-sessions.ts");
			const { formatSubagentSessionList, formatSubagentSessionView } = await import(
				"../../porcupine/subagent-session-format.ts"
			);
			const sessionDir = this.sessionManager.getSessionDir();
			const sessions = await listSubagentSessions(sessionDir);
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("accent", "Sub-agents"), 1, 0));
			const output = arg ? formatSubagentSessionView(sessions, arg) : formatSubagentSessionList(sessions);
			this.chatContainer.addChild(new Text(output, 1, 0));
			this.ui.requestRender();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showWarning(`/subagents failed: ${message}`);
		}
	}

	private handleXCommand(text: string): void {
		void (async () => {
			const { runXCommand } = await import("../../porcupine/x-command.ts");
			const result = await runXCommand(text);
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("accent", "X"), 1, 0));
			this.chatContainer.addChild(new Text(result.output, 1, 0));
			this.ui.requestRender();
		})().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.showWarning(`/x failed: ${message}`);
		});
	}

	private handleVoiceCommand(text: string): void {
		const arg = text
			.replace(/^\/voice\b/i, "")
			.trim()
			.toLowerCase();
		if (arg === "off") {
			this.voiceEnabled = false;
			this.clearStatusIndicator();
			this.showStatus("Voice Mode off");
			return;
		}
		if (arg === "status" || arg === "") {
			this.showStatus(
				`Voice Mode ${this.voiceEnabled ? "on" : "off"}${this.voiceEnabled ? " — press Space (empty editor) to talk, Space again to send" : " — run /voice on to enable"}`,
			);
			return;
		}
		if (arg === "on" || !this.voiceEnabled) {
			this.voiceEnabled = true;
			this.ensureVoiceMode();
			this.showStatus(
				"Voice Mode on — press Space (with an empty editor) to record, Space again to send. First use downloads Moonshine (STT) + Kokoro (TTS).",
			);
			// Resolve + verify the mic NOW (once per session), not on the first
			// Space press — the probe can take a second or two and must not make
			// the first recording feel frozen or double-toggle.
			void this.ensureMicReady();
			return;
		}
		if (arg === "diag" || arg === "diagnose") {
			void this.runVoiceDiagnostics();
		}
	}

	/** Eagerly resolve the working mic so the first Space press is instant. */
	private async ensureMicReady(): Promise<void> {
		try {
			const settings = this.settingsManager.getVoiceSettings();
			const index = settings.inputDevice !== undefined ? settings.inputDevice : resolveMacMicIndex();
			const name = getDeviceName(index);
			this.showStatus(`🎤 Using ${name} — press Space (empty editor) to talk`);
		} catch {
			// Non-fatal: the recorder falls back to device 0 + the silence message.
		}
	}

	/** Full voice pipeline self-test — shows every step so failures are visible. */
	private async runVoiceDiagnostics(): Promise<void> {
		const voice = this.ensureVoiceMode();
		this.showStatus("🔍 Voice diagnostics…");
		const steps: string[] = [];
		try {
			const index = resolveMacMicIndex();
			steps.push(`Device: ${getDeviceName(index)} (index ${index})`);
		} catch (error) {
			steps.push(`Device resolution failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		steps.push("Recording 2 seconds — say something…");
		this.showStatus("🎤 Recording 2s for the diagnostic — say anything…");
		const recorder = startRecording((message) => steps.push(`Early error: ${message}`));
		await new Promise((resolve) => setTimeout(resolve, 2000));
		try {
			const wav = await recorder.stop();
			const { decodeWavToFloat32 } = await import("../../porcupine/voice/wav.ts");
			const pcm = decodeWavToFloat32(wav);
			let peak = 0;
			for (const sample of pcm) {
				if (Math.abs(sample) > peak) peak = Math.abs(sample);
			}
			steps.push(
				`Capture: ${(wav.length / 1024).toFixed(0)} KB, peak ${peak.toFixed(4)} ${peak < 0.0015 ? "— SILENT (permission or device issue)" : "— has sound"}`,
			);
			if (peak >= 0.0015) {
				steps.push("Transcribing…");
				const text = await voice.transcribe(wav);
				steps.push(`Transcription: ${text ? JSON.stringify(text) : "(empty — speak louder or check the mic)"}`);
			}
		} catch (error) {
			steps.push(`Capture failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		for (const step of steps) {
			this.showStatus(step);
		}
	}

	/** Lazily create the voice orchestrator (models download on first use). */
	private ensureVoiceMode(): VoiceMode {
		if (!this.voiceMode) {
			const settings = this.settingsManager.getVoiceSettings();
			this.voiceMode = new VoiceMode(
				{
					onStatus: (status) => {
						if (status) this.showStatus(status);
						// else: voice uses chat-based status lines only — never touch the
						// statusContainer, or an empty onStatus would wipe a running
						// working/compaction animation indicator.
					},
					onError: (message) => this.showError(message),
					onCapture: (wav) => void this.routeVoiceCapture(wav),
				},
				{
					sttModel: settings.sttModel,
					ttsVoice: settings.ttsVoice,
					autoSpeak: settings.autoSpeak,
					inputDevice: settings.inputDevice,
				},
			);
		}
		return this.voiceMode;
	}

	/** Route a finished capture (user Space or the 30s safety auto-stop). */
	private async routeVoiceCapture(wav: Buffer): Promise<void> {
		const activeModel = this.session.model;
		if (activeModel?.input?.includes("audio") === true) {
			// Native-audio model: send the WAV straight to the model (no STT).
			this.editor.setText("");
			await this.session.prompt("", {
				audio: [{ type: "audio", data: wav.toString("base64"), mimeType: "audio/wav" }],
			});
			return;
		}
		// Text-only model: Moonshine STT → transcription in the editor.
		const text = await this.ensureVoiceMode().transcribe(wav);
		if (text) {
			this.editor.setText(text);
			this.showStatus(`🎙️ "${text}" — press Enter to send, or edit it`);
		}
	}

	/** Space pressed (empty editor): start recording or stop + transcribe + prompt. */
	private async toggleVoiceCapture(): Promise<void> {
		const voice = this.ensureVoiceMode();
		const activeModel = this.session.model;
		const nativeAudio = activeModel?.input?.includes("audio") === true;

		if (!voice.isRecording) {
			// Starting a new capture.
			await voice.toggle();
			return;
		}

		if (nativeAudio) {
			// The model hears audio natively (same as images) — no STT round-trip.
			const wav = await voice.stopToWav();
			if (wav) await this.routeVoiceCapture(wav);
			return;
		}

		// Text-only model: Moonshine STT → transcription in the editor.
		const text = await voice.toggle();
		if (text) {
			this.editor.setText(text);
			this.showStatus(`🎙️ "${text}" — press Enter to send, or edit it`);
		}
	}

	private handleGuideCommand(text: string): void {
		const output = formatGuideCommandOutput(text);
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("accent", "Guide"), 1, 0));
		this.chatContainer.addChild(new Text(output, 1, 0));
		this.ui.requestRender();
	}

	private showTaskOutput(title: string, body: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.chatContainer.addChild(new Text(body, 1, 0));
		this.ui.requestRender();
	}

	private formatTaskList(): string {
		const tasks = this.taskStore.listTasks();
		if (tasks.length === 0) {
			return "No tasks yet. Add one with /task add <title> :: <prompt>.";
		}
		return tasks
			.map(
				(task) =>
					`• ${task.id}  [${task.status}]  ${task.title} (${task.runCount} run${task.runCount === 1 ? "" : "s"})`,
			)
			.join("\n");
	}

	private formatTaskDetail(taskId: string): string {
		const task = this.taskStore.getTask(taskId);
		if (!task) throw new Error(`Task not found: ${taskId}`);
		const runs = this.taskStore.listRuns(task.id);
		const history =
			runs.length === 0
				? "No runs yet."
				: runs
						.map(
							(run) =>
								`• ${run.id}  [${run.status}]  ${run.trigger.type}  ${run.startedAt}${run.error ? `\n  error: ${run.error}` : ""}`,
						)
						.join("\n");
		return `${task.title}\n${task.id}  [${task.status}]  ${task.runCount} run${task.runCount === 1 ? "" : "s"}\n\nPrompt\n${task.prompt}\n\nRun history\n${history}`;
	}

	private formatCronList(): string {
		const schedules = this.taskStore.listSchedules();
		if (schedules.length === 0) {
			return "No routines yet. Add one with /cron add <task-id> :: <minute hour day month weekday>.";
		}
		return schedules
			.map((schedule) => {
				const task = this.taskStore.getTask(schedule.taskId);
				return `• ${schedule.id}  [${schedule.enabled ? "active" : "paused"}]  ${schedule.expression} → ${task?.title ?? schedule.taskId}\n  next: ${schedule.nextRunAt}`;
			})
			.join("\n");
	}

	private async runStoredTask(taskId: string, trigger: TaskRunTrigger): Promise<void> {
		if (
			!isTaskDrainEligible({
				activeTaskRun: this.activeTaskRunId !== undefined,
				streaming: this.session.isStreaming,
				compacting: this.session.isCompacting,
				bashRunning: this.session.isBashRunning,
			})
		) {
			this.showWarning("A task can start only when Porcupine is idle.");
			return;
		}
		const task = this.taskStore.getTask(taskId);
		if (!task) {
			this.showWarning(`Task not found: ${taskId}`);
			return;
		}
		try {
			const run = this.taskStore.startRun(task.id, trigger);
			this.activeTaskRunId = run.id;
			this.showStatus(`Task running: ${task.title}`);
			await this.session.prompt(
				`## Porcupine Task: ${task.title}\n\n${task.prompt}\n\nReport a concise result when the task is complete.`,
			);
			const resultText = extractTaskRunResultText(this.session.agent.state.messages);
			this.taskStore.completeRun(run.id, resultText || "Completed (no text result).");
			this.showStatus(`Task completed: ${task.title}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// A claimed run that could not be adopted (e.g. another process won the
			// claim, or the task was paused between claim and start) must not block
			// the schedule forever — release it as failed.
			if (trigger.claimRunId) {
				try {
					this.taskStore.failClaimedRun(trigger.claimRunId, `Run never started: ${message}`);
				} catch {
					// Claim already finalized elsewhere — nothing to release.
				}
			}
			if (this.activeTaskRunId) {
				try {
					this.taskStore.failRun(this.activeTaskRunId, message);
				} catch {
					// Preserve the original task error; an already-finalized run needs no rewrite.
				}
			}
			this.showError(`Task failed: ${message}`);
		} finally {
			this.activeTaskRunId = undefined;
		}
	}

	private async handleTaskCommand(command: NonNullable<ReturnType<typeof parseTaskCommand>>): Promise<void> {
		if (command.kind === "invalid") {
			this.showWarning(command.message);
			return;
		}
		if (command.kind === "list") {
			this.showTaskOutput("Tasks", this.formatTaskList());
			return;
		}
		try {
			if (command.kind === "add") {
				const task = this.taskStore.createTask(command);
				this.showStatus(`Task saved: ${task.title} (${task.id})`);
			} else if (command.kind === "show") {
				this.showTaskOutput("Task", this.formatTaskDetail(command.taskId));
			} else if (command.kind === "run") {
				await this.runStoredTask(command.taskId, { type: "manual" });
			} else {
				const status = command.kind === "pause" ? "paused" : command.kind === "resume" ? "ready" : "cancelled";
				const task = this.taskStore.setTaskStatus(command.taskId, status);
				this.showStatus(`Task ${task.id} is ${task.status}.`);
			}
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private async handleCronCommand(command: NonNullable<ReturnType<typeof parseCronCommand>>): Promise<void> {
		if (command.kind === "invalid") {
			this.showWarning(command.message);
			return;
		}
		try {
			if (command.kind === "list") {
				this.showTaskOutput("Cron routines", this.formatCronList());
			} else if (command.kind === "add") {
				const schedule = this.taskStore.createSchedule(command);
				this.showStatus(`Cron routine saved: ${schedule.id}; next ${schedule.nextRunAt}`);
			} else if (command.kind === "run") {
				const schedule = this.taskStore.listSchedules().find((candidate) => candidate.id === command.scheduleId);
				if (!schedule) throw new Error(`Cron schedule not found: ${command.scheduleId}`);
				await this.runStoredTask(schedule.taskId, {
					type: "cron",
					scheduleId: schedule.id,
				});
			} else if (command.kind === "remove") {
				this.taskStore.removeSchedule(command.scheduleId);
				this.showStatus(`Cron routine removed: ${command.scheduleId}`);
			} else {
				const schedule = this.taskStore.setScheduleEnabled(command.scheduleId, command.kind === "resume");
				this.showStatus(`Cron routine ${schedule.id} is ${schedule.enabled ? "active" : "paused"}.`);
			}
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private async handleEmailCommand(command: NonNullable<ReturnType<typeof parseEmailCommand>>): Promise<void> {
		if (command.kind === "invalid") {
			this.showWarning(command.message);
			return;
		}
		const settings = this.settingsManager.getEmailSettings();
		if (!settings) {
			this.showWarning("Email is not configured. See packages/coding-agent/docs/email.md to set up IMAP/SMTP.");
			return;
		}
		try {
			const output = await buildEmailCommandOutput(command, {
				configured: true,
				connectInfo: {
					host: settings.host ?? "",
					user: settings.user ?? "",
					draftsFolder: settings.draftsFolder ?? "Drafts",
					sentFolder: settings.sentFolder ?? "Sent Mail",
				},
				getClient: async () => {
					const pass = await readSecret(getAgentDir(), EMAIL_KEYRING_SERVICE, settings.user ?? "");
					return createEmailClient({
						host: settings.host ?? "",
						port: settings.port ?? (settings.secure === false ? 143 : 993),
						secure: settings.secure ?? true,
						user: settings.user ?? "",
						pass,
						draftsFolder: settings.draftsFolder ?? "Drafts",
						sentFolder: settings.sentFolder ?? "Sent Mail",
						timeoutMs: settings.timeoutMs ?? 15000,
					});
				},
			});
			this.showTaskOutput("Email", output);
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private tickCronSchedules(): void {
		if (
			!isTaskDrainEligible({
				activeTaskRun: this.activeTaskRunId !== undefined,
				streaming: this.session.isStreaming,
				compacting: this.session.isCompacting,
				bashRunning: this.session.isBashRunning,
			})
		) {
			return;
		}
		const [schedule] = this.taskStore.claimDueSchedules(new Date(), 1);
		if (schedule) {
			void this.runStoredTask(schedule.taskId, {
				type: "cron",
				scheduleId: schedule.id,
				claimRunId: schedule.claimedRunId,
			});
			return;
		}
		// Agent/tool-queued manual runs (tasks tool action=run) drain when idle.
		const [queued] = this.taskStore.claimQueuedRuns(1);
		if (queued) {
			void this.runStoredTask(queued.taskId, { type: "manual", claimRunId: queued.id });
		}
	}

	/** Exposed for Porcupine routing UI and diagnostics. */
	getCapabilityTree(): CapabilityTree {
		return this.capabilityTree;
	}

	getTaskGraph() {
		return this.orchestrator.getTaskGraph();
	}

	private applyTaskGraphDisplay(): void {
		const graph = this.orchestrator.getTaskGraph();
		if (!this.taskGraphComponent) {
			this.taskGraphComponent = new TaskGraphComponent(graph);
			this.chatContainer.addChild(this.taskGraphComponent);
		} else {
			this.taskGraphComponent.setGraph(graph);
		}
		this.ui.requestRender();
	}

	private handlePorcupineRuntimeEvent(event: { type: string }): void {
		// Orchestrator phases are soft UI hints only. Never touch the strip while a
		// concrete tool animation is live — markStepForTool() emits step:start and
		// was wiping Reading/Writing/Editing back to Working on every tool call.
		if (this.pendingTools.size > 0 || isToolDrivenAnimation(this.activityPhase)) {
			return;
		}
		switch (event.type) {
			case "phase:analyze":
			case "phase:route":
			case "route:complete":
			case "phase:execute":
			case "step:start":
			case "phase:verify":
			case "verification:complete":
				this.setPorcupineActivity("working");
				break;
			case "phase:plan":
			case "plan:complete":
				this.setPorcupineActivity("thinking");
				break;
			case "phase:learn":
				this.setPorcupineActivity("updating");
				break;
			case "artifact:changed":
				break;
			default:
				break;
		}
	}

	/**
	 * Porcupine turn entry — Adaptive/Auto live on AgentSession.
	 * Planning / skill / tool choice is model personality (system prompt), not a
	 * forced pre-turn classifier. We only inject an explicit plan block when the
	 * user asks for planning; chit-chat stays quiet.
	 */
	private async promptWithPorcupine(text: string, options?: Parameters<AgentSession["prompt"]>[1]): Promise<void> {
		const trimmed = text.trim();
		if (trimmed && !trimmed.startsWith("/") && options?.streamingBehavior === undefined) {
			if (!isGoalContinuation(trimmed)) this.learningUserText = text;
		}
		const skip = trimmed.startsWith("/") || this.session.isStreaming || options?.streamingBehavior !== undefined;

		if (this.goalPlanState.goal?.status === "active" && !skip && !isPlanPrompt(trimmed)) {
			this.goalTurnInFlight = true;
		}

		if (skip) {
			await this.session.prompt(text, options);
			return;
		}

		if (this.goalPlanState.goal?.status === "active" && !isGoalContinuation(trimmed)) {
			await this.session.sendCustomMessage(
				{
					customType: "porcupine.standing-goal",
					content: [
						"[Porcupine standing goal]",
						this.goalPlanState.goal.text,
						"Keep this objective in view while answering the user's current request. Do not claim completion without verification.",
					].join("\n"),
					display: false,
				},
				{ deliverAs: "nextTurn" },
			);
		}

		// Soft activity only — never force skill search or planning.
		if (isTrivialChatTurn(trimmed)) {
			this.setPorcupineActivity("working");
		} else if (userRequestedPlanning(trimmed)) {
			this.refreshCapabilityTree();
			this.setPorcupineActivity("thinking");
			const turn = await this.orchestrator.prepareTurn(text);
			this.applyTaskGraphDisplay();
			const planNote = buildPersonalityReminder({ forcePlan: true });
			await this.session.sendCustomMessage(
				{
					customType: "porcupine.plan",
					content: [planNote, turn.contextBlock].filter(Boolean).join("\n\n"),
					display: false,
					details: {
						status: turn.prepare.status,
						objective: turn.prepare.intent.objective,
						route: turn.prepare.route.matches.map((match: { capability: { id: string } }) => match.capability.id),
						steps: turn.prepare.plan?.steps.map((step: { id: string }) => step.id) ?? [],
						requestedByUser: true,
					},
				},
				{ deliverAs: "nextTurn" },
			);
			this.orchestrator.markRunning();
			this.applyTaskGraphDisplay();
		} else {
			// Model-led turn: start with a clean graph; steps build dynamically
			// from actual tool calls (Option B dynamic task tracker).
			this.orchestrator.resetDynamicGraph();
			this.setPorcupineActivity(this.session.isAdaptiveReasoningEnabled ? "thinking" : "working");
		}

		await this.session.prompt(text, options);
	}

	private async handleEvent(event: AgentSessionEvent): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		this.footer.invalidate();

		switch (event.type) {
			case "agent_start":
				this.pendingTools.clear();
				this.learningToolEvidence = [];
				this.refreshCapabilityTree();
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(true);
				}
				// Restore main escape handler if retry handler is still active
				// (retry success event fires later, but we need main handler now)
				if (this.retryEscapeHandler) {
					this.defaultEditor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				if (this.workingVisible) {
					this.setPorcupineActivity("working", { showInterruptHint: true });
				} else {
					this.clearStatusIndicator();
				}
				this.ui.requestRender();
				break;

			case "queue_update":
				this.updatePendingMessagesDisplay();
				this.ui.requestRender();
				break;

			case "entry_appended":
				if (event.entry.type === "custom") {
					this.addCustomEntryToChat(event.entry);
					this.ui.requestRender();
				}
				break;

			case "session_info_changed":
				this.updateTerminalTitle();
				this.footer.invalidate();
				this.ui.requestRender();
				break;

			case "thinking_level_changed":
				this.footer.invalidate();
				this.updateEditorBorderColor();
				break;

			case "message_start":
				if (event.message.role === "custom") {
					this.addMessageToChat(event.message);
					this.ui.requestRender();
				} else if (event.message.role === "user") {
					this.addMessageToChat(event.message);
					this.updatePendingMessagesDisplay();
					this.ui.requestRender();
				} else if (event.message.role === "assistant") {
					this.setPorcupineActivity("thinking");
					this.streamingComponent = new AssistantMessageComponent(
						undefined,
						this.hideThinkingBlock,
						this.getMarkdownThemeWithSettings(),
						this.hiddenThinkingLabel,
						this.outputPad,
						this.getMarkdownTransformers(),
					);
					this.streamingMessage = event.message;
					this.chatContainer.addChild(this.streamingComponent);
					this.streamingComponent.updateContent(this.streamingMessage, true);
					this.ui.requestRender();
				}
				break;

			case "message_update":
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingMessage = event.message;
					// Streaming updates re-parse the whole accumulated markdown from
					// scratch (clear + new Markdown per block): one parse per token
					// batch is O(n^2) in stream length. Throttle mid-stream parses;
					// message_end always performs the final full parse.
					const now = performance.now();
					if (
						this.streamingLastParseAt === undefined ||
						now - this.streamingLastParseAt >= InteractiveMode.STREAMING_PARSE_INTERVAL_MS
					) {
						this.streamingLastParseAt = now;
						this.streamingComponent.updateContent(this.streamingMessage, true);
					}

					let sawToolCall = false;
					let sawThinking = false;
					for (const content of this.streamingMessage.content) {
						if (content.type === "thinking") {
							sawThinking = true;
						}
						if (content.type === "toolCall") {
							sawToolCall = true;
							if (!this.pendingTools.has(content.id)) {
								const component = new ToolExecutionComponent(
									content.name,
									content.id,
									content.arguments,
									{
										showImages: this.settingsManager.getShowImages(),
										imageWidthCells: this.settingsManager.getImageWidthCells(),
									},
									this.getRegisteredToolDefinition(content.name),
									this.ui,
									this.sessionManager.getCwd(),
								);
								component.setExpanded(this.toolOutputExpanded);
								this.chatContainer.addChild(component);
								this.pendingTools.set(content.id, component);
								// Chip appears as soon as the model emits the tool call — don't
								// wait for tool_execution_start (which can lag the stream).
								const streamChip = this.toolChip(content.name, content.arguments);
								this.setPorcupineActivity(streamChip.phase, {
									showInterruptHint: true,
									force: true,
									name: streamChip.name,
								});
							} else {
								const component = this.pendingTools.get(content.id);
								if (component) {
									component.updateArgs(content.arguments);
								}
							}
						}
					}
					// Never let streaming token updates clobber a live tool animation
					// (Reading/Writing/Editing/…). That was wiping the status strip every chunk.
					if (!isToolDrivenAnimation(this.activityPhase) && this.pendingTools.size === 0) {
						if (sawThinking) {
							this.setPorcupineActivity("thinking");
						} else {
							this.setPorcupineActivity("working");
						}
					} else if (sawToolCall && this.pendingTools.size > 0 && !isToolDrivenAnimation(this.activityPhase)) {
						// Args streaming, execution not started yet
						this.setPorcupineActivity("working");
					}
					this.ui.requestRender();
				}
				break;

			case "message_end":
				if (event.message.role === "user") break;
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingMessage = event.message;
					let errorMessage: string | undefined;
					if (this.streamingMessage.stopReason === "aborted") {
						const retryAttempt = this.session.retryAttempt;
						errorMessage =
							retryAttempt > 0
								? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
								: "Operation aborted";
						this.streamingMessage.errorMessage = errorMessage;
					}
					this.streamingComponent.updateContent(this.streamingMessage, false);

					if (this.streamingMessage.stopReason === "aborted" || this.streamingMessage.stopReason === "error") {
						if (!errorMessage) {
							errorMessage = this.streamingMessage.errorMessage || "Error";
						}
						for (const [, component] of this.pendingTools.entries()) {
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						}
						this.pendingTools.clear();
					} else {
						// Args are now complete - trigger diff computation for edit tools
						for (const [, component] of this.pendingTools.entries()) {
							component.setArgsComplete();
						}
						this.maybeShowCacheMissNotice(this.streamingMessage);
					}
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
					this.footer.invalidate();
				}
				this.ui.requestRender();
				break;

			case "bash_execution_update":
				// The bash execution callback handles TUI output rendering.
				break;

			case "tool_execution_start": {
				let component = this.pendingTools.get(event.toolCallId);
				if (!component) {
					component = new ToolExecutionComponent(
						event.toolName,
						event.toolCallId,
						event.args,
						{
							showImages: this.settingsManager.getShowImages(),
							imageWidthCells: this.settingsManager.getImageWidthCells(),
						},
						this.getRegisteredToolDefinition(event.toolName),
						this.ui,
						this.sessionManager.getCwd(),
					);
					component.setExpanded(this.toolOutputExpanded);
					// Extension activity override hides only the extension's own tool
					// components — never the main agent's built-in tool calls.
					if (!this.extensionToolComponentsHidden || !this.isExtensionTool(event.toolName)) {
						this.chatContainer.addChild(component);
					}
					this.pendingTools.set(event.toolCallId, component);
				}
				component.markExecutionStarted();
				// Tool name wins for the status chip — never let later message_update steal it.
				// Args refine it: "👀 Searching for skills", "📖 Reading skill: git-basics", "🧰 Using <tool>".
				const chip = this.toolChip(event.toolName, event.args);
				this.setPorcupineActivity(chip.phase, { showInterruptHint: true, force: true, name: chip.name });
				this.orchestrator.ensureDynamicStep(event.toolName);
				this.orchestrator.markStepForTool(event.toolName);
				this.applyTaskGraphDisplay();
				this.ui.requestRender();
				break;
			}

			case "tool_execution_update": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.partialResult, isError: false }, true);
					// Keep the tool animation locked while output streams.
					const name = component.getToolName?.() ?? event.toolName;
					if (name) {
						const chip = this.toolChip(name, component.getArgs?.());
						this.setPorcupineActivity(chip.phase, {
							showInterruptHint: true,
							force: true,
							name: chip.name,
						});
					}
					this.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				const viewerEntry = (event.result?.details ?? {}) as
					| { markdownViewer?: { title: string; content: string; path?: string } }
					| undefined;
				if (viewerEntry?.markdownViewer) {
					this.showMarkdownViewer(viewerEntry.markdownViewer);
				}
				const component = this.pendingTools.get(event.toolCallId);
				const toolArgs = component?.getArgs();
				const toolName = component?.getToolName() ?? event.toolName;
				if (component) {
					component.updateResult({ ...event.result, isError: event.isError });
					this.pendingTools.delete(event.toolCallId);
					if (this.extensionToolComponentsHidden && this.isExtensionTool(toolName)) {
						this.chatContainer.removeChild(component);
					}
				}

				const artifactChange = artifactChangeFromToolCall(toolName, toolArgs, event.isError);
				if (artifactChange) {
					this.chatContainer.addChild(new ArtifactChangeComponent(artifactChange));
				}

				if (!this.extensionToolComponentsHidden) {
					if (event.isError) {
						this.setPorcupineActivity("error");
					} else if (this.pendingTools.size === 0) {
						// A finished message send shows ✉️ Sent message before the next phase.
						this.setPorcupineActivity(this.isMessagingToolName(toolName) ? "sent-message" : "thinking");
					} else {
						// Switch strip to the next still-running tool's phase.
						const next = this.pendingTools.values().next().value as
							| { getToolName?: () => string; getArgs?: () => unknown }
							| undefined;
						const nextName = next?.getToolName?.();
						if (nextName) {
							const chip = this.toolChip(nextName, next?.getArgs?.());
							this.setPorcupineActivity(chip.phase, { name: chip.name });
						}
					}
				}
				if (toolName) {
					this.learningToolEvidence.push({
						name: toolName,
						isError: event.isError,
					});
					this.orchestrator.markToolFinished(toolName, event.isError);
					this.applyTaskGraphDisplay();
				}

				this.ui.requestRender();
				break;
			}

			case "agent_end":
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(false);
				}
				this.clearStatusIndicator("working");
				if (this.streamingComponent) {
					this.chatContainer.removeChild(this.streamingComponent);
					this.streamingComponent = undefined;
					this.streamingMessage = undefined;
				}
				this.pendingTools.clear();
				this.orchestrator.markTurnComplete(true);
				this.applyTaskGraphDisplay();

				// Voice Mode: speak the terminal response (only when not retrying).
				if (this.voiceEnabled && !event.willRetry) {
					const reply = extractAssistantText(event.messages);
					void this.ensureVoiceMode().speak(reply);
				}

				// Kick queued task runs right after a turn settles instead of waiting
				// for the 15s cron tick.
				this.tickCronSchedules();

				this.ui.requestRender();
				break;

			case "agent_settled":
				await this.processSettledTurnLearning();
				await this.processSettledGoalTurn();
				this.processSettledPlanTurn();
				await this.checkShutdownRequested();
				break;

			case "compaction_start": {
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(true);
				}
				// Keep editor active; submissions are queued during compaction.
				this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
				this.defaultEditor.onEscape = () => {
					this.session.abortCompaction();
				};
				this.showStatusIndicator(new CompactionStatusIndicator(this.ui, event.reason));
				this.ui.requestRender();
				break;
			}

			case "compaction_end": {
				if (this.settingsManager.getShowTerminalProgress()) {
					this.ui.terminal.setProgress(false);
				}
				if (this.autoCompactionEscapeHandler) {
					this.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
					this.autoCompactionEscapeHandler = undefined;
				}
				this.clearStatusIndicator("compaction");
				if (event.aborted) {
					if (event.reason === "manual") {
						this.showError("Compaction cancelled");
					} else {
						this.showStatus("Auto-compaction cancelled");
					}
				} else if (event.result) {
					this.chatContainer.clear();
					this.rebuildChatFromMessages();
					this.addMessageToChat(
						createCompactionSummaryMessage(
							event.result.summary,
							event.result.tokensBefore,
							new Date().toISOString(),
						),
					);
					this.footer.invalidate();
				} else if (event.errorMessage) {
					if (event.reason === "manual") {
						this.showError(event.errorMessage);
					} else {
						this.chatContainer.addChild(new Spacer(1));
						this.chatContainer.addChild(new Text(theme.fg("error", event.errorMessage), 1, 0));
					}
				}
				void this.flushCompactionQueue({ willRetry: event.willRetry });
				this.ui.requestRender();
				break;
			}

			case "auto_retry_start": {
				// Set up escape to abort retry
				this.retryEscapeHandler = this.defaultEditor.onEscape;
				this.defaultEditor.onEscape = () => {
					this.session.abortRetry();
				};
				this.showStatusIndicator(
					new RetryStatusIndicator(this.ui, event.attempt, event.maxAttempts, event.delayMs, () =>
						this.clearStatusIndicator("retry"),
					),
				);
				this.ui.requestRender();
				break;
			}

			case "auto_retry_end": {
				// Restore escape handler
				if (this.retryEscapeHandler) {
					this.defaultEditor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				this.clearStatusIndicator("retry");
				// Show error only on final failure (success shows normal response)
				if (!event.success) {
					this.showError(`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`);
				}
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_scheduled": {
				this.showError(event.errorMessage);
				this.showStatusIndicator(
					new RetryStatusIndicator(this.ui, event.attempt, event.maxAttempts, event.delayMs, () =>
						this.clearStatusIndicator("retry"),
					),
				);
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_attempt_start": {
				this.clearStatusIndicator("retry");
				if (event.source === "branchSummary") {
					this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
				} else {
					this.showStatusIndicator(new CompactionStatusIndicator(this.ui, event.reason));
				}
				this.ui.requestRender();
				break;
			}

			case "summarization_retry_finished": {
				this.clearStatusIndicator("retry");
				this.ui.requestRender();
				break;
			}
		}
	}

	/** Extract text content from a user message */
	private getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((c: { type: string }) => c.type === "text");
		return textBlocks.map((c) => (c as { text: string }).text).join("");
	}

	/**
	 * Show a status message in the chat.
	 *
	 * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
	 * we update the previous status line instead of appending new ones to avoid log spam.
	 */
	private showStatus(message: string): void {
		const children = this.chatContainer.children;
		const last = children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

		if (last && secondLast && last === this.lastStatusText && secondLast === this.lastStatusSpacer) {
			this.lastStatusText.setText(theme.fg("dim", message));
			this.ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		const text = new Text(theme.fg("dim", message), 1, 0);
		this.chatContainer.addChild(spacer);
		this.chatContainer.addChild(text);
		this.lastStatusSpacer = spacer;
		this.lastStatusText = text;
		this.ui.requestRender();
	}

	private addCustomEntryToChat(entry: Extract<SessionEntry, { type: "custom" }>): void {
		const renderer = this.session.extensionRunner.getEntryRenderer(entry.customType);
		if (!renderer) {
			return;
		}
		const component = new CustomEntryComponent(entry, renderer);
		component.setExpanded(this.toolOutputExpanded);
		if (!component.hasContent()) {
			return;
		}

		if (this.streamingComponent) {
			const streamingIndex = this.chatContainer.children.indexOf(this.streamingComponent);
			if (streamingIndex >= 0) {
				this.chatContainer.children.splice(streamingIndex, 0, component);
				return;
			}
		}

		this.chatContainer.addChild(component);
	}

	private addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
		switch (message.role) {
			case "bashExecution": {
				const component = new BashExecutionComponent(message.command, this.ui, message.excludeFromContext);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(
					message.exitCode,
					message.cancelled,
					message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
					message.fullOutputPath,
				);
				this.chatContainer.addChild(component);
				break;
			}
			case "custom": {
				if (message.display) {
					const renderer = this.session.extensionRunner.getMessageRenderer(message.customType);
					const component = new CustomMessageComponent(
						message,
						renderer,
						this.getMarkdownThemeWithSettings(),
						this.outputPad,
					);
					component.setExpanded(this.toolOutputExpanded);
					this.chatContainer.addChild(component);
				}
				break;
			}
			case "compactionSummary": {
				this.chatContainer.addChild(new Spacer(1));
				const component = new CompactionSummaryMessageComponent(message, this.getMarkdownThemeWithSettings());
				component.setExpanded(this.toolOutputExpanded);
				this.chatContainer.addChild(component);
				break;
			}
			case "branchSummary": {
				this.chatContainer.addChild(new Spacer(1));
				const component = new BranchSummaryMessageComponent(message, this.getMarkdownThemeWithSettings());
				component.setExpanded(this.toolOutputExpanded);
				this.chatContainer.addChild(component);
				break;
			}
			case "user": {
				const textContent = this.getUserMessageText(message);
				let mediaLabel: string | undefined;
				// Media-only user messages (native voice/image prompts) carry no text;
				// still render a placeholder so the turn is visible in the transcript.
				const mediaBlocks = Array.isArray(message.content)
					? message.content.filter((c) => c?.type === "audio" || c?.type === "image")
					: [];
				if (textContent || mediaBlocks.length > 0) {
					if (this.chatContainer.children.length > 0) {
						this.chatContainer.addChild(new Spacer(1));
					}
					if (textContent) {
						const skillBlock = parseSkillBlock(textContent);
						if (skillBlock) {
							// Render skill block (collapsible)
							const component = new SkillInvocationMessageComponent(
								skillBlock,
								this.getMarkdownThemeWithSettings(),
							);
							component.setExpanded(this.toolOutputExpanded);
							this.chatContainer.addChild(component);
							// Render user message separately if present
							if (skillBlock.userMessage) {
								this.chatContainer.addChild(new Spacer(1));
								const userComponent = new UserMessageComponent(
									skillBlock.userMessage,
									this.getMarkdownThemeWithSettings(),
									this.outputPad,
									this.getMarkdownTransformers(),
								);
								this.chatContainer.addChild(userComponent);
							}
						} else {
							const userComponent = new UserMessageComponent(
								textContent,
								this.getMarkdownThemeWithSettings(),
								this.outputPad,
								this.getMarkdownTransformers(),
							);
							this.chatContainer.addChild(userComponent);
						}
					} else if (mediaBlocks.length > 0) {
						const audioCount = mediaBlocks.filter((c) => c.type === "audio").length;
						const imageCount = mediaBlocks.filter((c) => c.type === "image").length;
						const label =
							audioCount > 0
								? `🎤 Voice message${audioCount > 1 ? ` (${audioCount})` : ""}`
								: `🖼️ Image${imageCount > 1 ? ` (${imageCount})` : ""}`;
						// label is also used for history population below
						mediaLabel = label;
						const mediaComponent = new UserMessageComponent(
							label,
							this.getMarkdownThemeWithSettings(),
							this.outputPad,
							this.getMarkdownTransformers(),
						);
						this.chatContainer.addChild(mediaComponent);
					}
					if (options?.populateHistory) {
						this.editor.addToHistory?.(textContent || mediaLabel || "");
					}
				}
				break;
			}
			case "assistant": {
				const assistantComponent = new AssistantMessageComponent(
					message,
					this.hideThinkingBlock,
					this.getMarkdownThemeWithSettings(),
					this.hiddenThinkingLabel,
					this.outputPad,
					this.getMarkdownTransformers(),
				);
				this.chatContainer.addChild(assistantComponent);
				break;
			}
			case "toolResult": {
				// Tool results are rendered inline with tool calls, handled separately
				break;
			}
			default: {
				const _exhaustive: never = message;
			}
		}
	}

	private renderSessionItems(
		items: readonly RenderSessionItem[],
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		this.pendingTools.clear();
		const renderedPendingTools = new Map<string, ToolExecutionComponent>();
		// Cache-miss notices are not persisted; re-derive them from the full entry
		// list and re-inject them after the assistant messages that paid for them.
		const cacheMisses = this.settingsManager.getShowCacheMissNotices()
			? collectCacheMisses(this.sessionManager.getEntries(), this.session.modelRuntime)
			: new Map<AssistantMessage, CacheMiss>();

		if (options.updateFooter) {
			this.footer.invalidate();
			this.updateEditorBorderColor();
		}

		for (const item of items) {
			if (isCustomSessionEntry(item)) {
				this.addCustomEntryToChat(item);
				continue;
			}

			const message = item;
			// Assistant messages need special handling for tool calls
			if (message.role === "assistant") {
				this.addMessageToChat(message);
				// Render tool call components
				for (const content of message.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(
							content.name,
							content.id,
							content.arguments,
							{
								showImages: this.settingsManager.getShowImages(),
								imageWidthCells: this.settingsManager.getImageWidthCells(),
							},
							this.getRegisteredToolDefinition(content.name),
							this.ui,
							this.sessionManager.getCwd(),
						);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);

						if (message.stopReason === "aborted" || message.stopReason === "error") {
							let errorMessage: string;
							if (message.stopReason === "aborted") {
								const retryAttempt = this.session.retryAttempt;
								errorMessage =
									retryAttempt > 0
										? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
										: "Operation aborted";
							} else {
								errorMessage = message.errorMessage || "Error";
							}
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						} else {
							renderedPendingTools.set(content.id, component);
						}
					}
				}
				if (message.stopReason !== "aborted" && message.stopReason !== "error") {
					const miss = cacheMisses.get(message);
					if (miss) this.addCacheMissNotice(miss);
				}
			} else if (message.role === "toolResult") {
				// Match tool results to pending tool components
				const component = renderedPendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult(message);
					renderedPendingTools.delete(message.toolCallId);
				}
			} else {
				// All other messages use standard rendering
				this.addMessageToChat(message, options);
			}
		}

		for (const [toolCallId, component] of renderedPendingTools) {
			this.pendingTools.set(toolCallId, component);
		}
		this.ui.requestRender();
	}

	/**
	 * Render session entries to chat. Used for initial load and rebuild after compaction.
	 * @param entries Compaction-aware session entries to render
	 * @param options.updateFooter Update footer state
	 * @param options.populateHistory Add user messages to editor history
	 */
	private renderSessionEntries(
		entries: SessionEntry[],
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		const items = entries.flatMap((entry): RenderSessionItem[] => {
			if (entry.type === "custom") {
				return [entry];
			}
			return sessionEntryToContextMessages(entry);
		});
		this.renderSessionItems(items, options);
	}

	/**
	 * Show a transcript notice when a completed assistant message paid for a
	 * significant cache miss. Only states observable facts: the miss itself,
	 * a model switch, or an idle gap past the cache TTL.
	 */
	private maybeShowCacheMissNotice(message: AssistantMessage): void {
		if (!this.settingsManager.getShowCacheMissNotices()) return;

		// Entries don't contain `message` yet: message_end fires before persistence.
		const miss = detectCacheMiss(this.sessionManager.getEntries(), message, this.session.modelRuntime);
		if (miss) this.addCacheMissNotice(miss);
	}

	private addCacheMissNotice(miss: CacheMiss): void {
		if (miss.missedTokens < 20_000 && miss.missedCost < 0.1) return;

		const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
		const reBilled = `${formatTokens(miss.missedTokens)} tokens re-billed${cost}`;
		let label = "Cache miss";
		if (miss.modelChanged) {
			label = "Cache miss after model switch";
		} else if (miss.idleMs >= CACHE_TTL_MS) {
			label = `Cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
		}
		const text = theme.fg("warning", `${label}: ${reBilled}`);
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(text, 1, 0));
	}

	renderInitialMessages(): void {
		const entries = this.sessionManager.buildContextEntries();
		this.renderSessionEntries(entries, {
			updateFooter: true,
			populateHistory: true,
		});
		this.renderProjectTrustWarningIfNeeded();

		// Show compaction info if session was compacted
		const allEntries = this.sessionManager.getEntries();
		const compactionCount = allEntries.filter((e) => e.type === "compaction").length;
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.showStatus(`Session compacted ${times}`);
		}
	}

	private renderProjectTrustWarningIfNeeded(): void {
		if (this.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(this.sessionManager.getCwd())) {
			return;
		}

		if (this.chatContainer.children.length > 0) {
			this.chatContainer.addChild(new Spacer(1));
		}
		this.chatContainer.addChild(
			new Text(
				theme.fg(
					"warning",
					`This project is not trusted. Project ${CONFIG_DIR_NAME} resources and packages are ignored. Use /trust to save a trust decision, then restart ${APP_NAME}.`,
				),
				1,
				0,
			),
		);
	}

	async getUserInput(): Promise<string> {
		const queuedInput = this.pendingUserInputs.shift();
		if (queuedInput !== undefined) {
			return queuedInput;
		}

		return new Promise((resolve) => {
			this.onInputCallback = (text: string) => {
				this.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

	private rebuildChatFromMessages(): void {
		this.chatContainer.clear();
		this.renderSessionEntries(this.sessionManager.buildContextEntries());
	}

	// =========================================================================
	// Key handlers
	// =========================================================================

	private handleCtrlC(): void {
		const now = Date.now();
		if (now - this.lastSigintTime < 500) {
			void this.shutdown();
		} else {
			this.clearEditor();
			this.lastSigintTime = now;
		}
	}

	private handleCtrlD(): void {
		// Only called when editor is empty (enforced by CustomEditor)
		void this.shutdown();
	}

	/**
	 * Gracefully shutdown the agent.
	 * Stops the TUI before emitting shutdown events so extension UI cleanup cannot
	 * repaint the final frame while the process is exiting.
	 */
	private isShuttingDown = false;

	private async shutdown(options?: { fromSignal?: boolean }): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		if (this.cronTimer) clearInterval(this.cronTimer);
		// Keep signal handlers registered until terminal cleanup has completed.
		// `signal-exit` checks the listener list during the same SIGTERM/SIGHUP
		// dispatch and re-sends the signal if only its own listeners remain.

		if (options?.fromSignal) {
			// Signal-triggered shutdown (SIGTERM/SIGHUP). Emit extension cleanup
			// (session_shutdown) BEFORE touching the terminal. Extension teardown
			// such as removing sockets does not write to the tty, so it must not be
			// skipped if a later terminal-restore write fails on a dead or stalled
			// terminal. If the terminal is gone, the restore writes below emit EIO,
			// which the stdout/stderr error handler turns into emergencyTerminalExit;
			// the render loop is already idle, so this cannot hot-spin (see #4144).
			await this.runtimeHost.dispose();
			this.themeController.disableAutoSync();
			await this.ui.terminal.drainInput(1000);
			this.stop();
			process.exit(0);
		}

		// Interactive quit (Ctrl+D, Ctrl+C, /quit, extension shutdown()). Stop the
		// TUI before emitting shutdown events so extension UI cleanup cannot repaint
		// the final frame while the process is exiting.
		// Drain any in-flight Kitty key release events before stopping.
		// This prevents escape sequences from leaking to the parent shell over slow SSH.
		this.themeController.disableAutoSync();
		await this.ui.terminal.drainInput(1000);

		this.stop();
		await this.runtimeHost.dispose();

		const resumeCommand = formatResumeCommand(this.sessionManager);
		if (resumeCommand) {
			process.stdout.write(`${chalk.dim("To resume this session:")} ${resumeCommand}\n`);
		}

		process.exit(0);
	}

	private emergencyTerminalExit(): never {
		this.isShuttingDown = true;
		this.unregisterSignalHandlers();
		killTrackedDetachedChildren();
		// The terminal is gone. Do not run normal shutdown because TUI and
		// extension cleanup can write restore sequences and re-trigger EIO.
		process.exit(129);
	}

	/**
	 * Last-resort handler for uncaught exceptions. The TUI puts stdin into raw
	 * mode and hides the cursor; without this handler, an uncaught throw from
	 * anywhere (e.g. an extension's async `ChildProcess.on("exit")` callback)
	 * tears down the process while leaving the terminal in raw mode with no
	 * cursor, requiring `stty sane && reset` to recover.
	 *
	 * Unlike emergencyTerminalExit, the terminal is still alive here, so we
	 * call ui.stop() to restore cooked mode, the cursor, and disable bracketed
	 * paste / Kitty / modifyOtherKeys sequences.
	 */
	private uncaughtCrash(error: Error): never {
		if (this.isShuttingDown) {
			process.exit(1);
		}
		this.isShuttingDown = true;
		try {
			this.unregisterSignalHandlers();
		} catch {}
		try {
			killTrackedDetachedChildren();
		} catch {}
		try {
			this.ui.stop();
		} catch {}
		console.error(`${APP_NAME} exiting due to uncaughtException:`);
		console.error(error);
		process.exit(1);
	}

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 */
	private async checkShutdownRequested(): Promise<void> {
		if (!this.shutdownRequested) return;
		await this.shutdown();
	}

	private registerSignalHandlers(): void {
		this.unregisterSignalHandlers();

		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				// SIGHUP no longer hard-exits: graceful shutdown emits session_shutdown
				// first, then attempts terminal restore. A genuinely dead terminal
				// surfaces as an EIO on the restore writes, which the stdout/stderr
				// error handler converts into emergencyTerminalExit (see #4144, #5080).
				killTrackedDetachedChildren();
				void this.shutdown({ fromSignal: true });
			};
			process.prependListener(signal, handler);
			this.signalCleanupHandlers.push(() => process.off(signal, handler));
		}

		const terminalErrorHandler = (error: Error) => {
			if (isDeadTerminalError(error)) {
				this.emergencyTerminalExit();
			}
			throw error;
		};
		process.stdout.on("error", terminalErrorHandler);
		process.stderr.on("error", terminalErrorHandler);
		this.signalCleanupHandlers.push(() => process.stdout.off("error", terminalErrorHandler));
		this.signalCleanupHandlers.push(() => process.stderr.off("error", terminalErrorHandler));

		// Restore the terminal before the process dies on any uncaught throw.
		// Without this, an unhandled exception from extension code (or anywhere
		// in porcupine) leaves the terminal in raw mode with no cursor.
		const uncaughtExceptionHandler = (error: Error) => this.uncaughtCrash(error);
		process.prependListener("uncaughtException", uncaughtExceptionHandler);
		this.signalCleanupHandlers.push(() => process.off("uncaughtException", uncaughtExceptionHandler));
	}

	private unregisterSignalHandlers(): void {
		for (const cleanup of this.signalCleanupHandlers) {
			cleanup();
		}
		this.signalCleanupHandlers = [];
	}

	private handleCtrlZ(): void {
		if (process.platform === "win32") {
			this.showStatus("Suspend to background is not supported on Windows");
			return;
		}

		// Keep the event loop alive while suspended. Without this, stopping the TUI
		// can leave Node with no ref'ed handles, causing the process to exit on fg
		// before the SIGCONT handler gets a chance to restore the terminal.
		const suspendKeepAlive = setInterval(() => {}, 2 ** 30);

		// Ignore SIGINT while suspended so Ctrl+C in the terminal does not
		// kill the backgrounded process. The handler is removed on resume.
		const ignoreSigint = () => {};
		process.on("SIGINT", ignoreSigint);

		// Set up handler to restore TUI when resumed
		process.once("SIGCONT", () => {
			clearInterval(suspendKeepAlive);
			process.removeListener("SIGINT", ignoreSigint);
			this.ui.start();
			this.ui.requestRender(true);
		});

		try {
			// Stop the TUI (restore terminal to normal mode)
			this.ui.stop();

			// Send SIGTSTP to process group (pid=0 means all processes in group)
			process.kill(0, "SIGTSTP");
		} catch (error) {
			clearInterval(suspendKeepAlive);
			process.removeListener("SIGINT", ignoreSigint);
			throw error;
		}
	}

	private async handleFollowUp(): Promise<void> {
		const text = (this.editor.getExpandedText?.() ?? this.editor.getText()).trim();
		if (!text) return;

		// Queue input during compaction (extension commands execute immediately)
		if (this.session.isCompacting) {
			if (this.isExtensionCommand(text)) {
				this.editor.addToHistory?.(text);
				this.editor.setText("");
				await this.session.prompt(text);
			} else {
				this.queueCompactionMessage(text, "followUp");
			}
			return;
		}

		// Alt+Enter queues a follow-up message (waits until agent finishes)
		// This handles extension commands (execute immediately), prompt template expansion, and queueing
		if (this.session.isStreaming) {
			this.editor.addToHistory?.(text);
			this.editor.setText("");
			await this.session.prompt(text, { streamingBehavior: "followUp" });
			this.updatePendingMessagesDisplay();
			this.ui.requestRender();
		}
		// If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
		else if (this.editor.onSubmit) {
			this.editor.setText("");
			this.editor.onSubmit(text);
		}
	}

	private handleDequeue(): void {
		const restored = this.restoreQueuedMessagesToEditor();
		if (restored === 0) {
			this.showStatus("No queued messages to restore");
		} else {
			this.showStatus(`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`);
		}
	}

	private updateEditorBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else if (this.session.isAdaptiveReasoningEnabled) {
			this.editor.borderColor = theme.getAdaptiveThinkingBorderColor();
		} else {
			const level = this.session.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.ui.requestRender();
	}

	private cycleThinkingLevel(): void {
		const newLevel = this.session.cycleThinkingLevel();
		if (newLevel === undefined) {
			this.showStatus("Current model does not support thinking");
		} else {
			this.footer.invalidate();
			this.updateEditorBorderColor();
			const label =
				newLevel === "adaptive"
					? formatReasoningModeLabel("adaptive", this.session.adaptiveLastResolved)
					: formatReasoningModeLabel(newLevel);
			this.showStatus(`Reasoning: ${label}`);
		}
	}

	/** Apply reasoning mode and refresh chrome. */
	private applyReasoningMode(mode: ReasoningMode): void {
		const applied = this.session.setReasoningMode(mode);
		this.footer.invalidate();
		this.updateEditorBorderColor();
		const label =
			applied === "adaptive"
				? formatReasoningModeLabel("adaptive", this.session.adaptiveLastResolved)
				: formatReasoningModeLabel(applied);
		this.showStatus(`Reasoning: ${label}`);
	}

	/**
	 * /reasoning [level]  - open selector, or set mode directly.
	 * /thinking is a Porcupine-compatible alias.
	 */
	private handleReasoningCommand(text: string): void {
		const space = text.indexOf(" ");
		const arg = space === -1 ? "" : text.slice(space + 1).trim();

		if (!this.session.supportsThinking()) {
			this.showWarning("Current model does not support thinking/reasoning levels.");
			this.ui.requestRender();
			return;
		}

		if (arg === "status" || arg === "?") {
			const mode = this.session.getReasoningMode();
			const label =
				mode === "adaptive"
					? formatReasoningModeLabel("adaptive", this.session.adaptiveLastResolved)
					: formatReasoningModeLabel(mode);
			const available = this.session.getAvailableThinkingLevels().join(", ");
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Text(
					theme.fg("accent", `Reasoning: ${label}  |  available: ${available}, adaptive  |  Shift+Tab cycles`),
					1,
					0,
				),
			);
			this.ui.requestRender();
			return;
		}

		if (arg) {
			const parsed = parseReasoningModeArg(arg);
			if (!parsed) {
				this.showWarning(
					"Usage: /reasoning [off|minimal|low|medium|high|xhigh|max|adaptive]  (or bare /reasoning to pick)",
				);
				this.ui.requestRender();
				return;
			}
			if (parsed !== "adaptive") {
				const available = this.session.getAvailableThinkingLevels();
				if (!available.includes(parsed)) {
					this.showWarning(
						`Level "${parsed}" is not supported by this model. Available: ${available.join(", ")}, adaptive`,
					);
					this.ui.requestRender();
					return;
				}
			}
			this.applyReasoningMode(parsed);
			return;
		}

		this.showReasoningSelector();
	}

	private showReasoningSelector(): void {
		this.showSelector((done) => {
			const current = this.session.getReasoningMode();
			const selector = new ThinkingSelectorComponent(
				current,
				this.session.getAvailableThinkingLevels(),
				(mode) => {
					this.applyReasoningMode(mode);
					done();
				},
				() => {
					done();
					this.ui.requestRender();
				},
				{ includeAdaptive: true },
			);
			return { component: selector, focus: selector.getSelectList() };
		});
	}

	private async cycleModel(direction: "forward" | "backward"): Promise<void> {
		try {
			const result = await this.session.cycleModel(direction);
			if (result === undefined) {
				const msg = this.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available";
				this.showStatus(msg);
			} else {
				this.footer.invalidate();
				this.updateEditorBorderColor();
				const thinkingStr =
					result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
				this.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
				void this.maybeWarnAboutAnthropicSubscriptionAuth(result.model);
			}
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private toggleToolOutputExpansion(): void {
		this.setToolsExpanded(!this.toolOutputExpanded);
	}

	private setToolsExpanded(expanded: boolean): void {
		if (expanded === this.toolOutputExpanded) return;

		this.toolOutputExpanded = expanded;
		const activeHeader = this.customHeader ?? this.builtInHeader;
		if (isExpandable(activeHeader)) {
			activeHeader.setExpanded(expanded);
		}
		for (const container of [this.loadedResourcesContainer, this.chatContainer]) {
			for (const child of container.children) {
				if (isExpandable(child)) {
					child.setExpanded(expanded);
				}
			}
		}
		this.showStatus(`Tool output: ${expanded ? "expanded" : "collapsed"}`);
	}

	private setThinkingBlockVisibility(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.settingsManager.setHideThinkingBlock(hide);

		// Rebuild chat from session messages
		this.chatContainer.clear();
		this.rebuildChatFromMessages();

		// If streaming, re-add the streaming component with updated visibility and re-render
		if (this.streamingComponent && this.streamingMessage) {
			this.streamingComponent.setHideThinkingBlock(this.hideThinkingBlock);
			this.streamingComponent.updateContent(this.streamingMessage);
			this.chatContainer.addChild(this.streamingComponent);
		}

		this.showStatus(`Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`);
	}

	private toggleThinkingBlockVisibility(): void {
		this.setThinkingBlockVisibility(!this.hideThinkingBlock);
	}

	private handleReasoningVisibilityCommand(
		command: NonNullable<ReturnType<typeof parseReasoningVisibilityCommand>>,
	): void {
		if (command.kind === "invalid") {
			this.showWarning(command.message);
			return;
		}
		if (command.kind === "status") {
			this.showStatus(
				`Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}. Use /reasoning-show yes or /reasoning-show no.`,
			);
			return;
		}
		this.setThinkingBlockVisibility(command.hide);
	}

	private async processSettledTurnLearning(): Promise<void> {
		const userText = this.learningUserText;
		this.learningUserText = undefined;
		if (!userText && this.learningToolEvidence.length === 0) return;
		try {
			const outcome = await processPostTurnLearning(getAgentDir(), {
				userText: userText ?? "",
				tools: this.learningToolEvidence,
				sessionId: this.session.sessionManager.getSessionId(),
			});
			if (outcome.userPatternChange) {
				this.chatContainer.addChild(new ArtifactChangeComponent(outcome.userPatternChange));
			}
			for (const result of outcome.activated) {
				if (result.artifactChange) {
					this.chatContainer.addChild(new ArtifactChangeComponent(result.artifactChange));
				}
			}
			// Autonomous learning is transparent: sweep for regressions after every
			// settled turn and surface any auto-rollback in the UI feed + status.
			const rolledBack = checkAndRollbackRegressions(getAgentDir());
			for (const proposal of rolledBack) {
				this.showStatus(`↺ Auto-rolled back ${proposal.id} (${proposal.summary})`);
			}
			// Autonomous refinement: a weak porcupine-crafted skill gets a targeted
			// edit (snapshot + feed + proposal). Global cooldown — at most one pass
			// per 10 minutes, and only when a candidate exists.
			const now = Date.now();
			if (now - this.lastAutoRefineAt > AUTO_REFINE_COOLDOWN_MS) {
				const refined = await runRefiner({
					agentDir: getAgentDir(),
					generate: this.buildRefinerGenerator(),
					sessionId: this.session.sessionManager.getSessionId(),
					maxSkillsPerRun: 1,
				});
				if (refined.some((result) => result.via !== "skipped")) {
					this.lastAutoRefineAt = now;
					for (const result of refined) {
						this.showStatus(`🧠 Auto-refined ${result.proposal.id} (+${result.linesAdded} lines)`);
					}
				}
			}
			if (outcome.userPatternChange || outcome.records.length || rolledBack.length) this.ui.requestRender();
		} catch (error) {
			this.showWarning(`Post-turn learning skipped: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.learningToolEvidence = [];
		}
	}

	/** `/mcpp:<server>:<prompt>` — run an MCP prompt as a slash command. */
	private async handleMcpPromptCommand(text: string): Promise<void> {
		const rest = text.slice(6); // strip "/mcpp:"
		const [serverKey, ...nameParts] = rest.split(":");
		const promptName = nameParts.join(":").trim();
		if (!serverKey || !promptName) {
			this.showWarning("Usage: /mcpp:<server>:<prompt>");
			return;
		}
		const manager = this.session.mcpManager;
		if (!manager) {
			this.showWarning("MCP is not active — add servers to ~/.porcupine/agent/mcp.json.");
			return;
		}
		const result = await manager.getPrompt(serverKey, promptName);
		if ("error" in result) {
			this.showWarning(`MCP prompt: ${result.error}`);
			return;
		}
		await this.session.prompt(result.text);
	}

	private async handleRefineCommand(): Promise<void> {
		try {
			const results = await runRefiner({
				agentDir: getAgentDir(),
				generate: this.buildRefinerGenerator(),
				sessionId: this.session.sessionManager.getSessionId(),
				maxSkillsPerRun: 2,
			});
			this.chatContainer.addChild(
				new LearningFeedComponent(
					results.length === 0
						? []
						: results.map((result) => ({
								at: result.proposal.updatedAt,
								action: result.via === "skipped" ? "rejected" : "edited",
								file: result.file,
								linesAdded: result.linesAdded,
								linesRemoved: result.linesRemoved,
								summary: result.proposal.summary,
								proposalId: result.proposal.id,
								kind: result.proposal.kind,
							})),
				),
			);
			this.ui.requestRender();
		} catch (error) {
			this.showWarning(`Refiner failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Load the skill-crafting meta-skill content into context (as chat guidance)
	 * for the extract/craft commands. Uses the resource-loader's discovered skill
	 * so it auto-injects like a context file; falls back to reading the packaged
	 * SKILL.md directly when the skill is not registered yet.
	 */
	private async loadSkillCraftingGuidance(): Promise<string> {
		try {
			const meta = this.session.resourceLoader.getSkills().skills.find((s) => s.name === "skill-crafting");
			if (meta) {
				return fs.readFileSync(meta.filePath, "utf-8");
			}
			const fallback = path.join(process.cwd(), "skills/meta/skill-crafting/SKILL.md");
			if (fs.existsSync(fallback)) return fs.readFileSync(fallback, "utf-8");
		} catch {
			// Fall through to a short inline summary.
		}
		return [
			"# Skill Crafting",
			"",
			"Turns a document or a research topic into a discoverable SKILL.md (agent procedure) or a callable shell tool in user-tools.json.",
			"Write path: agentDir/skills/<stack>/<name>/SKILL.md (skills) or agentDir/user-tools.json (tools).",
			"Never overwrite a user skill without force. Names/stacks are lowercase a-z, 0-9, hyphens.",
		].join("\n");
	}

	/** Dispatch `/extract-stack <path> [--name <n>] [--stack <s>] [--tool]`. */
	private async handleExtractStackCommand(text: string): Promise<void> {
		try {
			const args = parseStackCommandArgs(
				text.replace(/^\/extract-stack\b/i, "").trim(),
				["name", "stack", "desc"],
				["force", "tool"],
			);
			if (!args.positionals[0]) {
				this.showWarning("Usage: /extract-stack <path> [--name <n>] [--stack <s>] [--tool]");
				return;
			}
			const filePath = args.positionals[0]!;
			const stack = args.flags.stack || "meta";
			const name =
				args.flags.name ||
				path
					.basename(filePath)
					.replace(/\.[^.]+$/, "")
					.toLowerCase()
					.replace(/[^a-z0-9-]+/g, "-");
			const kind = args.flags.tool ? "tool" : undefined;

			const guidance = await this.loadSkillCraftingGuidance();
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("accent", `Skill Crafting`), 1, 0));
			this.chatContainer.addChild(new Text(guidance.split("\n").slice(0, 8).join("\n"), 1, 0));
			this.ui.requestRender();

			const { extractSkillFromDocument } = await import("../../porcupine/skill-extract.ts");
			const result = await extractSkillFromDocument(getAgentDir(), {
				path: filePath,
				stack,
				name,
				description: args.flags.desc,
				kind,
				force: args.flags.force === "true",
			});
			this.showStatus(`Extracted ${result.kind} "${result.name}" -> ${result.path}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showWarning(`/extract-stack failed: ${message}`);
		}
	}

	/** Dispatch `/craft-stack <name> --desc <description> [--stack <s>] [--tool]`. */
	private async handleCraftStackCommand(text: string): Promise<void> {
		try {
			const args = parseStackCommandArgs(
				text.replace(/^\/craft-stack\b/i, "").trim(),
				["desc", "stack", "hint"],
				["force", "tool"],
			);
			const name = args.positionals[0];
			if (!name) {
				this.showWarning("Usage: /craft-stack <name> --desc <description> [--stack <s>] [--tool]");
				return;
			}
			const stack = args.flags.stack || "meta";
			const description = args.flags.desc ?? "";
			if (!description.trim()) {
				this.showWarning("Usage: /craft-stack <name> --desc <description>");
				return;
			}
			const kind = args.flags.tool ? "tool" : undefined;

			const guidance = await this.loadSkillCraftingGuidance();
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("accent", `Skill Crafting`), 1, 0));
			this.chatContainer.addChild(new Text(guidance.split("\n").slice(0, 8).join("\n"), 1, 0));
			this.ui.requestRender();

			const { craftSkill } = await import("../../porcupine/skill-craft.ts");
			const result = await craftSkill(getAgentDir(), {
				name,
				description,
				stack,
				researchHint: args.flags.hint,
				kind,
				force: args.flags.force === "true",
			});
			this.showStatus(
				`Crafted ${result.kind} "${result.name}" -> ${result.path} (${result.sources.length} sources)`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showWarning(`/craft-stack failed: ${message}`);
		}
	}

	/** LLM generator for the refiner; returns "" when no model → heuristic fallback. */
	private buildRefinerGenerator(): ((prompt: string) => Promise<string>) | undefined {
		const model = this.session.model;
		if (!model) return undefined;
		return async (prompt: string) => {
			try {
				const result = await this.session.modelRuntime.completeSimple(
					model,
					{
						systemPrompt:
							"You are a skill-refinement editor. Output ONLY the markdown block to append. Never output frontmatter, secrets, or unrelated text.",
						messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
					},
					{ maxTokens: 400, temperature: 0, timeoutMs: 25_000 },
				);
				return extractTextFromAssistantMessage(result);
			} catch {
				return "";
			}
		};
	}

	private handleLearningCommand(command: NonNullable<ReturnType<typeof parseLearningCommand>>): void {
		if (command.kind === "invalid") {
			this.showWarning(command.message);
			return;
		}
		if (command.kind === "graph") {
			this.chatContainer.addChild(new LearningGraphComponent(buildLearningGraph(getAgentDir())));
			this.ui.requestRender();
			return;
		}
		if (command.kind === "feed") {
			this.chatContainer.addChild(new LearningFeedComponent(listLearningFeed(getAgentDir(), 25)));
			this.ui.requestRender();
			return;
		}
		this.chatContainer.addChild(new LearningHistoryComponent(listLearningEvents(getAgentDir())));
		this.ui.requestRender();
	}

	private restoreGoalPlanState(): void {
		for (const entry of this.sessionManager.getBranch().slice().reverse()) {
			if (entry.type === "custom" && entry.customType === GOAL_PLAN_SESSION_ENTRY && isGoalPlanState(entry.data)) {
				this.goalPlanState = entry.data;
				return;
			}
		}
	}

	private persistGoalPlanState(): void {
		this.sessionManager.appendCustomEntry(GOAL_PLAN_SESSION_ENTRY, this.goalPlanState);
	}

	/** Queue goal continuations only after a settled turn; never re-enter AgentSession from an event callback. */
	private async processSettledGoalTurn(): Promise<void> {
		if (!this.goalTurnInFlight) return;
		this.goalTurnInFlight = false;
		const goal = this.goalPlanState.goal;
		if (!goal || goal.status !== "active") return;

		const now = new Date().toISOString();
		if (this.pendingUserInputs.some((input) => !isGoalContinuation(input))) {
			this.goalPlanState = {
				...this.goalPlanState,
				goal: {
					...goal,
					status: "paused",
					updatedAt: now,
					lastVerdict: "blocked",
					lastReason: "Paused because a new user message is waiting.",
				},
			};
			this.persistGoalPlanState();
			this.showStatus("Standing goal paused for your new instruction.");
			return;
		}

		const verdict = await judgeGoalResponse({
			modelRuntime: this.session.modelRuntime,
			model: this.session.model,
			goal,
			response: this.session.getLastAssistantText() ?? "",
		});
		const updatedGoal = {
			...goal,
			turnsUsed: goal.turnsUsed + 1,
			updatedAt: now,
		};
		if (verdict.kind === "done") {
			this.goalPlanState = {
				...this.goalPlanState,
				goal: {
					...updatedGoal,
					status: "done",
					lastVerdict: "done",
					lastReason: verdict.reason,
				},
			};
			this.persistGoalPlanState();
			this.showStatus(
				`Standing goal completed after ${updatedGoal.turnsUsed} turn${updatedGoal.turnsUsed === 1 ? "" : "s"}.`,
			);
			return;
		}
		if (verdict.kind === "blocked") {
			this.goalPlanState = {
				...this.goalPlanState,
				goal: {
					...updatedGoal,
					status: "paused",
					lastVerdict: "blocked",
					lastReason: verdict.reason,
				},
			};
			this.persistGoalPlanState();
			this.showWarning("Standing goal paused: the agent reported a block or needs input.");
			return;
		}
		if (updatedGoal.turnsUsed >= updatedGoal.maxTurns) {
			this.goalPlanState = {
				...this.goalPlanState,
				goal: {
					...updatedGoal,
					status: "paused",
					lastVerdict: "budget-exhausted",
					lastReason: `Reached the ${updatedGoal.maxTurns}-turn safety budget.`,
				},
			};
			this.persistGoalPlanState();
			this.showWarning(`Standing goal paused at its ${updatedGoal.maxTurns}-turn budget.`);
			return;
		}
		const continuingGoal = {
			...updatedGoal,
			lastVerdict: "continue" as const,
			lastReason: verdict.reason,
		};
		this.goalPlanState = { ...this.goalPlanState, goal: continuingGoal };
		this.persistGoalPlanState();
		this.pendingUserInputs.push(buildGoalContinuation(continuingGoal));
	}

	/** Persist the final /plan response in the active workspace, never source code. */
	private processSettledPlanTurn(): void {
		if (!this.planTurnInFlight) return;
		this.planTurnInFlight = false;
		const plan = this.goalPlanState.plan;
		const markdown = this.session.getLastAssistantText();
		if (!plan || !markdown) {
			this.showWarning("Plan response was empty; no plan artifact was saved.");
			return;
		}

		const cwd = path.resolve(this.sessionManager.getCwd());
		const artifactPath = path.resolve(cwd, plan.path);
		if (!artifactPath.startsWith(`${cwd}${path.sep}`)) {
			this.showError("Refused to save a plan outside the active workspace.");
			return;
		}
		try {
			fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
			fs.writeFileSync(artifactPath, `${markdown.trim()}\n`, "utf8");
			this.goalPlanState = {
				...this.goalPlanState,
				plan: { ...plan, updatedAt: new Date().toISOString() },
			};
			this.persistGoalPlanState();
			this.showStatus(`Plan saved: ${plan.path}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showError(`Could not save plan artifact: ${message}`);
		}
	}
	private handleGoalCommand(command: NonNullable<ReturnType<typeof parseGoalCommand>>): void {
		if (command.kind === "invalid") {
			this.showWarning(command.message);
			return;
		}
		if (command.kind === "status") {
			this.showStatus(formatGoalStatus(this.goalPlanState.goal));
			return;
		}
		if (command.kind === "clear") {
			const { goal: _goal, ...remaining } = this.goalPlanState;
			this.goalPlanState = remaining;
			this.pendingUserInputs = this.pendingUserInputs.filter((input) => !isGoalContinuation(input));
			this.persistGoalPlanState();
			this.showStatus("Standing goal cleared.");
			return;
		}

		const current = this.goalPlanState.goal;
		if (command.kind === "pause" || command.kind === "resume") {
			if (!current) {
				this.showWarning("No standing goal to update. Use /goal <text> first.");
				return;
			}
			const goal = {
				...current,
				status: command.kind === "pause" ? ("paused" as const) : ("active" as const),
				updatedAt: new Date().toISOString(),
			};
			this.goalPlanState = { ...this.goalPlanState, goal };
			this.pendingUserInputs = this.pendingUserInputs.filter((input) => !isGoalContinuation(input));
			if (command.kind === "resume") this.pendingUserInputs.push(buildGoalContinuation(goal));
			this.persistGoalPlanState();
			this.showStatus(`Standing goal ${command.kind === "pause" ? "paused" : "resumed"}.`);
			return;
		}

		const now = new Date().toISOString();
		const goal = {
			text: command.text,
			status: "active" as const,
			turnsUsed: 0,
			maxTurns: DEFAULT_GOAL_MAX_TURNS,
			createdAt: now,
			updatedAt: now,
		};
		this.goalPlanState = { ...this.goalPlanState, goal };
		this.pendingUserInputs = this.pendingUserInputs.filter((input) => !isGoalContinuation(input));
		this.pendingUserInputs.push(buildGoalContinuation(goal));
		this.persistGoalPlanState();
		this.showStatus(`Standing goal started (0/${goal.maxTurns} turns): ${goal.text}`);
	}

	private async handlePlanCommand(command: NonNullable<ReturnType<typeof parsePlanCommand>>): Promise<void> {
		if (command.kind === "invalid") {
			this.showWarning(command.message);
			return;
		}
		if (command.kind === "status") {
			this.showStatus(formatPlanStatus(this.goalPlanState.plan));
			return;
		}
		if (command.kind === "clear") {
			const { plan: _plan, ...remaining } = this.goalPlanState;
			this.goalPlanState = remaining;
			this.persistGoalPlanState();
			this.showStatus("Saved plan cleared.");
			return;
		}

		this.refreshCapabilityTree();
		this.setPorcupineActivity("thinking");
		const turn = await this.orchestrator.prepareTurn(command.text);
		const slug =
			command.text
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 64) || "plan";
		const planPath = `.porcupine/plans/${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}.md`;
		this.goalPlanState = {
			...this.goalPlanState,
			plan: {
				objective: turn.taskGraph.objective,
				path: planPath,
				status: turn.taskGraph.status,
				steps: turn.taskGraph.steps,
				routeSummary: turn.taskGraph.routeSummary,
				updatedAt: new Date().toISOString(),
			},
		};
		this.persistGoalPlanState();
		this.applyTaskGraphDisplay();
		this.planTurnInFlight = true;
		this.pendingUserInputs.push(buildPlanPrompt(command.text, planPath));
		this.showStatus("Plan prepared. Inspecting the codebase and drafting the implementation plan.");
	}

	private async handleOpenExternalEditor(): Promise<void> {
		const editorCmd = this.settingsManager.getExternalEditorCommand();
		const content = this.editor.getExpandedText?.() ?? this.editor.getText();
		this.ui.stop();
		try {
			const result = await editInExternalEditor({
				command: editorCmd,
				content,
			});
			if (result.status === "complete") {
				this.editor.setText(result.content);
			}
		} finally {
			this.ui.start();
			this.ui.requestRender(true);
		}
	}

	// =========================================================================
	// UI helpers
	// =========================================================================

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
		this.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.ui.requestRender();
	}

	/** "🆕 vX.Y.Z available" badge shown beside the version in the header. */
	private renderUpdateBadge(): string {
		if (!this.latestVersion) return "";
		return theme.fg("warning", ` · 🆕 v${this.latestVersion} available — /update`);
	}

	/** Re-check for a newer release after /refresh so the update badge isn't stale. */
	private recheckUpdateBadge(): void {
		if (!this.settingsManager.getUpdateCheck()) {
			return;
		}
		// Clear any cached result so /refresh revalidates against the registry.
		this.latestVersion = undefined;
		checkForNewPorcupineVersion(this.version, { cacheTtlMs: 0 })
			.then((newRelease) => {
				if (newRelease) {
					this.latestVersion = newRelease.version;
					this.ui.requestRender();
				}
			})
			.catch(() => {
				// Best-effort; a stale badge is harmless.
			});
	}

	showNewVersionNotification(release: LatestPorcupineRelease): void {
		const action = theme.fg("accent", `${APP_NAME} update`);
		const updateInstruction = theme.fg("muted", `New version ${release.version} is available. Run `) + action;
		const changelogUrl = getProductEnvironment("CHANGELOG_URL");
		const note = release.note?.trim();

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.chatContainer.addChild(
			new Text(`${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}`, 1, 0),
		);
		if (note) {
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Markdown(note, 1, 0, this.getMarkdownThemeWithSettings(), {
					color: (text) => theme.fg("muted", text),
				}),
			);
			this.chatContainer.addChild(new Spacer(1));
		}
		if (changelogUrl) {
			const changelogLink = getCapabilities().hyperlinks
				? hyperlink(theme.fg("accent", changelogUrl), changelogUrl)
				: theme.fg("accent", changelogUrl);
			const changelogLine = theme.fg("muted", "Changelog: ") + changelogLink;
			this.chatContainer.addChild(new Text(changelogLine, 1, 0));
		}
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ui.requestRender();
	}

	showPackageUpdateNotification(packages: string[]): void {
		const action = theme.fg("accent", `${APP_NAME} update --extensions`);
		const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
		const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.chatContainer.addChild(
			new Text(
				`${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
				1,
				0,
			),
		);
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ui.requestRender();
	}

	/**
	 * Get all queued messages (read-only).
	 * Combines session queue and compaction queue.
	 */
	private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
		return {
			steering: [
				...this.session.getSteeringMessages(),
				...this.compactionQueuedMessages.filter((msg) => msg.mode === "steer").map((msg) => msg.text),
			],
			followUp: [
				...this.session.getFollowUpMessages(),
				...this.compactionQueuedMessages.filter((msg) => msg.mode === "followUp").map((msg) => msg.text),
			],
		};
	}

	/**
	 * Clear all queued messages and return their contents.
	 * Clears both session queue and compaction queue.
	 */
	private clearAllQueues(): { steering: string[]; followUp: string[] } {
		const { steering, followUp } = this.session.clearQueue();
		const compactionSteering = this.compactionQueuedMessages
			.filter((msg) => msg.mode === "steer")
			.map((msg) => msg.text);
		const compactionFollowUp = this.compactionQueuedMessages
			.filter((msg) => msg.mode === "followUp")
			.map((msg) => msg.text);
		this.compactionQueuedMessages = [];
		return {
			steering: [...steering, ...compactionSteering],
			followUp: [...followUp, ...compactionFollowUp],
		};
	}

	private updatePendingMessagesDisplay(): void {
		this.pendingMessagesContainer.clear();
		const { steering: steeringMessages, followUp: followUpMessages } = this.getAllQueuedMessages();
		if (steeringMessages.length > 0 || followUpMessages.length > 0) {
			this.pendingMessagesContainer.addChild(new Spacer(1));
			for (const message of steeringMessages) {
				const text = theme.fg("dim", `Steering: ${message}`);
				this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			for (const message of followUpMessages) {
				const text = theme.fg("dim", `Follow-up: ${message}`);
				this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
			}
			const dequeueHint = this.getAppKeyDisplay("app.message.dequeue");
			const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
			this.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
		}
	}

	private restoreQueuedMessagesToEditor(options?: { abort?: boolean; currentText?: string }): number {
		const { steering, followUp } = this.clearAllQueues();
		const allQueued = [...steering, ...followUp];
		if (allQueued.length === 0) {
			this.updatePendingMessagesDisplay();
			if (options?.abort) {
				this.agent.abort();
			}
			return 0;
		}
		const queuedText = allQueued.join("\n\n");
		const currentText = options?.currentText ?? this.editor.getText();
		const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
		this.editor.setText(combinedText);
		this.updatePendingMessagesDisplay();
		if (options?.abort) {
			this.agent.abort();
		}
		return allQueued.length;
	}

	private queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
		this.compactionQueuedMessages.push({ text, mode });
		this.editor.addToHistory?.(text);
		this.editor.setText("");
		this.updatePendingMessagesDisplay();
		this.showStatus("Queued message for after compaction");
	}

	private isExtensionCommand(text: string): boolean {
		if (!text.startsWith("/")) return false;

		const extensionRunner = this.session.extensionRunner;

		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		return !!extensionRunner.getCommand(commandName);
	}

	private async flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
		if (this.compactionQueuedMessages.length === 0) {
			return;
		}

		const queuedMessages = [...this.compactionQueuedMessages];
		this.compactionQueuedMessages = [];
		this.updatePendingMessagesDisplay();

		const restoreQueue = (error: unknown) => {
			this.session.clearQueue();
			this.compactionQueuedMessages = queuedMessages;
			this.updatePendingMessagesDisplay();
			this.showError(
				`Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		};

		try {
			if (options?.willRetry) {
				// When retry is pending, queue messages for the retry turn
				for (const message of queuedMessages) {
					if (this.isExtensionCommand(message.text)) {
						await this.session.prompt(message.text);
					} else if (message.mode === "followUp") {
						await this.session.followUp(message.text);
					} else {
						await this.session.steer(message.text);
					}
				}
				this.updatePendingMessagesDisplay();
				return;
			}

			// Find first non-extension-command message to use as prompt
			const firstPromptIndex = queuedMessages.findIndex((message) => !this.isExtensionCommand(message.text));
			if (firstPromptIndex === -1) {
				// All extension commands - execute them all
				for (const message of queuedMessages) {
					await this.session.prompt(message.text);
				}
				return;
			}

			// Execute any extension commands before the first prompt
			const preCommands = queuedMessages.slice(0, firstPromptIndex);
			const firstPrompt = queuedMessages[firstPromptIndex];
			const rest = queuedMessages.slice(firstPromptIndex + 1);

			for (const message of preCommands) {
				await this.session.prompt(message.text);
			}

			// Start a prompt when idle, or queue it into a run still finishing compaction.
			const promptPromise = this.session
				.prompt(firstPrompt.text, { streamingBehavior: firstPrompt.mode })
				.catch((error) => {
					restoreQueue(error);
				});

			// Queue remaining messages
			for (const message of rest) {
				if (this.isExtensionCommand(message.text)) {
					await this.session.prompt(message.text);
				} else if (message.mode === "followUp") {
					await this.session.followUp(message.text);
				} else {
					await this.session.steer(message.text);
				}
			}
			this.updatePendingMessagesDisplay();
			void promptPromise;
		} catch (error) {
			restoreQueue(error);
		}
	}

	/** Move pending bash components from pending area to chat */
	private flushPendingBashComponents(): void {
		for (const component of this.pendingBashComponents) {
			this.pendingMessagesContainer.removeChild(component);
			this.chatContainer.addChild(component);
		}
		this.pendingBashComponents = [];
	}

	// =========================================================================
	// Selectors
	// =========================================================================

	/**
	 * Shows a selector component in place of the editor.
	 * @param create Factory that receives a `done` callback and returns the component and focus target
	 */
	private showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
		const done = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
		};
		const { component, focus } = create(done);
		this.editorContainer.clear();
		this.editorContainer.addChild(component);
		this.ui.setFocus(focus);
		this.ui.requestRender();
	}

	/**
	 * Show a markdown document as a full-screen overlay viewer.
	 * Used both by the agent-initiated `show_markdown` tool and the `/view` command.
	 */
	/**
	 * /kill — instant hard stop. No prompts, no negotiation: aborts the current
	 * run, kills bash, cancels every sub-agent, and kills tracked children.
	 */
	private handleKillCommand(): void {
		this.restoreQueuedMessagesToEditor({ abort: true });
		void this.session.abort().catch(() => {});
		this.session.abortBash();
		this.session.cancelAllSubagents();
		killTrackedDetachedChildren();
		this.ui.setFocus(this.editor as Component);
		this.showStatus("⏹ Killed: run, bash, and sub-agents stopped");
	}

	private showMarkdownViewer(entry: { title: string; content: string; path?: string }): void {
		if (this.ui.hasOverlay()) {
			this.showWarning("Another dialog is already open.");
			return;
		}

		const closeHint = keyText("tui.select.cancel");
		const upHint = keyDisplayText("tui.select.up");
		const downHint = keyDisplayText("tui.select.down");
		const pageUpHint = keyDisplayText("tui.select.pageUp");
		const pageDownHint = keyDisplayText("tui.select.pageDown");
		const footerHint = `q / ${closeHint} close  ·  ${upHint}/${downHint}/${pageUpHint}/${pageDownHint} scroll`;

		const viewer = new TuiLayouts.MarkdownViewer({
			getHeight: () => this.ui.terminal.rows,
			title: entry.title,
			text: entry.content,
			markdownTheme: this.getMarkdownThemeWithSettings(),
			style: {
				border: (text: string) => theme.fg("border", text),
				title: (text: string) => theme.bold(theme.fg("accent", text)),
				footer: (text: string) => theme.fg("dim", text),
				contentEdge: (text: string) => theme.fg("border", text),
			},
			footerHint,
			onClose: () => {
				this.ui.hideOverlay();
				this.ui.setFocus(this.editor);
				this.ui.requestRender();
			},
			requestRender: () => {
				this.ui.requestRender();
			},
		});
		this.ui.showOverlay(viewer, { width: "100%", maxHeight: "100%", margin: 1 });
		this.ui.requestRender();
	}

	/**
	 * Load a markdown file and open it in the full-screen viewer (used by `/view`).
	 */
	private async handleViewCommand(filePath: string): Promise<void> {
		try {
			const absolutePath = await resolveReadPathAsync(filePath, this.sessionManager.getCwd());
			const stat = await fs.promises.stat(absolutePath);
			if (stat.size > SHOW_MARKDOWN_MAX_BYTES) {
				this.showError(
					`File is ${stat.size} bytes, exceeds the ${SHOW_MARKDOWN_MAX_BYTES / 1024}KB markdown viewer limit.`,
				);
				return;
			}
			const content = await fs.promises.readFile(absolutePath, "utf-8");
			this.showMarkdownViewer({ title: path.basename(absolutePath), content, path: absolutePath });
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private showSettingsSelector(): void {
		this.showSelector((done) => {
			const selector = new SettingsSelectorComponent(
				{
					autoCompact: this.session.autoCompactionEnabled,
					showImages: this.settingsManager.getShowImages(),
					imageWidthCells: this.settingsManager.getImageWidthCells(),
					autoResizeImages: this.settingsManager.getImageAutoResize(),
					blockImages: this.settingsManager.getBlockImages(),
					enableSkillCommands: this.settingsManager.getEnableSkillCommands(),
					steeringMode: this.session.steeringMode,
					followUpMode: this.session.followUpMode,
					transport: this.settingsManager.getTransport(),
					httpIdleTimeoutMs: this.settingsManager.getHttpIdleTimeoutMs(),
					thinkingLevel: this.session.thinkingLevel,
					availableThinkingLevels: this.session.getAvailableThinkingLevels(),
					adaptiveReasoning: this.session.isAdaptiveReasoningEnabled,
					currentTheme: this.settingsManager.getThemeSetting() || "dark",
					terminalTheme: this.themeController.getTerminalTheme(),
					availableThemes: getAvailableThemes(),
					hideThinkingBlock: this.hideThinkingBlock,
					collapseChangelog: this.settingsManager.getCollapseChangelog(),
					enableInstallTelemetry: this.settingsManager.getEnableInstallTelemetry(),
					doubleEscapeAction: this.settingsManager.getDoubleEscapeAction(),
					treeFilterMode: this.settingsManager.getTreeFilterMode(),
					showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
					showCacheMissNotices: this.settingsManager.getShowCacheMissNotices(),
					defaultProjectTrust: this.settingsManager.getDefaultProjectTrust(),
					editorPaddingX: this.settingsManager.getEditorPaddingX(),
					outputPad: this.settingsManager.getOutputPad(),
					autocompleteMaxVisible: this.settingsManager.getAutocompleteMaxVisible(),
					quietStartup: this.settingsManager.getQuietStartup(),
					clearOnShrink: this.settingsManager.getClearOnShrink(),
					showTerminalProgress: this.settingsManager.getShowTerminalProgress(),
					uiMode: this.settingsManager.getUiMode(),
					fullscreenScrollbar: this.settingsManager.getFullscreenScrollbar(),
					warnings: this.settingsManager.getWarnings(),
				},
				{
					onAutoCompactChange: (enabled) => {
						this.session.setAutoCompactionEnabled(enabled);
						this.footer.setAutoCompactEnabled(enabled);
					},
					onShowImagesChange: (enabled) => {
						this.settingsManager.setShowImages(enabled);
						for (const child of this.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) {
								child.setShowImages(enabled);
							}
						}
					},
					onImageWidthCellsChange: (width) => {
						this.settingsManager.setImageWidthCells(width);
						for (const child of this.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) {
								child.setImageWidthCells(width);
							}
						}
					},
					onAutoResizeImagesChange: (enabled) => {
						this.settingsManager.setImageAutoResize(enabled);
					},
					onBlockImagesChange: (blocked) => {
						this.settingsManager.setBlockImages(blocked);
					},
					onEnableSkillCommandsChange: (enabled) => {
						this.settingsManager.setEnableSkillCommands(enabled);
						this.setupAutocompleteProvider();
					},
					onSteeringModeChange: (mode) => {
						this.session.setSteeringMode(mode);
					},
					onFollowUpModeChange: (mode) => {
						this.session.setFollowUpMode(mode);
					},
					onTransportChange: (transport) => {
						this.settingsManager.setTransport(transport);
						this.session.agent.transport = transport;
					},
					onHttpIdleTimeoutMsChange: (timeoutMs) => {
						this.settingsManager.setHttpIdleTimeoutMs(timeoutMs);
						configureHttpDispatcher(timeoutMs);
						this.showStatus(`HTTP idle timeout: ${formatHttpIdleTimeoutMs(timeoutMs)}`);
					},
					onThinkingLevelChange: (level) => {
						this.applyReasoningMode(level as ReasoningMode);
					},
					onThemeChange: (themeSetting) => {
						this.settingsManager.setTheme(themeSetting);
						void this.themeController.applyFromSettings();
					},
					onThemePreview: (themeName) => this.themeController.preview(themeName),
					onHideThinkingBlockChange: (hidden) => {
						this.hideThinkingBlock = hidden;
						this.settingsManager.setHideThinkingBlock(hidden);
						for (const child of this.chatContainer.children) {
							if (child instanceof AssistantMessageComponent) {
								child.setHideThinkingBlock(hidden);
							}
						}
						this.chatContainer.clear();
						this.rebuildChatFromMessages();
					},
					onShowCacheMissNoticesChange: (shown) => {
						this.settingsManager.setShowCacheMissNotices(shown);
						this.rebuildChatFromMessages();
					},
					onCollapseChangelogChange: (collapsed) => {
						this.settingsManager.setCollapseChangelog(collapsed);
					},
					onEnableInstallTelemetryChange: (enabled) => {
						this.settingsManager.setEnableInstallTelemetry(enabled);
					},
					onQuietStartupChange: (enabled) => {
						this.settingsManager.setQuietStartup(enabled);
					},
					onDefaultProjectTrustChange: (defaultProjectTrust) => {
						this.settingsManager.setDefaultProjectTrust(defaultProjectTrust);
					},
					onDoubleEscapeActionChange: (action) => {
						this.settingsManager.setDoubleEscapeAction(action);
					},
					onTreeFilterModeChange: (mode) => {
						this.settingsManager.setTreeFilterMode(mode);
					},
					onShowHardwareCursorChange: (enabled) => {
						this.settingsManager.setShowHardwareCursor(enabled);
						this.ui.setShowHardwareCursor(enabled);
					},
					onEditorPaddingXChange: (padding) => {
						this.settingsManager.setEditorPaddingX(padding);
						this.defaultEditor.setPaddingX(padding);
						if (this.editor !== this.defaultEditor && this.editor.setPaddingX !== undefined) {
							this.editor.setPaddingX(padding);
						}
					},
					onOutputPadChange: (padding) => {
						this.settingsManager.setOutputPad(padding);
						this.outputPad = padding;
						if (this.streamingComponent || this.session.isStreaming) {
							for (const child of this.chatContainer.children) {
								if (
									child instanceof AssistantMessageComponent ||
									child instanceof CustomMessageComponent ||
									child instanceof UserMessageComponent
								) {
									child.setOutputPad(padding);
								}
							}
							if (this.streamingComponent) {
								this.streamingComponent.setOutputPad(padding);
							}
							this.ui.requestRender();
							return;
						}
						this.rebuildChatFromMessages();
					},
					onAutocompleteMaxVisibleChange: (maxVisible) => {
						this.settingsManager.setAutocompleteMaxVisible(maxVisible);
						this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
						if (this.editor !== this.defaultEditor && this.editor.setAutocompleteMaxVisible !== undefined) {
							this.editor.setAutocompleteMaxVisible(maxVisible);
						}
					},
					onClearOnShrinkChange: (enabled) => {
						this.settingsManager.setClearOnShrink(enabled);
						this.ui.setClearOnShrink(enabled);
						if (!enabled && !this.activeStatusIndicator) {
							this.statusContainer.clear();
						}
					},
					onShowTerminalProgressChange: (enabled) => {
						this.settingsManager.setShowTerminalProgress(enabled);
					},
					onUiModeChange: (mode) => {
						this.settingsManager.setUiMode(mode);
						this.showStatus(`UI mode: ${mode} (restart required)`);
					},
					onFullscreenScrollbarChange: (mode) => {
						this.settingsManager.setFullscreenScrollbar(mode);
						this.applyFullscreenScrollbarSetting();
					},
					onWarningsChange: (warnings) => {
						this.settingsManager.setWarnings(warnings);
					},
					onCancel: () => {
						done();
						this.ui.requestRender();
					},
				},
			);
			return { component: selector, focus: selector.getSettingsList() };
		});
	}

	private async handleModelCommand(searchTerm?: string): Promise<void> {
		if (!searchTerm) {
			this.showModelSelector();
			return;
		}

		const model = await this.findExactModelMatch(searchTerm);
		if (model) {
			try {
				await this.session.setModel(model);
				this.footer.invalidate();
				this.updateEditorBorderColor();
				this.showStatus(`Model: ${model.id}`);
				void this.maybeWarnAboutAnthropicSubscriptionAuth(model);
				this.checkDaxnutsEasterEgg(model);
			} catch (error) {
				this.showError(error instanceof Error ? error.message : String(error));
			}
			return;
		}

		this.showModelSelector(searchTerm);
	}

	private async findExactModelMatch(searchTerm: string): Promise<Model<any> | undefined> {
		const models = await this.getModelCandidates();
		return findExactModelReferenceMatch(searchTerm, models);
	}

	private async getModelCandidates(): Promise<Model<any>[]> {
		if (this.session.scopedModels.length > 0) {
			return this.session.scopedModels.map((scoped) => scoped.model);
		}

		try {
			await this.session.modelRuntime.refresh();
			return [...(await this.session.modelRuntime.getAvailable())];
		} catch {
			return [];
		}
	}

	/** Update the footer's available provider count from the current snapshot without refreshing catalogs. */
	private updateAvailableProviderCount(): void {
		const models =
			this.session.scopedModels.length > 0
				? this.session.scopedModels.map((scoped) => scoped.model)
				: this.session.modelRuntime.getAvailableSnapshot();
		const uniqueProviders = new Set(models.map((model) => model.provider));
		this.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
	}

	private async maybeWarnAboutAnthropicSubscriptionAuth(
		model: Model<any> | undefined = this.session.model,
	): Promise<void> {
		if (this.settingsManager.getWarnings().anthropicExtraUsage === false) {
			return;
		}
		if (this.anthropicSubscriptionWarningShown) {
			return;
		}
		if (!model || model.provider !== "anthropic") {
			return;
		}

		try {
			if ((await this.session.modelRuntime.checkAuth("anthropic"))?.type === "oauth") {
				this.anthropicSubscriptionWarningShown = true;
				this.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
				return;
			}
			const apiKey = (await this.session.modelRuntime.getAuth(model.provider))?.auth.apiKey;
			if (!isAnthropicSubscriptionAuthKey(apiKey)) {
				return;
			}
			this.anthropicSubscriptionWarningShown = true;
			this.showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING);
		} catch {
			// Ignore auth lookup failures for warning-only checks.
		}
	}

	private maybeSaveImplicitProjectTrustAfterReload(): boolean {
		const cwd = this.sessionManager.getCwd();
		if (this.autoTrustOnReloadCwd !== cwd) {
			return false;
		}
		if (!this.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(cwd)) {
			return false;
		}

		const trustStore = new ProjectTrustStore(this.runtimeHost.services.agentDir);
		try {
			if (trustStore.get(cwd) !== null) {
				this.autoTrustOnReloadCwd = undefined;
				return false;
			}
			trustStore.set(cwd, true);
			this.autoTrustOnReloadCwd = undefined;
			return true;
		} catch (error) {
			this.showWarning(
				`Could not save project trust after reload: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}

	private showTrustSelector(): void {
		const cwd = this.sessionManager.getCwd();
		const trustStore = new ProjectTrustStore(this.runtimeHost.services.agentDir);
		const savedDecision = trustStore.getEntry(cwd);
		this.showSelector((done) => {
			const selector = new TrustSelectorComponent({
				cwd,
				savedDecision,
				projectTrusted: this.settingsManager.isProjectTrusted(),
				onSelect: (selection) => {
					trustStore.setMany(selection.updates);
					done();
					this.showStatus(
						`Saved trust decision: ${selection.trusted ? "trusted" : "untrusted"}. Restart porcupine for this to take effect.`,
					);
				},
				onCancel: () => {
					done();
					this.ui.requestRender();
				},
			});
			return { component: selector, focus: selector };
		});
	}

	private showModelSelector(initialSearchInput?: string): void {
		this.showSelector((done) => {
			const selector = new ModelSelectorComponent(
				this.ui,
				this.session.model,
				this.settingsManager,
				this.session.modelRuntime,
				this.session.scopedModels,
				async (model) => {
					try {
						await this.session.setModel(model);
						this.footer.invalidate();
						this.updateEditorBorderColor();
						done();
						this.showStatus(`Model: ${model.id}`);
						void this.maybeWarnAboutAnthropicSubscriptionAuth(model);
						this.checkDaxnutsEasterEgg(model);
					} catch (error) {
						done();
						this.showError(error instanceof Error ? error.message : String(error));
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
				initialSearchInput,
			);
			return { component: selector, focus: selector };
		});
	}

	private async showModelsSelector(): Promise<void> {
		// Get all available models
		await this.session.modelRuntime.refresh();
		const allModels = [...(await this.session.modelRuntime.getAvailable())];
		const allModelIds = new Set(allModels.map((model) => `${model.provider}/${model.id}`));
		const configuredPatterns = this.settingsManager.getEnabledModels();
		const sessionScopedModels = this.session.scopedModels;

		if (allModels.length === 0 && !configuredPatterns?.length && sessionScopedModels.length === 0) {
			this.showStatus("No models available");
			return;
		}

		const configuredScope = configuredPatterns?.length
			? await resolveModelScopeWithDiagnostics(configuredPatterns, this.session.modelRuntime)
			: undefined;

		// Check if session has scoped models (from previous session-only changes or CLI --models)
		const hasSessionScope = sessionScopedModels.length > 0;

		// Build enabled model IDs from session state or settings
		let currentEnabledIds: string[] | null = null;

		if (hasSessionScope) {
			// Use current session's scoped models
			currentEnabledIds = sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`);
		} else if (configuredScope) {
			currentEnabledIds = configuredScope.scopedModels.map(
				(scoped) => `${scoped.model.provider}/${scoped.model.id}`,
			);
		}

		for (const diagnostic of configuredScope?.diagnostics ?? []) {
			if (diagnostic.code !== "no-match") continue;
			currentEnabledIds ??= [];
			if (!currentEnabledIds.includes(diagnostic.pattern)) currentEnabledIds.push(diagnostic.pattern);
		}

		// Helper to update session's scoped models (session-only, no persist)
		const updateSessionModels = async (enabledIds: string[] | null) => {
			currentEnabledIds = enabledIds === null ? null : [...enabledIds];
			const hasEnabledAvailableModel = enabledIds?.some((id) => allModelIds.has(id)) ?? false;
			const allAvailableModelsEnabled =
				enabledIds !== null && [...allModelIds].every((id) => enabledIds.includes(id));
			if (enabledIds && hasEnabledAvailableModel && !allAvailableModelsEnabled) {
				const newScopedModels = await resolveModelScope(enabledIds, this.session.modelRuntime);
				this.session.setScopedModels(
					newScopedModels.map((sm) => ({
						model: sm.model,
						thinkingLevel: sm.thinkingLevel,
					})),
				);
			} else {
				// All enabled or none enabled = no filter
				this.session.setScopedModels([]);
			}
			await this.updateAvailableProviderCount();
			this.ui.requestRender();
		};

		this.showSelector((done) => {
			const selector = new ScopedModelsSelectorComponent(
				{
					allModels,
					enabledModelIds: currentEnabledIds,
				},
				{
					onChange: async (enabledIds) => {
						await updateSessionModels(enabledIds);
					},
					onPersist: (enabledIds) => {
						// Persist to settings
						const allEnabled =
							enabledIds !== null &&
							enabledIds.length === allModels.length &&
							enabledIds.every((id) => allModelIds.has(id));
						const newPatterns = enabledIds === null || allEnabled ? undefined : enabledIds;
						this.settingsManager.setEnabledModels(newPatterns ? [...newPatterns] : undefined);
						this.showStatus("Model selection saved to settings");
					},
					onCancel: () => {
						done();
						this.ui.requestRender();
					},
				},
			);
			return { component: selector, focus: selector };
		});
	}

	private showUserMessageSelector(): void {
		const userMessages = this.session.getUserMessagesForForking();

		if (userMessages.length === 0) {
			this.showStatus("No messages to fork from");
			return;
		}

		const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

		this.showSelector((done) => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map((m) => ({ id: m.entryId, text: m.text })),
				async (entryId) => {
					done();
					try {
						const result = await this.runtimeHost.fork(entryId);
						if (result.cancelled) {
							this.ui.requestRender();
							return;
						}

						this.editor.setText(result.selectedText ?? "");
						this.showStatus("Forked to new session");
					} catch (error: unknown) {
						this.showError(error instanceof Error ? error.message : String(error));
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
				initialSelectedId,
			);
			return { component: selector, focus: selector.getMessageList() };
		});
	}

	private async handleCloneCommand(): Promise<void> {
		const leafId = this.sessionManager.getLeafId();
		if (!leafId) {
			this.showStatus("Nothing to clone yet");
			return;
		}

		try {
			const result = await this.runtimeHost.fork(leafId, { position: "at" });
			if (result.cancelled) {
				this.ui.requestRender();
				return;
			}

			this.editor.setText("");
			this.showStatus("Cloned to new session");
		} catch (error: unknown) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private showTreeSelector(initialSelectedId?: string): void {
		const tree = this.sessionManager.getTree();
		const realLeafId = this.sessionManager.getLeafId();
		const initialFilterMode = this.settingsManager.getTreeFilterMode();

		if (tree.length === 0) {
			this.showStatus("No entries in session");
			return;
		}

		this.showSelector((done) => {
			const selector = new TreeSelectorComponent(
				tree,
				realLeafId,
				this.ui.terminal.rows,
				async (entryId) => {
					// Selecting the current leaf is a no-op (already there)
					if (entryId === this.sessionManager.getLeafId()) {
						done();
						this.showStatus("Already at this point");
						return;
					}

					// Ask about summarization
					done(); // Close selector first

					// Loop until user makes a complete choice or cancels to tree
					let wantsSummary = false;
					let customInstructions: string | undefined;

					// Check if we should skip the prompt (user preference to always default to no summary)
					if (!this.settingsManager.getBranchSummarySkipPrompt()) {
						while (true) {
							const summaryChoice = await this.showExtensionSelector("Summarize branch?", [
								"No summary",
								"Summarize",
								"Summarize with custom prompt",
							]);

							if (summaryChoice === undefined) {
								// User pressed escape - re-show tree selector with same selection
								this.showTreeSelector(entryId);
								return;
							}

							wantsSummary = summaryChoice !== "No summary";

							if (summaryChoice === "Summarize with custom prompt") {
								customInstructions = await this.showExtensionEditor("Custom summarization instructions");
								if (customInstructions === undefined) {
									// User cancelled - loop back to summary selector
									continue;
								}
							}

							// User made a complete choice
							break;
						}
					}

					// The user committed to navigating: stop the active response first.
					if (this.session.isStreaming) {
						this.restoreQueuedMessagesToEditor();
						await this.session.abort();
					}

					// Set up escape handler and status indicator if summarizing
					let showingSummaryIndicator = false;
					const originalOnEscape = this.defaultEditor.onEscape;

					if (wantsSummary) {
						this.defaultEditor.onEscape = () => {
							this.session.abortBranchSummary();
						};
						this.chatContainer.addChild(new Spacer(1));
						this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
						showingSummaryIndicator = true;
						this.ui.requestRender();
					}

					try {
						const result = await this.session.navigateTree(entryId, {
							summarize: wantsSummary,
							customInstructions,
						});

						if (result.aborted) {
							// Summarization aborted - re-show tree selector with same selection
							this.showStatus("Branch summarization cancelled");
							this.showTreeSelector(entryId);
							return;
						}
						if (result.cancelled) {
							this.showStatus("Navigation cancelled");
							return;
						}

						// Update UI
						this.chatContainer.clear();
						this.renderInitialMessages();
						if (result.editorText && !this.editor.getText().trim()) {
							this.editor.setText(result.editorText);
						}
						this.showStatus("Navigated to selected point");
						void this.flushCompactionQueue({ willRetry: false });
					} catch (error) {
						this.showError(error instanceof Error ? error.message : String(error));
					} finally {
						if (showingSummaryIndicator) {
							this.clearStatusIndicator("branchSummary");
						}
						this.defaultEditor.onEscape = originalOnEscape;
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
				(entryId, label) => {
					this.sessionManager.appendLabelChange(entryId, label);
					this.ui.requestRender();
				},
				initialSelectedId,
				initialFilterMode,
			);
			selector.onCopy = async (text) => {
				if (!text) {
					this.showError("Selected entry has no text to copy");
					return;
				}
				try {
					await copyToClipboard(text);
					this.showStatus("Copied selected message to clipboard");
				} catch (error) {
					this.showError(error instanceof Error ? error.message : String(error));
				}
			};
			return { component: selector, focus: selector };
		});
	}

	private showSessionSelector(): void {
		this.showSelector((done) => {
			const selector = new SessionSelectorComponent(
				(onProgress) =>
					SessionManager.list(this.sessionManager.getCwd(), this.sessionManager.getSessionDir(), onProgress),
				(onProgress) =>
					this.sessionManager.usesDefaultSessionDir()
						? SessionManager.listAll(onProgress)
						: SessionManager.listAll(this.sessionManager.getSessionDir(), onProgress),
				async (sessionPath) => {
					done();
					await this.handleResumeSession(sessionPath);
				},
				() => {
					done();
					this.ui.requestRender();
				},
				() => {
					void this.shutdown();
				},
				() => this.ui.requestRender(),
				{
					renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
						const next = (nextName ?? "").trim();
						if (!next) return;
						const mgr = SessionManager.open(sessionFilePath);
						mgr.appendSessionInfo(next);
					},
					showRenameHint: true,
					keybindings: this.keybindings,
				},

				this.sessionManager.getSessionFile(),
			);
			return { component: selector, focus: selector };
		});
	}

	private async handleResumeSession(
		sessionPath: string,
		options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
	): Promise<{ cancelled: boolean }> {
		this.clearStatusIndicator();
		try {
			const result = await this.runtimeHost.switchSession(sessionPath, {
				withSession: options?.withSession,
				projectTrustContextFactory: (cwd) => this.createProjectTrustContext(cwd),
			});
			if (result.cancelled) {
				return result;
			}
			this.showStatus("Resumed session");
			return result;
		} catch (error: unknown) {
			if (error instanceof MissingSessionCwdError) {
				const selectedCwd = await this.promptForMissingSessionCwd(error);
				if (!selectedCwd) {
					this.showStatus("Resume cancelled");
					return { cancelled: true };
				}
				const result = await this.runtimeHost.switchSession(sessionPath, {
					cwdOverride: selectedCwd,
					withSession: options?.withSession,
					projectTrustContextFactory: (cwd) => this.createProjectTrustContext(cwd),
				});
				if (result.cancelled) {
					return result;
				}
				this.showStatus("Resumed session in current cwd");
				return result;
			}
			return this.handleFatalRuntimeError("Failed to resume session", error);
		}
	}

	private getLoginProviderOptions(authType?: "oauth" | "api_key"): AuthSelectorProvider[] {
		const options: AuthSelectorProvider[] = [];
		for (const provider of this.session.modelRuntime.getProviders()) {
			const authStatus = this.session.modelRuntime.getProviderAuthStatus(provider.id);
			const status = authStatus.configured
				? {
						type: this.session.modelRuntime.isUsingOAuth(provider.id) ? ("oauth" as const) : ("api_key" as const),
						source: authStatus.label ?? authStatus.source,
					}
				: undefined;
			if ((!authType || authType === "oauth") && provider.auth.oauth) {
				options.push({
					id: provider.id,
					name: provider.name,
					authType: "oauth",
					method: provider.auth.oauth,
					status,
				});
			}
			if ((!authType || authType === "api_key") && provider.auth.apiKey) {
				options.push({
					id: provider.id,
					name: provider.name,
					authType: "api_key",
					method: provider.auth.apiKey,
					status,
				});
			}
		}
		return options.sort((a, b) => a.name.localeCompare(b.name));
	}

	private async getLogoutProviderOptions(): Promise<AuthSelectorProvider[]> {
		return (await this.session.modelRuntime.listCredentials())
			.map(({ providerId, type }) => ({
				id: providerId,
				name: this.session.modelRuntime.getProvider(providerId)?.name ?? providerId,
				authType: type,
				status: { type, source: "stored credential" },
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	private findLoginProviderOptions(providerRef: string): AuthSelectorProvider[] {
		const normalizedProviderRef = providerRef.trim().toLowerCase();
		if (!normalizedProviderRef) {
			return [];
		}

		return this.getLoginProviderOptions().filter(
			(provider) =>
				provider.id.toLowerCase() === normalizedProviderRef ||
				provider.name.toLowerCase() === normalizedProviderRef,
		);
	}

	private async handleLoginCommand(providerRef?: string): Promise<void> {
		await this.session.modelRuntime.getAvailable();
		if (!providerRef) {
			this.showLoginAuthTypeSelector();
			return;
		}

		const providerOptions = this.findLoginProviderOptions(providerRef);
		if (providerOptions.length === 1) {
			await this.startProviderLogin(providerOptions[0]!);
			return;
		}

		if (providerOptions.length > 1) {
			const providerIds = new Set(providerOptions.map((provider) => provider.id));
			if (providerIds.size === 1) {
				this.showLoginAuthTypeSelector(providerOptions);
				return;
			}
		}

		this.showLoginProviderSelector(undefined, providerRef);
	}

	private async startProviderLogin(providerOption: AuthSelectorProvider): Promise<void> {
		if (providerOption.authType === "oauth") {
			await this.showLoginDialog(providerOption.id, providerOption.name);
		} else if (providerOption.method?.login) {
			await this.showApiKeyLoginDialog(providerOption.id, providerOption.name);
		} else {
			this.showAmbientAuthDialog(providerOption);
		}
	}

	private showLoginAuthTypeSelector(providerOptions?: AuthSelectorProvider[]): void {
		const oauthProvider = providerOptions?.find((provider) => provider.authType === "oauth");
		const oauthLoginLabel =
			oauthProvider?.method && "loginLabel" in oauthProvider.method ? oauthProvider.method.loginLabel : undefined;
		const subscriptionLabel = oauthLoginLabel ?? "Sign in with an account";
		const apiKeyLabel = "Sign in with an API key";
		const availableAuthTypes = providerOptions
			? new Set(providerOptions.map((provider) => provider.authType))
			: new Set<AuthSelectorProvider["authType"]>(["oauth", "api_key"]);
		const options: string[] = [];
		if (availableAuthTypes.has("oauth")) {
			options.push(subscriptionLabel);
		}
		if (availableAuthTypes.has("api_key")) {
			options.push(apiKeyLabel);
		}

		if (options.length === 0) {
			this.showStatus("No login methods available.");
			return;
		}

		if (providerOptions && options.length === 1) {
			const providerOption = providerOptions[0];
			if (providerOption) {
				void this.startProviderLogin(providerOption);
			}
			return;
		}

		const title = providerOptions?.[0]
			? `Select authentication method for ${providerOptions[0].name}:`
			: "Select authentication method:";
		this.showSelector((done) => {
			const selector = new ExtensionSelectorComponent(
				title,
				options,
				(option) => {
					done();
					const authType = option === subscriptionLabel ? "oauth" : "api_key";
					if (providerOptions) {
						const providerOption = providerOptions.find((provider) => provider.authType === authType);
						if (providerOption) {
							void this.startProviderLogin(providerOption);
						}
						return;
					}
					this.showLoginProviderSelector(authType);
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	private showLoginProviderSelector(authType?: AuthSelectorProvider["authType"], initialSearchInput?: string): void {
		const providerOptions = this.getLoginProviderOptions(authType);
		if (providerOptions.length === 0) {
			const message =
				authType === "oauth"
					? "No subscription providers available."
					: authType === "api_key"
						? "No API key providers available."
						: "No login providers available.";
			this.showStatus(message);
			return;
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				"login",
				providerOptions,
				async (providerId, selectedAuthType) => {
					done();

					const providerOption = providerOptions.find(
						(provider) => provider.id === providerId && provider.authType === selectedAuthType,
					);
					if (!providerOption) {
						return;
					}

					await this.startProviderLogin(providerOption);
				},
				() => {
					done();
					if (authType) {
						this.showLoginAuthTypeSelector();
					} else {
						this.ui.requestRender();
					}
				},
				initialSearchInput,
			);
			return { component: selector, focus: selector };
		});
	}

	private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		if (mode === "login") {
			this.showLoginAuthTypeSelector();
			return;
		}

		const providerOptions = await this.getLogoutProviderOptions();
		if (providerOptions.length === 0) {
			this.showStatus(
				"No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
			);
			return;
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				mode,
				providerOptions,
				async (providerId: string) => {
					done();

					const providerOption = providerOptions.find((provider) => provider.id === providerId);
					if (!providerOption) {
						return;
					}

					try {
						await this.session.modelRuntime.logout(providerOption.id);
						await this.updateAvailableProviderCount();
						const message =
							providerOption.authType === "oauth"
								? `Logged out of ${providerOption.name}`
								: `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`;
						this.showStatus(message);
					} catch (error: unknown) {
						this.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	private async completeProviderAuthentication(
		providerId: string,
		providerName: string,
		authType: "oauth" | "api_key",
		previousModel: Model<any> | undefined,
	): Promise<void> {
		await this.session.modelRuntime.getAvailable();

		const actionLabel = authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

		let selectedModel: Model<any> | undefined;
		let selectionError: string | undefined;
		if (isUnknownModel(previousModel)) {
			const availableModels = await this.session.modelRuntime.getAvailable();
			const providerModels = availableModels.filter((model) => model.provider === providerId);
			if (!hasDefaultModelProvider(providerId)) {
				selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
			} else if (providerModels.length === 0) {
				selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
			} else {
				const defaultModelId = defaultModelPerProvider[providerId];
				selectedModel = providerModels.find((model) => model.id === defaultModelId);
				if (!selectedModel) {
					selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
				} else {
					try {
						await this.session.setModel(selectedModel);
					} catch (error: unknown) {
						selectedModel = undefined;
						const errorMessage = error instanceof Error ? error.message : String(error);
						selectionError = `${actionLabel}, but selecting its default model failed: ${errorMessage}. Use /model to select a model.`;
					}
				}
			}
		}

		await this.updateAvailableProviderCount();
		this.footer.invalidate();
		this.updateEditorBorderColor();
		if (selectedModel) {
			this.showStatus(`${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`);
			void this.maybeWarnAboutAnthropicSubscriptionAuth(selectedModel);
			this.checkDaxnutsEasterEgg(selectedModel);
		} else {
			this.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
			if (selectionError) {
				this.showError(selectionError);
			} else {
				void this.maybeWarnAboutAnthropicSubscriptionAuth();
			}
		}
	}

	private showAmbientAuthDialog(providerOption: AuthSelectorProvider): void {
		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		const dialog = new LoginDialogComponent(
			this.ui,
			providerOption.id,
			() => restoreEditor(),
			providerOption.name,
			`${providerOption.name} setup`,
		);
		dialog.showInfo(`${providerOption.method?.name ?? "Authentication"} is configured outside Porcupine.`, [], true);

		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();
	}

	private async showApiKeyLoginDialog(providerId: string, providerName: string): Promise<void> {
		const previousModel = this.session.model;

		const dialog = new LoginDialogComponent(
			this.ui,
			providerId,
			(_success, _message) => {
				// Completion handled below
			},
			providerName,
		);

		if (providerId === "amazon-bedrock") {
			dialog.showDetails([
				theme.fg("text", "You can also use an AWS profile, IAM keys, or role-based credentials."),
				theme.fg("muted", "See:"),
				theme.fg("accent", `  ${path.join(getDocsPath(), "providers.md")}`),
			]);
		}

		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		try {
			await this.loginProvider(dialog, providerId, "api_key");
			restoreEditor();
			await this.completeProviderAuthentication(providerId, providerName, "api_key", previousModel);
		} catch (error: unknown) {
			restoreEditor();
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (errorMsg !== "Login cancelled") {
				this.showError(`Failed to save API key for ${providerName}: ${errorMsg}`);
			}
		}
	}

	private showAuthSelect(
		dialog: LoginDialogComponent,
		prompt: Extract<AuthPrompt, { type: "select" }>,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const restoreDialog = () => {
				this.editorContainer.clear();
				this.editorContainer.addChild(dialog);
				this.ui.setFocus(dialog);
				this.ui.requestRender();
			};
			const labels = prompt.options.map((option) => option.label);
			const selector = new ExtensionSelectorComponent(
				prompt.message,
				labels,
				(optionLabel) => {
					restoreDialog();
					const id = prompt.options.find((option) => option.label === optionLabel)?.id;
					if (id) resolve(id);
					else reject(new Error("Login cancelled"));
				},
				() => {
					restoreDialog();
					reject(new Error("Login cancelled"));
				},
			);
			this.editorContainer.clear();
			this.editorContainer.addChild(selector);
			this.ui.setFocus(selector);
			this.ui.requestRender();
		});
	}

	private async showAuthPrompt(dialog: LoginDialogComponent, prompt: AuthPrompt): Promise<string> {
		let response: Promise<string>;
		if (prompt.type === "select") {
			response = this.showAuthSelect(dialog, prompt);
		} else if (prompt.type === "manual_code") {
			response = dialog.showManualInput(prompt.message);
		} else {
			response = dialog.showPrompt(prompt.message, prompt.placeholder);
		}
		if (!prompt.signal) return response;
		if (prompt.signal.aborted) throw new Error("Login cancelled");
		const signal = prompt.signal;
		let onAbort: (() => void) | undefined;
		const aborted = new Promise<string>((_resolve, reject) => {
			onAbort = () => reject(new Error("Login cancelled"));
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			return await Promise.race([response, aborted]);
		} finally {
			if (onAbort) signal.removeEventListener("abort", onAbort);
		}
	}

	private notifyAuthDialog(dialog: LoginDialogComponent, event: AuthEvent): void {
		if (event.type === "auth_url") {
			dialog.showAuth(event.url, event.instructions);
		} else if (event.type === "device_code") {
			dialog.showDeviceCode(event);
			dialog.showWaiting("Waiting for authentication...");
		} else if (event.type === "info") {
			dialog.showInfo(event.message, event.links);
		} else {
			dialog.showProgress(event.message);
		}
	}

	private async loginProvider(
		dialog: LoginDialogComponent,
		providerId: string,
		method: "api_key" | "oauth",
	): Promise<void> {
		await this.session.modelRuntime.login(providerId, method, {
			signal: dialog.signal,
			prompt: (prompt) => this.showAuthPrompt(dialog, prompt),
			notify: (event) => this.notifyAuthDialog(dialog, event),
		});
	}

	private async showLoginDialog(providerId: string, providerName: string): Promise<void> {
		const previousModel = this.session.model;
		const dialog = new LoginDialogComponent(this.ui, providerId, (_success, _message) => {}, providerName);
		this.editorContainer.clear();
		this.editorContainer.addChild(dialog);
		this.ui.setFocus(dialog);
		this.ui.requestRender();

		const restoreEditor = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			this.ui.requestRender();
		};

		try {
			await this.loginProvider(dialog, providerId, "oauth");
			restoreEditor();
			await this.completeProviderAuthentication(providerId, providerName, "oauth", previousModel);
		} catch (error: unknown) {
			restoreEditor();
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (errorMsg !== "Login cancelled") {
				this.showError(`Failed to login to ${providerName}: ${errorMsg}`);
			}
		}
	}

	// =========================================================================
	// Command handlers
	// =========================================================================

	/**
	 * Full Porcupine refresh: force-flush session → tear down runtime → recreate
	 * services (skills, extensions, tools, settings, themes, context) → resume
	 * this same session (chat + modes + thinking). Never degrades to /reload.
	 */
	private async handleRefreshCommand(): Promise<void> {
		if (this.session.isStreaming) {
			this.showWarning("Wait for the current response to finish before refreshing.");
			return;
		}
		if (this.session.isCompacting) {
			this.showWarning("Wait for compaction to finish before refreshing.");
			return;
		}
		if (this.session.hasActiveSubagents()) {
			this.showWarning("Cannot /refresh while sub-agents are running.");
			return;
		}
		if (this.session.isBashRunning) {
			this.showWarning("Cannot /refresh while bash is running.");
			return;
		}
		if (this.extensionSelector) {
			this.showWarning("Cannot /refresh while a confirmation or selector dialog is open.");
			return;
		}

		// Capture live session policy before the runtime is torn down.
		const ephemeralState = this.session.snapshotEphemeralSessionState();
		const editorText = this.editor.getText();

		// Background bridges poll / heartbeat over WS; stop them so their
		// reconnect churn cannot write to the raw stderr frame while the locked
		// refresh banner is up. They are restarted once the runtime is rebound.
		this.stopRemoteBridges();

		this.resetExtensionUI();

		const refreshBox = new Container();
		const borderColor = (s: string) => theme.fg("border", s);
		refreshBox.addChild(new DynamicBorder(borderColor));
		refreshBox.addChild(new Spacer(1));
		refreshBox.addChild(
			new Text(theme.fg("muted", "Rebuilding whole Porcupine runtime and resuming this session..."), 1, 0),
		);
		refreshBox.addChild(new Spacer(1));
		refreshBox.addChild(new DynamicBorder(borderColor));

		const previousEditor = this.editor;
		// Lock so resetExtensionUI / setCustomEditorComponent during rebuild
		// cannot yank the refresh banner out of the editor surface.
		this.editorSurfaceLocked = true;
		this.editorContainer.clear();
		this.editorContainer.addChild(refreshBox);
		this.ui.setFocus(refreshBox);
		this.ui.requestRender(true);
		await new Promise((resolve) => process.nextTick(resolve));

		const dismissRefreshBox = (editor: Component) => {
			this.editorSurfaceLocked = false;
			this.editorContainer.clear();
			this.editorContainer.addChild(editor);
			this.ui.setFocus(editor);
			this.ui.requestRender();
		};

		let refreshBoxDismissed = false;
		try {
			// Always full rebuild (flush → recreate services → resume). Never /reload.
			const result = await this.runtimeHost.refresh({
				projectTrustContextFactory: (cwd) => this.createProjectTrustContext(cwd),
			});
			if (result.cancelled) {
				dismissRefreshBox(this.editor as Component);
				refreshBoxDismissed = true;
				this.startRemoteBridges();
				this.showStatus("Refresh cancelled");
				return;
			}

			// Restore Ask/Normal/Auto, Auto Mode gate, and thinking/adaptive after the new runtime binds.
			this.session.restoreEphemeralSessionState(ephemeralState);
			if (editorText) {
				this.editor.setText(editorText);
			}

			// refresh() rebinds the session (chat + extensions). Finish host chrome.
			this.keybindings.reload();
			const activeHeader = this.customHeader ?? this.builtInHeader;
			if (isExpandable(activeHeader)) {
				activeHeader.setExpanded(this.toolOutputExpanded);
			}
			setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
			await this.themeController.applyFromSettings();
			this.applyRuntimeSettings();
			this.updateEditorBorderColor();
			this.setupAutocompleteProvider();
			const runner = this.session.extensionRunner;
			this.setupExtensionShortcuts(runner);
			this.refreshCapabilityTree();
			this.showLoadedResources({
				force: true,
				showDiagnosticsWhenQuiet: true,
			});
			const savedImplicitProjectTrust = this.maybeSaveImplicitProjectTrustAfterReload();
			const modelsJsonError = this.session.modelRuntime.getError();
			if (modelsJsonError) {
				this.showError(`models.json error: ${modelsJsonError}`);
			}
			// Surface runtime diagnostics from the rebuild so failures aren't silent.
			for (const d of this.runtimeHost.diagnostics) {
				if (d.type === "error") {
					this.showError(d.message);
				} else if (d.type === "warning") {
					this.showWarning(d.message);
				}
			}
			this.footer.invalidate();
			const sessionLabel = this.session.sessionFile
				? path.basename(this.session.sessionFile)
				: this.session.sessionId;
			this.showStatus(
				savedImplicitProjectTrust
					? `Rebuilt Porcupine runtime, resumed ${sessionLabel}, saved project trust`
					: `Rebuilt Porcupine runtime and resumed session (${sessionLabel})`,
			);
			dismissRefreshBox(this.editor as Component);
			refreshBoxDismissed = true;
			// Rebind bridges against the fresh runtime now that the rebuild is done
			// and the banner is cleared. Flush any background warnings that were
			// buffered by the console guard into the status surface.
			this.startRemoteBridges();
			this.recheckUpdateBadge();
			const buffered = drainConsoleGuard();
			if (buffered.length > 0) {
				this.showStatus("Background warnings were buffered during refresh and surfaced here.");
			}
		} catch (error) {
			if (!refreshBoxDismissed) {
				dismissRefreshBox(previousEditor as Component);
			} else {
				this.editorSurfaceLocked = false;
			}
			this.startRemoteBridges();
			this.showError(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Real process restart: flush session, tear down TUI, spawn a new Porcupine
	 * with `--session`, exit this process. Reloads fresh code from disk.
	 */
	private async handleRestartCommand(): Promise<void> {
		if (this.session.isStreaming) {
			this.showWarning("Wait for the current response to finish before restarting.");
			return;
		}
		if (this.session.isCompacting) {
			this.showWarning("Wait for compaction to finish before restarting.");
			return;
		}
		if (this.session.hasActiveSubagents()) {
			this.showWarning("Cannot /restart while sub-agents are running.");
			return;
		}
		if (this.session.isBashRunning) {
			this.showWarning("Cannot /restart while bash is running.");
			return;
		}

		// Ensure the session is on disk so the new process can resume it.
		if (this.sessionManager.isPersisted()) {
			this.sessionManager.forceFlushToDisk();
		}

		const sessionId = this.sessionManager.getSessionId();
		const sessionFile = this.sessionManager.getSessionFile();
		if (!sessionFile || !fs.existsSync(sessionFile)) {
			this.showError("Cannot restart: session is not saved on disk yet. Send a message first, or use /refresh.");
			return;
		}

		const entryPath = process.argv[1];
		if (!entryPath) {
			this.showError("Cannot restart: missing process entry path.");
			return;
		}

		const childArgv = buildRestartArgv({
			entryPath,
			originalArgs: process.argv.slice(2),
			sessionId,
			sessionFile,
			sessionDir: this.sessionManager.getSessionDir(),
			usesDefaultSessionDir: this.sessionManager.usesDefaultSessionDir(),
		});

		this.showStatus("Restarting Porcupine (new process, same session)...");
		this.ui.requestRender(true);
		await new Promise((resolve) => setTimeout(resolve, 80));

		// Clean terminal shutdown before replacing the process.
		this.isShuttingDown = true;
		if (this.cronTimer) clearInterval(this.cronTimer);
		this.themeController.disableAutoSync();
		try {
			await this.ui.terminal.drainInput(1000);
		} catch {
			// Best-effort drain.
		}
		this.stop();
		try {
			await this.runtimeHost.dispose();
		} catch {
			// Best-effort dispose.
		}

		// Re-apply the agent-home .env so a user editing env settings while the
		// app is running gets them picked up by the replaced process (a fresh
		// process also re-reads it at startup, but this guarantees the inherited
		// environment is current rather than frozen from launch).
		try {
			loadAgentEnvFile();
		} catch {
			// Best-effort env refresh.
		}

		const child = spawn(process.execPath, [...process.execArgv, ...childArgv], {
			cwd: this.sessionManager.getCwd(),
			env: process.env,
			detached: true,
			stdio: "inherit",
		});

		// Wait for the detached child to confirm it actually spawned before
		// exiting 0. A failed spawn is delivered asynchronously via 'error', so
		// we must wait for it rather than calling process.exit(0) in the same tick
		// as spawn() (which would make the error branch dead code and silently
		// report success).
		const childStarted = new Promise<"spawn" | "error">((resolve) => {
			child.once("spawn", () => resolve("spawn"));
			child.once("error", (err) => {
				process.stderr.write(`Restart failed to spawn: ${err instanceof Error ? err.message : String(err)}\n`);
				resolve("error");
			});
		});
		child.unref();

		const outcome = await childStarted;
		process.exit(outcome === "spawn" ? 0 : 1);
	}

	private async handleReloadCommand(): Promise<void> {
		if (this.session.isStreaming) {
			this.showWarning("Wait for the current response to finish before reloading.");
			return;
		}
		if (this.session.isCompacting) {
			this.showWarning("Wait for compaction to finish before reloading.");
			return;
		}

		this.resetExtensionUI();

		const reloadBox = new Container();
		const borderColor = (s: string) => theme.fg("border", s);
		reloadBox.addChild(new DynamicBorder(borderColor));
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(
			new Text(
				theme.fg("muted", "Reloading keybindings, extensions, skills, prompts, themes, and context files..."),
				1,
				0,
			),
		);
		reloadBox.addChild(new Spacer(1));
		reloadBox.addChild(new DynamicBorder(borderColor));

		const previousEditor = this.editor;
		this.editorSurfaceLocked = true;
		this.editorContainer.clear();
		this.editorContainer.addChild(reloadBox);
		this.ui.setFocus(reloadBox);
		this.ui.requestRender(true);
		await new Promise((resolve) => process.nextTick(resolve));

		const dismissReloadBox = (editor: Component) => {
			this.editorSurfaceLocked = false;
			this.editorContainer.clear();
			this.editorContainer.addChild(editor);
			this.ui.setFocus(editor);
			this.ui.requestRender();
		};

		let chatRestoredBeforeSessionStart = false;
		let reloadBoxDismissed = false;
		const restoreChatBeforeSessionStart = () => {
			if (chatRestoredBeforeSessionStart) {
				return;
			}
			this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
			this.outputPad = this.settingsManager.getOutputPad();
			this.rebuildChatFromMessages();
			chatRestoredBeforeSessionStart = true;
		};

		try {
			await this.session.reload({
				beforeSessionStart: restoreChatBeforeSessionStart,
			});
			restoreChatBeforeSessionStart();
			this.keybindings.reload();
			const activeHeader = this.customHeader ?? this.builtInHeader;
			if (isExpandable(activeHeader)) {
				activeHeader.setExpanded(this.toolOutputExpanded);
			}
			setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
			await this.themeController.applyFromSettings();
			this.applyRuntimeSettings();
			this.setupAutocompleteProvider();
			const runner = this.session.extensionRunner;
			this.setupExtensionShortcuts(runner);
			this.showLoadedResources({
				force: false,
				showDiagnosticsWhenQuiet: true,
			});
			const savedImplicitProjectTrust = this.maybeSaveImplicitProjectTrustAfterReload();
			const modelsJsonError = this.session.modelRuntime.getError();
			if (modelsJsonError) {
				this.showError(`models.json error: ${modelsJsonError}`);
			}
			this.showStatus(
				savedImplicitProjectTrust
					? "Reloaded keybindings, extensions, skills, prompts, themes, and context files; saved project trust"
					: "Reloaded keybindings, extensions, skills, prompts, themes, and context files",
			);
			dismissReloadBox(this.editor as Component);
			reloadBoxDismissed = true;
		} catch (error) {
			if (!reloadBoxDismissed) {
				dismissReloadBox(previousEditor as Component);
			}
			this.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async handleExportCommand(text: string): Promise<void> {
		const outputPath = this.getPathCommandArgument(text, "/export");

		try {
			if (outputPath?.endsWith(".jsonl")) {
				const filePath = this.session.exportToJsonl(outputPath);
				this.showStatus(`Session exported to: ${filePath}`);
			} else {
				const filePath = await this.session.exportToHtml(outputPath);
				this.showStatus(`Session exported to: ${filePath}`);
			}
		} catch (error: unknown) {
			this.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	private getPathCommandArgument(text: string, command: "/export" | "/import"): string | undefined {
		if (text === command) {
			return undefined;
		}
		if (!text.startsWith(`${command} `)) {
			return undefined;
		}

		const argsString = text.slice(command.length + 1).trimStart();
		if (!argsString) {
			return undefined;
		}

		const firstChar = argsString[0];
		if (firstChar === '"' || firstChar === "'") {
			const closingQuoteIndex = argsString.indexOf(firstChar, 1);
			if (closingQuoteIndex < 0) {
				return undefined;
			}
			return argsString.slice(1, closingQuoteIndex);
		}

		const firstWhitespaceIndex = argsString.search(/\s/);
		if (firstWhitespaceIndex < 0) {
			return argsString;
		}
		return argsString.slice(0, firstWhitespaceIndex);
	}

	private async handleImportCommand(text: string): Promise<void> {
		const inputPath = this.getPathCommandArgument(text, "/import");
		if (!inputPath) {
			this.showError("Usage: /import <path.jsonl>");
			return;
		}

		const confirmed = await this.showExtensionConfirm("Import session", `Replace current session with ${inputPath}?`);
		if (!confirmed) {
			this.showStatus("Import cancelled");
			return;
		}

		try {
			this.clearStatusIndicator();
			const result = await this.runtimeHost.importFromJsonl(inputPath);
			if (result.cancelled) {
				this.showStatus("Import cancelled");
				return;
			}
			this.showStatus(`Session imported from: ${inputPath}`);
		} catch (error: unknown) {
			if (error instanceof MissingSessionCwdError) {
				const selectedCwd = await this.promptForMissingSessionCwd(error);
				if (!selectedCwd) {
					this.showStatus("Import cancelled");
					return;
				}
				const result = await this.runtimeHost.importFromJsonl(inputPath, selectedCwd);
				if (result.cancelled) {
					this.showStatus("Import cancelled");
					return;
				}
				this.showStatus(`Session imported from: ${inputPath}`);
				return;
			}
			if (error instanceof SessionImportFileNotFoundError) {
				this.showError(`Failed to import session: ${error.message}`);
				return;
			}
			await this.handleFatalRuntimeError("Failed to import session", error);
		}
	}

	private async handleShareCommand(): Promise<void> {
		// Check if gh is available and logged in
		try {
			const authResult = spawnSync("gh", ["auth", "status"], {
				encoding: "utf-8",
			});
			if (authResult.status !== 0) {
				this.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
				return;
			}
		} catch {
			this.showError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/");
			return;
		}

		// Export to a temp file
		const tmpFile = path.join(os.tmpdir(), "session.html");
		try {
			await this.session.exportToHtml(tmpFile);
		} catch (error: unknown) {
			this.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
			return;
		}

		// Show cancellable loader, replacing the editor
		const loader = new BorderedLoader(this.ui, theme, "Creating gist...");
		this.editorContainer.clear();
		this.editorContainer.addChild(loader);
		this.ui.setFocus(loader);
		this.ui.requestRender();

		const restoreEditor = () => {
			loader.dispose();
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
			try {
				fs.unlinkSync(tmpFile);
			} catch {
				// Ignore cleanup errors
			}
		};

		// Create a secret gist asynchronously
		let proc: ReturnType<typeof spawn> | null = null;

		loader.onAbort = () => {
			proc?.kill();
			restoreEditor();
			this.showStatus("Share cancelled");
		};

		try {
			const result = await new Promise<{
				stdout: string;
				stderr: string;
				code: number | null;
			}>((resolve) => {
				proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
				let stdout = "";
				let stderr = "";
				proc.stdout?.on("data", (data) => {
					stdout += data.toString();
				});
				proc.stderr?.on("data", (data) => {
					stderr += data.toString();
				});
				proc.on("close", (code) => resolve({ stdout, stderr, code }));
			});

			if (loader.signal.aborted) return;

			restoreEditor();

			if (result.code !== 0) {
				const errorMsg = result.stderr?.trim() || "Unknown error";
				this.showError(`Failed to create gist: ${errorMsg}`);
				return;
			}

			// Extract gist ID from the URL returned by gh
			// gh returns something like: https://gist.github.com/username/GIST_ID
			const gistUrl = result.stdout?.trim();
			const gistId = gistUrl?.split("/").pop();
			if (!gistId) {
				this.showError("Failed to parse gist ID from gh output");
				return;
			}

			// Create the preview URL
			const previewUrl = getShareViewerUrl(gistId);
			this.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
		} catch (error: unknown) {
			if (!loader.signal.aborted) {
				restoreEditor();
				this.showError(`Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`);
			}
		}
	}

	private async handleCopyCommand(): Promise<void> {
		const text = this.session.getLastAssistantText();
		if (!text) {
			this.showError("No agent messages to copy yet.");
			return;
		}

		try {
			await copyToClipboard(text);
			this.showStatus("Copied last agent message to clipboard");
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private handleNameCommand(text: string): void {
		const name = text.replace(/^\/name\s*/, "").trim();
		if (!name) {
			const currentName = this.sessionManager.getSessionName();
			if (currentName) {
				this.chatContainer.addChild(new Spacer(1));
				this.chatContainer.addChild(new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0));
			} else {
				this.showWarning("Usage: /name <name>");
			}
			this.ui.requestRender();
			return;
		}

		this.session.setSessionName(name);
		const sessionName = this.sessionManager.getSessionName();
		if (sessionName !== name) {
			this.showWarning(`Session name was normalized from ${JSON.stringify(name)} to ${JSON.stringify(sessionName)}`);
		}
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", `Session name set: ${sessionName ?? name}`), 1, 0));
		this.ui.requestRender();
	}

	private handleAutoModeCommand(text: string): void {
		const arg = text.startsWith("/auto ") ? text.slice(6).trim().toLowerCase() : "";
		let enabled = this.session.isAutoModeEnabled;
		if (arg === "on" || arg === "enable" || arg === "1" || arg === "true") {
			enabled = this.session.setAutoMode(true);
		} else if (arg === "off" || arg === "disable" || arg === "0" || arg === "false") {
			enabled = this.session.setAutoMode(false);
		} else if (arg === "status" || arg === "") {
			if (arg === "") {
				enabled = this.session.toggleAutoMode();
			}
		} else if (arg === "toggle") {
			enabled = this.session.toggleAutoMode();
		} else {
			this.showWarning("Usage: /auto [on|off|status]");
			this.ui.requestRender();
			return;
		}
		this.chatContainer.addChild(new Spacer(1));
		const status = enabled
			? "ON - flagged bash is approved/denied by an LLM safety gate (fail-closed)."
			: "OFF - flagged bash requires interactive confirm (or is blocked unattended).";
		this.chatContainer.addChild(new Text(theme.fg("accent", `Auto Mode: ${status}`), 1, 0));
		this.footer.invalidate();
		this.ui.requestRender();
	}

	/** Agent-home dir where /sandbox on installs the bundled Gondolin extension. */
	private gondolinExtensionDir(): string {
		return path.join(os.homedir(), ".porcupine", "agent", "extensions", "gondolin");
	}

	/** Bundled Gondolin extension shipped with the package (examples/extensions/gondolin). */
	private bundledGondolinSourceDir(): string {
		return path.join(getPackageDir(), "examples", "extensions", "gondolin");
	}

	private gondolinDepInstalled(extDir: string): boolean {
		return fs.existsSync(path.join(extDir, "node_modules", "@earendil-works", "gondolin"));
	}

	private copyDirRecursive(source: string, dest: string): void {
		fs.mkdirSync(dest, { recursive: true });
		for (const entry of fs.readdirSync(source)) {
			const srcPath = path.join(source, entry);
			const destPath = path.join(dest, entry);
			if (fs.statSync(srcPath).isDirectory()) this.copyDirRecursive(srcPath, destPath);
			else fs.copyFileSync(srcPath, destPath);
		}
	}

	private async runNpmInstall(cwd: string): Promise<boolean> {
		const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
		return new Promise<boolean>((resolve) => {
			const child = spawn(npmCmd, ["install", "--ignore-scripts"], { cwd, stdio: "pipe" });
			let output = "";
			child.stdout.on("data", (data: Buffer) => {
				output += data.toString();
			});
			child.stderr.on("data", (data: Buffer) => {
				output += data.toString();
			});
			child.on("close", (code) => {
				if (code !== 0) {
					console.error(output);
				}
				resolve(code === 0);
			});
			child.on("error", (error) => {
				console.error(error.message);
				resolve(false);
			});
		});
	}

	/** /sandbox status — report activation state plus Gondolin requirements. */
	private showGondolinSandboxStatus(): void {
		const extDir = this.gondolinExtensionDir();
		const enabled = this.settingsManager.getExtensionPaths().includes(extDir);
		const installed = fs.existsSync(path.join(extDir, "index.ts"));
		const depInstalled = this.gondolinDepInstalled(extDir);
		const qemuFound =
			spawnSync("which", ["qemu-system-aarch64"], { stdio: "ignore" }).status === 0 ||
			spawnSync("which", ["qemu-system-x86_64"], { stdio: "ignore" }).status === 0;
		const vmLoaded = this.session.extensionRunner.getCommand("gondolin") !== undefined;
		const lines = [
			`Sandbox: ${enabled ? theme.fg("success", "ON") : theme.fg("muted", "OFF")}`,
			`Extension: ${installed ? "installed" : "not installed"} (${extDir})`,
			`@earendil-works/gondolin: ${depInstalled ? "installed" : "missing — run /sandbox on"}`,
			`Runtime: Node ${process.versions.node} (Gondolin needs >= 23.6)`,
			`QEMU: ${qemuFound ? "found" : theme.fg("warning", "missing — brew install qemu")}`,
			`Gondolin VM loaded: ${vmLoaded ? theme.fg("success", "yes — /gondolin shows VM status") : theme.fg("muted", "no")}`,
		];
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
		this.ui.requestRender();
	}

	/** /sandbox on — install, register, and hot-reload the Gondolin tool-routing extension. */
	private async enableGondolinSandbox(): Promise<void> {
		const extDir = this.gondolinExtensionDir();
		const sourceDir = this.bundledGondolinSourceDir();
		try {
			if (!fs.existsSync(path.join(extDir, "index.ts"))) {
				if (!fs.existsSync(path.join(sourceDir, "index.ts"))) {
					this.showWarning(
						`Bundled Gondolin extension not found (${sourceDir}). Reinstall the package to restore it.`,
					);
					this.ui.requestRender();
					return;
				}
				this.copyDirRecursive(sourceDir, extDir);
			}
			if (!this.gondolinDepInstalled(extDir)) {
				this.showStatus("Installing @earendil-works/gondolin (first run only)…");
				this.ui.requestRender();
				const ok = await this.runNpmInstall(extDir);
				if (!ok) {
					this.showError(
						`Gondolin dependency install failed. Run manually: cd ${extDir} && npm install --ignore-scripts`,
					);
					this.ui.requestRender();
					return;
				}
			}
			const paths = this.settingsManager.getExtensionPaths();
			if (!paths.includes(extDir)) {
				this.settingsManager.setExtensionPaths([...paths, extDir]);
			}
			this.showStatus("Sandbox ON — reloading extensions to route tools into the Gondolin VM…");
			await this.handleReloadCommand();
			this.showStatus("Sandbox ON: built-in tools and ! commands run in the Gondolin micro-VM (/workspace).");
		} catch (error) {
			this.showError(`Sandbox enable failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		this.ui.requestRender();
	}

	/** /sandbox off — unregister and reload so tools run on the host again. */
	private async disableGondolinSandbox(): Promise<void> {
		const extDir = this.gondolinExtensionDir();
		const paths = this.settingsManager.getExtensionPaths().filter((p) => p !== extDir);
		this.settingsManager.setExtensionPaths(paths);
		this.showStatus("Sandbox OFF — reloading extensions…");
		await this.handleReloadCommand();
		this.showStatus("Sandbox OFF: tools run on the host again.");
		this.ui.requestRender();
	}

	/** /sandbox [on|off|status] — Gondolin micro-VM isolation for built-in tools. */
	/** /update — force a fresh check and show current vs latest + how to install. */
	private async handleUpdateCommand(): Promise<void> {
		const current = this.version;
		this.showStatus("Checking for updates…");
		const latest = await checkForNewPorcupineVersion(current, { cacheTtlMs: 0 }).catch(() => undefined);
		this.chatContainer.addChild(new Spacer(1));
		if (!latest) {
			this.chatContainer.addChild(
				new Text(theme.fg("success", `You're up to date — ${APP_NAME} v${current}.`), 1, 0),
			);
		} else {
			this.latestVersion = latest.version;
			const pkg = latest.packageName ?? getInstalledPackageName();
			const lines = [
				`Current: v${current}`,
				`Latest:  ${theme.fg("warning", `v${latest.version} available`)}`,
				"",
				`To update: npm install -g --ignore-scripts ${pkg ?? "@porcupineai/coding-agent"}`,
				"Or run: porcupine update --yes",
			];
			if (latest.note) {
				lines.push("", `Release notes: ${latest.note.slice(0, 300)}`);
			}
			this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
		}
		this.ui.requestRender();
	}

	private async handleSandboxCommand(text: string): Promise<void> {
		const arg = text.startsWith("/sandbox ") ? text.slice(9).trim().toLowerCase() : "";
		if (arg !== "" && arg !== "on" && arg !== "off" && arg !== "status" && arg !== "enable" && arg !== "disable") {
			this.showWarning("Usage: /sandbox [on|off|status]");
			this.ui.requestRender();
			return;
		}
		if (arg === "on" || arg === "enable") {
			if (process.platform === "win32") {
				this.showWarning("Gondolin sandbox is not supported on Windows yet.");
				this.ui.requestRender();
				return;
			}
			await this.enableGondolinSandbox();
			return;
		}
		if (arg === "off" || arg === "disable") {
			await this.disableGondolinSandbox();
			return;
		}
		this.showGondolinSandboxStatus();
	}

	private showInteractionModeSelector(): void {
		this.showSelector((done) => {
			const selector = new InteractionModeSelectorComponent(
				this.session.interactionMode,
				(mode) => {
					this.session.setInteractionMode(mode);
					this.footer.invalidate();
					this.showStatus(`Mode set: ${formatInteractionModeBadge(mode)}`);
					done();
					this.ui.requestRender();
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getSelectList() };
		});
	}

	private handleAdaptiveReasoningCommand(text: string): void {
		const arg = text.startsWith("/adaptive ") ? text.slice(10).trim().toLowerCase() : "";
		if (!this.session.supportsThinking()) {
			this.showWarning("Current model does not support thinking/reasoning levels.");
			this.ui.requestRender();
			return;
		}
		let enabled = this.session.isAdaptiveReasoningEnabled;
		if (arg === "on" || arg === "enable" || arg === "1" || arg === "true") {
			enabled = this.session.setAdaptiveReasoning(true);
		} else if (arg === "off" || arg === "disable" || arg === "0" || arg === "false") {
			enabled = this.session.setAdaptiveReasoning(false);
		} else if (arg === "status") {
			// keep
		} else if (arg === "" || arg === "toggle") {
			enabled = this.session.toggleAdaptiveReasoning();
		} else {
			this.showWarning("Usage: /adaptive [on|off|status]");
			this.ui.requestRender();
			return;
		}
		this.chatContainer.addChild(new Spacer(1));
		const last = this.session.adaptiveLastResolved;
		const status = enabled
			? `ON - per-turn thinking depth (last: ${last ?? "pending"}). Planning/skills/tools still model-led.`
			: `OFF - fixed thinking level: ${this.session.thinkingLevel}`;
		this.chatContainer.addChild(new Text(theme.fg("accent", `Adaptive Reasoning: ${status}`), 1, 0));
		this.ui.requestRender();
	}

	private handleSessionCommand(): void {
		const stats = this.session.getSessionStats();
		const sessionName = this.sessionManager.getSessionName();
		const entries = this.sessionManager.getEntries();
		const cacheWaste = computeCacheWaste(entries, this.session.modelRuntime);

		// Cost/token totals per provider/model actually used (e.g. OpenRouter `auto`
		// resolves to a concrete responseModel). Usage without model attribution is
		// grouped separately so the breakdown reconciles with the session total.
		const usageBreakdown = getUsageCostBreakdown(entries);

		let info = `${theme.bold("Session Info")}\n\n`;
		if (sessionName) {
			info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
		}
		info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
		info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", "Tools:")} ${stats.toolCalls} calls, ${stats.toolResults} results\n\n`;
		info += `${theme.bold("Tokens")}\n`;
		// "Input" is the full prompt volume. With cache activity, split it into
		// cached (served from cache) vs uncached (everything else) - the only
		// provider-independent split. Cache writes, where reported, are a detail
		// of the uncached portion.
		const { input, cacheRead, cacheWrite } = stats.tokens;
		const promptTokens = input + cacheRead + cacheWrite;
		info += `${theme.fg("dim", "Input:")} ${promptTokens.toLocaleString()}\n`;
		if (promptTokens > 0 && (cacheRead > 0 || cacheWrite > 0)) {
			const hitRate = theme.fg("dim", `(${((cacheRead / promptTokens) * 100).toFixed(1)}%)`);
			info += `  ${theme.fg("dim", "Cached:")} ${cacheRead.toLocaleString()} ${hitRate}\n`;
			const written =
				cacheWrite > 0 ? ` ${theme.fg("dim", `(${cacheWrite.toLocaleString()} written to cache)`)}` : "";
			info += `  ${theme.fg("dim", "Uncached:")} ${(input + cacheWrite).toLocaleString()}${written}\n`;
		}
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0 || cacheWaste.missedTokens > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} $${stats.cost.toFixed(3)}`;
			if (usageBreakdown.length > 1) {
				for (const entry of usageBreakdown) {
					info += `\n  ${theme.fg("dim", `${entry.key}:`)} $${entry.cost.toFixed(3)} ${theme.fg("dim", `(${formatTokens(entry.tokens)} tokens)`)}`;
				}
			}
			if (cacheWaste.missedTokens > 0) {
				const missLabel = cacheWaste.missCount === 1 ? "1 miss" : `${cacheWaste.missCount} misses`;
				const detail = `${cacheWaste.missedTokens.toLocaleString()} tokens, ${missLabel}`;
				info +=
					cacheWaste.missedCost >= 0.0001
						? `\n${theme.fg("dim", "Cache Re-billed:")} $${cacheWaste.missedCost.toFixed(3)} ${theme.fg("dim", `(${detail})`)}`
						: `\n${theme.fg("dim", "Cache Re-billed:")} ${detail}`;
			}
		}

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(info, 1, 0));
		this.ui.requestRender();
	}

	private handleChangelogCommand(): void {
		const changelogPath = getChangelogPath();
		const allEntries = parseChangelog(changelogPath);

		const changelogMarkdown =
			allEntries.length > 0
				? allEntries
						.reverse()
						.map((e) => normalizeChangelogLinks(e.content, e))
						.join("\n\n")
				: "No changelog entries found.";

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, this.getMarkdownThemeWithSettings()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	/**
	 * Get capitalized display string for an app keybinding action.
	 */
	private getAppKeyDisplay(action: AppKeybinding): string {
		return keyDisplayText(action);
	}

	/**
	 * Get capitalized display string for an editor keybinding action.
	 */
	private getEditorKeyDisplay(action: Keybinding): string {
		return keyDisplayText(action);
	}

	private handleHotkeysCommand(): void {
		// Navigation keybindings
		const cursorUp = this.getEditorKeyDisplay("tui.editor.cursorUp");
		const cursorDown = this.getEditorKeyDisplay("tui.editor.cursorDown");
		const cursorLeft = this.getEditorKeyDisplay("tui.editor.cursorLeft");
		const cursorRight = this.getEditorKeyDisplay("tui.editor.cursorRight");
		const cursorWordLeft = this.getEditorKeyDisplay("tui.editor.cursorWordLeft");
		const cursorWordRight = this.getEditorKeyDisplay("tui.editor.cursorWordRight");
		const cursorLineStart = this.getEditorKeyDisplay("tui.editor.cursorLineStart");
		const cursorLineEnd = this.getEditorKeyDisplay("tui.editor.cursorLineEnd");
		const jumpForward = this.getEditorKeyDisplay("tui.editor.jumpForward");
		const jumpBackward = this.getEditorKeyDisplay("tui.editor.jumpBackward");
		const pageUp = this.getEditorKeyDisplay("tui.editor.pageUp");
		const pageDown = this.getEditorKeyDisplay("tui.editor.pageDown");

		// Editing keybindings
		const submit = this.getEditorKeyDisplay("tui.input.submit");
		const newLine = this.getEditorKeyDisplay("tui.input.newLine");
		const deleteWordBackward = this.getEditorKeyDisplay("tui.editor.deleteWordBackward");
		const deleteWordForward = this.getEditorKeyDisplay("tui.editor.deleteWordForward");
		const deleteToLineStart = this.getEditorKeyDisplay("tui.editor.deleteToLineStart");
		const deleteToLineEnd = this.getEditorKeyDisplay("tui.editor.deleteToLineEnd");
		const yank = this.getEditorKeyDisplay("tui.editor.yank");
		const yankPop = this.getEditorKeyDisplay("tui.editor.yankPop");
		const undo = this.getEditorKeyDisplay("tui.editor.undo");
		const tab = this.getEditorKeyDisplay("tui.input.tab");

		// App keybindings
		const interrupt = this.getAppKeyDisplay("app.interrupt");
		const clear = this.getAppKeyDisplay("app.clear");
		const exit = this.getAppKeyDisplay("app.exit");
		const suspend = this.getAppKeyDisplay("app.suspend");
		const cycleThinkingLevel = this.getAppKeyDisplay("app.thinking.cycle");
		const cycleModelForward = this.getAppKeyDisplay("app.model.cycleForward");
		const selectModel = this.getAppKeyDisplay("app.model.select");
		const expandTools = this.getAppKeyDisplay("app.tools.expand");
		const toggleThinking = this.getAppKeyDisplay("app.thinking.toggle");
		const externalEditor = this.getAppKeyDisplay("app.editor.external");
		const cycleModelBackward = this.getAppKeyDisplay("app.model.cycleBackward");
		const copyMessage = this.getAppKeyDisplay("app.message.copy");
		const followUp = this.getAppKeyDisplay("app.message.followUp");
		const dequeue = this.getAppKeyDisplay("app.message.dequeue");
		const pasteImage = this.getAppKeyDisplay("app.clipboard.pasteImage");

		let hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`${cursorUp}\` / \`${cursorDown}\` / \`${cursorLeft}\` / \`${cursorRight}\` | Move cursor / browse history |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${process.platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle reasoning mode (levels + adaptive) |
| \`/reasoning\` | Open reasoning mode selector |
| \`/thinking\` | Alias for /reasoning |
| \`/stacks\` | Show or search tools/skills stack tree |
| \`${cycleModelForward}\` / \`${cycleModelBackward}\` | Cycle models |
| \`${selectModel}\` | Open model selector |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${externalEditor}\` | Edit message in external editor |
| \`${copyMessage}\` | Copy last assistant message |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`${pasteImage}\` | Paste image or text from clipboard |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

		// Add extension-registered shortcuts
		const extensionRunner = this.session.extensionRunner;
		const shortcuts = extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig());
		if (shortcuts.size > 0) {
			hotkeys += `
**Extensions**
| Key | Action |
|-----|--------|
`;
			for (const [key, shortcut] of shortcuts) {
				const description = shortcut.description ?? shortcut.extensionPath;
				const keyDisplay = formatKeyText(key, { capitalize: true });
				hotkeys += `| \`${keyDisplay}\` | ${description} |\n`;
			}
		}

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, this.getMarkdownThemeWithSettings()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	private async handleClearCommand(): Promise<void> {
		this.clearStatusIndicator();
		try {
			const result = await this.runtimeHost.newSession();
			if (result.cancelled) {
				return;
			}
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
			this.ui.requestRender();
		} catch (error: unknown) {
			await this.handleFatalRuntimeError("Failed to create session", error);
		}
	}

	private handleDebugCommand(): void {
		const width = this.ui.terminal.columns;
		const height = this.ui.terminal.rows;
		const allLines = this.ui.render(width);

		const debugLogPath = getDebugLogPath();
		const debugData = [
			`Debug output at ${new Date().toISOString()}`,
			`Terminal: ${width}x${height}`,
			`Total lines: ${allLines.length}`,
			"",
			"=== All rendered lines with visible widths ===",
			...allLines.map((line, idx) => {
				const vw = visibleWidth(line);
				const escaped = JSON.stringify(line);
				return `[${idx}] (w=${vw}) ${escaped}`;
			}),
			"",
			"=== Agent messages (JSONL) ===",
			...this.session.messages.map((msg) => JSON.stringify(msg)),
			"",
		].join("\n");

		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.writeFileSync(debugLogPath, debugData);

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(`${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
		);
		this.ui.requestRender();
	}

	private handleArminSaysHi(): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ArminComponent(this.ui));
		this.ui.requestRender();
	}

	private handleDementedDelves(): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new EarendilAnnouncementComponent());
		this.ui.requestRender();
	}

	private handleDaxnuts(): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DaxnutsComponent(this.ui));
		this.ui.requestRender();
	}

	private checkDaxnutsEasterEgg(model: { provider: string; id: string }): void {
		if (model.provider === "opencode" && model.id.toLowerCase().includes("kimi-k2.5")) {
			this.handleDaxnuts();
		}
	}

	private async handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
		const extensionRunner = this.session.extensionRunner;

		// Emit user_bash event to let extensions intercept
		const eventResult = await extensionRunner.emitUserBash({
			type: "user_bash",
			command,
			excludeFromContext,
			cwd: this.sessionManager.getCwd(),
		});

		// If extension returned a full result, use it directly
		if (eventResult?.result) {
			const result = eventResult.result;

			// Create UI component for display
			this.bashComponent = new BashExecutionComponent(command, this.ui, excludeFromContext);
			if (this.session.isStreaming) {
				this.pendingMessagesContainer.addChild(this.bashComponent);
				this.pendingBashComponents.push(this.bashComponent);
			} else {
				this.chatContainer.addChild(this.bashComponent);
			}

			// Show output and complete
			if (result.output) {
				this.bashComponent.appendOutput(result.output);
			}
			this.bashComponent.setComplete(
				result.exitCode,
				result.cancelled,
				result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
				result.fullOutputPath,
			);

			// Record the result in session
			this.session.recordBashResult(command, result, { excludeFromContext });
			this.bashComponent = undefined;
			this.ui.requestRender();
			return;
		}

		// Normal execution path (possibly with custom operations)
		const isDeferred = this.session.isStreaming;
		this.bashComponent = new BashExecutionComponent(command, this.ui, excludeFromContext);

		if (isDeferred) {
			// Show in pending area when agent is streaming
			this.pendingMessagesContainer.addChild(this.bashComponent);
			this.pendingBashComponents.push(this.bashComponent);
		} else {
			// Show in chat immediately when agent is idle
			this.chatContainer.addChild(this.bashComponent);
		}
		this.ui.requestRender();

		try {
			const result = await this.session.executeBash(
				command,
				(chunk) => {
					if (this.bashComponent) {
						this.bashComponent.appendOutput(chunk);
						this.ui.requestRender();
					}
				},
				{ excludeFromContext, operations: eventResult?.operations },
			);

			if (this.bashComponent) {
				this.bashComponent.setComplete(
					result.exitCode,
					result.cancelled,
					result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
					result.fullOutputPath,
				);
			}
		} catch (error) {
			if (this.bashComponent) {
				this.bashComponent.setComplete(undefined, false);
			}
			this.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.bashComponent = undefined;
		this.ui.requestRender();
	}

	private async handleCompactCommand(customInstructions?: string): Promise<void> {
		this.clearStatusIndicator();

		try {
			await this.session.compact(customInstructions);
		} catch {
			// Ignore, will be emitted as an event
		}
	}

	stop(): void {
		this.remoteBridgeUnsubscribe?.();
		this.remoteBridgeUnsubscribe = undefined;
		this.stopSubagentFooterTimer();
		for (const bridge of [this.telegramBridge, this.discordBridge, this.imessageBridge]) {
			void bridge?.stop().catch(() => {});
		}
		this.telegramBridge = undefined;
		this.discordBridge = undefined;
		this.imessageBridge = undefined;
		if (this.settingsManager.getShowTerminalProgress()) {
			this.ui.terminal.setProgress(false);
		}
		this.clearStatusIndicator();
		this.themeController.disableAutoSync();
		this.clearExtensionTerminalInputListeners();
		this.footer.dispose();
		this.footerDataProvider.dispose();
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
		this.unregisterSignalHandlers();
		// The TUI is down (or being rebuilt); restore the original console
		// methods and flush any buffered background warnings as scrollback.
		uninstallConsoleGuard();
	}
}
