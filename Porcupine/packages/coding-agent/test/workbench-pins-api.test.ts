import { describe, expect, it } from "vitest";
import { startServeApi } from "../src/server/http-api.ts";
import { WorkbenchError } from "../src/server/workbench-context-files.ts";

describe("conversation pin API", () => {
	it("allows pinning while an HTTP message is still running", async () => {
		let release = () => {},
			started = () => {},
			pinned = false;
		const gate = new Promise<void>((resolve) => {
				release = resolve;
			}),
			start = new Promise<void>((resolve) => {
				started = resolve;
			});
		const server = await startServeApi({
			port: 0,
			token: "pin",
			session: {
				id: "live",
				async sendUserMessage() {
					started();
					await gate;
				},
				async abort() {},
				isStreaming: () => true,
				onEvent: () => () => {},
				onConfirm: () => () => {},
			},
			setSessionPinned: async (_id, value) => {
				pinned = value;
			},
		});
		const base = `http://127.0.0.1:${server.port()}`,
			headers = { authorization: "Bearer pin", "content-type": "application/json" };
		const message = fetch(`${base}/session/live/message`, {
			method: "POST",
			headers,
			body: JSON.stringify({ text: "Work" }),
		});
		try {
			await start;
			expect(
				(
					await fetch(`${base}/session/live/pin`, {
						method: "PUT",
						headers,
						body: JSON.stringify({ pinned: true }),
					})
				).status,
			).toBe(200);
			expect(pinned).toBe(true);
		} finally {
			release();
			await message;
			await server.close();
		}
	});
	it("pins a saved conversation without resuming an agent and enforces authentication and input validation", async () => {
		let pinned = false;
		const server = await startServeApi({
			port: 0,
			token: "test-pin",
			listSessions: async () => [{ id: "saved", name: "Research", pinned }],
			setSessionPinned: async (id, value) => {
				if (id !== "saved") throw new WorkbenchError(404, "No such conversation");
				pinned = value;
			},
		});
		const base = `http://127.0.0.1:${server.port()}`,
			headers = { authorization: "Bearer test-pin", "content-type": "application/json" };
		try {
			const update = (body: unknown, id = "saved", extra = {}) =>
				fetch(`${base}/session/${id}/pin`, {
					method: "PUT",
					headers: { ...headers, ...extra },
					body: JSON.stringify(body),
				});
			expect((await fetch(`${base}/session/saved/pin`, { method: "PUT", body: '{"pinned":true}' })).status).toBe(
				401,
			);
			expect((await update({ pinned: true }, "saved", { origin: "https://other.example" })).status).toBe(403);
			for (const body of [{ pinned: "true" }, { pinned: true, path: "/tmp/chat" }, [], null])
				expect((await update(body)).status).toBe(400);
			expect((await update({ pinned: true }, "unknown")).status).toBe(404);
			expect((await update({ pinned: true })).status).toBe(200);
			expect((await (await fetch(`${base}/session`, { headers })).json()).sessions).toEqual([
				{ id: "saved", name: "Research", pinned: true },
			]);
			expect((await update({ pinned: false })).status).toBe(200);
			expect(pinned).toBe(false);
		} finally {
			await server.close();
		}
	});
});
