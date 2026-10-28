import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convertToLlm } from "../src/core/messages.ts";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";
import { WorkbenchProjectStore } from "../src/server/workbench-projects.ts";
import { setSessionProject } from "../src/server/workbench-session-projects.ts";
import { createHarness, fauxModel } from "./test-harness.ts";

function fakeSession(overrides: Partial<ServeApiSession> = {}): ServeApiSession {
	const listeners = new Set<(event: unknown) => void>();
	const confirmHandlers = new Set<
		(p: { id: string; title: string; message: string }, respond: (allow: boolean) => void) => void
	>();
	let streaming = false;
	return {
		id: "fake-session",
		sendUserMessage: async (text) => {
			streaming = true;
			listeners.forEach((l) => {
				l({ type: "user_message", text });
			});
			streaming = false;
			listeners.forEach((l) => {
				l({ type: "message_end", text: `reply to ${text}` });
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
		onConfirm: (h) => {
			confirmHandlers.add(h);
			return () => confirmHandlers.delete(h);
		},
		fireConfirm(title: string, message: string) {
			const id = `perm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
			for (const h of confirmHandlers) h({ id, title, message }, () => {});
			return id;
		},
		...overrides,
	} as ServeApiSession & { fireConfirm(title: string, message: string): string };
}

async function start(overrides: Partial<ServeApiSession> = {}, token?: string) {
	const session = fakeSession(overrides);
	const handle = await startServeApi({ session, port: 0, token });
	const base = `http://127.0.0.1:${handle.port()}`;
	return { session, handle, base };
}

const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(() => {
	process.env.PORCUPINE_SERVE_ALLOW_TOKENLESS = "1";
});

afterEach(async () => {
	delete process.env.PORCUPINE_SERVE_ALLOW_TOKENLESS;
	while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("serve HTTP API", () => {
	it("accepts attachment-only messages and rejects invalid attachments before delivery", async () => {
		const received: unknown[] = [];
		const { handle, base } = await start({
			sendUserMessage: async (text, attachments) => {
				received.push({ text, attachments });
			},
		});
		cleanups.push(() => handle.close());
		const attachments = [{ name: "notes.txt", data: "YQ==" }];
		const send = (body: unknown) =>
			fetch(`${base}/session/fake-session/message`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		expect((await send({ text: "", attachments })).status).toBe(202);
		expect((await send({ text: "", attachments: [{ name: "../secret", data: "YQ==" }] })).status).toBe(400);
		expect(received).toEqual([{ text: "", attachments }]);
	});
	it("GET /health returns healthy + version", async () => {
		const { handle, base } = await start();
		cleanups.push(() => handle.close());
		const res = await fetch(`${base}/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { healthy: boolean };
		expect(body.healthy).toBe(true);
	});

	it("POST /session returns the session id", async () => {
		const { handle, base } = await start();
		cleanups.push(() => handle.close());
		const res = await fetch(`${base}/session`, { method: "POST" });
		expect(res.status).toBe(201);
		const body = (await res.json()) as { sessionId: string };
		expect(body.sessionId).toBe("fake-session");
	});

	it("POST /session/:id/message sends the prompt and acks", async () => {
		const { handle, base } = await start();
		cleanups.push(() => handle.close());
		const res = await fetch(`${base}/session/fake-session/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "run the tests" }),
		});
		expect(res.status).toBe(202);
	});

	it("rejects empty text with 400", async () => {
		const { handle, base } = await start();
		cleanups.push(() => handle.close());
		const res = await fetch(`${base}/session/fake-session/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "   " }),
		});
		expect(res.status).toBe(400);
	});

	it("GET /session/:id/status reports streaming state", async () => {
		const { handle, base } = await start();
		cleanups.push(() => handle.close());
		const res = await fetch(`${base}/session/fake-session/status`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { streaming: boolean };
		expect(body.streaming).toBe(false);
	});

	it("rejects wrong session ids with 404", async () => {
		const { handle, base } = await start();
		cleanups.push(() => handle.close());
		const res = await fetch(`${base}/session/other/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hi" }),
		});
		expect(res.status).toBe(404);
	});

	it("enforces the bearer token when set", async () => {
		const { handle, base } = await start({}, "secret-token");
		cleanups.push(() => handle.close());
		const denied = await fetch(`${base}/health`);
		expect(denied.status).toBe(401);
		const allowed = await fetch(`${base}/health`, { headers: { authorization: "Bearer secret-token" } });
		expect(allowed.status).toBe(200);
	});

	it("broadcasts session events over SSE", async () => {
		const { handle, base, session } = await start();
		cleanups.push(() => handle.close());
		const controller = new AbortController();
		cleanups.push(() => controller.abort());
		const events: string[] = [];
		const streamPromise = (async () => {
			const res = await fetch(`${base}/session/fake-session/events`, { signal: controller.signal });
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = decoder.decode(value, { stream: true });
				for (const line of chunk.split("\n")) {
					if (line.startsWith("data: ")) events.push(line.slice(6));
				}
				if (events.some((e) => e.includes("message_end"))) break;
			}
		})();
		await new Promise((resolve) => setTimeout(resolve, 50));
		await session.sendUserMessage("hello");
		await streamPromise;
		expect(events.some((e) => e.includes("message_end"))).toBe(true);
	});

	it("permission request surfaces over SSE and resolves via the endpoint", async () => {
		const { handle, base, session } = await start();
		cleanups.push(() => handle.close());
		const confirmSession = session as ServeApiSession & { fireConfirm(title: string, message: string): string };
		const controller = new AbortController();
		cleanups.push(() => controller.abort());
		const events: string[] = [];
		const streamPromise = (async () => {
			const res = await fetch(`${base}/session/fake-session/events`, { signal: controller.signal });
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				for (const line of decoder.decode(value, { stream: true }).split("\n")) {
					if (line.startsWith("data: ")) events.push(line.slice(6));
				}
				if (events.some((e) => e.includes("permission_request"))) break;
			}
		})();
		await new Promise((resolve) => setTimeout(resolve, 50));

		const permissionId = confirmSession.fireConfirm("Run bash?", "rm -rf /tmp/x");
		await streamPromise;
		const event = events.find((e) => e.includes("permission_request"))!;
		expect(event).toContain(permissionId);
		expect(event).toContain("Run bash?");

		const res = await fetch(`${base}/session/fake-session/permissions/${permissionId}/response`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ allow: true }),
		});
		expect(res.status).toBe(200);

		const res2 = await fetch(`${base}/session/fake-session/permissions/${permissionId}/response`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ allow: false }),
		});
		expect(res2.status).toBe(404);
	});
});

