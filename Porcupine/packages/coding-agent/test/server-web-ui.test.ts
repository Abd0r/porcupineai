import { afterEach, describe, expect, it } from "vitest";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";
import { WORKBENCH_STYLES } from "../src/server/web-ui-styles.ts";

const handles: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
	while (handles.length > 0) await handles.pop()?.close();
});

function session(): ServeApiSession {
	return {
		id: "gui-session",
		sendUserMessage: async () => {},
		abort: async () => {},
		isStreaming: () => false,
		onEvent: () => () => {},
		onConfirm: () => () => {},
	};
}

function observableSession(): { session: ServeApiSession; emit(event: unknown): void } {
	const listeners = new Set<(event: unknown) => void>();
	return {
		session: {
			...session(),
			onEvent: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		emit: (event) => {
			for (const listener of listeners) listener(event);
		},
	};
}

describe("serve web UI", () => {
	it("keeps the design tokens self-contained and retains upstream attribution", () => {
		const declared = new Set([...WORKBENCH_STYLES.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
		const referenced = [...WORKBENCH_STYLES.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
		expect(referenced.length).toBeGreaterThan(20);
		expect(referenced.filter((token) => !declared.has(token))).toEqual([]);
		expect(WORKBENCH_STYLES).toContain("Copyright (c) 2026 DeepSeek");
		expect(WORKBENCH_STYLES).not.toContain("url(");
	});
	it("serves a safe browser shell while keeping session APIs behind bearer auth", async () => {
		const handle = await startServeApi({ session: session(), token: "gui-secret", port: 0 });
		handles.push(handle);
		const base = `http://127.0.0.1:${handle.port()}`;

		const page = await fetch(`${base}/`);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toContain("text/html");
		expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
		const html = await page.text();
		expect(html).toContain("Porcupine Workbench");
		expect(html).toContain("function renderVisual(");
		expect(html).toContain("canvas.getContext('2d')");
		expect(html).not.toContain(".innerHTML");
		expect(html).toContain("Copyright (c) 2026 DeepSeek");

		const denied = await fetch(`${base}/session`);
		expect(denied.status).toBe(401);

		const allowed = await fetch(`${base}/session`, {
			headers: { authorization: "Bearer gui-secret" },
		});
		expect(allowed.status).toBe(200);
	});

	it("streams validated visualization tool details to the browser client", async () => {
		const observable = observableSession();
		const handle = await startServeApi({ session: observable.session, token: "gui-secret", port: 0 });
		handles.push(handle);
		const controller = new AbortController();
		const response = await fetch(`http://127.0.0.1:${handle.port()}/session/gui-session/events`, {
			headers: { authorization: "Bearer gui-secret" },
			signal: controller.signal,
		});
		const reader = response.body?.getReader();
		if (!reader) throw new Error("SSE response body is missing");
		const decoder = new TextDecoder();
		let received = "";
		const first = await reader.read();
		received += decoder.decode(first.value);
		observable.emit({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "visualize_3d",
			result: {
				content: [{ type: "text", text: "Validated 3D scene specification: test" }],
				details: {
					visualization: {
						version: 1,
						title: "test",
						objects: [{ type: "box", position: [0, 0, 0], size: [1, 1, 1], color: "#80c060" }],
					},
				},
			},
			isError: false,
		});
		while (!received.includes('"visualization"')) {
			const next = await reader.read();
			if (next.done) break;
			received += decoder.decode(next.value);
		}
		await reader.cancel();
		controller.abort();
		expect(response.status).toBe(200);
		expect(received).toContain('"toolName":"visualize_3d"');
		expect(received).toContain('"title":"test"');
	});

	it("rejects cross-origin requests to the browser shell", async () => {
		const handle = await startServeApi({ session: session(), token: "gui-secret", port: 0 });
		handles.push(handle);
		const page = await fetch(`http://127.0.0.1:${handle.port()}/`, {
			headers: { origin: "http://attacker.example" },
		});
		expect(page.status).toBe(403);
	});
});
