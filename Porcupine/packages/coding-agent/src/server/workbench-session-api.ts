import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServeApiSession } from "./http-api.ts";
import { WorkbenchError } from "./workbench-context-files.ts";
import { parseControlPatch, type SessionControls } from "./workbench-session-surfaces.ts";

interface SurfaceRouter {
	readBody(req: IncomingMessage): Promise<string>;
	json(res: ServerResponse, status: number, body: unknown): void;
	getSession(id: string): ServeApiSession | undefined;
	publishControls(id: string, controls: SessionControls): void;
}
export async function handleSessionSurfaceRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	router: SurfaceRouter,
): Promise<boolean> {
	const match = /^\/session\/([^/]+)\/(controls|catalog)(?:\/(skills|tools)\/([^/]+))?$/.exec(url.pathname);
	if (!match) return false;
	const session = router.getSession(match[1]!);
	if (!session) {
		router.json(res, 404, { error: "No such session" });
		return true;
	}
	const controls = match[2] === "controls";
	if (method !== "GET" && !(controls && method === "PATCH" && !match[3])) {
		res.setHeader("allow", controls ? "GET, PATCH" : "GET");
		router.json(res, 405, { error: "Method not allowed" });
		return true;
	}
	if (controls) {
		if (match[3]) {
			router.json(res, 404, { error: "No such controls route" });
			return true;
		}
		if (method === "GET") {
			router.json(
				res,
				200,
				session.getControls
					? { supported: true, writable: Boolean(session.configure), ...session.getControls() }
					: { supported: false },
			);
			return true;
		}
		if (!session.configure) throw new WorkbenchError(501, "This session does not support configuration changes");
		const raw = await router.readBody(req);
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			throw new WorkbenchError(400, "Expected a JSON control patch");
		}
		const applied = session.configure(parseControlPatch(value));
		router.publishControls(session.id, applied);
		router.json(res, 200, { supported: true, writable: true, ...applied });
		return true;
	}
	if (!session.getCatalog) {
		router.json(res, 200, { supported: false, skillsCount: 0, toolsCount: 0, entries: [], total: 0, offset: 0 });
		return true;
	}
	if (match[3] && match[4]) {
		if (!session.inspectCatalog) throw new WorkbenchError(501, "This session does not support source inspection");
		let name: string;
		try {
			name = decodeURIComponent(match[4]);
		} catch {
			throw new WorkbenchError(400, "Malformed catalog name");
		}
		if (name.length > 256 || name.includes("\0")) throw new WorkbenchError(400, "Invalid catalog name");
		router.json(res, 200, session.inspectCatalog(match[3] as "skills" | "tools", name));
		return true;
	}
	const kind = url.searchParams.get("kind"),
		query = url.searchParams.get("query") ?? "",
		offset = Number(url.searchParams.get("offset") ?? 0),
		limit = Number(url.searchParams.get("limit") ?? 50);
	if (
		(kind !== null && kind !== "skills" && kind !== "tools") ||
		query.length > 256 ||
		!Number.isInteger(offset) ||
		offset < 0 ||
		offset > 100_000 ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 100
	)
		throw new WorkbenchError(400, "Invalid catalog filter or pagination");
	router.json(res, 200, { supported: true, ...session.getCatalog(kind ?? undefined, query, offset, limit) });
	return true;
}
