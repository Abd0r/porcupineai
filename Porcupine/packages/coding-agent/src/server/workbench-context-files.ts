import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_CHAR_LIMIT, USER_CHAR_LIMIT } from "../porcupine/memory-store.ts";

export class WorkbenchError extends Error {
	readonly statusCode: number;
	constructor(statusCode: number, message: string) {
		super(message);
		this.statusCode = statusCode;
	}
}
export interface ContextFileInfo {
	id: string;
	name: string;
	scope: "global" | "workspace";
	path: string;
	charLimit: number;
	effect: string;
}
export interface ContextFileDocument extends ContextFileInfo {
	exists: boolean;
	content: string;
	revision: string;
}
const MAX_BYTES = 128 * 1024;
const GLOBAL_FILES = [
	"AGENTS.md",
	"CLAUDE.md",
	"USER.md",
	"MEMORY.md",
	"PERSONALITY.md",
	"PROMPT.md",
	"SYSTEM.md",
	"APPEND_SYSTEM.md",
	"APPEND_PROMPT.md",
] as const;

/** Only named context documents, never a general-purpose filesystem editor. */
export class ContextFileStore {
	private readonly files = new Map<string, ContextFileInfo>();
	constructor(cwd: string, agentDir: string) {
		for (const [scope, root, names] of [
			["global", realpathSync(agentDir), GLOBAL_FILES],
			["workspace", realpathSync(cwd), ["AGENTS.md", "CLAUDE.md"]],
		] as const) {
			for (const name of names) {
				const effect =
					name === "USER.md" || name === "MEMORY.md"
						? "Read from disk for future turns; injection budgets can truncate long files."
						: name === "SYSTEM.md"
							? "Replaces the default system prompt when loaded. Reload resources or restart; this does not alter an active turn."
							: "Reload resources or restart to load changed context. This does not alter an active turn.";
				const info: ContextFileInfo = {
					id: `${scope}:${name}`,
					name,
					scope,
					path: join(root, name),
					charLimit: name === "USER.md" ? USER_CHAR_LIMIT : name === "MEMORY.md" ? MEMORY_CHAR_LIMIT : 64_000,
					effect,
				};
				this.files.set(info.id, info);
			}
		}
	}
	list(): ContextFileInfo[] {
		return [...this.files.values()].map((file) => ({ ...file }));
	}
	read(id: string): ContextFileDocument {
		const info = this.files.get(id);
		if (!info) throw new WorkbenchError(404, "Unknown context file");
		let content = "",
			exists = false;
		try {
			const stat = lstatSync(info.path);
			if (stat.isSymbolicLink()) throw new WorkbenchError(403, "Refusing a symbolic-link context file");
			if (!stat.isFile()) throw new WorkbenchError(403, "Context target must be a regular file");
			if (stat.size > MAX_BYTES) throw new WorkbenchError(413, "Context file exceeds the inspection size limit");
			content = readFileSync(info.path, "utf8");
			exists = true;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		const revision = createHash("sha256")
			.update(exists ? "present:" : "missing:")
			.update(content)
			.digest("hex");
		return { ...info, content, exists, revision };
	}
	write(id: string, content: string, expectedRevision: string): ContextFileDocument {
		const previous = this.read(id);
		if (content.length > previous.charLimit || Buffer.byteLength(content, "utf8") > MAX_BYTES)
			throw new WorkbenchError(413, "Context file exceeds its size limit");
		if (content.includes("\0")) throw new WorkbenchError(400, "Context files must be text");
		if (previous.revision !== expectedRevision)
			throw new WorkbenchError(409, "This file changed since you opened it. Reload it before saving.");
		const temporary = `${previous.path}.${randomUUID()}.tmp`;
		try {
			const mode = previous.exists ? lstatSync(previous.path).mode & 0o777 : 0o600;
			writeFileSync(temporary, content, { encoding: "utf8", mode, flag: "wx" });
			// Recheck immediately before the atomic replacement; do not silently overwrite a new revision.
			if (this.read(id).revision !== expectedRevision)
				throw new WorkbenchError(409, "This file changed while saving. Reload it before saving.");
			renameSync(temporary, previous.path);
		} finally {
			if (existsSync(temporary)) rmSync(temporary);
		}
		return this.read(id);
	}
}
