/**
 * Durable Porcupine memory: MEMORY.md (agent notes) + USER.md (user profile).
 * Injected into the system prompt every turn; mutated via the memory tool.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type MemoryTarget = "memory" | "user";
export type MemoryAction = "add" | "replace" | "remove" | "list";

export const MEMORY_FILE = "MEMORY.md";
export const USER_FILE = "USER.md";

/** Storage limits: how large each memory file may grow on disk. */
export const MEMORY_CHAR_LIMIT = 16_000;
export const USER_CHAR_LIMIT = 12_000;

/**
 * Prompt budgets: how much of each file is injected into the system prompt
 * every turn. Storage can outgrow this; the injected block is truncated with a
 * count marker and the full file stays reachable via the memory tool.
 */
export const MEMORY_PROMPT_CHAR_LIMIT = 8_000;
export const USER_PROMPT_CHAR_LIMIT = 6_000;

const DEFAULT_MEMORY = `# MEMORY

Durable agent notes (preferences learned, environment facts, stable conventions).
Keep compact. Prefer short bullets.

`;

const DEFAULT_USER = `# USER

Who the user is — stable prefs, corrections, workflow facts.
Lines may use: - [category:key] fact

`;

export interface MemoryEntry {
	/** 1-based line number in the file body (after header). */
	index: number;
	text: string;
}

export interface MemoryMutationResult {
	ok: boolean;
	target: MemoryTarget;
	action: MemoryAction;
	file: string;
	message: string;
	content: string;
	chars: number;
	limit: number;
	entries?: MemoryEntry[];
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
		renameSync(tmp, path);
	} finally {
		try {
			rmSync(tmp, { force: true });
		} catch {
			/* ignore */
		}
	}
}

export function memoryPath(agentDir: string, target: MemoryTarget): string {
	return join(agentDir, target === "user" ? USER_FILE : MEMORY_FILE);
}

export function charLimit(target: MemoryTarget): number {
	return target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

export function defaultContent(target: MemoryTarget): string {
	return target === "user" ? DEFAULT_USER : DEFAULT_MEMORY;
}

export function readMemoryFile(agentDir: string, target: MemoryTarget): string {
	const path = memoryPath(agentDir, target);
	if (!existsSync(path)) return defaultContent(target);
	try {
		return readFileSync(path, "utf8");
	} catch {
		return defaultContent(target);
	}
}

export function ensureMemoryFiles(agentDir: string): void {
	mkdirSync(agentDir, { recursive: true });
	for (const target of ["memory", "user"] as const) {
		const path = memoryPath(agentDir, target);
		if (!existsSync(path)) {
			atomicWrite(path, defaultContent(target));
		}
	}
}

/**
 * Bullet / non-empty lines under the heading, for list/remove/replace.
 * The preamble (header lines and any intro text before the first bullet) is
 * preserved separately so rebuilds never destroy user-authored structure.
 */
export interface MemoryBody {
	preamble: string[];
	entries: MemoryEntry[];
}

export function parseMemoryBody(content: string): MemoryBody {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const preamble: string[] = [];
	const entries: MemoryEntry[] = [];
	let i = 0;
	let seenEntry = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (!seenEntry) preamble.push(line);
			continue;
		}
		if (trimmed.startsWith("#")) {
			if (!seenEntry) preamble.push(line);
			continue;
		}
		seenEntry = true;
		i += 1;
		entries.push({ index: i, text: trimmed.replace(/^- /, "") });
	}
	return { preamble, entries };
}

/** Legacy alias: flat entry list for existing callers/tests. */
export function listEntries(content: string): MemoryEntry[] {
	return parseMemoryBody(content).entries;
}

function rebuildFromEntries(target: MemoryTarget, body: MemoryBody): string {
	const fallback = target === "user" ? "# USER\n\n" : "# MEMORY\n\n";
	const preamble = body.preamble.length > 0 ? `${body.preamble.join("\n")}\n` : fallback;
	if (body.entries.length === 0) return `${preamble}\n`;
	return `${preamble}${body.entries.map((e) => `- ${e.text}`).join("\n")}\n`;
}

