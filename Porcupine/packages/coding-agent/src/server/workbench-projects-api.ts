import type { IncomingMessage, ServerResponse } from "node:http";
import { readWorkbenchArtifact } from "./workbench-artifacts.ts";
import { WorkbenchError } from "./workbench-context-files.ts";
import { ProjectNoteStore } from "./workbench-project-notes.ts";
import { PROJECT_UPLOAD_LIMIT, type WorkbenchProjectStore } from "./workbench-projects.ts";

export function readRawBody(req: IncomingMessage, limit = PROJECT_UPLOAD_LIMIT): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > limit) {
				req.removeAllListeners("data");
				req.removeAllListeners("end");
				reject(new WorkbenchError(413, "Document exceeds the 12 MiB upload limit"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

interface ProjectRouter {
	readBody(req: IncomingMessage): Promise<string>;
	json(res: ServerResponse, status: number, body: unknown): void;
	projects: WorkbenchProjectStore;
	deleteProject?: (name: string) => Promise<void>;
}

/** Local project workspace routes. Project names and file paths are validated by the store. */
export async function handleProjectRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	router: ProjectRouter,
): Promise<boolean> {
	const path = url.pathname;
	if (path !== "/workbench/projects" && !path.startsWith("/workbench/projects/")) return false;
	if (path === "/workbench/projects") {
		if (method === "GET") {
			router.json(res, 200, { projects: router.projects.list() });
			return true;
		}
		if (method === "POST") {
			let input: unknown;
			try {
				input = JSON.parse(await router.readBody(req));
			} catch {
				throw new WorkbenchError(400, "Expected JSON with name and optional title");
			}
			if (!input || typeof input !== "object" || Array.isArray(input))
				throw new WorkbenchError(400, "Expected an object");
			const keys = Object.keys(input);
			if (!keys.includes("name") || keys.some((key) => !["name", "title", "description"].includes(key)))
				throw new WorkbenchError(400, "Expected only name, optional title and description");
			const { name, title, description } = input as { name?: unknown; title?: unknown; description?: unknown };
			if (
				typeof name !== "string" ||
				(title !== undefined && typeof title !== "string") ||
				(description !== undefined && (typeof description !== "string" || description.length > 360))
			)
				throw new WorkbenchError(400, "name and title must be strings; description must be at most 360 characters");
			router.json(res, 201, router.projects.create(name, title, description));
			return true;
		}
		res.setHeader("allow", "GET, POST");
		router.json(res, 405, { error: "Method not allowed" });
		return true;
	}
	const match = /^\/workbench\/projects\/([^/]+)(\/notes(?:\/([a-f0-9-]+))?|\/pin|\/files(?:\/(.+))?)?$/.exec(path);
	if (!match) {
		router.json(res, 404, { error: "Unknown project route" });
		return true;
	}
	let name: string;
	try {
		name = decodeURIComponent(match[1]!);
	} catch {
		throw new WorkbenchError(400, "Malformed project name");
	}

	if (match[2]?.startsWith("/notes")) {
		const store = new ProjectNoteStore(router.projects.path(name)),
			id = match[3];
		if (method === "GET" && !id) {
			router.json(res, 200, { notes: store.list() });
			return true;
		}
		if ((method === "POST" && !id) || (method === "PUT" && id) || (method === "DELETE" && id)) {
			let input: unknown;
			try {
				input = JSON.parse(await router.readBody(req));
			} catch {
				throw new WorkbenchError(400, "Expected a note object");
			}
			if (!input || typeof input !== "object" || Array.isArray(input))
				throw new WorkbenchError(400, "Expected a note object");
			const values = input as Record<string, unknown>;
			const allowed =
				method === "DELETE"
					? ["revision"]
					: method === "POST"
						? ["title", "text", "color"]
						: ["title", "text", "color", "revision"];
			if (Object.keys(values).some((key) => !allowed.includes(key)))
				throw new WorkbenchError(400, "Unknown note property");
			router.json(
				res,
				method === "POST" ? 201 : 200,
				store.mutate(
					method === "POST" ? "add" : method === "PUT" ? "update" : "delete",
					input,
					"user",
					id,
					typeof values.revision === "string" ? values.revision : undefined,
				),
			);
			return true;
		}
		res.setHeader("allow", id ? "PUT, DELETE" : "GET, POST");
		router.json(res, 405, { error: "Method not allowed" });
		return true;
	}
	if (match[2] === undefined) {
		if (method === "DELETE") {
			if (router.deleteProject) await router.deleteProject(name);
			else router.projects.remove(name);
			router.json(res, 200, { ok: true });
			return true;
		}
		if (method !== "GET") {
			res.setHeader("allow", "GET, DELETE");
			router.json(res, 405, { error: "Method not allowed" });
			return true;
		}
		const files = router.projects.files(name);
		router.json(res, 200, {
			...router.projects.list().find((project) => project.name === name),
			name,
			files,
			notes: new ProjectNoteStore(router.projects.path(name)).list(),
		});
		return true;
	}
	if (match[2] === "/pin") {
		if (method !== "PUT") {
			res.setHeader("allow", "PUT");
			router.json(res, 405, { error: "Method not allowed" });
			return true;
		}
		let input: unknown;
		try {
			input = JSON.parse(await router.readBody(req));
		} catch {
			throw new WorkbenchError(400, "Expected JSON with pinned");
		}
		if (
			!input ||
			typeof input !== "object" ||
			Array.isArray(input) ||
			Object.keys(input).length !== 1 ||
			!("pinned" in input) ||
			typeof input.pinned !== "boolean"
		)
			throw new WorkbenchError(400, "Expected only a boolean pinned");
		router.projects.setPinned(name, input.pinned);
		router.json(res, 200, { pinned: input.pinned });
		return true;
	}

	if (match[4] === undefined) {
		if (method === "GET") {
			router.json(res, 200, { name, files: router.projects.files(name) });
			return true;
		}
		if (method === "POST") {
			const filename = url.searchParams.get("name");
			if (!filename) throw new WorkbenchError(400, "Pass ?name=<filename> for an upload");
			router.json(res, 201, router.projects.upload(name, filename, await readRawBody(req)));
			return true;
		}
		res.setHeader("allow", "GET, POST");
		router.json(res, 405, { error: "Method not allowed" });
		return true;
	}
	if (match[4] === "" || match[4] === "." || match[4] === "..") {
		router.json(res, 404, { error: "Unknown project file" });
		return true;
	}
	if (method !== "GET") {
		res.setHeader("allow", "GET");
		router.json(res, 405, { error: "Method not allowed" });
		return true;
	}
	let filePath: string;
	try {
		filePath = match[4].split("/").map(decodeURIComponent).join("/");
	} catch {
		throw new WorkbenchError(400, "Malformed file path");
	}
	if (url.searchParams.get("raw") === "1") {
		const file = await readWorkbenchArtifact(router.projects.path(name), filePath);
		res.writeHead(200, {
			"content-type": file.mime,
			"content-length": file.bytes.length,
			"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`,
			"x-porcupine-preview": file.kind,
			"x-porcupine-name": encodeURIComponent(file.name),
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		});
		res.end(file.bytes);
	} else router.json(res, 200, router.projects.read(name, filePath));
	return true;
}
