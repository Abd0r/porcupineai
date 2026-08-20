import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider, type RefreshModelsContext } from "../models.ts";
import type { Model } from "../types.ts";
import { OPENCODE_GO_MODELS } from "./opencode-go.models.ts";

const OPENCODE_AUTH_URL = "https://opencode.ai/auth";
const OPENCODE_ENV = ["OPENCODE_API_KEY"] as const;
export const OPENCODE_GO_MODELS_URL = "https://opencode.ai/zen/go/v1/models";
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go";
const OPENCODE_GO_V1_BASE_URL = "https://opencode.ai/zen/go/v1";

type GoApi = "anthropic-messages" | "openai-completions" | "openai-responses";

/**
 * Live Go only returns ids. Map new ids onto the transport the official Go
 * docs assign (opencode.ai/docs/go Endpoints table). Known pinned ids keep
 * their generated metadata.
 */
const LIVE_GO_API: Record<string, GoApi> = {
	"gpt-5.6-luna": "openai-responses",
	"grok-4.5": "openai-responses",
	"muse-spark-1.2": "openai-responses",
	"muse-spark-1.2-contributor": "openai-responses",
	"minimax-m3": "anthropic-messages",
	"minimax-m2.7": "anthropic-messages",
	"minimax-m2.5": "anthropic-messages",
	"qwen3.8-max": "anthropic-messages",
	"qwen3.7-max": "anthropic-messages",
	"qwen3.7-plus": "anthropic-messages",
	"qwen3.6-plus": "anthropic-messages",
	"qwen3.5-plus": "anthropic-messages",
};

function titleFromId(id: string): string {
	return id
		.split(/[-.]/g)
		.filter(Boolean)
		.map((part) =>
			part === "v2" || part === "v4" ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
		)
		.join(" ");
}

function guessApi(id: string): GoApi {
	if (LIVE_GO_API[id]) return LIVE_GO_API[id];
	if (id.startsWith("gpt-") || id.startsWith("grok-") || id.startsWith("muse-spark")) return "openai-responses";
	if (id.startsWith("minimax-") || id.startsWith("qwen")) return "anthropic-messages";
	return "openai-completions";
}

function synthesizeGoModel(id: string): Model<GoApi> {
	const api = guessApi(id);
	const baseUrl = api === "anthropic-messages" ? OPENCODE_GO_BASE_URL : OPENCODE_GO_V1_BASE_URL;
	return {
		id,
		name: titleFromId(id),
		api,
		provider: "opencode-go",
		baseUrl,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 32000,
		compat:
			api === "openai-responses"
				? { sessionAffinityFormat: "openai-nosession" }
				: api === "openai-completions"
					? { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens" }
					: undefined,
	};
}

function parseLiveGoIds(payload: unknown): string[] {
	if (typeof payload !== "object" || payload === null) return [];
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];
	const ids: string[] = [];
	for (const entry of data) {
		if (typeof entry !== "object" || entry === null) continue;
		const id = (entry as { id?: unknown }).id;
		if (typeof id === "string" && id) ids.push(id);
	}
	return ids;
}

export async function fetchOpenCodeGoLiveIds(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<string[]> {
	const timeout = AbortSignal.timeout(15_000);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const response = await fetchImpl(OPENCODE_GO_MODELS_URL, { signal: combined });
	if (!response.ok) throw new Error(`OpenCode Go models list returned HTTP ${response.status}`);
	return parseLiveGoIds(await response.json());
}

export function overlayOpenCodeGoCatalog(
	liveIds: readonly string[],
	baseline: readonly Model<GoApi>[] = Object.values(OPENCODE_GO_MODELS) as Model<GoApi>[],
): Model<GoApi>[] {
	if (liveIds.length === 0) return [...baseline];
	const byId = new Map(baseline.map((model) => [model.id, model]));
	return liveIds.map((id) => byId.get(id) ?? synthesizeGoModel(id));
}

/**
 * OpenCode Go uses a subscription API key (not browser OAuth device flow).
 * Users sign in at opencode.ai/auth, copy the key, and paste it in /login.
 */
function opencodeGoApiKeyAuth(): ApiKeyAuth {
	return {
		name: "OpenCode Go API key",
		login: async (interaction) => {
			interaction.notify({
				type: "info",
				message: `OpenCode Go: create/subscribe at ${OPENCODE_AUTH_URL}, then paste your API key.`,
			});
			const key = await interaction.prompt({
				type: "secret",
				message: "Enter OpenCode Go API key",
			});
			return { type: "api_key", key };
		},
		resolve: async ({ ctx, credential }) => {
			if (credential?.key) {
				return { auth: { apiKey: credential.key }, env: credential.env, source: "stored credential" };
			}
			for (const envVar of OPENCODE_ENV) {
				const value = await ctx.env(envVar);
				if (value) return { auth: { apiKey: value }, source: envVar };
			}
			return undefined;
		},
	};
}

export function opencodeGoProvider(): Provider<GoApi> {
	const baseline = Object.values(OPENCODE_GO_MODELS) as Model<GoApi>[];
	return createProvider<GoApi>({
		id: "opencode-go",
		name: "OpenCode Go",
		auth: { apiKey: opencodeGoApiKeyAuth() },
		models: baseline,
		fetchModels: async (context: RefreshModelsContext) => {
			const liveIds = await fetchOpenCodeGoLiveIds(globalThis.fetch, context.signal);
			return overlayOpenCodeGoCatalog(liveIds, baseline);
		},
		api: {
			"anthropic-messages": anthropicMessagesApi(),
			"openai-completions": openAICompletionsApi(),
			"openai-responses": openAIResponsesApi(),
		},
	});
}
