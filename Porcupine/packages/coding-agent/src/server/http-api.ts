/**
 * Headless HTTP API for Porcupine (`porcupine serve`).
 *
 * Exposes sessions, message submission, abort, status, programmatic approval
 * and a Server-Sent-Events stream over HTTP — the OpenCode-style server
 * surface that lets other clients (IDE plugins, web/mobile apps, scripts)
 * drive an agent session programmatically.
 *
 * The server is decoupled from AgentSession via {@link ServeApiSession} so it
 * can be unit-tested with a fake backend; serve-mode adapts a real session
 * via adaptSessionToServeApi before starting the API.
 *
 * ## Multi-session
 *
 * Since v0.1.69 the API can run multiple independent sessions concurrently.
 * Pass either a single `session` (legacy behavior — a dedicated legacy
 * session that POST /session returns) or a `sessions` list plus an optional
 * `createSession` factory:
 *
 *   - `GET /session` lists every session.
 *   - `POST /session` with an optional `{"id": "..."}` body creates (or
 *     returns an existing) session; without an id it uses `createSession` or
 *     falls back to the legacy session.
 *   - The per-session routes already carry `:id` in the path, so concurrent
 *     sessions run independently.
 *
 * SSE is per-session: `/session/:id/events` fans out events only for that
 * session. A global lifecycle stream on `/events` carries `session_created`
 * and `session_closed` events for every session on the server. Approval
 * responses route only to the session that surfaced the request.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripAnsi } from "../utils/ansi.ts";
import { serveMathAsset } from "./math-assets.ts";
import { PORCUPINE_WEB_UI } from "./web-ui.ts";
import { validateWorkbenchAttachments, type WorkbenchAttachment } from "./workbench-attachments.ts";
import type { WorkbenchCommand, WorkbenchCommandResult } from "./workbench-commands.ts";
import { type ContextFileStore, WorkbenchError } from "./workbench-context-files.ts";
import type { WorkbenchProjectStore } from "./workbench-projects.ts";
import { handleProjectRequest, readRawBody } from "./workbench-projects-api.ts";
import { handleSessionSurfaceRequest } from "./workbench-session-api.ts";
import type {
	ContextSurfaces,
	GoalPlanSurfaces,
	SessionSurfaces,
	SurfaceControl,
} from "./workbench-session-surfaces.ts";
import type { WorkbenchReplayEvent } from "./workbench-transcript.ts";

/** Minimal session surface the HTTP API drives. */
export interface ServeApiSession
	extends Partial<SessionSurfaces>,
		Partial<GoalPlanSurfaces>,
		Partial<SurfaceControl>,
		Partial<ContextSurfaces> {
	readonly id: string;
	getCommands?(): WorkbenchCommand[];
	runCommand?(text: string): Promise<WorkbenchCommandResult>;
	sendUserMessage(text: string, attachments?: WorkbenchAttachment[]): Promise<void>;
	abort(): Promise<void>;
	isStreaming(): boolean;
	/** Text transcript only. Never include provider signatures, tool arguments, or credentials. */
	getTranscript?(): Array<{ role: "user" | "assistant"; content: string }>;
	getTimeline?(): WorkbenchReplayEvent[];
	getSubagents?(): Array<{
		id: string;
		name: string;
		task: string;
		status: string;
		activity?: { kind: string; summary: string };
	}>;
	/** Subscribe to session events (agent messages, tool calls, ...). Returns an unsubscribe. */
	onEvent(listener: (event: unknown) => void): () => void;
	/**
	 * Register a permission/confirmation handler. Fired when the session asks
	 * the user to approve something; the caller must eventually call respond.
	 * Returns an unsubscribe.
	 */
	onConfirm(
		handler: (permission: { id: string; title: string; message: string }, respond: (allow: boolean) => void) => void,
	): () => void;
}

