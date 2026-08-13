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
	session: ServeApiSession;
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

export function createServeApi(options: ServeApiOptions): ServeApiHandle {
	const { session, token, version } = options;
	const sseClients = new Set<ServerResponse>();
	const permissionResponders = new Map<string, (allow: boolean) => void>();
	const sessionEvents = new Set<(event: unknown) => void>();

	// Write one SSE payload to a single client, removing it on any failure so a
	// closed/dropped socket can't throw mid-fan-out and never holds the entry.
	const writeSse = (client: ServerResponse, chunk: string): void => {
		try {
			if (client.writableEnded || client.destroyed) {
				sseClients.delete(client);
				return;
			}
			client.write(chunk);
		} catch {
			// EPIPE / closed socket — drop the client so it isn't written again.
			sseClients.delete(client);
		}
	};

	const broadcast = (event: unknown): void => {
		const serialized = JSON.stringify(event);
		for (const client of Array.from(sseClients)) {
			writeSse(client, `data: ${serialized}\n\n`);
		}
	};

	const heartbeat = setInterval(() => {
		for (const client of Array.from(sseClients)) {
			writeSse(client, `: ping\n\n`);
		}
	}, SSE_HEARTBEAT_MS);
	heartbeat.unref();

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

			// SSE stream first: it must hijack the response.
			const eventsMatch = /^\/session\/([^/]+)\/events$/.exec(path);
			if (method === "GET" && eventsMatch && eventsMatch[1] === session.id) {
				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "keep-alive",
					"x-accel-buffering": "no",
				});
				res.write(`data: ${JSON.stringify({ type: "server_connected" })}\n\n`);
				sseClients.add(res);
				const onClose = () => sseClients.delete(res);
				req.on("close", onClose);
				res.on("close", onClose);
				return;
			}

			if (method === "GET" && path === "/health") {
				json(res, 200, { healthy: true, version });
				return;
			}

			if (method === "GET" && path === "/session") {
				json(res, 200, { sessions: [{ id: session.id }] });
				return;
			}

			if (method === "POST" && path === "/session") {
				json(res, 201, { sessionId: session.id });
				return;
			}

			const messageMatch = /^\/session\/([^/]+)\/message$/.exec(path);
			if (method === "POST" && messageMatch && messageMatch[1] === session.id) {
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
				await session.sendUserMessage(text);
				json(res, 202, { ok: true });
				return;
			}

			const abortMatch = /^\/session\/([^/]+)\/abort$/.exec(path);
			if (method === "POST" && abortMatch && abortMatch[1] === session.id) {
				await session.abort();
				json(res, 200, { ok: true });
				return;
			}

			const statusMatch = /^\/session\/([^/]+)\/status$/.exec(path);
			if (method === "GET" && statusMatch && statusMatch[1] === session.id) {
				json(res, 200, { id: session.id, streaming: session.isStreaming() });
				return;
			}

			const permissionMatch = /^\/session\/([^/]+)\/permissions\/([^/]+)\/response$/.exec(path);
			if (method === "POST" && permissionMatch && permissionMatch[1] === session.id) {
				let permissionId: string;
				try {
					permissionId = decodeURIComponent(permissionMatch[2]);
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
				const responder = permissionResponders.get(permissionId);
				if (!responder) {
					json(res, 404, { error: "permission request not found or already answered" });
					return;
				}
				permissionResponders.delete(permissionId);
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

	// Permission requests flow in from the session confirm callback and surface
	// as SSE events plus a pending responder keyed by permission id.
	const unsubscribeConfirm = session.onConfirm((permission, respond) => {
		const responder: (allow: boolean) => void = (allow) => {
			permissionResponders.delete(permission.id);
			respond(allow);
		};
		permissionResponders.set(permission.id, responder);
		broadcast({
			type: "permission_request",
			permissionId: permission.id,
			title: stripAnsi(permission.title),
			message: stripAnsi(permission.message),
		});
		setTimeout(() => {
			if (permissionResponders.delete(permission.id)) respond(false);
		}, PERMISSION_TIMEOUT_MS).unref();
	});

	const unsubscribeSessionEvents = session.onEvent((event) => {
		for (const listener of sessionEvents) listener(event);
		broadcast(event);
	});

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
			unsubscribeConfirm();
			unsubscribeSessionEvents();
			for (const client of sseClients) {
				client.end();
			}
			sseClients.clear();
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
