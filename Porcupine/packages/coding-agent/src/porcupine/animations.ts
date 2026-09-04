/**
 * Porcupine status animations — single source of truth.
 *
 * Design:
 * - One fixed emoji per activity (never cycles the emoji).
 * - Motion comes from trailing dots:  . → .. → ... → ..
 * - Full chip frames: "🌌  Staring into the void..."
 * - Optional hint (e.g. "esc to interrupt") lives in the Loader message.
 *
 * Do not scatter frame tables across the interactive mode. Import from here.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Core status animations (always available). */
export type CoreAnimationId =
	| "working"
	| "thinking"
	| "reading"
	| "writing"
	| "editing"
	| "updating"
	| "searching"
	| "searching-skills"
	| "searching-tools"
	| "searching-projects"
	| "reading-skill"
	| "reading-tool"
	| "reading-project"
	| "running"
	| "browsing"
	| "web-search"
	| "web-extract"
	| "subagent"
	| "subagent-swap"
	| "sending-message"
	| "sent-message"
	| "using-tool"
	| "compacting"
	| "error";

/**
 * Rare easter-egg labels that sometimes replace Working / Thinking.
 * Shown less often so they stay fun when they appear.
 */
export type EasterEggAnimationId =
	| "vibing"
	| "caffeinated"
	| "charging"
	| "grooving"
	| "on-a-roll"
	| "in-the-zone"
	| "cooking"
	| "pondering"
	| "scheming"
	| "daydreaming"
	| "staring-into-void"
	| "having-ideas";

export type AnimationId = CoreAnimationId | EasterEggAnimationId;

/** @deprecated Use AnimationId — alias kept for call-site migration. */
export type PorcupineActivityPhase = AnimationId;

export interface AnimationSpec {
	readonly id: AnimationId;
	/** Fixed emoji for this activity (does not cycle). */
	readonly emoji: string;
	/** Human label shown next to the emoji (e.g. "Reading"). */
	readonly label: string;
	/** Milliseconds between dot frames. */
	readonly intervalMs: number;
	/** If set, this is a rare variant of a core animation (working / thinking). */
	readonly easterEggOf?: "working" | "thinking";
}

/** Options the TUI Loader understands. */
export interface AnimationLoaderOptions {
	frames: string[];
	intervalMs: number;
	/** When true, skip theme accent on frames (pre-colored ANSI only). */
	verbatim?: boolean;
}

// ---------------------------------------------------------------------------
// Dot cycle (the only motion)
// ---------------------------------------------------------------------------

/** `.` → `..` → `...` → `..` → loop */
export const DOT_FRAMES = [".", "..", "...", ".."] as const;

export const DEFAULT_ANIMATION_INTERVAL_MS = 320;

