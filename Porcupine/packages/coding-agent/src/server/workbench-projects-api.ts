import type { IncomingMessage, ServerResponse } from "node:http";
import { WorkbenchError } from "./workbench-context-files.ts";
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
			if (!keys.includes("name") || keys.some((key) => !["name", "title"].includes(key)))
				throw new WorkbenchError(400, "Expected only name and optional title");
			const { name, title } = input as { name?: unknown; title?: unknown };
			if (typeof name !== "string" || (title !== undefined && typeof title !== "string"))
				throw new WorkbenchError(400, "name and title must be strings");
			router.json(res, 201, router.projects.create(name, title));
			return true;
		}
		res.setHeader("allow", "GET, POST");
		router.json(res, 405, { error: "Method not allowed" });
		return true;
	}
	const match = /^\/workbench\/projects\/([^/]+)(\/files(?:\/(.+))?)?$/.exec(path);
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
	if (match[2] === undefined) {
		if (method !== "GET") {
			res.setHeader("allow", "GET");
			router.json(res, 405, { error: "Method not allowed" });
			return true;
		}
		router.json(res, 200, { name, files: router.projects.files(name) });
		return true;
	}

	if (match[3] === undefined) {
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
	if (match[3] === "" || match[3] === "." || match[3] === "..") {
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
		filePath = match[3].split("/").map(decodeURIComponent).join("/");
	} catch {
		throw new WorkbenchError(400, "Malformed file path");
	}
	router.json(res, 200, router.projects.read(name, filePath));
	return true;
}
