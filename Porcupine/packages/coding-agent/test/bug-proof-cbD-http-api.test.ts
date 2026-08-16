import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";

/**
 * Part-D deep review repro: server/http-api.ts body/status-code correctness.
 * A request body over MAX_BODY_BYTES (1 MiB) is rejected in readBody() with
 * "payload too large" AND the socket is destroyed (req.destroy()). The outer
 * catch then tries to write a 500 JSON to the destroyed socket -> EPIPE, so the
 * client gets a raw network error instead of any HTTP status. It should be a
 * clean 413 (or 400), without destroying the connection before the response.
 */

function fakeSession(): ServeApiSession {
	const listeners = new Set<(event: unknown) => void>();
	let streaming = false;
	return {
		id: "fake-session",
		sendUserMessage: async () => {
			streaming = true;
			listeners.forEach((l) => {
				l({ type: "message_start" });
			});
			streaming = false;
			listeners.forEach((l) => {
				l({ type: "message_end" });
			});
		},
		abort: async () => {},
		isStreaming: () => streaming,
		onEvent: (l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		onConfirm: () => () => {},
	};
}

const cleanups: Array<() => Promise<void> | void> = [];
beforeEach(() => {
	process.env.PORCUPINE_SERVE_ALLOW_TOKENLESS = "1";
});

afterEach(async () => {
	delete process.env.PORCUPINE_SERVE_ALLOW_TOKENLESS;
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("http-api oversized body handling", () => {
	it("REGRESSION: a >1MiB POST body must be rejected with a 4xx status, not EPIPE", async () => {
		const session = fakeSession();
		const handle = await startServeApi({ session, port: 0 });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const big = JSON.stringify({ text: "x".padEnd(2 * 1024 * 1024, "a") }); // >1 MiB
		// Expected: a clean 4xx (413 Payload Too Large). Actual (buggy): req.destroy()
		// -> response write EPIPEs -> fetch rejects with a network error.
		const res = await fetch(`${base}/session/fake-session/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: big,
		});
		expect(res.status).toBe(413);
	});

	it("a small body is accepted (sanity check the harness)", async () => {
		const session = fakeSession();
		const handle = await startServeApi({ session, port: 0 });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const res = await fetch(`${base}/session/fake-session/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
		});
		expect(res.status).toBe(202);
	});
});
