/**
 * Human tags for background sub-agents.
 *
 * The main agent is always `@porcupine` (`@main` stays accepted as an alias).
 * Running sub-agents hold one tag each from a small pool so the TUI, status
 * views, and WoT messages can say `@buck` instead of `sa-mtn1cag1-5k4z1v`.
 * The pool defaults to buck/fudgy/tinker/rivet/gizmo and the user may override
 * it via `subagent.names` in settings.
 */

export const MAIN_AGENT_TAG = "porcupine";
export const MAIN_AGENT_TAG_ALIASES = ["main"] as const;

/** Shipped default sub-agent names (tags are `@` + name). */
export const DEFAULT_SUBAGENT_NAMES = ["buck", "fudgy", "tinker", "rivet", "gizmo"] as const;

/** Fixed-size name pool: one slot per sub-agent, up to the configured maximum. */
export type SubagentNamePoolTuple = [string, string, string, string, string];

/** A resolved tag always carries its `@` prefix for display and addressing. */
export function formatAgentTag(name: string): string {
	return `@${name}`;
}

/** Normalize a user- or model-supplied reference (`@Buck`, `buck`) to a bare name. */
export function normalizeAgentName(value: string): string {
	return value.trim().toLowerCase().replace(/^@+/, "");
}

/** True for the main agent's tag or alias (`@porcupine`, `porcupine`, `@main`, `main`). */
export function isMainAgentRef(value: string): boolean {
	const name = normalizeAgentName(value);
	return name === MAIN_AGENT_TAG || (MAIN_AGENT_TAG_ALIASES as readonly string[]).includes(name);
}

const RESERVED_NAMES = new Set<string>([MAIN_AGENT_TAG, ...MAIN_AGENT_TAG_ALIASES]);

function isValidName(name: string): boolean {
	return /^[a-z0-9][a-z0-9-]{0,23}$/.test(name);
}

/**
 * Clean an explicit name request (tool `name` param or settings entry).
 * Returns undefined when the request is unusable so the caller falls back
 * to the pool instead of failing the spawn.
 */
export function sanitizeAgentName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const name = normalizeAgentName(value);
	if (!isValidName(name) || RESERVED_NAMES.has(name)) return undefined;
	return name;
}

/**
 * Build the effective name pool: user settings first (sanitized, deduped),
 * then shipped defaults to fill up to five slots.
 */
export function buildAgentNamePool(configured: unknown): SubagentNamePoolTuple {
	const pool: string[] = [];
	const seen = new Set<string>();
	const take = (name: string) => {
		if (seen.has(name)) return;
		seen.add(name);
		if (pool.length < 5) pool.push(name);
	};
	if (Array.isArray(configured)) {
		for (const entry of configured) {
			const name = sanitizeAgentName(entry);
			if (name) take(name);
		}
	}
	for (const name of DEFAULT_SUBAGENT_NAMES) take(name);
	while (pool.length < 5) pool.push(`worker-${pool.length + 1}`);
	return [pool[0]!, pool[1]!, pool[2]!, pool[3]!, pool[4]!];
}

/** Per-session pool: claims names for running sub-agents, frees them on settle. */
export class SubagentNamePool {
	private readonly pool: SubagentNamePoolTuple;
	private readonly claimed = new Map<string, string>();

	constructor(configured: unknown) {
		this.pool = buildAgentNamePool(configured);
	}

	/** Claim a tag for a run id. An explicit request wins when free and valid. */
	claim(id: string, preferred?: unknown): string {
		const existing = this.claimed.get(id);
		if (existing) return existing;
		const taken = new Set(this.claimed.values());
		const wanted = sanitizeAgentName(preferred);
		if (wanted && !taken.has(wanted)) {
			this.claimed.set(id, wanted);
			return wanted;
		}
		const free = this.pool.find((name) => !taken.has(name));
		// The pool always has five slots for up to maxConcurrent=5; a custom
		// request that collides falls back to the first free pool name, else a suffix.
		const name = free ?? `${this.pool[0]}-${this.claimed.size + 1}`;
		this.claimed.set(id, name);
		return name;
	}

	/** Free a run id's tag when its run settles. */
	release(id: string): void {
		this.claimed.delete(id);
	}

	/** Tag currently held by a run id, if any. */
	nameOf(id: string): string | undefined {
		return this.claimed.get(id);
	}

	/**
	 * Resolve a main-side reference (`@buck`, `buck`, or a raw `sa-…` id) to a
	 * running run id. Unknown refs resolve to undefined.
	 */
	resolveRef(ref: string): string | undefined {
		const trimmed = ref.trim();
		if (trimmed.length === 0) return undefined;
		if (this.claimed.has(trimmed)) return trimmed;
		const name = normalizeAgentName(trimmed);
		for (const [id, claimed] of this.claimed) {
			if (claimed === name) return id;
		}
		return undefined;
	}

	/** Live `tag → id` pairs for status views and error messages. */
	active(): Array<{ tag: string; id: string }> {
		return [...this.claimed].map(([id, name]) => ({ tag: formatAgentTag(name), id }));
	}
}
