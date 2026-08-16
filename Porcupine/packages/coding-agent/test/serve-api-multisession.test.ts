import { afterEach, describe, expect, it } from "vitest";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";


/**
 * Multi-session serve API surface (Feature A). The server can run several
 * independent sessions: create/list/select by id, per-session prompts, scoped
 * approval, and per-session SSE isolation. Backward compatible with the single
 * `session` mode exercised by serve-mode.test.ts.
 */

function fakeSession(id: string): ServeApiSession {
	const listeners = new Set<(event: unknown) => void>();
	const confirmHandlers = new Set<
		(p: { id: string; title: string; message: string }, respond: (allow: boolean) => void) => void
	>();
	let streaming = false;
	const session: ServeApiSession & {
		fireConfirm(title: string, message: string): string;
		emit(event: unknown): void;
	} = {
		id,
		sendUserMessage: async (text) => {
			streaming = true;
			session.emit({ type: "user_message", text });
			streaming = false;
			session.emit({ type: "message_end", text: `reply to ${text}` });
		},
		abort: async () => {
			session.emit({ type: "aborted" });
		},
		isStreaming: () => streaming,
		onEvent: (l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		onConfirm: (h) => {
			confirmHandlers.add(h);
			return () => confirmHandlers.delete(h);
		},
		emit(event: unknown) {
			for (const l of listeners) l(event);
		},
		fireConfirm(title: string, message: string) {
			const perm = `perm-${id}-${Math.floor(Math.random() * 1e6)}`;
			for (const h of confirmHandlers) h({ id: perm, title, message }, () => {});
			return perm;
		},
	};
	return session;
}

function collectSse(
	base: string,
	eventsPath: string,
	untilGuard: (events: string[]) => boolean,
): { events: string[]; stop: () => void; done: Promise<void> } {
	const controller = new AbortController();
	cleanups.push(() => controller.abort());
	const events: string[] = [];
	const done = (async () => {
		const res = await fetch(`${base}${eventsPath}`, { signal: controller.signal });
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		for (;;) {
			const { done: d, value } = await reader.read();
			if (d) break;
			for (const line of decoder.decode(value, { stream: true }).split("\n")) {
				if (line.startsWith("data: ")) events.push(line.slice(6));
			}
			if (untilGuard(events)) break;
		}
	})().catch(() => {});
	return { events, stop: () => controller.abort(), done };
}

const cleanups: Array<() => Promise<void> | void> = [];
beforeEach(() => {
	process.env.PORCUPINE_SERVE_ALLOW_TOKENLESS = "1";
});

afterEach(async () => {
	delete process.env.PORCUPINE_SERVE_ALLOW_TOKENLESS;
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("serve HTTP API multi-session", () => {
	it("GET /session lists every provisioned session", async () => {
		const a = fakeSession("sess-a");
		const b = fakeSession("sess-b");
		const handle = await startServeApi({ sessions: [a, b], port: 0 });
		cleanups.push(() => handle.close());
		const res = await fetch(`http://127.0.0.1:${handle.port()}/session`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { sessions: Array<{ id: string }> };
		expect(body.sessions.map((s) => s.id).sort()).toEqual(["sess-a", "sess-b"]);
	});

	it("POST /session creates a new session; accepts an explicit id", async () => {
		const created: string[] = [];
		const handle = await startServeApi({
			sessions: [],
			createSession: (id) => fakeSession(id ?? `new-${created.length}`),
			port: 0,
		});
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const res = await fetch(`${base}/session`, { method: "POST" });
		expect(res.status).toBe(201);
		const first = (await res.json()) as { sessionId: string };

		const res2 = await fetch(`${base}/session`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "explicit-42" }),
		});
		expect(res2.status).toBe(201);
		const second = (await res2.json()) as { sessionId: string };
		expect(second.sessionId).toBe("explicit-42");

		// Re-creating an existing id returns it (200).
		const res3 = await fetch(`${base}/session`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "explicit-42" }),
		});
		expect(res3.status).toBe(200);
		expect((await res3.json()) as { sessionId: string }).toEqual({ sessionId: "explicit-42" });

		// Both sessions are now listable.
		const list = (await (await fetch(`${base}/session`)).json()) as { sessions: Array<{ id: string }> };
		expect(list.sessions.map((s) => s.id).sort()).toEqual([first.sessionId, "explicit-42"].sort());
	});

	it("per-session prompts run independently and hit only the named session", async () => {
		const aReplies: string[] = [];
		const bReplies: string[] = [];
		const sa = makeCaptureSession("sess-a", aReplies);
		const sb = makeCaptureSession("sess-b", bReplies);
		const handle = await startServeApi({ sessions: [sa, sb], port: 0 });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const msgA = await fetch(`${base}/session/sess-a/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello A" }),
		});
		const msgB = await fetch(`${base}/session/sess-b/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello B" }),
		});
		expect(msgA.status).toBe(202);
		expect(msgB.status).toBe(202);
		expect(aReplies).toEqual(["reply to hello A"]);
		expect(bReplies).toEqual(["reply to hello B"]);
	});

	it("wrong session id still returns 404", async () => {
		const handle = await startServeApi({ sessions: [fakeSession("sess-a")], port: 0 });
		cleanups.push(() => handle.close());
		const res = await fetch(`http://127.0.0.1:${handle.port()}/session/ghost/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hi" }),
		});
		expect(res.status).toBe(404);
	});

	it("permission approval routes only to the session that surfaced it", async () => {
		const decisions: Array<{ session: string; allow: boolean }> = [];
		const aSess = makeConfirmSession("sess-a", decisions);
		const bSess = makeConfirmSession("sess-b", decisions);
		const handle = await startServeApi({ sessions: [aSess, bSess], port: 0 });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const permId = (aSess as unknown as { fireConfirm(t: string, m: string): string }).fireConfirm(
			"Approve A",
			"action A",
		);
		// Respond against session A.
		const res = await fetch(`${base}/session/sess-a/permissions/${encodeURIComponent(permId)}/response`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ allow: true }),
		});
		expect(res.status).toBe(200);
		expect(decisions).toEqual([{ session: "sess-a", allow: true }]);
	});

	it("SSE is isolated per session: session A events do not reach session B's stream", async () => {
		const sessA = fakeSession("sess-a");
		const sessB = fakeSession("sess-b");
		const handle = await startServeApi({ sessions: [sessA, sessB], port: 0 });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const a = collectSse(base, "/session/sess-a/events", (evs) => evs.some((e) => e.includes("message_end")));
		const b = collectSse(base, "/session/sess-b/events", (evs) => evs.some((e) => e.includes("ping A")));

		await new Promise((r) => setTimeout(r, 50));
		await sessA.sendUserMessage("ping A");

		await Promise.race([a.done, new Promise((r) => setTimeout(r, 300))]);
		await new Promise((r) => setTimeout(r, 100));
		a.stop();
		b.stop();
		expect(a.events.some((e) => e.includes("reply to ping A"))).toBe(true);
		expect(a.events.some((e) => e.includes("message_end"))).toBe(true);
		// Session B saw none of session A's traffic.
		expect(b.events.some((e) => e.includes("ping A"))).toBe(false);
	});
});

/** Build a fresh capture session whose events are collected into `replies`. */
function makeCaptureSession(id: string, replies: string[]): ServeApiSession {
	const listeners = new Set<(event: unknown) => void>();
	let streaming = false;
	const session: ServeApiSession = {
		id,
		sendUserMessage: async (text) => {
			streaming = true;
			listeners.forEach((l) => {
				l({ type: "user_message", text });
			});
			streaming = false;
			const reply = `reply to ${text}`;
			replies.push(reply);
			listeners.forEach((l) => {
				l({ type: "message_end", text: reply });
			});
		},
		abort: async () => {
			listeners.forEach((l) => {
				l({ type: "aborted" });
			});
		},
		isStreaming: () => streaming,
		onEvent: (l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		onConfirm: () => () => {},
	};
	return session;
}

/** Wrap a fake launch session, capturing confirm decisions keyed by session id. */
function makeConfirmSession(sessionId: string, decisions: Array<{ session: string; allow: boolean }>): ServeApiSession {
	const confirmHandlers = new Set<
		(p: { id: string; title: string; message: string }, respond: (allow: boolean) => void) => void
	>();
	const wrapped: ServeApiSession & { fireConfirm(title: string, message: string): string } = {
		id: sessionId,
		sendUserMessage: async () => {},
		abort: async () => {},
		isStreaming: () => false,
		onEvent: () => () => {},
		onConfirm: (h) => {
			confirmHandlers.add(h);
			return () => confirmHandlers.delete(h);
		},
		fireConfirm(title: string, message: string) {
			const perm = `perm-${sessionId}-${Math.floor(Math.random() * 1e6)}`;
			for (const h of confirmHandlers) {
				h({ id: perm, title, message }, (allow) => decisions.push({ session: sessionId, allow }));
			}
			return perm;
		},
	};
	return wrapped;
}