export interface ServeApiOptions {
	/** Legacy single session (backward compatible). When provided and no
	 * `sessions`/`createSession` are given, this is the only session and POST
	 * /session returns it. */
	session?: ServeApiSession;
	/** Pre-provisioned independent sessions (multi-session mode). */
	sessions?: readonly ServeApiSession[];
	/** Factory used by POST /session to mint a new session by optional id. */
	createSession?: (id?: string) => ServeApiSession | Promise<ServeApiSession>;
	/** Discover persisted conversations without starting an agent for each one. */
	listSessions?: () => Promise<Array<{ id: string; name?: string; project?: string | null }>>;
	/** Resume only a discovered id; never accept a client-supplied filesystem path. */
	openSession?: (id: string) => Promise<ServeApiSession>;
	assignProject?: (id: string, name: string | null) => Promise<void>;
	deleteSession?: (id: string) => Promise<void>;
	deleteProject?: (name: string) => Promise<void>;
	port?: number;
	host?: string;
	/** Optional bearer token. When set, every request must carry it. */
	token?: string;
	version?: string;
	/** Explicitly configured, allowlisted context documents for local Settings. */
	contextFiles?: ContextFileStore;
	/** Local Project/<name>/ workspaces for the browser sidebar. */
	projects?: WorkbenchProjectStore;
}

export interface ServeApiHandle {
	/** The actual listening port (useful when port 0 was requested). */
	port(): number;
	/** Push a session event to all SSE clients. */
	emit(event: unknown): void;
	/** Bind the server to the configured port/host. Resolves once listening. */
	listen(): Promise<void>;
	close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB
const SSE_HEARTBEAT_MS = 15_000;
const PERMISSION_TIMEOUT_MS = 60_000;

function json(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		"cache-control": "no-store",
	});
	res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				// Stop reading and reject with a clean 413: destroying the socket
				// here makes the catch write a 500 into a dead socket (EPIPE) and
				// the client never sees a status. Removing the listeners lets the
				// caller respond before the socket is torn down.
				req.removeAllListeners("data");
				req.removeAllListeners("end");
				const error = new Error("payload too large") as Error & { statusCode?: number };
				error.statusCode = 413;
				reject(error);
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/**
 * Per-session routing state. Each independent session gets its own SSE client
 * set, permission responder table, and event/confirm subscriptions so events
 * and approvals never leak across sessions.
 */
interface SessionEndpoint {
	session: ServeApiSession;
	sseClients: Set<ServerResponse>;
	permissionResponders: Map<string, (allow: boolean) => void>;
	permissionRequests: Map<
		string,
		{ type: "permission_request"; permissionId: string; title: string; message: string }
	>;
	/** Internal bounce listeners re-emitting every session event to `emit`. */
	eventListeners: Set<(event: unknown) => void>;
	unsubscribeConfirm: () => void;
	unsubscribeEvents: () => void;
	unsubscribeGoalPlan: () => void;
	webAttached: number;
}

