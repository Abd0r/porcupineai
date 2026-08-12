/**
 * Platform-neutral remote slash-command catalog layer.
 *
 * InteractiveMode owns the canonical slash-command descriptors (built-in
 * interactive commands, prompt templates, skills, and extension commands) and
 * needs to expose them to remote bridges — Telegram, Discord, and iMessage —
 * each of which imposes different limitations on what a "/command" may look
 * like:
 *
 *   - Telegram  : command names are restricted to lowercase ASCII letters,
 *                 digits, and underscores, 1-32 chars. Hyphens and colons are
 *                 NOT allowed.
 *   - Discord   : names must be valid lowercase, 1-32 chars (letters, digits,
 *                 underscores and hyphens are allowed). Colons are not.
 *   - iMessage  : no strict charset restriction — canonical names flow through.
 *
 * This module turns the canonical descriptors into a deterministic remote
 * catalog per platform:
 *
 *   - Preserves the canonical "/command" invocation (and its argument text) so
 *     the resolved command line is always exact, e.g. "/skill:web-search docs".
 *   - Generates platform-safe aliases for names that contain a colon or hyphen
 *     (or would collide after normalization).
 *   - Keeps aliases stable and collision-safe (a pure, deterministic function
 *     of the command set, independent of caller ordering).
 *   - Reserves the bridge control surface (start/status/help/commands) so a
 *     generated alias can never shadow them.
 *   - Bounds descriptions to Telegram's 256-char and Discord's 100-char caps.
 *   - Resolves an inbound "alias + argument text" back to the exact canonical
 *     command line.
 *   - Formats a paginated textual "/commands [query|page]" listing suitable for
 *     iMessage/overflow rendering.
 *
 * Hidden internal easter eggs are excluded unless explicitly passed with
 * includeHidden. This module never emits secrets — it only echoes the
 * caller-supplied command names, descriptions, and hints.
 */

/** How a canonical command is sourced from the interactive mode surface. */
export type RemoteCommandKind = "builtin" | "prompt" | "skill" | "extension";

/** The remote surfaces a catalog can be materialized for. */
export type BridgePlatform = "telegram" | "discord" | "imessage";

/**
 * A canonical slash-command descriptor as contributed by InteractiveMode after
 * a refresh. `name` is the canonical command name WITHOUT a leading slash —
 * e.g. "settings", "skill:web-search", or an extension invocation name.
 */
export interface RemoteCommandDescriptor {
	/** Canonical command name without the leading slash. */
	name: string;
	/** Source slot the command lives in. */
	kind: RemoteCommandKind;
	/** Human description (auto-bounded per platform). */
	description?: string;
	/** Optional usage hint appended after the command name. */
	argumentHint?: string;
	/** Internal easter egg — excluded unless includeHidden is set. */
	hidden?: boolean;
	/** Non-secret metadata a caller may attach (e.g. source file path). */
	metadata?: Readonly<Record<string, string>>;
}

/** One resolved command entry in a generated remote catalog. */
export interface RemoteCatalogEntry {
	/** Canonical command name (e.g. "skill:web-search"). */
	command: string;
	/** Source slot (builtin/prompt/skill/extension). */
	kind: RemoteCommandKind;
	/** Platform-safe invocation name WITHOUT leading slash (e.g. "skill_web_search"). */
	alias: string;
	/** Canonical command line, e.g. "/skill:web-search". */
	commandLine: string;
	/** Description bounded for this platform. */
	description: string;
	/** Optional usage hint (e.g. "<repo>"). */
	argumentHint?: string;
}

/** A generated, deterministic remote catalog for a single platform. */
export interface RemoteCatalog {
	/** The platform this catalog was materialized for. */
	platform: BridgePlatform;
	/** Reserved bridge control-command names that can never be shadowed. */
	reserved: readonly string[];
	/** All visible commands, deterministic order. */
	commands: readonly RemoteCatalogEntry[];
	/** canonical command -> alias. */
	aliasOf: ReadonlyMap<string, string>;
	/** alias -> canonical command. */
	commandOf: ReadonlyMap<string, string>;
}

/** The reserved bridge control surface that must never be shadowed. */
export const RESERVED_BRIDGE_COMMANDS: readonly string[] = ["start", "status", "help", "commands"];

const DESCRIPTION_LIMITS: Record<BridgePlatform, number> = {
	telegram: 256,
	discord: 100,
	imessage: 256,
};

const DEFAULT_PAGE_SIZE = 20;

/** Deterministic 32-bit FNV-1a hash — stable across runs and callers. */
function stableHash(input: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return `00000000${h.toString(16)}`.slice(-8);
}

/** Lowercase and replace any disallowed char with "_", collapse and trim. */
function baseAlias(name: string, platform: BridgePlatform): string {
	const s = name.toLowerCase();
	let out = "";
	for (const ch of s) {
		if (/[a-z0-9]/.test(ch) || ch === "_" || (platform === "discord" && ch === "-")) {
			out += ch;
		} else {
			out += "_";
		}
	}
	out = out.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
	return out === "" ? "cmd" : out;
}

function truncated(alias: string): string {
	return alias.length > 32 ? alias.slice(0, 32) : alias;
}

/** Deterministic suffix used to disambiguate colliding aliases. */
function disambiguate(command: string, ordinal: number): string {
	const h = stableHash(`${command}#${ordinal}`);
	return h.slice(0, 6);
}

function isReserved(name: string): boolean {
	const lower = name.toLowerCase();
	return RESERVED_BRIDGE_COMMANDS.includes(lower);
}

