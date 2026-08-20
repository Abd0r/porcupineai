import { once } from "node:events";
import { createServer, type RequestListener, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthContext, AuthPrompt, ModelsStoreEntry } from "@porcupineai/ai";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import {
	LocalOpenAiClient,
	localInferenceUrl,
	normalizeLocalServerUrl,
} from "../src/extensions/local-openai/client.ts";
import localOpenAiExtension, { MLX_PROVIDER_ID, OLLAMA_PROVIDER_ID } from "../src/extensions/local-openai/index.ts";
import { createLocalOpenAiProvider, MLX_SPEC, OLLAMA_SPEC } from "../src/extensions/local-openai/provider.ts";

const servers: Server[] = [];

async function listen(handler: RequestListener): Promise<{ server: Server; url: string }> {
	const server = createServer(handler);
	servers.push(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address() as AddressInfo;
	return { server, url: `http://127.0.0.1:${address.port}` };
}

function json(response: ServerResponse, value: unknown): void {
	response.writeHead(200, { "Content-Type": "application/json" });
	response.end(JSON.stringify(value));
}

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				}),
		),
	);
});

describe("local OpenAI providers (Ollama + MLX)", () => {
	it("registers native Ollama and MLX providers plus list commands", async () => {
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(
			localOpenAiExtension,
			process.cwd(),
			createEventBus(),
			runtime,
			"<inline:local-openai>",
		);

		expect(extension.commands.get("ollama")?.description).toBe("List Ollama models on the local server");
		expect(extension.commands.get("mlx")?.description).toBe("List MLX models on the local server");
		expect(runtime.pendingNativeProviderRegistrations.map((entry) => entry.provider.id).sort()).toEqual([
			MLX_PROVIDER_ID,
			OLLAMA_PROVIDER_ID,
		]);
	});

	it("normalizes management and inference URLs", () => {
		expect(normalizeLocalServerUrl("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434");
		expect(localInferenceUrl("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/v1");
		expect(() => normalizeLocalServerUrl("file:///tmp/ollama")).toThrow("http or https");
	});

	it("lists Ollama tags and falls back to /v1/models", async () => {
		const { url } = await listen((request, response) => {
			if (request.url === "/api/tags") {
				json(response, { models: [{ name: "qwen2.5-coder:7b" }, { model: "llama3.1:8b" }] });
				return;
			}
			response.writeHead(404).end();
		});
		const client = new LocalOpenAiClient(url);
		expect((await client.listOllama()).map((model) => model.id)).toEqual(["qwen2.5-coder:7b", "llama3.1:8b"]);
	});

	it("lists MLX models from the OpenAI catalog", async () => {
		const { url } = await listen((request, response) => {
			if (request.url === "/v1/models") {
				json(response, { data: [{ id: "mlx-community/Qwen2.5-7B-Instruct-4bit" }] });
				return;
			}
			response.writeHead(404).end();
		});
		const client = new LocalOpenAiClient(url);
		expect((await client.listMlx()).map((model) => model.id)).toEqual(["mlx-community/Qwen2.5-7B-Instruct-4bit"]);
	});

	it("exposes discovered Ollama models with local compat defaults", () => {
		const controller = createLocalOpenAiProvider(OLLAMA_SPEC);
		controller.setCatalog([{ id: "qwen2.5-coder:7b", name: "qwen2.5-coder:7b" }], "http://127.0.0.1:11434");
		expect(controller.provider.getModels()).toEqual([
			expect.objectContaining({
				id: "qwen2.5-coder:7b",
				provider: OLLAMA_PROVIDER_ID,
				baseUrl: "http://127.0.0.1:11434/v1",
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				compat: expect.objectContaining({
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
				}),
			}),
		]);
	});

	it("persists and restores MLX models for cache-only startup refreshes", async () => {
		let cachedEntry: ModelsStoreEntry | undefined;
		const store = {
			read: async () => cachedEntry,
			write: async (entry: ModelsStoreEntry) => {
				cachedEntry = structuredClone(entry);
			},
			delete: async () => {
				cachedEntry = undefined;
			},
		};
		const { url } = await listen((request, response) => {
			if (request.url === "/v1/models") {
				json(response, { data: [{ id: "mlx-community/Llama-3.2-3B-Instruct-4bit" }] });
				return;
			}
			response.writeHead(404).end();
		});

		const first = createLocalOpenAiProvider(MLX_SPEC);
		await first.provider.refreshModels?.({
			credential: { type: "api_key", key: "local", env: { MLX_BASE_URL: url } },
			store,
			allowNetwork: true,
		});
		expect(first.provider.getModels().map((model) => model.id)).toEqual(["mlx-community/Llama-3.2-3B-Instruct-4bit"]);

		const second = createLocalOpenAiProvider(MLX_SPEC);
		await second.provider.refreshModels?.({
			credential: { type: "api_key", key: "local", env: { MLX_BASE_URL: url } },
			store,
			allowNetwork: false,
		});
		expect(second.provider.getModels()).toEqual([
			expect.objectContaining({
				id: "mlx-community/Llama-3.2-3B-Instruct-4bit",
				baseUrl: `${url}/v1`,
			}),
		]);
	});

	it("stays dormant until configured and stores URL plus optional key", async () => {
		const { provider } = createLocalOpenAiProvider(OLLAMA_SPEC);
		const auth = provider.auth.apiKey!;
		const emptyContext: AuthContext = {
			env: async () => undefined,
			fileExists: async () => false,
		};
		expect(await auth.check?.({ ctx: emptyContext })).toBeUndefined();
		expect(await auth.resolve({ ctx: emptyContext })).toBeUndefined();

		const { url } = await listen((request, response) => {
			if (request.url === "/api/tags") {
				json(response, { models: [] });
				return;
			}
			response.writeHead(404).end();
		});
		const answers = [url, "secret"];
		const credential = await auth.login!({
			prompt: async (_prompt: AuthPrompt) => answers.shift()!,
			notify: () => {},
		});
		expect(credential).toEqual({
			type: "api_key",
			key: "secret",
			env: { OLLAMA_BASE_URL: url },
		});
		expect(await auth.resolve({ ctx: emptyContext, credential })).toEqual({
			auth: { apiKey: "secret", baseUrl: `${url}/v1` },
			env: { OLLAMA_BASE_URL: url },
			source: "stored credential",
		});
	});
});
