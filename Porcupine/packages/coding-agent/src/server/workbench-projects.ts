import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { WorkbenchError } from "./workbench-context-files.ts";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".csv", ".json", ".yaml", ".yml", ".toml", ".log"]);
const BINARY_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip"]);
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 400;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,119}$/;

export interface ProjectSummary {
	name: string;
	title: string;
	state: string;
	files: number;
	updatedAt: string;
}
export interface ProjectFile {
	path: string;
	bytes: number;
	kind: "text" | "binary";
	updatedAt: string;
}
export interface ProjectDocument extends ProjectFile {
	content?: string;
	truncated?: boolean;
}

function slug(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!SLUG.test(normalized))
		throw new WorkbenchError(400, "Use a project name with letters, digits and hyphens (maximum 64)");
	return normalized;
}

/** Canonical Project/<name>/ workspaces only. Creates and adds files; never deletes. */
export class WorkbenchProjectStore {
	private readonly cwd: string;
	private readonly root: string;
	constructor(cwd: string) {
		this.cwd = realpathSync(cwd);
		this.root = join(this.cwd, "Project");
	}
	private projectPath(name: string): string {
		if (!SAFE_NAME.test(name)) throw new WorkbenchError(400, "Invalid project name");
		const directory = join(this.root, name);
		const parent = resolve(directory, "..");
		if (parent !== this.root && !parent.startsWith(`${this.root}${sep}`))
			throw new WorkbenchError(403, "Outside the Project workspace");
		try {
			const stat = lstatSync(directory);
			if (stat.isSymbolicLink()) throw new WorkbenchError(403, "Refusing a symbolic-link project");
			if (!stat.isDirectory()) throw new WorkbenchError(400, "Project is not a directory");
			if (realpathSync(directory) !== directory)
				throw new WorkbenchError(403, "Refusing an aliased project directory");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				throw new WorkbenchError(404, "No such project");
			throw error;
		}
		return directory;
	}
	private walk(directory: string, out: ProjectFile[], limit = MAX_FILES, depth = 0, base = directory): void {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (out.length >= limit || entry.name.startsWith(".")) continue;
			const path = join(directory, entry.name);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) {
				if (depth < 2) this.walk(path, out, limit, depth + 1, base);
				continue;
			}
			const extension = extname(entry.name).toLowerCase();
			const kind = TEXT_EXTENSIONS.has(extension) ? "text" : BINARY_EXTENSIONS.has(extension) ? "binary" : undefined;
			if (!kind) continue;
			out.push({ path: relative(base, path), bytes: stat.size, kind, updatedAt: stat.mtime.toISOString() });
		}
	}
	list(): ProjectSummary[] {
		let entries: string[];
		try {
			entries = readdirSync(this.root, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && SAFE_NAME.test(entry.name))
				.map((entry) => entry.name);
		} catch {
			return [];
		}
		const projects: ProjectSummary[] = [];
		for (const name of entries.sort()) {
			const directory = this.projectPath(name);
			const files: ProjectFile[] = [];
			this.walk(directory, files);
			let state = "unknown";
			let title = name;
			try {
				const status = readFileSync(join(directory, "STATUS.md"), "utf8");
				state =
					/^##\s+State\s*$[\s\S]{0,120}?`?(planning|active|blocked|paused|complete)`?/im
						.exec(status)?.[1]
						?.toLowerCase() ?? "unstated";
			} catch {
				// No status document yet.
			}
			try {
				title = /^#\s+(.+)$/m.exec(readFileSync(join(directory, "README.md"), "utf8"))?.[1]?.trim() || name;
			} catch {
				// No readme yet.
			}
			const updatedAt =
				files
					.map((file) => file.updatedAt)
					.sort()
					.at(-1) ?? "";
			projects.push({ name, title, state, files: files.length, updatedAt });
		}
		return projects;
	}
	create(name: string, title?: string): ProjectSummary {
		const project = slug(name);
		const directory = join(this.root, project);
		mkdirSync(this.root, { recursive: true });
		try {
			mkdirSync(directory);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EEXIST")
				throw new WorkbenchError(409, "A project with that name already exists");
			throw error;
		}
		const heading = (title?.trim() || project).slice(0, 120);
		writeFileSync(
			join(directory, "README.md"),
			`# ${heading}\n\n## Objective\n\n## Scope\n- In scope:\n- Out of scope:\n\n## Workspace map\n- \`uploads/\`: documents supplied through the workbench\n`,
			{ mode: 0o600 },
		);
		writeFileSync(
			join(directory, "STATUS.md"),
			`# Status: ${heading}\n\n## State\n\`planning\`\n\n## Last verified\n- Date:\n- What was executed or inspected:\n- Result:\n\n## Current position\n\n## Blockers and risks\n- None.\n\n## Next verified action\n`,
			{ mode: 0o600 },
		);
		return { name: project, title: heading, state: "planning", files: 2, updatedAt: new Date().toISOString() };
	}
	files(name: string): ProjectFile[] {
		const directory = this.projectPath(name);
		const files: ProjectFile[] = [];
		this.walk(directory, files);
		return files.sort((a, b) => a.path.localeCompare(b.path));
	}
	read(name: string, path: string): ProjectDocument {
		const directory = this.projectPath(name);
		const target = resolve(directory, path);
		if (!target.startsWith(`${directory}${sep}`)) throw new WorkbenchError(403, "Outside the project workspace");
		if (realpathSync(target) !== target) throw new WorkbenchError(403, "Refusing an aliased project file");
		const stat = lstatSync(target);
		if (stat.isSymbolicLink() || !stat.isFile())
			throw new WorkbenchError(403, "Only regular project files can be opened");
		const extension = extname(target).toLowerCase();
		if (TEXT_EXTENSIONS.has(extension)) {
			const content = readFileSync(target, "utf8");
			return {
				path: relative(directory, target),
				bytes: stat.size,
				kind: "text",
				updatedAt: stat.mtime.toISOString(),
				content: content.slice(0, MAX_TEXT_BYTES),
				truncated: content.length > MAX_TEXT_BYTES,
			};
		}
		if (BINARY_EXTENSIONS.has(extension))
			return {
				path: relative(directory, target),
				bytes: stat.size,
				kind: "binary",
				updatedAt: stat.mtime.toISOString(),
			};
		throw new WorkbenchError(415, "Unsupported project document type");
	}
	/** Store an uploaded document in uploads/, never overwriting an existing file. */
	upload(name: string, filename: string, body: Buffer): ProjectFile {
		if (body.length === 0 || body.length > MAX_UPLOAD_BYTES)
			throw new WorkbenchError(413, "Choose a document between 1 byte and 12 MiB");
		const raw = filename.trim();
		if (raw.includes("/") || raw.includes("\\") || raw.includes("\0"))
			throw new WorkbenchError(400, "Use a plain filename without directories");
		const trimmed = basename(raw);
		if (!SAFE_NAME.test(trimmed) || trimmed.startsWith("."))
			throw new WorkbenchError(400, "Use a plain filename of letters, digits, spaces and . _ ( ) + -");
		const extension = extname(trimmed).toLowerCase();
		if (!TEXT_EXTENSIONS.has(extension) && !BINARY_EXTENSIONS.has(extension))
			throw new WorkbenchError(415, "Unsupported document type");
		const directory = this.projectPath(name);
		const uploads = join(directory, "uploads");
		mkdirSync(uploads, { recursive: true, mode: 0o700 });
		if (realpathSync(uploads) !== uploads) throw new WorkbenchError(403, "Refusing an aliased upload directory");
		const stem = trimmed.slice(0, -extension.length).slice(0, 80);
		for (let copy = 1; copy < 100; copy += 1) {
			const candidate = join(uploads, copy === 1 ? trimmed : `${stem}-${copy}${extension}`);
			try {
				writeFileSync(candidate, body, { flag: "wx", mode: 0o600 });
				return {
					path: relative(directory, candidate),
					bytes: body.length,
					kind: TEXT_EXTENSIONS.has(extension) ? "text" : "binary",
					updatedAt: statSync(candidate).mtime.toISOString(),
				};
			} catch (error) {
				if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
			}
		}
		throw new WorkbenchError(409, "Too many files with that name");
	}
}

export const PROJECT_UPLOAD_LIMIT = MAX_UPLOAD_BYTES;