/**
 * Build a deterministic remote catalog for a platform from canonical command
 * descriptors. Output order is the input order (as the caller presented it),
 * but alias assignment is fully deterministic regardless of caller ordering.
 */
export function buildRemoteCatalog(
	descriptors: readonly RemoteCommandDescriptor[],
	platform: BridgePlatform,
	options?: { includeHidden?: boolean; pageSize?: number; descriptionLimit?: number },
): RemoteCatalog {
	const includeHidden = options?.includeHidden ?? false;
	const descLimit = options?.descriptionLimit ?? DESCRIPTION_LIMITS[platform];

	// Deterministically de-duplicate by canonical name (last descriptor wins).
	const dedup = new Map<string, RemoteCommandDescriptor>();
	for (const d of descriptors) {
		if (includeHidden || !d.hidden) dedup.set(d.name, d);
	}

	const visible = Array.from(dedup.values()).map((d) => ({
		command: d.name,
		kind: d.kind,
		description: bound(d.description ?? "", descLimit),
		argumentHint: d.argumentHint,
	}));

	// Make alias assignment independent of caller ordering by working over a
	// name-stable sort; we keep canonical ordering for the returned list.
	const sorted = [...visible]
		.map((v, idx) => ({ ...v, _order: idx }))
		.sort((a, b) => (a.command < b.command ? -1 : a.command > b.command ? 1 : a._order - b._order));

	const used = new Set<string>();
	const aliasOf = new Map<string, string>();
	const commandOf = new Map<string, string>();

	for (const item of sorted) {
		let alias = truncated(baseAlias(item.command, platform));
		const base = alias;
		let ordinal = 0;
		// Ensure uniqueness AND never collide with a reserved bridge command.
		while (used.has(alias) || isReserved(alias)) {
			ordinal++;
			const suffix = disambiguate(item.command, ordinal);
			alias = truncated(`${base.slice(0, 32 - suffix.length - 1)}_${suffix}`);
			// Final fallback: reserve the whole slot to a pure hash.
			if (used.has(alias) || isReserved(alias)) {
				alias = truncated(`${stableHash(item.command)}_${ordinal}`);
			}
		}
		used.add(alias);
		aliasOf.set(item.command, alias);
		commandOf.set(alias, item.command);
	}

	const commands: RemoteCatalogEntry[] = visible.map((v) => {
		const alias = aliasOf.get(v.command)!;
		return {
			command: v.command,
			kind: v.kind,
			alias,
			commandLine: `/${v.command}`,
			description: v.description,
			...(v.argumentHint ? { argumentHint: v.argumentHint } : {}),
		};
	});

	return {
		platform,
		reserved: RESERVED_BRIDGE_COMMANDS,
		commands,
		aliasOf,
		commandOf,
	};
}

/**
 * Resolve an inbound remote alias (optionally with a leading "/") plus
 * argument text back to the exact canonical command line. Returns null when the
 * alias is unknown. Argument text is whitespace-trimmed.
 */
export function resolveRemoteCommand(
	catalog: RemoteCatalog,
	aliasOrCommand: string,
	argumentText?: string,
): { command: string; commandLine: string } | null {
	const token = aliasOrCommand.trim().replace(/^\/+/, "").toLowerCase();
	if (!token) return null;

	let command = catalog.commandOf.get(token);
	if (command === undefined) {
		// Also accept the canonical command name directly.
		const direct = catalog.commands.find((e) => e.command.toLowerCase() === token);
		command = direct?.command;
	}
	if (command === undefined) return null;

	const arg = argumentText?.trim() ?? "";
	const commandLine = arg ? `/${command} ${arg}` : `/${command}`;
	return { command, commandLine };
}

/** Options controlling the textual /commands listing. */
export interface RemoteCommandListOptions {
	pageSize?: number;
}

/**
 * Format a paginated textual "/commands [query|page]" listing for iMessage /
 * overflow rendering. `queryOrPage` may be a search query, a page number, a
 * "query" + page "n" pairing (space-separated), or omitted for page 1.
 */
export function formatRemoteCommandList(
	catalog: RemoteCatalog,
	queryOrPage?: string,
	options?: RemoteCommandListOptions,
): string {
	const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
	const tokens = (queryOrPage ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);

	let query = "";
	let page = 1;
	for (const token of tokens) {
		if (/^\d+$/.test(token)) {
			page = Math.max(1, Number(token));
		} else if (query === "") {
			query = token;
		} else {
			query = `${query} ${token}`;
		}
	}

	const entries = catalog.commands.filter((e) => {
		if (!query) return true;
		const haystack = `${e.command} ${e.alias} ${e.description}`.toLowerCase();
		return haystack.includes(query);
	});

	const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
	const boundedPage = Math.min(page, totalPages);
	const start = (boundedPage - 1) * pageSize;
	const slice = entries.slice(start, start + pageSize);

	const header = query
		? `/commands — matching “${query}” (page ${boundedPage}/${totalPages})`
		: `/commands — remote command list (page ${boundedPage}/${totalPages})`;

	const lines = slice.map((e) => {
		let line = e.commandLine;
		if (e.alias !== e.command && catalog.platform !== "imessage") {
			line = `/${e.command} (alias /${e.alias})`;
		}
		if (e.argumentHint) line = `${line} ${e.argumentHint}`;
		const desc = e.description ? ` — ${e.description}` : "";
		return `${line}${desc}`;
	});

	lines.push(`Use "/commands <query>" to filter, or "/commands <N>" for page N (1-${totalPages}).`);
	return [header, ...lines].join("\n");
}

function bound(value: string, limit: number): string {
	return value.length > limit ? value.slice(0, limit) : value;
}
