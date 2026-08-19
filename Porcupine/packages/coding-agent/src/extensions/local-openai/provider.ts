import type {
	ApiKeyCredential,
	AuthContext,
	AuthResult,
	Model,
	Provider,
	ProviderStreamOptions,
	RefreshModelsContext,
} from "@porcupineai/ai";
import { stream, streamSimple } from "@porcupineai/ai/compat";
import { LocalOpenAiClient, type LocalOpenAiModel, localInferenceUrl, normalizeLocalServerUrl } from "./client.ts";

export const OLLAMA_PROVIDER_ID = "ollama";
export const MLX_PROVIDER_ID = "mlx";
export const DEFAULT_OLLAMA_SERVER_URL = "http://127.0.0.1:11434";
export const DEFAULT_MLX_SERVER_URL = "http://127.0.0.1:8080";

export interface LocalOpenAiProviderSpec {
	id: typeof OLLAMA_PROVIDER_ID | typeof MLX_PROVIDER_ID;
	name: string;
	defaultUrl: string;
	urlEnv: string;
	keyEnv: string;
	loginLabel: string;
	list: (client: LocalOpenAiClient, signal?: AbortSignal) => Promise<LocalOpenAiModel[]>;
}

export const OLLAMA_SPEC: LocalOpenAiProviderSpec = {
	id: OLLAMA_PROVIDER_ID,
	name: "Ollama",
	defaultUrl: DEFAULT_OLLAMA_SERVER_URL,
	urlEnv: "OLLAMA_BASE_URL",
	keyEnv: "OLLAMA_API_KEY",
	loginLabel: "Ollama server URL",
	list: (client, signal) => client.listOllama(signal),
};

export const MLX_SPEC: LocalOpenAiProviderSpec = {
	id: MLX_PROVIDER_ID,
	name: "MLX",
	defaultUrl: DEFAULT_MLX_SERVER_URL,
	urlEnv: "MLX_BASE_URL",
	keyEnv: "MLX_API_KEY",
	loginLabel: "MLX server URL (mlx_lm.server)",
	list: (client, signal) => client.listMlx(signal),
};

function credentialServerUrl(
	spec: LocalOpenAiProviderSpec,
	credential: ApiKeyCredential | undefined,
): string | undefined {
	const value = credential?.env?.[spec.urlEnv];
	return typeof value === "string" && value.trim() ? normalizeLocalServerUrl(value) : undefined;
}

async function resolveServerUrl(
	spec: LocalOpenAiProviderSpec,
	ctx: AuthContext,
	credential: ApiKeyCredential | undefined,
): Promise<string | undefined> {
	const configured = credentialServerUrl(spec, credential) ?? (await ctx.env(spec.urlEnv))?.trim();
	return configured ? normalizeLocalServerUrl(configured) : undefined;
}

function toPorcupineModel(
	spec: LocalOpenAiProviderSpec,
	model: LocalOpenAiModel,
	serverUrl: string,
): Model<"openai-completions"> {
	const contextWindow = model.contextWindow && model.contextWindow > 0 ? model.contextWindow : 128000;
	return {
		id: model.id,
		name: model.name || model.id,
		api: "openai-completions",
		provider: spec.id,
		baseUrl: localInferenceUrl(serverUrl),
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: contextWindow,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
			supportsStrictMode: false,
			maxTokensField: "max_tokens",
		},
	};
}

export interface LocalOpenAiProviderController {
	provider: Provider<"openai-completions">;
	setCatalog(models: readonly LocalOpenAiModel[], serverUrl: string): void;
}

export function createLocalOpenAiProvider(spec: LocalOpenAiProviderSpec): LocalOpenAiProviderController {
	let models: readonly Model<"openai-completions">[] = [];

	const setCatalog = (catalog: readonly LocalOpenAiModel[], serverUrl: string): void => {
		models = catalog.map((model) => toPorcupineModel(spec, model, serverUrl));
	};

	const provider: Provider<"openai-completions"> = {
		id: spec.id,
		name: spec.name,
		baseUrl: localInferenceUrl(spec.defaultUrl),
		auth: {
			apiKey: {
				name: spec.name,
				login: async (interaction): Promise<ApiKeyCredential> => {
					const enteredUrl = await interaction.prompt({
						type: "text",
						message: spec.loginLabel,
						placeholder: process.env[spec.urlEnv] ?? spec.defaultUrl,
					});
					const serverUrl = normalizeLocalServerUrl(
						enteredUrl.trim() || process.env[spec.urlEnv] || spec.defaultUrl,
					);
					const apiKey = (
						await interaction.prompt({
							type: "secret",
							message: "API key (optional, local servers usually need none)",
						})
					).trim();
					const client = new LocalOpenAiClient(serverUrl, apiKey || undefined);
					await spec.list(client, interaction.signal);
					return {
						type: "api_key",
						key: apiKey || undefined,
						env: { [spec.urlEnv]: serverUrl },
					};
				},
				check: async ({ ctx, credential }) => {
					const serverUrl = await resolveServerUrl(spec, ctx, credential);
					return serverUrl
						? { type: "api_key", source: credential ? "stored credential" : spec.urlEnv }
						: undefined;
				},
				resolve: async ({ ctx, credential }): Promise<AuthResult | undefined> => {
					const serverUrl = await resolveServerUrl(spec, ctx, credential);
					if (!serverUrl) return undefined;
					const apiKey = credential?.key ?? (await ctx.env(spec.keyEnv)) ?? "local";
					return {
						auth: { apiKey, baseUrl: localInferenceUrl(serverUrl) },
						env: { ...credential?.env, [spec.urlEnv]: serverUrl },
						source: credential ? "stored credential" : spec.urlEnv,
					};
				},
			},
		},
		getModels: () => models,
		refreshModels: async (context: RefreshModelsContext): Promise<void> => {
			const stored = await context.store.read();
			if (stored) {
				models = stored.models.filter(
					(model): model is Model<"openai-completions"> =>
						model.provider === spec.id && model.api === "openai-completions",
				);
			}

			if (!context.allowNetwork || context.signal?.aborted || context.credential?.type !== "api_key") return;
			const serverUrl = credentialServerUrl(spec, context.credential);
			if (!serverUrl) return;
			const catalog = await spec.list(new LocalOpenAiClient(serverUrl, context.credential.key), context.signal);
			setCatalog(catalog, serverUrl);
			if (!context.signal?.aborted) await context.store.write({ models, checkedAt: Date.now() });
		},
		stream: (model, context, options) => stream(model, context, options as ProviderStreamOptions | undefined),
		streamSimple: (model, context, options) => streamSimple(model, context, options),
	};

	return { provider, setCatalog };
}