export function mutateMemory(
	agentDir: string,
	action: MemoryAction,
	target: MemoryTarget,
	opts: { content?: string; oldText?: string } = {},
): MemoryMutationResult {
	ensureMemoryFiles(agentDir);
	const file = memoryPath(agentDir, target);
	const limit = charLimit(target);
	let body = readMemoryFile(agentDir, target);
	const parsed = parseMemoryBody(body);
	const entries = parsed.entries;

	if (action === "list") {
		return {
			ok: true,
			target,
			action,
			file,
			message: `${entries.length} entries (${body.length}/${limit} chars)`,
			content: body,
			chars: body.length,
			limit,
			entries,
		};
	}

	if (action === "add") {
		const fact = (opts.content ?? "").trim();
		if (!fact) {
			return {
				ok: false,
				target,
				action,
				file,
				message: "content is required for add",
				content: body,
				chars: body.length,
				limit,
			};
		}
		// de-dupe: exact text only (substring suffixes cause false positives).
		if (entries.some((e) => e.text === fact)) {
			return {
				ok: true,
				target,
				action,
				file,
				message: "already present",
				content: body,
				chars: body.length,
				limit,
				entries,
			};
		}
		entries.push({ index: entries.length + 1, text: fact });
	} else if (action === "replace") {
		const oldText = (opts.oldText ?? "").trim();
		const fact = (opts.content ?? "").trim();
		if (!oldText || !fact) {
			return {
				ok: false,
				target,
				action,
				file,
				message: "oldText and content are required for replace",
				content: body,
				chars: body.length,
				limit,
			};
		}
		// Prefer an exact entry match; fall back to a substring match only when
		// it is unambiguous (exactly one entry contains it).
		let idx = entries.findIndex((e) => e.text === oldText);
		if (idx < 0) {
			const candidates = entries.filter((e) => e.text.includes(oldText));
			if (candidates.length === 1) idx = entries.indexOf(candidates[0]);
		}
		if (idx < 0) {
			return {
				ok: false,
				target,
				action,
				file,
				message: `no unique entry matching oldText: ${oldText}`,
				content: body,
				chars: body.length,
				limit,
				entries,
			};
		}
		entries[idx] = { index: entries[idx].index, text: fact };
	} else if (action === "remove") {
		const oldText = (opts.oldText ?? opts.content ?? "").trim();
		if (!oldText) {
			return {
				ok: false,
				target,
				action,
				file,
				message: "oldText (or content) is required for remove",
				content: body,
				chars: body.length,
				limit,
			};
		}
		const next = entries.filter((e) => !e.text.includes(oldText));
		if (next.length === entries.length) {
			return {
				ok: false,
				target,
				action,
				file,
				message: `no entry matching: ${oldText}`,
				content: body,
				chars: body.length,
				limit,
				entries,
			};
		}
		entries.length = 0;
		entries.push(...next.map((e, i) => ({ index: i + 1, text: e.text })));
	}

	body = rebuildFromEntries(target, parsed);
	// Only growth mutations are bounded by the storage limit. remove/replace
	// shrink or hold the size and must always succeed once matched, otherwise a
	// file over the limit becomes uneditable.
	if (action === "add" && body.length > limit) {
		const longest = [...entries]
			.sort((a, b) => b.text.length - a.text.length)
			.slice(0, 5)
			.map((e) => `- (${e.text.length}c) ${e.text.slice(0, 80)}…`)
			.join("\n");
		return {
			ok: false,
			target,
			action,
			file,
			message: `would exceed ${limit} char limit (${body.length}). Shorten or remove entries first; longest entries:\n${longest}`,
			content: readMemoryFile(agentDir, target),
			chars: readMemoryFile(agentDir, target).length,
			limit,
			entries: listEntries(readMemoryFile(agentDir, target)),
		};
	}

	atomicWrite(file, body);
	return {
		ok: true,
		target,
		action,
		file,
		message: `${action} ok`,
		content: body,
		chars: body.length,
		limit,
		entries: listEntries(body),
	};
}

