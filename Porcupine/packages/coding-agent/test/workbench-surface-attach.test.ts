import { afterEach, describe, expect, it } from "vitest";
import { startServeApi } from "../src/server/http-api.ts";

const handles: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
	while (handles.length > 0) await handles.pop()?.close();
});

describe("surface attachment tracking", () => {
	it("marks the browser surface on first SSE attach and detaches on the last close", async () => {
		const seen: string[] = [];
		const base = await startServeApi({
			port: 0,
			token: "surface-token",
			session: {
				id: "surface-session",
				async sendUserMessage() {},
				async abort() {},
				isStreaming: () => false,
				onEvent: () => () => {},
				onConfirm: () => () => {},
				setClientSurface: (surface) => seen.push(surface),
			},
		});
		handles.push(base);
		const controller = new AbortController();
		const response = await fetch(`http://127.0.0.1:${base.port()}/session/surface-session/events`, {
			headers: { authorization: "Bearer surface-token" },
			signal: controller.signal,
		});
		expect(response.status).toBe(200);
		await response.body?.getReader().read();
		expect(seen).toEqual(["web"]);
		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(seen).toEqual(["web", "none"]);
	});
});
