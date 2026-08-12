/**
 * Sub-agent sessions: first-class, recallable session files.
 *
 * Every sub-agent run's full transcript is persisted as a normal session file
 * in the same store and JSONL format as main sessions, tagged with a
 * `type: "subagent"` header. This makes sub-agent runs:
 * - searchable via session_search (it shares the store and format),
 * - openable/recallable via the /subagents slash command,
 * - continuable after a budget-exhausted run.
 *
 * Because the header carries `type: "subagent"`, main-session surfaces
 * (/resume and the session picker) exclude them — see SessionManager.list /
 * listAll which filter on that tag — while recall surfaces keep them visible.
 */

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage, SubagentResult } from "@porcupineai/agent-core";
import type { Message } from "@porcupineai/ai";
import { getSessionsDir } from "../config.ts";
import type { SessionInfo } from "../core/session-manager.ts";
import { SessionManager } from "../core/session-manager.ts";

/** Max estimated transcript payload to persist per sub-agent run. */
export const MAX_SUBAGENT_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
/** Most-recent sub-agent sessions to keep; older ones are pruned. */
export const DEFAULT_SUBAGENT_SESSION_RETENTION = 100;

export interface SubagentSessionResult {
	readonly messages: AgentMessage[];
	readonly ok: boolean;
	readonly steps: number;
	readonly budgetExhausted: boolean;
	readonly cancelled?: boolean;
	readonly summary: string;
	readonly usage?: SubagentResult["usage"];
	readonly error?: string;
}

export interface PersistSubagentSessionOptions {
	/** Working directory (stored in the session header; defaults to process.cwd()). */
	cwd?: string;
	/** Explicit session dir. If omitted, uses the default per-cwd sessions store. */
	sessionDir?: string;
	/** Id of the main session that spawned this sub-agent. */
	parentSessionId?: string;
	/** Short sub-agent id (e.g. sa-...). */
	subagentId: string;
	/** The task text the sub-agent was asked to complete. */
	task: string;
	/** The sub-agent run result, including the full transcript. */
	result: SubagentSessionResult;
	/** Most-recent sub-agent sessions to keep. Defaults to DEFAULT_SUBAGENT_SESSION_RETENTION. */
	retention?: number;
}

export interface PersistedSubagentSession {
	sessionId: string;
	path: string;
}

/**
 * Write a sub-agent run's full transcript as a session file in the same store
 * and format as main sessions. Best-effort: never throws into the calling
 * session; returns undefined when the run produced no transcript or on failure.
 */
export async function persistSubagentSession(
	opts: PersistSubagentSessionOptions,
): Promise<PersistedSubagentSession | undefined> {
	const messages = opts.result.messages;
	if (!messages || messages.length === 0) {
		return undefined;
	}

	try {
		const cwd = opts.cwd ?? process.cwd();
		const manager = SessionManager.create(cwd, opts.sessionDir, {
			type: "subagent",
			subagentId: opts.subagentId,
			parentSessionId: opts.parentSessionId,
			task: opts.task,
		});

		// Result metadata as a custom entry (does not pollute LLM context).
		manager.appendCustomEntry("subagent_meta", {
			ok: opts.result.ok,
			steps: opts.result.steps,
			budgetExhausted: opts.result.budgetExhausted,
			cancelled: opts.result.cancelled ?? false,
			summary: opts.result.summary,
			error: opts.result.error,
			usage: opts.result.usage,
		});

		// Transcript, bounded by the size cap. Keep the earliest messages that fit.
		for (const message of fitTranscriptWithinCap(messages)) {
			const persisted = toAppendableMessage(message);
			if (persisted) manager.appendMessage(persisted);
		}

		// Guarantee the file lands on disk even if the transcript has no assistant
		// message (the normal append defers the first write until the assistant).
		const path = manager.forceFlushToDisk();
		if (!path) {
			return undefined;
		}

		pruneSubagentSessions(opts.sessionDir, opts.retention ?? DEFAULT_SUBAGENT_SESSION_RETENTION);
		return { sessionId: manager.getSessionId(), path };
	} catch (error) {
		// Best-effort: a failed sub-agent transcript write must never crash the
		// main session, but do not swallow it silently - surface it for diagnosis.
		console.warn("Failed to persist sub-agent session transcript:", error instanceof Error ? error.message : error);
		return undefined;
	}
}

/**
 * Reduce a SubagentResult transcript message to the shape SessionManager can
 * append. Messages that are not user/assistant/toolResult with content (e.g.
 * branch summaries) are dropped; they are not meaningful in a transcript file.
 */
function toAppendableMessage(message: AgentMessage): Message | undefined {
	const role = (message as { role?: string }).role;
	if (role !== "user" && role !== "assistant" && role !== "toolResult") return undefined;
	if ((message as { content?: unknown }).content == null) return undefined;
	return message as unknown as Message;
}