/** Block injected into the system prompt when files have substance. */
export function formatMemoryForPrompt(agentDir: string): string {
	ensureMemoryFiles(agentDir);
	const parts: string[] = [];

	for (const target of ["user", "memory"] as const) {
		const file = target === "user" ? USER_FILE : MEMORY_FILE;
		const budget = target === "user" ? USER_PROMPT_CHAR_LIMIT : MEMORY_PROMPT_CHAR_LIMIT;
		const full = readMemoryFile(agentDir, target).trim();
		const { entries } = parseMemoryBody(full);
		if (entries.length === 0) continue;

		let content = full;
		let marker = "";
		if (full.length > budget) {
			// Truncate on an entry boundary so the injected block never ends with
			// a dangling half-bullet, and tell the model more exists.
			let cut = 0;
			let includedCount = 0;
			for (const entry of entries) {
				const lineEnd = full.indexOf(`- ${entry.text}`, cut) + entry.text.length + 2;
				if (lineEnd > budget) break;
				cut = lineEnd;
				// The entry fully fits within the truncated block only when its own
				// line boundary was reached (lineEnd <= budget). Counting by boundary
				// avoids a substring-overlap false positive: an entry whose text
				// happens to be a substring of an included entry is still counted as
				// remaining if it was cut off.
				includedCount++;
			}
			if (cut === 0) cut = Math.min(budget, full.length);
			content = full.slice(0, cut).trimEnd();
			const remaining = entries.length - includedCount;
			marker = `\n… (${remaining} more entries in ${file} — read via the memory tool)`;
		}
		const tag = target === "user" ? "user_profile" : "agent_memory";
		parts.push(`<${tag} path="${file}">\n${content}${marker}\n</${tag}>`);
	}

	if (parts.length === 0) return "";
	return `\n\n<porcupine_memory>\n${parts.join("\n\n")}\n</porcupine_memory>`;
}

/**
 * Heuristic extractor for user-pattern learning (no LLM).
 * Picks durable prefs/corrections from plain user text.
 */
export function extractUserPatternsHeuristic(message: string): Array<{
	key: string;
	category: "preference" | "correction" | "workflow" | "context";
	fact: string;
	confidence: number;
	evidence: string[];
	sensitive: boolean;
	temporary: boolean;
}> {
	const text = message.trim();
	if (text.length < 12 || text.length > 2000) return [];

	const patterns: Array<{
		re: RegExp;
		category: "preference" | "correction" | "workflow" | "context";
		confidence: number;
	}> = [
		{ re: /\b(?:i\s+)?prefer\s+(.+?)(?:\.|$)/i, category: "preference", confidence: 0.9 },
		{ re: /\balways\s+(.+?)(?:\.|$)/i, category: "preference", confidence: 0.85 },
		{ re: /\bnever\s+(.+?)(?:\.|$)/i, category: "correction", confidence: 0.9 },
		{ re: /\bdon'?t\s+(.+?)(?:\.|$)/i, category: "correction", confidence: 0.85 },
		{ re: /\bremember\s+(?:that\s+)?(.+?)(?:\.|$)/i, category: "context", confidence: 0.9 },
		{ re: /\bfrom\s+now\s+on[,\s]+(.+?)(?:\.|$)/i, category: "workflow", confidence: 0.88 },
		{ re: /\bmy\s+(?:default|usual)\s+(.+?)(?:\.|$)/i, category: "preference", confidence: 0.86 },
	];

	const out: Array<{
		key: string;
		category: "preference" | "correction" | "workflow" | "context";
		fact: string;
		confidence: number;
		evidence: string[];
		sensitive: boolean;
		temporary: boolean;
	}> = [];

	const sensitive = /\b(password|api[_-]?key|token|secret|ssn|credit\s*card)\b/i.test(text);

	for (const p of patterns) {
		const m = text.match(p.re);
		if (!m?.[1]) continue;
		const fact = m[0].trim().replace(/\s+/g, " ").slice(0, 240);
		const key = fact
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 48);
		if (!key) continue;
		out.push({
			key,
			category: p.category,
			fact,
			confidence: p.confidence,
			evidence: [text.slice(0, 400)],
			sensitive,
			temporary: /\b(today|this\s+once|for\s+now|temporary)\b/i.test(text),
		});
	}
	return out;
}