/** Build chip frames: "🌌  Staring into the void." / ".." / "..." / ".." */
export function buildDotFrames(emoji: string, label: string): string[] {
	const chip = `${emoji} ${label}`;
	return DOT_FRAMES.map((dots) => `${chip}${dots}`);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ANIMATIONS: readonly AnimationSpec[] = [
	// --- core ---
	{ id: "working", emoji: "⚙️", label: "Working", intervalMs: 280 },
	{ id: "thinking", emoji: "🧠", label: "Thinking", intervalMs: 280 },
	{ id: "reading", emoji: "📖", label: "Reading", intervalMs: 300 },
	{ id: "writing", emoji: "✍️", label: "Writing", intervalMs: 300 },
	{ id: "editing", emoji: "✏️", label: "Editing", intervalMs: 300 },
	{ id: "updating", emoji: "🔄", label: "Updating", intervalMs: 300 },
	{ id: "searching", emoji: "🔎", label: "Searching", intervalMs: 300 },
	{ id: "searching-skills", emoji: "👀", label: "Searching for skills", intervalMs: 300 },
	{ id: "searching-tools", emoji: "👀", label: "Searching for tools", intervalMs: 300 },
	{ id: "searching-projects", emoji: "👀", label: "Searching for projects", intervalMs: 300 },
	{ id: "reading-skill", emoji: "📖", label: "Reading skill", intervalMs: 300 },
	{ id: "reading-tool", emoji: "📖", label: "Reading tool", intervalMs: 300 },
	{ id: "reading-project", emoji: "📖", label: "Reading project", intervalMs: 300 },
	{ id: "running", emoji: "💻", label: "Running", intervalMs: 280 },
	{ id: "browsing", emoji: "🌐", label: "Browsing", intervalMs: 300 },
	{ id: "web-search", emoji: "🌐", label: "Searching", intervalMs: 300 },
	{ id: "web-extract", emoji: "📄", label: "Extracting", intervalMs: 300 },
	{ id: "subagent", emoji: "🤖", label: "Using Sub Agent", intervalMs: 300 },
	{ id: "subagent-swap", emoji: "🤖", label: "Swapping Sub Agent", intervalMs: 300 },
	{ id: "sending-message", emoji: "📨", label: "Sending message", intervalMs: 300 },
	{ id: "sent-message", emoji: "✉️", label: "Sent message", intervalMs: 300 },
	{ id: "using-tool", emoji: "🧰", label: "Using", intervalMs: 300 },
	{ id: "compacting", emoji: "🗜️", label: "Compacting", intervalMs: 340 },
	{ id: "error", emoji: "⚠️", label: "Failed", intervalMs: 340 },
	// --- easter eggs (rare stand-ins for Working / Thinking) ---
	{ id: "vibing", emoji: "🎧", label: "Vibing", intervalMs: 320, easterEggOf: "working" },
	{ id: "caffeinated", emoji: "☕", label: "Caffeinated", intervalMs: 300, easterEggOf: "working" },
	{ id: "charging", emoji: "⚡", label: "Charging", intervalMs: 300, easterEggOf: "working" },
	{ id: "grooving", emoji: "🕺", label: "Grooving", intervalMs: 320, easterEggOf: "working" },
	{ id: "on-a-roll", emoji: "🎲", label: "On a roll", intervalMs: 300, easterEggOf: "working" },
	{ id: "in-the-zone", emoji: "🎯", label: "In the zone", intervalMs: 320, easterEggOf: "working" },
	{ id: "cooking", emoji: "🍳", label: "Cooking", intervalMs: 300, easterEggOf: "working" },
	{ id: "pondering", emoji: "🤔", label: "Pondering", intervalMs: 340, easterEggOf: "thinking" },
	{ id: "scheming", emoji: "🕵️", label: "Scheming", intervalMs: 340, easterEggOf: "thinking" },
	{ id: "daydreaming", emoji: "🌈", label: "Daydreaming", intervalMs: 360, easterEggOf: "thinking" },
	{
		id: "staring-into-void",
		emoji: "🌌",
		label: "Staring into the void",
		intervalMs: 360,
		easterEggOf: "thinking",
	},
	{ id: "having-ideas", emoji: "💡", label: "Having ideas", intervalMs: 320, easterEggOf: "thinking" },
] as const;

const BY_ID = Object.fromEntries(ANIMATIONS.map((a) => [a.id, a])) as Record<AnimationId, AnimationSpec>;

export const DEFAULT_ANIMATION_ID: AnimationId = "working";

/**
 * Chance an easter egg replaces Working / Thinking when that phase starts.
 * Target mix: ~6/10 normal, ~4/10 easter eggs (while sticky for the phase).
 */
export const EASTER_EGG_CHANCE = 0.4;

export function isEasterEggAnimation(id: AnimationId | string | undefined | null): boolean {
	if (!id || !(id in BY_ID)) return false;
	return BY_ID[id as AnimationId].easterEggOf !== undefined;
}

/** Tool-driven chips that must not be overwritten by streaming Working/Thinking noise. */
const TOOL_DRIVEN: ReadonlySet<AnimationId> = new Set([
	"reading",
	"writing",
	"editing",
	"updating",
	"searching",
	"searching-skills",
	"searching-tools",
	"searching-projects",
	"reading-skill",
	"reading-tool",
	"reading-project",
	"running",
	"browsing",
	"web-search",
	"web-extract",
	"subagent",
	"subagent-swap",
	"sending-message",
	"sent-message",
	"using-tool",
	"compacting",
	"error",
]);

export function isToolDrivenAnimation(id: AnimationId | string | undefined | null): boolean {
	if (!id) return false;
	const normalized = normalizeAnimationId(id);
	return TOOL_DRIVEN.has(normalized);
}

export function easterEggsFor(base: "working" | "thinking"): readonly AnimationSpec[] {
	return ANIMATIONS.filter((a) => a.easterEggOf === base);
}

/**
 * Pick what to actually show for a requested core phase.
 * Easter eggs only apply to Working / Thinking, ~40% of the time (≈4 of 10),
 * and stay sticky until the requested base phase changes (so chips don't thrash).
 */
export function pickStatusAnimation(
	requested: AnimationId,
	stickyEgg: AnimationId | undefined,
	random: () => number = Math.random,
): { id: AnimationId; stickyEgg: AnimationId | undefined } {
	const base =
		requested === "working" || requested === "thinking"
			? requested
			: isEasterEggAnimation(requested)
				? (BY_ID[requested].easterEggOf ?? requested)
				: requested;

	// Tool / error phases: never swap for eggs; clear sticky.
	if (base !== "working" && base !== "thinking") {
		return { id: base as AnimationId, stickyEgg: undefined };
	}

	// Keep the same egg while we remain on the same base phase.
	if (stickyEgg && isEasterEggAnimation(stickyEgg) && BY_ID[stickyEgg].easterEggOf === base) {
		return { id: stickyEgg, stickyEgg };
	}

	const eggs = easterEggsFor(base);
	if (eggs.length > 0) {
		// Single random draw: decide both whether to show an egg and which one,
		// so the easter-egg rate is exactly EASTER_EGG_CHANCE.
		const roll = random();
		if (roll < EASTER_EGG_CHANCE) {
			const egg = eggs[Math.min(eggs.length - 1, Math.floor((roll / EASTER_EGG_CHANCE) * eggs.length))]!;
			return { id: egg.id, stickyEgg: egg.id };
		}
	}

	return { id: base, stickyEgg: undefined };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getAnimation(id: AnimationId | string | undefined | null): AnimationSpec {
	if (id && id in BY_ID) return BY_ID[id as AnimationId];
	return BY_ID[DEFAULT_ANIMATION_ID];
}

/** True if id is a known animation. */
export function isAnimationId(value: string | undefined | null): value is AnimationId {
	return !!value && value in BY_ID;
}

/**
 * Build Loader frames as full visible status chips with fixed emoji + dots:
 * "🌌  Staring into the void." / ".." / "..." / ".."
 * When `name` is provided the label becomes "{label}: {name}" (e.g.
 * "📖  Reading skill: git-basics.").
 */
export function animationLoaderOptions(
	id: AnimationId | string | undefined | null,
	name?: string,
): AnimationLoaderOptions {
	const anim = getAnimation(id);
	const label = name ? `${anim.label}: ${name}` : anim.label;
	return {
		frames: buildDotFrames(anim.emoji, label),
		intervalMs: anim.intervalMs,
	};
}

/**
 * Optional trailing hint only (label lives in the animated frames).
 * Example: "esc to interrupt" → shown as muted text after the chip.
 */
export function formatAnimationMessage(
	_id: AnimationId | string | undefined | null,
	options?: { hint?: string },
): string {
	const hint = options?.hint?.trim();
	return hint ?? "";
}

// ---------------------------------------------------------------------------
// Resolution (tools / text / legacy aliases)
// ---------------------------------------------------------------------------

const LEGACY_ALIASES: Record<string, AnimationId> = {
	// core
	working: "working",
	thinking: "thinking",
	reading: "reading",
	writing: "writing",
	editing: "editing",
	updating: "updating",
	searching: "searching",
	"searching-skills": "searching-skills",
	"searching-tools": "searching-tools",
	"searching-projects": "searching-projects",
	"reading-skill": "reading-skill",
	"reading-tool": "reading-tool",
	"reading-project": "reading-project",
	running: "running",
	browsing: "browsing",
	compacting: "compacting",
	error: "error",
	// easter eggs (real ids now)
	vibing: "vibing",
	caffeinated: "caffeinated",
	charging: "charging",
	grooving: "grooving",
	"on-a-roll": "on-a-roll",
	"in-the-zone": "in-the-zone",
	cooking: "cooking",
	pondering: "pondering",
	scheming: "scheming",
	daydreaming: "daydreaming",
	"staring-into-void": "staring-into-void",
	"having-ideas": "having-ideas",
	// older internal jargon → core
	reasoning: "thinking",
	planning: "thinking",
	"selecting-tools": "working",
	"loading-skills": "working",
	patching: "editing",
	coding: "running",
	testing: "running",
	debugging: "running",
	"reading-docs": "reading",
	researching: "searching",
	"connecting-pieces": "working",
	"compacting-context": "compacting",
	"checking-safety": "working",
	verifying: "working",
	"updating-memory": "updating",
	recovering: "error",
};

/** Normalize any string (including old phase names) to a clean AnimationId. */
export function normalizeAnimationId(value: string | undefined | null): AnimationId {
	if (!value) return DEFAULT_ANIMATION_ID;
	const key = value.trim().toLowerCase();
	return LEGACY_ALIASES[key] ?? (isAnimationId(key) ? key : DEFAULT_ANIMATION_ID);
}

/** @deprecated Use normalizeAnimationId */
export const normalizeActivityPhase = normalizeAnimationId;

export function resolveAnimationFromToolName(toolName: string | undefined | null): AnimationId {
	if (!toolName) return "working";
	const name = toolName.trim().toLowerCase();

	if (name === "read" || name === "read_file" || name === "cat" || name === "view") return "reading";
	if (name === "write" || name === "write_file" || name === "create_file" || name === "create") return "writing";
	if (
		name === "edit" ||
		name === "apply_patch" ||
		name === "patch" ||
		name.includes("str_replace") ||
		name.includes("search_replace") ||
		name.includes("multi_edit")
	) {
		return "editing";
	}
	if (name === "bash" || name === "shell" || name === "terminal" || name === "execute") return "running";
	if (name === "grep" || name === "find" || name === "search" || name === "glob" || name === "rg" || name === "ls") {
		return "searching";
	}
	if (name === "web_search" || name === "webfetch") return "web-search";
	if (name === "web_extract") return "web-extract";
	if (name === "send_message" || name === "check_messages") return "sending-message";
	if (name.includes("web") || name.includes("browser") || name.includes("fetch")) {
		return "browsing";
	}
	if (name.includes("memory") || name.includes("remember") || name.includes("update") || name.includes("sync")) {
		return "updating";
	}
	if (name.includes("compact") || name.includes("summar")) return "compacting";
	if (name.includes("test") || name.includes("debug")) return "running";

	return "working";
}

/** Resolved status-chip activity for a specific tool invocation. */
export interface ToolActivity {
	id: AnimationId;
	/** Optional target name appended to the label, e.g. the skill being read. */
	name?: string;
}

/** Skill name from a SKILL.md path: /skills/vcs/git-basics/SKILL.md → git-basics */
export function skillNameFromPath(path: string | undefined): string | undefined {
	if (!path) return undefined;
	const normalized = path.replace(/\\/g, "/");
	const withoutFile = normalized.replace(/\/SKILL\.md$/i, "");
	const base = withoutFile.split("/").filter(Boolean).pop();
	return base || undefined;
}

/**
 * Derive a named activity chip from a tool call's name + args.
 * Returns undefined to fall back to the generic tool-name mapping.
 */
export function resolveToolActivity(toolName: string | undefined | null, args?: unknown): ToolActivity | undefined {
	if (!toolName) return undefined;
	const name = toolName.trim().toLowerCase();
	const a = (args ?? {}) as Record<string, unknown>;
	const action = typeof a.action === "string" ? a.action.trim().toLowerCase() : undefined;
	const kind = typeof a.kind === "string" ? a.kind.trim().toLowerCase() : undefined;
	const query = typeof a.query === "string" ? a.query.trim() : undefined;

	if (name === "subagent" || name === "sub-agent") {
		return { id: "subagent" };
	}
	if (name === "stop_subagent") {
		return { id: "subagent" };
	}
	if (name === "send_to_subagent") {
		return { id: "sending-message" };
	}
	if (name === "capability_search" || name === "capability-search") {
		if (action === "view") return { id: "reading-skill", name: query || undefined };
		if (kind === "tool") return { id: "searching-tools" };
		if (kind === "skill") return { id: "searching-skills" };
		// kind omitted (models usually skip it): infer from the query so the
		// chip is still specific instead of always the generic "Searching".
		if (query) {
			const q = query.toLowerCase();
			if (q.startsWith("skill:") || /\bskill/i.test(q)) return { id: "searching-skills" };
			if (/\btool/i.test(q)) return { id: "searching-tools" };
		}
		return { id: "searching" };
	}
	if (name === "projects" || name === "project_search" || name === "project-search") {
		if (action === "view") return { id: "reading-project", name: query || undefined };
		return { id: "searching-projects" };
	}
	// Reading a SKILL.md through the read tool → named skill chip.
	if ((name === "read" || name === "read_file") && typeof a.path === "string" && /\/SKILL\.md$/i.test(a.path)) {
		return { id: "reading-skill", name: skillNameFromPath(a.path) };
	}
	return undefined;
}

export function resolveAnimationFromText(text: string | undefined | null): AnimationId | undefined {
	if (!text) return undefined;
	const lower = text.toLowerCase();

	const explicit = lower.match(/^\[activity:\s*([^\]]+)\]/);
	if (explicit) {
		return normalizeAnimationId(explicit[1]!.trim());
	}

	if (/\b(pytest|vitest|jest|npm test|cargo test|go test)\b/.test(lower)) return "running";
	if (/\b(curl|wget|http|https:\/\/|browser)\b/.test(lower)) return "browsing";
	if (/\b(grep|rg |find |fd |ls )\b/.test(lower)) return "searching";
	if (/\b(cat |head |tail |less |more )\b/.test(lower)) return "reading";
	// Only treat arrow/redirect output as writing when it clearly means file
	// output (echo ... > file). A bare `->`/`=>`/`>> ` in grep/diff/tool output
	// is NOT a write and would otherwise mislabel the activity as Writing.
	if (/\btee\b/.test(lower) || /\becho\b.*>[^=-]/.test(lower)) return "writing";
	if (/\b(sed|awk)\b/.test(lower) || /perl\s+-i/.test(lower)) return "editing";
	if (/\b(update|upgrade|sync|refresh)\b/.test(lower)) return "updating";
	if (/\b(git |npm |pnpm |yarn |cargo |pip |docker )\b/.test(lower)) return "running";

	return undefined;
}

// ---------------------------------------------------------------------------
// Compatibility shims (old activity-status API)
// ---------------------------------------------------------------------------

/** @deprecated Use ANIMATIONS */
export const PORCUPINE_ACTIVITIES = ANIMATIONS.map((a) => ({
	phase: a.id,
	emoji: a.emoji,
	label: a.label,
	emojiFrames: [a.emoji],
}));

/** @deprecated Use getAnimation */
export function getPorcupineActivity(phase: AnimationId | string) {
	const a = getAnimation(phase);
	return { phase: a.id, emoji: a.emoji, label: a.label, emojiFrames: [a.emoji] };
}

/** @deprecated Use animationLoaderOptions */
export function buildActivityFrames(phase: AnimationId | string): string[] {
	const a = getAnimation(phase);
	return buildDotFrames(a.emoji, a.label);
}

/** @deprecated */
export function formatActivityLine(phase: AnimationId | string, dots: string = "..."): string {
	const a = getAnimation(phase);
	return `${a.emoji}  ${a.label}${dots}`;
}

/** @deprecated Use animationLoaderOptions + formatAnimationMessage */
export function activityIndicatorOptions(phase: AnimationId | string): AnimationLoaderOptions {
	return animationLoaderOptions(phase);
}

/** @deprecated */
export const resolveActivityFromToolName = resolveAnimationFromToolName;
/** @deprecated */
export const resolveActivityFromText = resolveAnimationFromText;

/** @deprecated Use DOT_FRAMES */
export const ACTIVITY_DOT_FRAMES = DOT_FRAMES;
/** @deprecated */
export const DEFAULT_ACTIVITY_INTERVAL_MS = DEFAULT_ANIMATION_INTERVAL_MS;
