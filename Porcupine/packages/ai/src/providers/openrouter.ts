import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadOpenRouterOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider, type RefreshModelsContext } from "../models.ts";
import type { Model } from "../types.ts";
import { OPENROUTER_MODELS } from "./openrouter.models.ts";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Live catalog fetched from OpenRouter's public /api/v1/models endpoint.
 * Field reference: https://openrouter.ai/api/reference (GET /api/v1/models).
 */
interface LiveOpenRouterEntry {
	id?: unknown;
	name?: unknown;
	context_length?: unknown;
	architecture?: { input_modalities?: unknown };
	pricing?: {
		prompt?: unknown;
		completion?: unknown;
		input_cache_read?: unknown;
		input_cache_write?: unknown;
	};
	top_provider?: { max_completion_tokens?: unknown };
	supported_parameters?: unknown;
}

/** OpenRouter prices are strings in $/token; Porcupine costs are numbers in $/M tokens. */
function perMillion(value: unknown): number | undefined {
	const parsed = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return parsed * 1_000_000;
}

function liveInputModalities(entry: LiveOpenRouterEntry): ("text" | "image" | "audio")[] | undefined {
	const raw = entry.architecture?.input_modalities;
	if (!Array.isArray(raw)) return undefined;
	const modalities = raw.filter(
		(value): value is "text" | "image" | "audio" => value === "text" || value === "image" || value === "audio",
	);
	return modalities.length > 0 ? modalities : undefined;
}

function liveReasoning(entry: LiveOpenRouterEntry): boolean | undefined {
	const raw = entry.supported_parameters;
	if (!Array.isArray(raw)) return undefined;
	return raw.some((value) => value === "reasoning" || value === "include_reasoning");
}

function parseLiveOpenRouterEntries(payload: unknown): LiveOpenRouterEntry[] {
	if (typeof payload !== "object" || payload === null)
		throw new Error("OpenRouter models list returned an invalid payload");
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data)) throw new Error("OpenRouter models list returned an invalid payload");
	return data.filter(
		(entry): entry is LiveOpenRouterEntry =>
			typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string",
	);
}

/**
 * Map one live entry onto the typed Model shape. Known ids start from their
 * pinned baseline entry (preserving compat/thinkingLevelMap details) and get
 * every live-provided field refreshed over it; unknown ids are synthesized.
 */
function toOpenRouterModel(
	entry: LiveOpenRouterEntry,
	baselineById: Map<string, Model<"openai-completions">>,
): Model<"openai-completions"> {
	const id = entry.id as string;
	const base = baselineById.get(id);
	const cost = base?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const inputCost = perMillion(entry.pricing?.prompt);
	const outputCost = perMillion(entry.pricing?.completion);
	const cacheReadCost = perMillion(entry.pricing?.input_cache_read);
	const cacheWriteCost = perMillion(entry.pricing?.input_cache_write);
	const contextLength =
		typeof entry.context_length === "number" && Number.isFinite(entry.context_length) && entry.context_length > 0
			? Math.floor(entry.context_length)
			: undefined;
	const maxCompletionTokens =
		typeof entry.top_provider?.max_completion_tokens === "number" &&
		Number.isFinite(entry.top_provider.max_completion_tokens) &&
		entry.top_provider.max_completion_tokens > 0
			? Math.floor(entry.top_provider.max_completion_tokens)
			: undefined;

	return {
		...(base ?? {
			id,
			name: id,
			api: "openai-completions" as const,
			provider: "openrouter",
			baseUrl: OPENROUTER_BASE_URL,
			reasoning: false,
			input: ["text" as const],
			cost,
			contextWindow: 128000,
			maxTokens: 32768,
			compat: { thinkingFormat: "openrouter" as const },
		}),
		id,
		name: typeof entry.name === "string" && entry.name ? entry.name : (base?.name ?? id),
		contextWindow: contextLength ?? base?.contextWindow ?? 128000,
		maxTokens: maxCompletionTokens ?? base?.maxTokens ?? 32768,
		reasoning: liveReasoning(entry) ?? base?.reasoning ?? false,
		input: liveInputModalities(entry) ?? base?.input ?? ["text"],
		cost: {
			...cost,
			input: inputCost ?? cost.input,
			output: outputCost ?? cost.output,
			cacheRead: cacheReadCost ?? cost.cacheRead,
			cacheWrite: cacheWriteCost ?? cost.cacheWrite,
		},
	};
}

export async function fetchOpenRouterLiveCatalog(
	fetchImpl: typeof fetch = globalThis.fetch,
	signal?: AbortSignal,
	apiKey?: string,
): Promise<Model<"openai-completions">[]> {
	const timeout = AbortSignal.timeout(15_000);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const headers: Record<string, string> = { accept: "application/json" };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const response = await fetchImpl(OPENROUTER_MODELS_URL, { headers, signal: combined });
	if (!response.ok) throw new Error(`OpenRouter models list returned HTTP ${response.status}`);
	const payload: unknown = await response.json();
	const baselineById = new Map(
		(Object.values(OPENROUTER_MODELS) as Model<"openai-completions">[]).map((model) => [model.id, model]),
	);
	const merged = parseLiveOpenRouterEntries(payload).map((entry) => toOpenRouterModel(entry, baselineById));
	return merged.filter((model, index) => merged.findIndex((entry) => entry.id === model.id) === index);
}

/** Live catalog wins over the pinned baseline; baseline-only ids survive at the end. */
export function overlayOpenRouterCatalog(
	live: readonly Model<"openai-completions">[],
	baseline: readonly Model<"openai-completions">[] = Object.values(OPENROUTER_MODELS),
): Model<"openai-completions">[] {
	if (live.length === 0) return [...baseline];
	const merged = [...live];
	const seen = new Set(live.map((model) => model.id));
	for (const model of baseline) {
		if (!seen.has(model.id)) merged.push(model);
	}
	return merged;
}

export function openrouterProvider(): Provider<"openai-completions"> {
	const baseline = Object.values(OPENROUTER_MODELS) as Model<"openai-completions">[];
	return createProvider({
		id: "openrouter",
		name: "OpenRouter",
		baseUrl: OPENROUTER_BASE_URL,
		auth: {
			apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]),
			oauth: lazyOAuth({
				name: "OpenRouter OAuth",
				loginLabel: "Sign in with OpenRouter",
				load: loadOpenRouterOAuth,
			}),
		},
		models: baseline,
		fetchModels: async (context: RefreshModelsContext) => {
			const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
			const live = await fetchOpenRouterLiveCatalog(globalThis.fetch, context.signal, apiKey);
			return overlayOpenRouterCatalog(live, baseline);
		},
		api: openAICompletionsApi(),
	});
}