/** Keep the earliest messages that fit within the transcript byte cap. */
function fitTranscriptWithinCap(messages: AgentMessage[]): AgentMessage[] {
	// Fast path: most transcripts fit comfortably.
	if (transcriptBytes(messages) <= MAX_SUBAGENT_TRANSCRIPT_BYTES) {
		return messages;
	}
	const fitted: AgentMessage[] = [];
	let total = 0;
	for (const message of messages) {
		const bytes = Buffer.byteLength(JSON.stringify(message));
		if (total + bytes > MAX_SUBAGENT_TRANSCRIPT_BYTES && fitted.length > 0) {
			break;
		}
		fitted.push(message);
		total += bytes;
	}
	return fitted;
}

function transcriptBytes(messages: AgentMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total += Buffer.byteLength(JSON.stringify(message));
	}
	return total;
}

export interface SubagentSessionSummary {
	sessionId: string;
	path: string;
	subagentId?: string;
	parentSessionId?: string;
	task?: string;
	steps: number;
	ok: boolean;
	budgetExhausted: boolean;
	created: Date;
	messageCount: number;
}

/**
 * Return sub-agent-tagged sessions (newest first). Reads from the same session
 * store; only sessions whose header carries `type: "subagent"` are returned.
 */
export async function listSubagentSessions(sessionDir?: string, limit?: number): Promise<SubagentSessionSummary[]> {
	const infos: SessionInfo[] =
		sessionDir !== undefined
			? await SessionManager.listAll(sessionDir, undefined, { includeSubagents: true })
			: await SessionManager.listAll(undefined, undefined, { includeSubagents: true });

	const subagents = infos.filter((info) => info.type === "subagent");
	subagents.sort((a, b) => {
		const aCreated = a.created.getTime();
		const bCreated = b.created.getTime();
		if (aCreated !== bCreated) return bCreated - aCreated;
		const aMtime = fileMtime(a.path);
		const bMtime = fileMtime(b.path);
		if (aMtime !== bMtime) return bMtime - aMtime;
		// Full tie: same-millisecond creates with identical mtimes. Break by
		// session id so ordering never depends on directory iteration order.
		return b.id.localeCompare(a.id);
	});

	const target = limit !== undefined ? subagents.slice(0, limit) : subagents;
	return target.map(toSummary);
}

function fileMtime(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

function toSummary(info: SessionInfo): SubagentSessionSummary {
	return {
		sessionId: info.id,
		path: info.path,
		subagentId: info.subagentId,
		parentSessionId: info.parentSessionId,
		task: info.task,
		steps: info.messageCount,
		ok: extractMeta(info, "ok"),
		budgetExhausted: extractMeta(info, "budgetExhausted"),
		created: info.created,
		messageCount: info.messageCount,
	};
}

/**
 * best-effort pull of a metadata field from the persisted subagent_meta custom
 * entry. Falls back to false rather than failing on malformed files.
 */
function extractMeta(info: SessionInfo, field: string): boolean {
	try {
		const entries = SessionManager.open(info.path).getEntries();
		for (const entry of entries) {
			if (entry.type === "custom" && entry.customType === "subagent_meta") {
				const data = (entry as { data?: Record<string, unknown> }).data;
				if (data && field in data) return data[field] === true;
			}
		}
	} catch {
		// unreadable session file: treat as absent metadata
	}
	return false;
}

/**
 * Keep only the most recent N sub-agent sessions; remove older sub-agent
 * session files. Main sessions are never pruned. Best-effort.
 */
export function pruneSubagentSessions(
	sessionDir?: string,
	retention: number = DEFAULT_SUBAGENT_SESSION_RETENTION,
): number {
	const root = sessionDir ?? getSessionsDir();
	if (retention <= 0 || !existsSync(root)) return 0;

	// Scope pruning to the CURRENT session directory only. Sessions live in
	// per-project subdirectories under the sessions root; walking them here would
	// delete sub-agent transcripts in unrelated projects. Reading only `root`
	// keeps retention local to the session that just persisted a transcript.
	const allSubagent: Array<{ path: string; mtime: number }> = [...readSubagentFilesInDir(root)];
	allSubagent.sort((a, b) => b.mtime - a.mtime);

	const removed = Math.max(0, allSubagent.length - retention);
	for (const stale of allSubagent.slice(retention)) {
		try {
			unlinkSync(stale.path);
		} catch {
			// best-effort prune
		}
	}
	return removed;
}

function readSubagentFilesInDir(dir: string): Array<{ path: string; mtime: number }> {
	const found: Array<{ path: string; mtime: number }> = [];
	if (!existsSync(dir)) return found;
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".jsonl")) continue;
		const path = join(dir, file);
		try {
			if (headerType(path) === "subagent") {
				found.push({ path, mtime: statSync(path).mtimeMs });
			}
		} catch {
			// skip unreadable
		}
	}
	return found;
}

function headerType(path: string): "session" | "subagent" | undefined {
	try {
		const fd = openSync(path, "r");
		try {
			const buf = Buffer.allocUnsafe(8192);
			const bytes = readSync(fd, buf, 0, buf.length, 0);
			const newline = buf.subarray(0, bytes).indexOf(0x0a);
			if (newline === -1) return undefined;
			const header = JSON.parse(buf.subarray(0, newline).toString("utf8")) as { type?: string };
			if (header.type === "subagent") return "subagent";
			if (header.type === "session") return "session";
			return undefined;
		} finally {
			closeSync(fd);
		}
	} catch {
		return undefined;
	}
}