export function createServeApi(options: ServeApiOptions): ServeApiHandle {
	const { session, sessions, createSession, token, version } = options;
	const globalClients = new Set<ServerResponse>();
	const allSessions = new Map<string, SessionEndpoint>();
	const openingSessions = new Map<string, Promise<ServeApiSession>>();
	const mutatingSessions = new Set<string>();
	async function mutateSession<T>(id: string, action: () => Promise<T>): Promise<T> {
		if (mutatingSessions.has(id))
			throw new WorkbenchError(409, "This conversation is busy. Wait for its current action to finish.");
		mutatingSessions.add(id);
		try {
			return await action();
		} finally {
			mutatingSessions.delete(id);
		}
	}

	const heartbeat = setInterval(() => {
		const signal = `: ping\n\n`;
		for (const client of Array.from(globalClients)) writeSse(client, signal, globalClients);
		for (const entry of allSessions.values()) {
			for (const client of Array.from(entry.sseClients)) writeSse(client, signal, entry.sseClients);
		}
	}, SSE_HEARTBEAT_MS);
	heartbeat.unref();

	// Write one SSE payload to a single client, removing it on any failure so a
	// closed/dropped socket can't throw mid-fan-out and never holds the entry.
	function writeSse(client: ServerResponse, chunk: string, clientSet: Set<ServerResponse>): void {
		try {
			if (client.writableEnded || client.destroyed) {
				clientSet.delete(client);
				return;
			}
			client.write(chunk);
		} catch {
			// EPIPE / closed socket — drop the client so it isn't written again.
			clientSet.delete(client);
		}
	}

	/** Global lifecycle channel (session_created / session_closed). */
	function broadcastGlobal(event: unknown): void {
		const serialized = JSON.stringify(event);
		for (const client of Array.from(globalClients)) writeSse(client, `data: ${serialized}\n\n`, globalClients);
	}

	const broadcast = (event: unknown): void => {
		for (const entry of allSessions.values()) {
			const serialized = JSON.stringify(event);
			for (const client of Array.from(entry.sseClients)) {
				writeSse(client, `data: ${serialized}\n\n`, entry.sseClients);
			}
		}
	};

	/**
	 * Create and subscribe a per-session endpoint. Called for pre-provisioned
	 * sessions and again whenever POST /session mints a new one.
	 */
	function registerSession(sessionToRegister: ServeApiSession): SessionEndpoint {
		const entry = allSessions.get(sessionToRegister.id);
		if (entry) return entry;

		const endpoint: SessionEndpoint = {
			session: sessionToRegister,
			sseClients: new Set<ServerResponse>(),
			permissionResponders: new Map<string, (allow: boolean) => void>(),
			permissionRequests: new Map(),
			eventListeners: new Set<(event: unknown) => void>(),
			unsubscribeConfirm: () => {},
			unsubscribeEvents: () => {},
			unsubscribeGoalPlan: () => {},
			webAttached: 0,
		};

		endpoint.unsubscribeConfirm = sessionToRegister.onConfirm((permission, respond) => {
			const responder: (allow: boolean) => void = (allow) => {
				endpoint.permissionResponders.delete(permission.id);
				endpoint.permissionRequests.delete(permission.id);
				const settled = `data: ${JSON.stringify({ type: "permission_resolved", permissionId: permission.id, allow })}\n\n`;
				for (const client of endpoint.sseClients) writeSse(client, settled, endpoint.sseClients);
				respond(allow);
			};
			endpoint.permissionResponders.set(permission.id, responder);
			const request = {
				type: "permission_request" as const,
				permissionId: permission.id,
				title: stripAnsi(permission.title),
				message: stripAnsi(permission.message),
			};
			endpoint.permissionRequests.set(permission.id, request);
			const serialized = JSON.stringify(request);
			for (const client of Array.from(endpoint.sseClients)) {
				writeSse(client, `data: ${serialized}\n\n`, endpoint.sseClients);
			}
			setTimeout(() => {
				if (endpoint.permissionResponders.has(permission.id)) responder(false);
			}, PERMISSION_TIMEOUT_MS).unref();
		});

		endpoint.unsubscribeEvents = sessionToRegister.onEvent((event) => {
			for (const listener of endpoint.eventListeners) listener(event);
			const serialized = JSON.stringify(event);
			for (const client of Array.from(endpoint.sseClients)) {
				writeSse(client, `data: ${serialized}\n\n`, endpoint.sseClients);
			}
		});

		endpoint.unsubscribeGoalPlan =
			sessionToRegister.onGoalPlanChange?.((view) => {
				const serialized = JSON.stringify({ type: "goal_plan", status: view });
				for (const client of Array.from(endpoint.sseClients)) {
					writeSse(client, `data: ${serialized}\n\n`, endpoint.sseClients);
				}
			}) ?? (() => {});

		allSessions.set(sessionToRegister.id, endpoint);
		return endpoint;
	}

	// Backward compatible: a single `session` is the legacy session; POST
	// /session returns it and every SSR route targets it by id.
	if (session) registerSession(session);
	for (const candidate of sessions ?? []) registerSession(candidate);

	// Fail closed: without a token the server will not accept unauthenticated
	// requests UNLESS the operator explicitly opted into tokenless loopback mode
	// via PORCUPINE_SERVE_ALLOW_TOKENLESS=1. This prevents any local process (or
	// a bare-Origin browser page) from driving the agent when no token is set.
	const allowTokenless = process.env.PORCUPINE_SERVE_ALLOW_TOKENLESS === "1";
	const requireAuth = (req: IncomingMessage): boolean => {
		if (!token) {
			return allowTokenless;
		}
		const header = req.headers.authorization;
		if (typeof header !== "string") return false;
		const expected = `Bearer ${token}`;
		// Constant-time comparison: hash both sides to equal-length digests so the
		// `crypto.timingSafeEqual` buffer-length precondition is satisfied and the
		// comparison reveals no timing information about the token.
		try {
			const a = createHash("sha256").update(header).digest();
			const b = createHash("sha256").update(expected).digest();
			return timingSafeEqual(a, b);
		} catch {
			return false;
		}
	};

	/**
	 * Origin/CSRF guard: the server is plain HTTP bound to a loopback host. A
	 * state-changing cross-origin call (token theft via a malicious browser page,
	 * DNS rebinding) must be rejected. When an Origin header is present it must
	 * match the server's own origin exactly — scheme (http:) + host + port.
	 * `URL.host` is scheme-agnostic hostname:port, so together with the explicit
	 * protocol check this validates the full origin.
	 */
	const isOriginAllowed = (req: IncomingMessage, origin: string): boolean => {
		let originUrl: URL;
		try {
			originUrl = new URL(origin);
		} catch {
			return false;
		}
		if (originUrl.protocol !== "http:") return false;
		let reqUrl: URL;
		try {
			reqUrl = new URL(`http://${req.headers.host ?? "localhost"}`);
		} catch {
			return false;
		}
		// Compare full origin: host includes hostname + port (default ports included
		// by URL normalization), so scheme + host + port are all validated.
		return originUrl.host === reqUrl.host && originUrl.hostname === reqUrl.hostname;
	};

	const server = createServer(async (req, res) => {
		try {
			const origin = req.headers.origin;
			if (origin !== undefined && !isOriginAllowed(req, origin)) {
				json(res, 403, { error: "cross-origin request denied" });
				return;
			}
			const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
			const path = url.pathname;
			const method = (req.method ?? "GET").toUpperCase();
			const querySessionId = url.searchParams.get("session");

			// The static workbench shell contains no session data. API requests made
			// by the page remain behind the same bearer-token check as every client.
			if (method === "GET" && path === "/") {
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"content-length": Buffer.byteLength(PORCUPINE_WEB_UI),
					"cache-control": "no-store",
					"content-security-policy":
						"default-src 'none'; img-src blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
					"x-content-type-options": "nosniff",
					"x-frame-options": "DENY",
					"referrer-policy": "no-referrer",
				});
				res.end(PORCUPINE_WEB_UI);
				return;
			}

			if (method === "GET" && serveMathAsset(path, res)) return;
			if (!requireAuth(req)) {
				json(res, 401, { error: "unauthorized" });
				return;
			}

			if (method === "GET" && path === "/workbench") {
				json(res, 200, {
					contextFiles: Boolean(options.contextFiles),
					projects: Boolean(options.projects),
					canCreateSessions: Boolean(createSession),
					canDeleteSessions: Boolean(options.deleteSession),
					canAssignProjects: Boolean(options.assignProject),
				});
				return;
			}
			if (path === "/workbench/context" || path.startsWith("/workbench/context/")) {
				if (!options.contextFiles) {
					json(res, 501, { error: "Context editing is not configured by this server" });
					return;
				}
				if (path === "/workbench/context" && method === "GET") {
					json(res, 200, { files: options.contextFiles.list() });
					return;
				}
				const match = /^\/workbench\/context\/([^/]+)$/.exec(path);
				if (!match) {
					json(res, 404, { error: "Unknown context document" });
					return;
				}
				let id: string;
				try {
					id = decodeURIComponent(match[1]!);
				} catch {
					json(res, 400, { error: "Malformed context id" });
					return;
				}
				if (method === "GET") {
					json(res, 200, options.contextFiles.read(id));
					return;
				}
				if (method === "PUT") {
					let input: unknown;
					try {
						input = JSON.parse(await readBody(req));
					} catch (error) {
						if (error instanceof Error && "statusCode" in error) throw error;
						json(res, 400, { error: "Expected JSON with content and revision" });
						return;
					}
					if (
						!input ||
						typeof input !== "object" ||
						Array.isArray(input) ||
						!("content" in input) ||
						!("revision" in input) ||
						typeof input.content !== "string" ||
						typeof input.revision !== "string" ||
						Object.keys(input).some((key) => key !== "content" && key !== "revision")
					) {
						json(res, 400, { error: "Expected only content and revision strings" });
						return;
					}
					json(res, 200, options.contextFiles.write(id, input.content, input.revision));
					return;
				}
				res.setHeader("allow", path === "/workbench/context" ? "GET" : "GET, PUT");
				json(res, 405, { error: "Method not allowed" });
				return;
			}

			if (
				options.projects &&
				(await handleProjectRequest(req, res, url, method, {
					readBody,
					json,
					projects: options.projects,
					deleteProject: options.deleteProject,
				}))
			)
				return;

			if (
				await handleSessionSurfaceRequest(req, res, url, method, {
					readBody,
					json,
					getSession: (id) => resolveEntry(id, querySessionId)?.session,
					publishControls: (id, controls) => {
						const entry = allSessions.get(id);
						if (!entry) return;
						const data = `data: ${JSON.stringify({ type: "session_controls", controls })}\n\n`;
						for (const client of Array.from(entry.sseClients)) writeSse(client, data, entry.sseClients);
					},
				})
			)
				return;

			const commandMatch = /^\/session\/([^/]+)\/(commands|command)$/.exec(path);
			if (commandMatch) {
				const entry = allSessions.get(commandMatch[1]!);
				if (!entry) {
					json(res, 404, { error: "No such session" });
					return;
				}
				if (commandMatch[2] === "commands" && method === "GET") {
					json(res, 200, { commands: entry.session.getCommands?.() || [] });
					return;
				}
				if (commandMatch[2] === "command" && method === "POST") {
					if (!entry.session.runCommand) {
						json(res, 501, { error: "Slash commands are unavailable for this session" });
						return;
					}
					let input: unknown;
					try {
						input = JSON.parse(await readBody(req));
					} catch {
						json(res, 400, { error: "Expected command text" });
						return;
					}
					if (!input || typeof input !== "object" || !("text" in input) || typeof input.text !== "string") {
						json(res, 400, { error: "Expected command text" });
						return;
					}
					const command = input.text;
					const result = /^\/kill(?:\s|$)/.test(command)
						? await entry.session.runCommand(command)
						: await mutateSession(entry.session.id, () => entry.session.runCommand!(command));
					const data = `data: ${JSON.stringify({ type: "command_result", ...result })}\n\n`;
					for (const client of entry.sseClients) writeSse(client, data, entry.sseClients);
					json(res, 200, result);
					return;
				}
				json(res, 405, { error: "Method not allowed" });
				return;
			}

			const projectMatch = /^\/session\/([^/]+)\/project$/.exec(path);
			if (method === "PUT" && projectMatch) {
				if (!options.assignProject) {
					json(res, 501, { error: "Project organization is unavailable" });
					return;
				}
				let input: unknown;
				try {
					input = JSON.parse(await readBody(req));
				} catch {
					json(res, 400, { error: "Expected a project name or null" });
					return;
				}
				if (
					!input ||
					typeof input !== "object" ||
					!("name" in input) ||
					(input.name !== null && typeof input.name !== "string")
				) {
					json(res, 400, { error: "Expected a project name or null" });
					return;
				}
				const id = decodeURIComponent(projectMatch[1]!),
					name = input.name;
				await mutateSession(id, () => options.assignProject!(id, name));
				json(res, 200, { ok: true });
				return;
			}
			const deleteMatch = /^\/session\/([^/]+)$/.exec(path);
			if (method === "DELETE" && deleteMatch) {
				if (!options.deleteSession) {
					json(res, 501, { error: "Session deletion is unavailable" });
					return;
				}
				const id = decodeURIComponent(deleteMatch[1]!);
				await mutateSession(id, () => options.deleteSession!(id));
				const entry = allSessions.get(id);
				if (entry) {
					for (const respond of entry.permissionResponders.values()) respond(false);
					entry.unsubscribeConfirm();
					entry.unsubscribeEvents();
					entry.unsubscribeGoalPlan();
					for (const client of entry.sseClients) {
						writeSse(
							client,
							`data: ${JSON.stringify({ type: "session_deleted", sessionId: id })}\n\n`,
							entry.sseClients,
						);
						client.end();
					}
					allSessions.delete(id);
				}
				broadcastGlobal({ type: "session_closed", sessionId: id });
				json(res, 200, { ok: true });
				return;
			}

			// Global session-lifecycle stream. Must hijack the response.
			if (method === "GET" && path === "/events") {
				res.writeHead(200, sseHeaders());
				writeSse(res, `data: ${JSON.stringify({ type: "server_connected" })}\n\n`, globalClients);
				globalClients.add(res);
				const onClose = () => globalClients.delete(res);
				req.on("close", onClose);
				res.on("close", onClose);
				return;
			}

			// Per-session SSE stream first: it must hijack the response.
			const eventsMatch = /^\/session\/([^/]+)\/events$/.exec(path);
			if (method === "GET" && eventsMatch) {
				const entry = allSessions.get(eventsMatch[1]!);
				if (!entry) {
					json(res, 404, { error: `no such session: ${eventsMatch[1]}` });
					return;
				}
				res.writeHead(200, sseHeaders());
				writeSse(
					res,
					`data: ${JSON.stringify({ type: "server_connected", sessionId: entry.session.id, streaming: entry.session.isStreaming(), timeline: entry.session.getTimeline?.(), messages: entry.session.getTimeline ? undefined : entry.session.getTranscript?.(), subagents: entry.session.getSubagents?.(), permissions: [...entry.permissionRequests.values()] })}\n\n`,
					entry.sseClients,
				);
				entry.sseClients.add(res);
				if (entry.webAttached++ === 0) entry.session.setClientSurface?.("web");
				let closed = false;
				const onClose = () => {
					if (closed) return;
					closed = true;
					entry.sseClients.delete(res);
					if (entry.webAttached > 0 && --entry.webAttached === 0) entry.session.setClientSurface?.("none");
				};
				req.on("close", onClose);
				res.on("close", onClose);
				return;
			}

			if (method === "GET" && path === "/health") {
				json(res, 200, { healthy: true, version });
				return;
			}

			if (method === "GET" && path === "/session") {
				const list = new Map(((await options.listSessions?.()) ?? []).map((item) => [item.id, item]));
				for (const entry of allSessions.values())
					if (!list.has(entry.session.id)) list.set(entry.session.id, { id: entry.session.id });
				json(res, 200, {
					sessions: [...list.values()],
					currentSessionId: session && allSessions.has(session.id) ? session.id : undefined,
				});
				return;
			}

			if (method === "POST" && path === "/session") {
				let requestedId: string | undefined;
				const raw = await readBody(req);
				if (raw.trim()) {
					try {
						const parsed = JSON.parse(raw) as { id?: unknown };
						if (parsed.id !== undefined && typeof parsed.id !== "string") {
							json(res, 400, { error: "id must be a non-empty string" });
							return;
						}
						requestedId = parsed.id as string;
					} catch {
						json(res, 400, { error: "invalid JSON body, expected { id?: string }" });
						return;
					}
				}
				if (requestedId && allSessions.has(requestedId)) {
					json(res, 200, { sessionId: requestedId });
					return;
				}
				if (requestedId && options.openSession) {
					let opening = openingSessions.get(requestedId);
					if (!opening) {
						opening = options.openSession(requestedId);
						openingSessions.set(requestedId, opening);
					}
					try {
						const resumed = await opening;
						registerSession(resumed);
						json(res, 200, { sessionId: resumed.id });
					} finally {
						openingSessions.delete(requestedId);
					}
					return;
				}
				let created: ServeApiSession | undefined;
				if (createSession) {
					created = await createSession(requestedId ?? undefined);
				} else if (session && !requestedId) {
					// Legacy single-session behavior.
					created = session;
				}
				if (!created) {
					json(res, 500, {
						error: requestedId
							? `no session provider can create id ${requestedId}`
							: "no session provider configured; pass createSession or a single session",
					});
					return;
				}
				registerSession(created);
				broadcastGlobal({ type: "session_created", sessionId: created.id });
				json(res, 201, { sessionId: created.id });
				return;
			}

			const messageMatch = /^\/session\/([^/]+)\/message$/.exec(path);
			if (method === "POST" && messageMatch) {
				const entry = resolveEntry(messageMatch[1]!, querySessionId);
				if (!entry) {
					json(res, 404, { error: `no such session: ${messageMatch[1]}` });
					return;
				}
				const raw = (await readRawBody(req, 18 * 1024 * 1024)).toString("utf8");
				let text: unknown;
				let attachments: WorkbenchAttachment[];
				try {
					const input = JSON.parse(raw);
					text = input.text;
					attachments = validateWorkbenchAttachments(input.attachments);
				} catch (error) {
					if (error instanceof Error && "statusCode" in error) throw error;
					json(res, 400, { error: "invalid JSON body, expected { text: string, attachments?: [] }" });
					return;
				}
				if (typeof text !== "string" || (text.trim().length === 0 && attachments.length === 0)) {
					json(res, 400, { error: "text must be a non-empty string" });
					return;
				}
				if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
					json(res, 413, { error: "Message text exceeds the 1 MiB limit" });
					return;
				}
				const messageText = text;
				await mutateSession(entry.session.id, () => entry.session.sendUserMessage(messageText, attachments));
				json(res, 202, { ok: true });
				return;
			}

			const abortMatch = /^\/session\/([^/]+)\/abort$/.exec(path);
			if (method === "POST" && abortMatch) {
				const entry = resolveEntry(abortMatch[1]!, querySessionId);
				if (!entry) {
					json(res, 404, { error: `no such session: ${abortMatch[1]}` });
					return;
				}
				await entry.session.abort();
				json(res, 200, { ok: true });
				return;
			}

			const statusMatch = /^\/session\/([^/]+)\/status$/.exec(path);
			if (method === "GET" && statusMatch) {
				const entry = resolveEntry(statusMatch[1]!, querySessionId);
				if (!entry) {
					json(res, 404, { error: `no such session: ${statusMatch[1]}` });
					return;
				}
				json(res, 200, { id: entry.session.id, streaming: entry.session.isStreaming() });
				return;
			}

			const permissionMatch = /^\/session\/([^/]+)\/permissions\/([^/]+)\/response$/.exec(path);
			if (method === "POST" && permissionMatch) {
				const entry = resolveEntry(permissionMatch[1]!, querySessionId);
				if (!entry) {
					json(res, 404, { error: `no such session: ${permissionMatch[1]}` });
					return;
				}
				let permissionId: string;
				try {
					permissionId = decodeURIComponent(permissionMatch[2]!);
				} catch {
					json(res, 400, { error: "malformed permission id" });
					return;
				}
				const raw = await readBody(req);
				let allow: unknown;
				try {
					allow = JSON.parse(raw).allow;
				} catch {
					json(res, 400, { error: "invalid JSON body, expected { allow: boolean }" });
					return;
				}
				if (typeof allow !== "boolean") {
					json(res, 400, { error: "allow must be a boolean" });
					return;
				}
				// Re-fetch the responder AFTER the (potentially slow) body read and only
				// respond if it is still present. If the 60s timeout already fired, it
				// deleted the entry and auto-denied — so this lookup returns undefined and
				// we must NOT answer again (avoids a double decision to the confirm
				// handler).
				const responder = entry.permissionResponders.get(permissionId);
				if (!responder) {
					json(res, 404, { error: "permission request not found or already answered" });
					return;
				}
				entry.permissionResponders.delete(permissionId);
				responder(allow);
				json(res, 200, { ok: true });
				return;
			}

			json(res, 404, { error: `no route for ${method} ${path}` });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// readBody rejects with a statusCode for size violations (413): honor it
			// instead of always answering 500.
			const status =
				typeof error === "object" &&
				error !== null &&
				"statusCode" in error &&
				typeof (error as { statusCode?: unknown }).statusCode === "number"
					? (error as { statusCode: number }).statusCode
					: 500;
			json(res, status, { error: message });
		}
	});

	// Resolve the per-session route from the path id, falling back to the
	// `?session=` query param as an alternative selector. This lets callers use
	// the convenience `?session=<id>` form while the `/session/:id/...` path
	// remains the primary selector (and stays fully backward compatible).
	function resolveEntry(pathId: string, queryId: string | null): SessionEndpoint | undefined {
		const byPath = allSessions.get(pathId);
		if (byPath) return byPath;
		if (queryId) return allSessions.get(queryId);
		return undefined;
	}

	function sseHeaders(): Record<string, string> {
		return {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		};
	}

	return {
		port: () => {
			const address = server.address();
			return typeof address === "object" && address !== null ? address.port : 0;
		},
		emit: (event: unknown) => broadcast(event),
		listen: () =>
			new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(options.port ?? 4096, options.host ?? "127.0.0.1", () => {
					server.off("error", reject);
					resolve();
				});
			}),
		close: async () => {
			clearInterval(heartbeat);
			for (const entry of allSessions.values()) {
				entry.unsubscribeConfirm();
				entry.unsubscribeEvents();
				entry.unsubscribeGoalPlan();
			}
			for (const entry of allSessions.values()) {
				for (const client of entry.sseClients) client.end();
			}
			allSessions.clear();
			for (const client of globalClients) client.end();
			globalClients.clear();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		},
	};
}

/**
 * Start the API server and wait until the port is bound.
 * Returns the handle with the actual listening port.
 */
export async function startServeApi(options: ServeApiOptions): Promise<ServeApiHandle> {
	const handle = createServeApi(options);
	await handle.listen();
	return handle;
}
