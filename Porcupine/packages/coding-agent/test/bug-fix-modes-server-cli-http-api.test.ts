import { afterEach, describe, expect, it } from "vitest";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";

/**
 * Regression tests for BUG-01 (permission double-response race after the 60s
 * timeout) and BUG-02 (constant-time bearer-token comparison).
 */

function fakeSession(): ServeApiSession {
	return {
		id: "fake-session",
		sendUserMessage: async () => {},
		abort: async () => {},
		isStreaming: () => false,
		onEvent: () => () => {},
		onConfirm: () => () => {},
	};
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("http-api permission single-response (BUG-01)", () => {
	it("delivers exactly ONE decision for one valid permission response", async () => {
		const session = fakeSession();
		const decisions: boolean[] = [];
		let fire:
			| ((permission: { id: string; title: string; message: string }, respond: (allow: boolean) => void) => void)
			| undefined;
		(session as unknown as { onConfirm: (h: typeof fire) => void }).onConfirm = (h) => {
			fire = h;
			return () => {};
		};
		const handle = await startServeApi({ session, port: 0 });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const respond = (allow: boolean) => decisions.push(allow);
		fire!({ id: "perm-1", title: "t", message: "m" }, respond);

		const res = await fetch(`${base}/session/fake-session/permissions/perm-1/response`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ allow: true }),
		});
		expect(res.status).toBe(200);
		expect(decisions).toEqual([true]);
	});

	it("a second response for the same (consumed) permission id is refused and does NOT double-deliver", async () => {
		const session = fakeSession();
		const decisions: boolean[] = [];
		let fire:
			| ((permission: { id: string; title: string; message: string }, respond: (allow: boolean) => void) => void)
			| undefined;
		(session as unknown as { onConfirm: (h: typeof fire) => void }).onConfirm = (h) => {
			fire = h;
			return () => {};
		};
		const handle = await startServeApi({ session, port: 0 });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const respond = (allow: boolean) => decisions.push(allow);
		fire!({ id: "perm-2", title: "t", message: "m" }, respond);

		const first = await fetch(`${base}/session/fake-session/permissions/perm-2/response`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ allow: true }),
		});
		expect(first.status).toBe(200);

		// The responder was deleted on the first response. A second, late response
		// (analogous to one arriving after the timeout auto-deny) must be refused
		// and must not call the confirm handler again.
		const second = await fetch(`${base}/session/fake-session/permissions/perm-2/response`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ allow: false }),
		});
		expect(second.status).toBe(404);
		expect(decisions).toEqual([true]); // exactly one decision, never a second
	});
});

describe("http-api bearer token comparison (BUG-02)", () => {
	it("rejects a wrong bearer token and allows the correct one", async () => {
		const handle = await startServeApi({ session: fakeSession(), port: 0, token: "sekret" });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const denied = await fetch(`${base}/health`, {
			headers: { authorization: "Bearer wrong-token" },
		});
		expect(denied.status).toBe(401);

		const allowed = await fetch(`${base}/health`, {
			headers: { authorization: "Bearer sekret" },
		});
		expect(allowed.status).toBe(200);
	});

	it("rejects a request with no Authorization header when a token is set", async () => {
		const handle = await startServeApi({ session: fakeSession(), port: 0, token: "sekret" });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const noHeader = await fetch(`${base}/health`);
		expect(noHeader.status).toBe(401);
	});
});
