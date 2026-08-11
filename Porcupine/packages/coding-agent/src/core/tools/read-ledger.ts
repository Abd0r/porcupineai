/**
 * Relational read/write ledger: tracks which line ranges of a file the model has
 * actually SEEN via read_file, then lets edit/write consult it before mutating.
 *
 * Rationale (lesson 3): a write that overwrites a file the model only PARTIALLY
 * saw would silently destroy the unseen part. The ledger refuses such overwrites,
 * but it must never loop: the moment the model has seen the FULL file (or the
 * file has since changed — so the model's view is stale anyway) the edit proceeds.
 *
 * This module is self-contained: pure record/query functions plus a per-session
 * cache class. It holds no I/O. read_file records into it (parent agent wires the
 * hook); edit and write consult it.
 */

export interface ReadRecordInput {
	/** File mtime (ms since epoch) observed at read time. */
	mtimeMs: number;
	/** File size (bytes) observed at read time. */
	size: number;
	/** First line the model saw, 1-indexed inclusive. */
	seenFromLine: number;
	/** Last line the model saw, 1-indexed inclusive. */
	seenToLine: number;
	/** Total number of lines in the file at the time of the read. */
	totalLines: number;
}

interface StoredRecord extends ReadRecordInput {}

export type CanEditResult =
	| { allowed: true; note?: string }
	| { allowed: false; seenLines: string; totalLines: number };

/** Render the seen window (1-indexed, inclusive) as the compact "X-Y" form. */
function formatSeenWindow(stored: StoredRecord): string {
	// Unit-covering reads: a single line reads as "N" rather than "N-N".
	if (stored.seenFromLine === stored.seenToLine) {
		return String(stored.seenFromLine);
	}
	return `${stored.seenFromLine}-${stored.seenToLine}`;
}

/**
 * Per-session cache of what the model has seen, keyed by absolute path.
 * A session should own one instance; see {@link getReadLedger} for the shared one.
 */
export class ReadLedger {
	private readonly records = new Map<string, StoredRecord>();

	/**
	 * Merge a read window into the ledger. Two reads are considered the same file
	 * version when both mtime and size match; their windows are merged so a full
	 * read later clears any earlier partial flag for that version.
	 */
	recordRead(absolutePath: string, input: ReadRecordInput): void {
		const current = this.records.get(absolutePath);

		if (current && current.mtimeMs === input.mtimeMs && current.size === input.size) {
			// Same version — widen the seen window.
			const seenFromLine = Math.min(current.seenFromLine, input.seenFromLine);
			const seenToLine = Math.max(current.seenToLine, input.seenToLine);
			// totalLines is intrinsic to the version; trust the larger observation.
			this.records.set(absolutePath, {
				mtimeMs: input.mtimeMs,
				size: input.size,
				seenFromLine,
				seenToLine,
				totalLines: Math.max(current.totalLines, input.totalLines),
			});
			return;
		}

		// New file version (changed mtime or size) — the old view is stale; replace.
		this.records.set(absolutePath, {
			mtimeMs: input.mtimeMs,
			size: input.size,
			seenFromLine: input.seenFromLine,
			seenToLine: input.seenToLine,
			totalLines: input.totalLines,
		});
	}

	/**
	 * True when the whole file at the given current mtime/size was seen.
	 */
	isFullySeen(absolutePath: string, mtimeMs: number, size: number): boolean {
		const stored = this.records.get(absolutePath);
		if (!stored) return false;
		if (stored.mtimeMs !== mtimeMs || stored.size !== size) return false; // stale view
		return stored.seenToLine >= stored.totalLines;
	}

	/**
	 * Decide whether an edit may proceed.
	 *
	 * Allowed when: the file was never read; OR the file has changed since the last
	 * read (stale view — editing cannot destroy unseen bytes the model never had a
	 * fresh snapshot of); OR the current version of the file was fully seen.
	 *
	 * Denied only when: the current version was read but only PARTIALLY seen.
	 * The denial carries the actionable info for the caller's message.
	 */
	canEdit(absolutePath: string, current: { mtimeMs: number; size: number }): CanEditResult {
		const stored = this.records.get(absolutePath);
		// Never-read file → nothing to preserve → edit freely (backward compat).
		if (!stored) return { allowed: true };

		// File changed since the last read → the model's view is stale anyway;
		// editing is allowed, with a note. Never loops, never denies.
		if (stored.mtimeMs !== current.mtimeMs || stored.size !== current.size) {
			return {
				allowed: true,
				note: "file changed since it was last read; proceeding against the current on-disk content",
			};
		}

		// Same version, fully seen → allow.
		if (stored.seenToLine >= stored.totalLines) {
			return { allowed: true };
		}

		// Same version, only partially seen → deny with the actionable window.
		return {
			allowed: false,
			seenLines: formatSeenWindow(stored),
			totalLines: stored.totalLines,
		};
	}

	/** Remove the ledger entry for a path (used by tests / when forgotten). */
	clear(absolutePath?: string): void {
		if (absolutePath === undefined) {
			this.records.clear();
			return;
		}
		this.records.delete(absolutePath);
	}
}

/**
 * The process-wide ledger shared by read_file (records) and edit/write (consults).
 * It is created lazily on first use so a process that never touches the ledger pays
 * nothing and never-read files still edit freely.
 */
let sharedLedger: ReadLedger | undefined;

export function getReadLedger(): ReadLedger {
	if (!sharedLedger) {
		sharedLedger = new ReadLedger();
	}
	return sharedLedger;
}
