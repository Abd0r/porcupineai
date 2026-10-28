import { afterEach, describe, expect, it } from "vitest";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";

const handles: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
	for (const handle of handles.splice(0)) await handle.close();
});
const live: ServeApiSession = {
	id: "live",
	sendUserMessage: async () => {},
	abort: async () => {},
	isStreaming: () => false,
	onEvent: () => () => {},
	onConfirm: () => () => {},
};
describe("workbench saved session discovery", () => {
	it("lists saved names without loading runtimes and resumes a saved id once", async () => {
		let opened = 0;
		const handle = await startServeApi({
			session: live,
			token: "local",
			port: 0,
			listSessions: async () => [{ id: "saved", name: "Earlier investigation" }],
			openSession: async (id) => {
				opened++;
				return { ...live, id };
			},
		});
		handles.push(handle);
		const base = `http://127.0.0.1:${handle.port()}`;
		const headers = { authorization: "Bearer local" };
		const list = await fetch(`${base}/session`, { headers }).then((r) => r.json());
		expect(list.sessions).toContainEqual({ id: "saved", name: "Earlier investigation" });
		expect(opened).toBe(0);
		for (let index = 0; index < 2; index++) {
			const response = await fetch(`${base}/session`, {
				method: "POST",
				headers,
				body: JSON.stringify({ id: "saved" }),
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ sessionId: "saved" });
		}
		expect(opened).toBe(1);
	});
	it("awaits asynchronous session creation", async () => {
		const handle = await startServeApi({
			token: "local",
			port: 0,
			createSession: async () => ({ ...live, id: "new" }),
		});
		handles.push(handle);
		const response = await fetch(`http://127.0.0.1:${handle.port()}/session`, {
			method: "POST",
			headers: { authorization: "Bearer local" },
		});
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ sessionId: "new" });
	});
});
