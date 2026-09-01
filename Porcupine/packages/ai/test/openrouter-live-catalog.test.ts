import { describe, expect, it } from "vitest";
import { OPENROUTER_MODELS } from "../src/providers/openrouter.models.ts";
import {
	fetchOpenRouterLiveCatalog,
	OPENROUTER_MODELS_URL,
	overlayOpenRouterCatalog,
} from "../src/providers/openrouter.ts";
import type { Model } from "../src/types.ts";

const baseline = Object.values(OPENROUTER_MODELS) as Model<"openai-completions">[];

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(payload: unknown, status = 200): typeof fetch {
	return (() => Promise.resolve(jsonResponse(payload, status))) as typeof fetch;
}

function captureFetch(): { fetchImpl: typeof fetch; requests: Request[] } {
	const requests: Request[] = [];
	const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
		requests.push(new Request(input, init));
		return Promise.resolve(
			jsonResponse({
				data: [
					{
						id: "fresh/new-model",
						name: "Fresh: New Model",
						context_length: 1048576,
						architecture: { input_modalities: ["text", "image"] },
						pricing: { prompt: "0.00000022", completion: "0.00000066", input_cache_read: "0.00000001" },
						top_provider: { max_completion_tokens: 65536 },
						supported_parameters: ["reasoning", "tools"],
					},
				],
			}),
		) as Promise<Response>;
	}) as typeof fetch;
	return { fetchImpl, requests };
}

describe("OpenRouter live catalog", () => {
	it("maps live metadata onto the typed model shape", async () => {
		const { fetchImpl } = captureFetch();
		const models = await fetchOpenRouterLiveCatalog(fetchImpl);
		expect(models).toHaveLength(1);
		expect(models[0]).toMatchObject({
			id: "fresh/new-model",
			name: "Fresh: New Model",
			api: "openai-completions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1048576,
			maxTokens: 65536,
			cost: { input: 0.22, output: 0.66, cacheRead: 0.01, cacheWrite: 0 },
			compat: { thinkingFormat: "openrouter" },
		});
	});

	it("sends bearer auth when an API key is provided", async () => {
		const { fetchImpl, requests } = captureFetch();
		await fetchOpenRouterLiveCatalog(fetchImpl, undefined, "sk-test");
		expect(requests[0].url).toBe(OPENROUTER_MODELS_URL);
		expect(requests[0].headers.get("authorization")).toBe("Bearer sk-test");
	});

	it("refreshes stale numbers on known ids while preserving pinned extras", async () => {
		const pinned = baseline[0];
		const payload = {
			data: [
				{
					id: pinned.id,
					name: pinned.name,
					context_length: 999999,
					pricing: { prompt: "0.000001", completion: "0.000002" },
					supported_parameters: [],
				},
			],
		};
		const models = await fetchOpenRouterLiveCatalog(fakeFetch(payload));
		expect(models.map((model) => model.id)).toEqual([pinned.id]);
		expect(models[0].contextWindow).toBe(999999);
		expect(models[0].cost.input).toBeCloseTo(1);
		expect(models[0].cost.output).toBeCloseTo(2);
		expect(models[0].reasoning).toBe(false);
	});

	it("deduplicates repeated ids", async () => {
		const entry = { id: "a/model", name: "A", context_length: 8192 };
		const payload = { data: [entry, entry] };
		const models = await fetchOpenRouterLiveCatalog(fakeFetch(payload));
		expect(models).toHaveLength(1);
	});

	it("uses a conservative output limit when live metadata omits one", async () => {
		const models = await fetchOpenRouterLiveCatalog(
			fakeFetch({ data: [{ id: "fresh/long-context", context_length: 1048576 }] }),
		);
		expect(models[0]?.maxTokens).toBe(32768);
	});

	it("rejects malformed successful responses instead of treating them as an empty catalog", async () => {
		await expect(fetchOpenRouterLiveCatalog(fakeFetch({}))).rejects.toThrow(/invalid payload/);
	});

	it("throws on non-OK responses", async () => {
		await expect(fetchOpenRouterLiveCatalog(fakeFetch({}, 500))).rejects.toThrow(/HTTP 500/);
	});
});

describe("OpenRouter live overlay", () => {
	it("returns the pinned catalog unchanged when the live list is empty", () => {
		expect(overlayOpenRouterCatalog([], baseline)).toEqual(baseline);
	});

	it("keeps baseline-only ids after the refreshed live entries", () => {
		const live = [{ ...baseline[0], contextWindow: 424242 }];
		const merged = overlayOpenRouterCatalog(live, baseline.slice(0, 3));
		expect(merged.map((model) => model.id)).toEqual([baseline[0].id, baseline[1].id, baseline[2].id]);
		expect(merged[0].contextWindow).toBe(424242);
	});
});