describe("serve HTTP API with a real session", () => {
	it("loads the assigned canonical project into the next turn without changing cwd", async () => {
		const harness = await createHarness({ responses: ["Project context received"] });
		cleanups.push(() => harness.cleanup());
		// Match the production SDK's custom-message conversion.
		harness.agent.convertToLlm = convertToLlm;
		const cwd = harness.session.sessionManager.getCwd();
		const projects = new WorkbenchProjectStore(harness.tempDir);
		projects.create("research", "Research workspace");
		setSessionProject(harness.session.sessionManager, projects.path("research"));
		await adaptSessionToServeApi(harness.session, harness.tempDir).sendUserMessage("Continue the research");
		expect(JSON.stringify(harness.faux.contexts)).toContain("Research workspace");
		expect(harness.session.sessionManager.getCwd()).toBe(cwd);
	});
	it("explains when a text-only model cannot accept a photo without calling it", async () => {
		const harness = await createHarness({ model: { ...fauxModel, input: ["text"] } });
		cleanups.push(() => harness.cleanup());
		await expect(
			adaptSessionToServeApi(harness.session, harness.tempDir).sendUserMessage("", [
				{
					name: "photo.png",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
				},
			]),
		).rejects.toThrow("supports images");
		expect(harness.faux.callCount).toBe(0);
	});
	it("delivers photo pixels to the real agent and preserves them in saved GUI history", async () => {
		const harness = await createHarness({ responses: ["Image received"] });
		cleanups.push(() => harness.cleanup());
		const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
		const adapted = adaptSessionToServeApi(harness.session, harness.tempDir);
		await adapted.sendUserMessage("Inspect", [{ name: "photo.png", data }]);
		const user = harness.session.messages.find((message) => message.role === "user");
		expect(user).toMatchObject({
			content: expect.arrayContaining([{ type: "image", mimeType: "image/png", data: expect.any(String) }]),
		});
		expect(adapted.getTimeline!()[0]).toMatchObject({
			message: {
				role: "user",
				content: expect.arrayContaining([{ type: "image", mimeType: "image/png", data: expect.any(String) }]),
			},
		});
	});
	it("retains older work in GUI replay after model context compaction", async () => {
		const harness = await createHarness({
			responses: [{ thinking: "Saved reasoning before compaction", text: "Original verified code" }],
		});
		cleanups.push(() => harness.cleanup());
		await harness.session.prompt("Original request");
		const kept = harness.session.sessionManager.appendMessage({
			role: "user",
			content: "Later request",
			timestamp: Date.now(),
		});
		harness.session.sessionManager.appendCompaction("Compact summary", kept, 1000);
		harness.agent.state.messages = harness.session.sessionManager.buildSessionContext().messages;
		expect(JSON.stringify(harness.session.messages)).not.toContain("Saved reasoning before compaction");
		const timeline = adaptSessionToServeApi(harness.session).getTimeline!();
		expect(JSON.stringify(timeline)).toContain("Saved reasoning before compaction");
		expect(JSON.stringify(timeline)).toContain("Original verified code");
	});
	it("tells the real agent which client surface is attached", async () => {
		const harness = await createHarness({ responses: ["unused"] });
		cleanups.push(async () => harness.cleanup());
		harness.session.setClientSurface("none");
		const adapted = adaptSessionToServeApi(harness.session);
		adapted.setClientSurface?.("web");
		expect(harness.session.clientSurface).toBe("web");
		adapted.setClientSurface?.("none");
		expect(harness.session.clientSurface).toBe("none");
	});
	it("sends a message through the harness session and receives events", async () => {
		const harness = await createHarness({ responses: ["server reply"] });
		cleanups.push(async () => harness.cleanup());
		const adapted = adaptSessionToServeApi(harness.session);
		const handle = await startServeApi({ session: adapted, port: 0 });
		cleanups.push(() => handle.close());
		const base = `http://127.0.0.1:${handle.port()}`;

		const controller = new AbortController();
		cleanups.push(() => controller.abort());
		const events: string[] = [];
		const streamPromise = (async () => {
			const res = await fetch(`${base}/session/${adapted.id}/events`, { signal: controller.signal });
			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				for (const line of decoder.decode(value, { stream: true }).split("\n")) {
					if (line.startsWith("data: ")) events.push(line.slice(6));
				}
				if (events.some((e) => e.includes('"message_end"'))) break;
			}
		})();

		await new Promise((resolve) => setTimeout(resolve, 50));
		const res = await fetch(`${base}/session/${adapted.id}/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello server" }),
		});
		expect(res.status).toBe(202);

		await streamPromise;
		expect(events.some((e) => e.includes("message_start"))).toBe(true);
		expect(events.some((e) => e.includes("message_end"))).toBe(true);
		expect(events.some((e) => e.includes("server reply"))).toBe(true);
	});
});
