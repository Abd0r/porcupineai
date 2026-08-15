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

/** Minimal session surface the HTTP API drives. */
export interface ServeApiSession {
	readonly id: string;
	sendUserMessage(text: string): Promise<void>;
	abort(): Promise<void>;
	isStreaming(): boolean;
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
	createSession?: (id?: string) => ServeApiSession;
	port?: number;
	host?: string;
	/** Optional bearer token. When set, every request must carry it. */
	token?: string;
	version?: string;
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
	/** Internal bounce listeners re-emitting every session event to `emit`. */
	eventListeners: Set<(event: unknown) => void>;
	unsubscribeConfirm: () => void;
	unsubscribeEvents: () => void;
}

export function createServeApi(options: ServeApiOptions): ServeApiHandle {
	const { session, sessions, createSession, token, version } = options;
	const globalClients = new Set<ServerResponse>();
	const allSessions = new Map<string, SessionEndpoint>();

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
			eventListeners: new Set<(event: unknown) => void>(),
			unsubscribeConfirm: () => {},
			unsubscribeEvents: () => {},
		};

		endpoint.unsubscribeConfirm = sessionToRegister.onConfirm((permission, respond) => {
			const responder: (allow: boolean) => void = (allow) => {
				endpoint.permissionResponders.delete(permission.id);
				respond(allow);
			};
			endpoint.permissionResponders.set(permission.id, responder);
			const serialized = JSON.stringify({
				type: "permission_request",
				permissionId: permission.id,
				title: stripAnsi(permission.title),
				message: stripAnsi(permission.message),
			});
			for (const client of Array.from(endpoint.sseClients)) {
				writeSse(client, `data: ${serialized}\n\n`, endpoint.sseClients);
			}
			setTimeout(() => {
				if (endpoint.permissionResponders.delete(permission.id)) respond(false);
			}, PERMISSION_TIMEOUT_MS).unref();
		});

		endpoint.unsubscribeEvents = sessionToRegister.onEvent((event) => {
			for (const listener of endpoint.eventListeners) listener(event);
			const serialized = JSON.stringify(event);
			for (const client of Array.from(endpoint.sseClients)) {
				writeSse(client, `data: ${serialized}\n\n`, endpoint.sseClients);
			}
		});

		allSessions.set(sessionToRegister.id, endpoint);
		return endpoint;
	}

	// Backward compatible: a single `session` is the legacy session; POST
	// /session returns it and every SSR route targets it by id.
	if (session) registerSession(session);
	for (const candidate of sessions ?? []) registerSession(candidate);

	const requireAuth = (req: IncomingMessage): boolean => {
		if (!token) return true;
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
	 * DNS rebinding) must be rejected. We allow requests with no Origin header;
	 * when one is present it must match the server's own origin (scheme://host:port).
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
		return originUrl.host === reqUrl.host;
	};

	const server = createServer(async (req, res) => {
		try {
			if (!requireAuth(req)) {
				json(res, 401, { error: "unauthorized" });
				return;
			}
			const origin = req.headers.origin;
			if (origin !== undefined && !isOriginAllowed(req, origin)) {
				json(res, 403, { error: "cross-origin request denied" });
				return;
			}
			const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
			const path = url.pathname;
			const method = (req.method ?? "GET").toUpperCase();
			const querySessionId = url.searchParams.get("session");

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
					`data: ${JSON.stringify({ type: "server_connected", sessionId: entry.session.id })}\n\n`,
					entry.sseClients,
				);
				entry.sseClients.add(res);
				const onClose = () => entry.sseClients.delete(res);
				req.on("close", onClose);
				res.on("close", onClose);
				return;
			}

			if (method === "GET" && path === "/health") {
				json(res, 200, { healthy: true, version });
				return;
			}

			if (method === "GET" && path === "/session") {
				const list = Array.from(allSessions.values()).map((entry) => ({ id: entry.session.id }));
				json(res, 200, { sessions: list });
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
				let created: ServeApiSession | undefined;
				if (createSession) {
					created = createSession(requestedId ?? undefined);
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
				const raw = await readBody(req);
				let text: unknown;
				try {
					text = JSON.parse(raw).text;
				} catch {
					json(res, 400, { error: "invalid JSON body, expected { text: string }" });
					return;
				}
				if (typeof text !== "string" || text.trim().length === 0) {
					json(res, 400, { error: "text must be a non-empty string" });
					return;
				}
				await entry.session.sendUserMessage(text);
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
