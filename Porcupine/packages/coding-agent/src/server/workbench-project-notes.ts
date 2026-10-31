import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ArtifactChange } from "@porcupineai/agent-core";
import { diffLines } from "diff";
import { createEventBus } from "../core/event-bus.ts";
import { lockDirSync } from "../core/sync-lock.ts";
import { WorkbenchError } from "./workbench-context-files.ts";

export const projectNoteEvents = createEventBus();
export const PROJECT_NOTE_LIMIT = 20;
export const PROJECT_NOTE_COLORS = ["amber", "blue", "sage", "rose"] as const;
export interface ProjectNote {
	id: string;
	title: string;
	text: string;
	color: (typeof PROJECT_NOTE_COLORS)[number];
	author: "user" | "agent";
	updatedAt: string;
	revision: string;
}
export interface ProjectNoteInput {
	title: string;
	text: string;
	color: ProjectNote["color"];
}
export function validateProjectNote(input: unknown): ProjectNoteInput {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new WorkbenchError(400, "Expected a note object");
	const { title, text, color } = input as Record<string, unknown>;
	if (
		typeof title !== "string" ||
		!title.trim() ||
		title.length > 120 ||
		typeof text !== "string" ||
		text.length > 8000 ||
		!PROJECT_NOTE_COLORS.includes(color as ProjectNote["color"])
	)
		throw new WorkbenchError(
			400,
			"Use a title of 1–120 characters, up to 8000 characters of text and an amber, blue, sage or rose color",
		);
	return { title: title.trim(), text, color: color as ProjectNote["color"] };
}
/** Shared GUI/agent notes. Caller supplies a canonical, confined project directory. */
export class ProjectNoteStore {
	private readonly directory: string;
	lastChange?: ArtifactChange;
	constructor(directory: string) {
		this.directory = directory;
	}
	list(): ProjectNote[] {
		let fd: number;
		try {
			fd = openSync(
				join(this.directory, ".workbench-notes.json"),
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
			);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
			throw new WorkbenchError(409, "Cannot safely open project notes");
		}
		try {
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Invalid notes file");
			const notes: unknown = JSON.parse(readFileSync(fd, "utf8"));
			if (!Array.isArray(notes) || notes.length > PROJECT_NOTE_LIMIT) throw new Error("Invalid notes list");
			const ids = new Set<string>();
			for (const note of notes) {
				validateProjectNote(note);
				if (
					typeof note.id !== "string" ||
					!/^[a-f0-9-]{36}$/.test(note.id) ||
					ids.has(note.id) ||
					!["user", "agent"].includes(note.author) ||
					typeof note.updatedAt !== "string" ||
					typeof note.revision !== "string"
				)
					throw new Error("Invalid note metadata");
				ids.add(note.id);
			}
			return notes as ProjectNote[];
		} catch {
			throw new WorkbenchError(409, "Project notes are invalid. Restore the notes file before editing.");
		} finally {
			closeSync(fd);
		}
	}
	mutate(
		action: "add" | "update" | "delete",
		input: unknown,
		author: ProjectNote["author"],
		id?: string,
		revision?: string,
	): ProjectNote | { ok: true } {
		this.lastChange = undefined;
		const values = action === "delete" ? null : validateProjectNote(input);
		let release: () => void;
		try {
			release = lockDirSync(this.directory, {
				lockfilePath: join(this.directory, ".workbench-notes.lock"),
				realpath: false,
				stale: 30000,
			});
		} catch {
			throw new WorkbenchError(409, "Project notes are being edited. Try again.");
		}
		const temporary = join(this.directory, `.workbench-notes-${randomUUID()}`);
		try {
			const notes = this.list(),
				index = notes.findIndex((note) => note.id === id);
			const path = join(this.directory, ".workbench-notes.json"),
				before = existsSync(path) ? `${JSON.stringify(notes, null, 2)}\n` : "";
			if (action !== "add" && index < 0) throw new WorkbenchError(404, "Note no longer exists");
			if (action !== "add" && (!revision || notes[index]!.revision !== revision))
				throw new WorkbenchError(409, "This note changed. Reopen it before editing; your draft is still here.");
			if (action === "add" && notes.length >= PROJECT_NOTE_LIMIT)
				throw new WorkbenchError(409, "A project can have up to 20 sticky notes");
			let result: ProjectNote | { ok: true };
			if (action === "delete") {
				notes.splice(index, 1);
				result = { ok: true };
			} else {
				const note: ProjectNote = {
					...values!,
					id: action === "add" ? randomUUID() : id!,
					author,
					updatedAt: new Date().toISOString(),
					revision: randomUUID(),
				};
				note.revision = createHash("sha256").update(JSON.stringify(note)).digest("hex");
				if (action === "add") notes.push(note);
				else notes[index] = note;
				result = note;
			}
			const after = `${JSON.stringify(notes, null, 2)}\n`;
			writeFileSync(temporary, after, { flag: "wx", mode: 0o600 });
			renameSync(temporary, path);
			const change: ArtifactChange = {
				path,
				operation: before ? "updated" : "created",
				linesAdded: 0,
				linesRemoved: 0,
				additions: [],
				removals: [],
				summary: `Sticky note ${action}`,
			};
			for (const part of diffLines(before, after)) {
				if (part.added) {
					change.linesAdded += part.count ?? 0;
					change.additions.push(...part.value.split("\n").filter(Boolean));
				}
				if (part.removed) {
					change.linesRemoved += part.count ?? 0;
					change.removals.push(...part.value.split("\n").filter(Boolean));
				}
			}
			this.lastChange = change;
			projectNoteEvents.emit("artifact:changed", { type: "artifact:changed", change });
			return result;
		} finally {
			rmSync(temporary, { force: true });
			release();
		}
	}
}
