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
	const goalMatch = /^\/session\/([^/]+)\/goal-plan$/.exec(url.pathname);
	if (goalMatch) {
		const target = router.getSession(goalMatch[1]!);
		if (!target) {
			router.json(res, 404, { error: "No such session" });
			return true;
		}
		if (!target.getGoalPlan) {
			router.json(res, 200, { supported: false });
			return true;
		}
		if (method !== "GET") {
			res.setHeader("allow", "GET");
			router.json(res, 405, { error: "Goals are set by the agent's goal tool, not by client commands" });
			return true;
		}
		router.json(res, 200, { supported: true, ...(target.getGoalPlan() as object) });
		return true;
	}
	if (goalMatch) {
		// handled above
	}
	const modelsMatch = /^\/session\/([^/]+)\/models$/.exec(url.pathname);
	if (modelsMatch) {
		const target = router.getSession(modelsMatch[1]!);
		if (!target) {
			router.json(res, 404, { error: "No such session" });
			return true;
		}
		if (!target.getModels) {
			router.json(res, 200, { supported: false });
			return true;
		}
		if (method === "GET") {
			router.json(res, 200, { supported: true, ...(await target.getModels()) });
			return true;
		}
		if (method !== "POST") {
			res.setHeader("allow", "GET, POST");
			router.json(res, 405, { error: "Method not allowed" });
			return true;
		}
		let input: unknown;
		try {
			input = JSON.parse(await router.readBody(req));
		} catch {
			throw new WorkbenchError(400, "Expected JSON with provider, id and optional scope");
		}
		if (!input || typeof input !== "object" || Array.isArray(input))
			throw new WorkbenchError(400, "Expected an object");
		const record = input as { provider?: unknown; id?: unknown; scope?: unknown };
		for (const key of Object.keys(input)) {
			if (key !== "provider" && key !== "id" && key !== "scope")
				throw new WorkbenchError(400, "Unexpected model field");
		}
		if (typeof record.provider !== "string" || typeof record.id !== "string")
			throw new WorkbenchError(400, "provider and id must be strings");
		if (record.provider.length > 80 || record.id.length > 160)
			throw new WorkbenchError(400, "Model identifier is too long");
		if (
			record.scope !== undefined &&
			record.scope !== "session" &&
			record.scope !== "default" &&
			record.scope !== "subagent"
		)
			throw new WorkbenchError(400, "scope must be session, default or subagent");
		if (record.scope === "subagent") {
			if (!target.setSubagentModel) throw new WorkbenchError(501, "This session cannot change sub-agent models");
			router.json(res, 200, {
				supported: true,
				scope: "subagent",
				...target.setSubagentModel(record.provider, record.id),
			});
			return true;
		}
		if (record.scope === "default") {
			if (!target.setDefaultModel) throw new WorkbenchError(501, "This session cannot change defaults");
			router.json(res, 200, {
				supported: true,
				scope: "default",
				...target.setDefaultModel(record.provider, record.id),
			});
			return true;
		}
		if (!target.setSessionModel) throw new WorkbenchError(501, "This session cannot switch models");
		router.json(res, 200, {
			supported: true,
			scope: "session",
			...(await target.setSessionModel(record.provider, record.id)),
		});
		return true;
	}
	const contextMatch = /^\/session\/([^/]+)\/context$/.exec(url.pathname);
	if (contextMatch) {
		const target = router.getSession(contextMatch[1]!);
		if (!target) {
			router.json(res, 404, { error: "No such session" });
			return true;
		}
		if (!target.getContext) {
			router.json(res, 200, { supported: false });
			return true;
		}
		if (method === "GET") {
			router.json(res, 200, { supported: true, ...target.getContext() });
			return true;
		}
		if (method !== "POST") {
			res.setHeader("allow", "GET, POST");
			router.json(res, 405, { error: "Method not allowed" });
			return true;
		}
		if (!target.setLimits) throw new WorkbenchError(501, "This session does not support limit changes");
		let limits: unknown;
		try {
			limits = JSON.parse(await router.readBody(req));
		} catch {
			throw new WorkbenchError(400, "Expected JSON limits");
		}
		if (!limits || typeof limits !== "object" || Array.isArray(limits))
			throw new WorkbenchError(400, "Expected an object");
		const patch = limits as { compactAtPercent?: unknown; maxSubagents?: unknown };
		for (const key of Object.keys(limits)) {
			if (key !== "compactAtPercent" && key !== "maxSubagents")
				throw new WorkbenchError(400, "Unexpected limit field");
		}
		if (patch.compactAtPercent !== undefined && typeof patch.compactAtPercent !== "number")
			throw new WorkbenchError(400, "compactAtPercent must be a number");
		if (patch.maxSubagents !== undefined && typeof patch.maxSubagents !== "number")
			throw new WorkbenchError(400, "maxSubagents must be a number");
		router.json(res, 200, {
			supported: true,
			...target.setLimits(patch as { compactAtPercent?: number; maxSubagents?: number }),
		});
		return true;
	}
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
