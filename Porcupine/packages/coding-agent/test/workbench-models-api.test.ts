import { afterEach, describe, expect, it } from "vitest";
import { startServeApi } from "../src/server/http-api.ts";

const handles: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
	while (handles.length > 0) await handles.pop()?.close();
});

async function fixture() {
	let current = { provider: "opencode-go", id: "deepseek-v4-flash" };
	const defaults: string[] = [];
	const handle = await startServeApi({
		port: 0,
		token: "models-token",
		session: {
			id: "models-session",
			async sendUserMessage() {},
			async abort() {},
			isStreaming: () => false,
			onEvent: () => () => {},
			onConfirm: () => () => {},
			getModels: async () => ({
				current,
				models: [
					{
						provider: "opencode-go",
						id: "deepseek-v4-flash",
						name: "DeepSeek V4 Flash",
						contextWindow: 1_000_000,
						reasoning: false,
					},
					{
						provider: "anthropic",
						id: "claude-sonnet-4-5",
						name: "Claude Sonnet 4.5",
						contextWindow: 200_000,
						reasoning: true,
					},
				],
			}),
			setSessionModel: async (provider: string, id: string) => {
				current = { provider, id };
				return { current, models: [] };
			},
			setDefaultModel: (provider: string, id: string) => {
				defaults.push(`${provider}/${id}`);
				return { provider, id };
			},
		},
	});
	handles.push(handle);
	return { base: `http://127.0.0.1:${handle.port()}`, headers: { authorization: "Bearer models-token" }, defaults };
}

describe("workbench model selection", () => {
	it("lists available models and switches the session model", async () => {
		const { base, headers } = await fixture();
		const listed = await fetch(`${base}/session/models-session/models`, { headers });
		expect(listed.status).toBe(200);
		const body = await listed.json();
		expect(body.models.map((model: { name: string }) => model.name)).toContain("Claude Sonnet 4.5");
		const switched = await fetch(`${base}/session/models-session/models`, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body: JSON.stringify({ provider: "anthropic", id: "claude-sonnet-4-5" }),
		});
		expect(switched.status).toBe(200);
		expect((await switched.json()).current).toEqual({ provider: "anthropic", id: "claude-sonnet-4-5" });
	});

	it("writes defaults separately and rejects malformed or unknown fields", async () => {
		const { base, headers, defaults } = await fixture();
		const json = { ...headers, "content-type": "application/json" };
		const setDefault = await fetch(`${base}/session/models-session/models`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ provider: "anthropic", id: "claude-sonnet-4-5", scope: "default" }),
		});
		expect(setDefault.status).toBe(200);
		expect(defaults).toEqual(["anthropic/claude-sonnet-4-5"]);
		for (const body of [
			{ provider: "a" },
			{ provider: 1, id: "x" },
			{ provider: "a", id: "b", extra: true },
			{ provider: "a", id: "b", scope: "everywhere" },
		]) {
			const response = await fetch(`${base}/session/models-session/models`, {
				method: "POST",
				headers: json,
				body: JSON.stringify(body),
			});
			expect(response.status).toBe(400);
		}
		expect((await fetch(`${base}/session/models-session/models`)).status).toBe(401);
	});
});

describe("workbench sub-agent model", () => {
	it("writes the sub-agent model separately from the session and default", async () => {
		const seen: string[] = [];
		const handle = await startServeApi({
			port: 0,
			token: "sub-token",
			session: {
				id: "sub-session",
				async sendUserMessage() {},
				async abort() {},
				isStreaming: () => false,
				onEvent: () => () => {},
				onConfirm: () => () => {},
				getModels: async () => ({ current: null, subagentModel: null, models: [] }),
				setSubagentModel: (provider: string, id: string) => {
					seen.push(`${provider}/${id}`);
					return { provider, id };
				},
			},
		});
		handles.push(handle);
		const response = await fetch(`http://127.0.0.1:${handle.port()}/session/sub-session/models`, {
			method: "POST",
			headers: { authorization: "Bearer sub-token", "content-type": "application/json" },
			body: JSON.stringify({ provider: "opencode-go", id: "deepseek-v4-flash", scope: "subagent" }),
		});
		expect(response.status).toBe(200);
		expect((await response.json()).scope).toBe("subagent");
		expect(seen).toEqual(["opencode-go/deepseek-v4-flash"]);
	});
});
