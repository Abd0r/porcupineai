import { afterEach, describe, expect, it } from "vitest";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";

const handles: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
	while (handles.length > 0) await handles.pop()?.close();
});

function session(timelineLength: number): ServeApiSession {
	const timeline = Array.from({ length: timelineLength }, (_, index) => ({
		type: "message_end" as const,
		message: { role: index % 2 ? "assistant" : "user", content: `message ${index}` },
	}));
	return {
		id: "paged-session",
		sendUserMessage: async () => {},
		abort: async () => {},
		isStreaming: () => false,
		onEvent: () => () => {},
		onConfirm: () => () => {},
		getTimeline: () => timeline,
	};
}

async function readFirstSseData(base: string, path: string, token: string): Promise<any> {
	const controller = new AbortController();
	const response = await fetch(`${base}${path}`, {
		headers: { authorization: `Bearer ${token}` },
		signal: controller.signal,
	});
	const reader = response.body!.getReader();
	const chunk = new TextDecoder().decode((await reader.read()).value);
	await reader.cancel();
	controller.abort();
	const line = chunk.split("\n").find((entry) => entry.startsWith("data: "))!;
	return JSON.parse(line.slice(6));
}

describe("serve API bounded timeline transport", () => {
	it("keeps legacy SSE full timeline when history is not paged", async () => {
		const handle = await startServeApi({ session: session(5), token: "secret", port: 0 });
		handles.push(handle);
		const base = `http://127.0.0.1:${handle.port()}`;
		const snapshot = await readFirstSseData(base, "/session/paged-session/events", "secret");
		expect(snapshot.type).toBe("server_connected");
		expect(snapshot.timeline).toHaveLength(5);
		expect(snapshot.historyBefore).toBeUndefined();
		expect(snapshot.messages).toBeUndefined();
	});

	it("pages the initial timeline to the newest 120 events", async () => {
		const handle = await startServeApi({ session: session(200), token: "secret", port: 0 });
		handles.push(handle);
		const base = `http://127.0.0.1:${handle.port()}`;
		const snapshot = await readFirstSseData(base, "/session/paged-session/events?history=paged", "secret");
		expect(snapshot.timeline).toHaveLength(120);
		expect(snapshot.historyBefore).toBe(80);
		expect(snapshot.timeline[0].message.content).toBe("message 80");
		expect(snapshot.timeline[119].message.content).toBe("message 199");
	});

	it("returns an older page and a validated cursor", async () => {
		const handle = await startServeApi({ session: session(200), token: "secret", port: 0 });
		handles.push(handle);
		const base = `http://127.0.0.1:${handle.port()}`;

		const denied = await fetch(`${base}/session/paged-session/history?before=80`);
		expect(denied.status).toBe(401);

		const page = await fetch(`${base}/session/paged-session/history?before=80`, {
			headers: { authorization: "Bearer secret" },
		});
		expect(page.status).toBe(200);
		const body = await page.json();
		expect(body.timeline).toHaveLength(80);
		expect(body.historyBefore).toBe(0);
		expect(body.timeline[0].message.content).toBe("message 0");
		expect(body.timeline[79].message.content).toBe("message 79");

		const missing = await fetch(`${base}/session/paged-session/history`, {
			headers: { authorization: "Bearer secret" },
		});
		expect(missing.status).toBe(400);

		const invalid = await fetch(`${base}/session/paged-session/history?before=abc`, {
			headers: { authorization: "Bearer secret" },
		});
		expect(invalid.status).toBe(400);

		const outOfRange = await fetch(`${base}/session/paged-session/history?before=201`, {
			headers: { authorization: "Bearer secret" },
		});
		expect(outOfRange.status).toBe(400);
	});

	it("handles a 10k timeline without returning the full payload", async () => {
		const handle = await startServeApi({ session: session(10000), token: "secret", port: 0 });
		handles.push(handle);
		const base = `http://127.0.0.1:${handle.port()}`;
		const snapshot = await readFirstSseData(base, "/session/paged-session/events?history=paged", "secret");
		expect(snapshot.timeline).toHaveLength(120);
		expect(snapshot.historyBefore).toBe(9880);

		const page = await fetch(`${base}/session/paged-session/history?before=9880`, {
			headers: { authorization: "Bearer secret" },
		});
		const body = await page.json();
		expect(body.timeline).toHaveLength(120);
		expect(body.historyBefore).toBe(9760);
		expect(body.timeline[0].message.content).toBe("message 9760");
	});
});
