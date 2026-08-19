import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import { LocalOpenAiClient, type LocalOpenAiModel } from "./client.ts";
import {
	createLocalOpenAiProvider,
	type LocalOpenAiProviderSpec,
	MLX_PROVIDER_ID,
	MLX_SPEC,
	OLLAMA_PROVIDER_ID,
	OLLAMA_SPEC,
} from "./provider.ts";

function isConnectionError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = `${error.name} ${error.message}`.toLowerCase();
	return message.includes("fetch failed") || message.includes("timeout") || message.includes("network");
}

function connectionErrorMessage(error: unknown, spec: LocalOpenAiProviderSpec): string {
	if (isConnectionError(error)) {
		return `Could not connect to ${spec.name} at the configured URL. Is the server running?`;
	}
	return error instanceof Error ? error.message : String(error);
}

async function configuredClient(
	ctx: ExtensionCommandContext,
	spec: LocalOpenAiProviderSpec,
): Promise<LocalOpenAiClient | undefined> {
	const result = await ctx.modelRegistry.getProviderAuth(spec.id);
	if (!result) {
		ctx.ui.notify(`Configure ${spec.name} with /login ${spec.id}`, "warning");
		return undefined;
	}
	const configuredUrl = result.env?.[spec.urlEnv];
	const raw = typeof configuredUrl === "string" && configuredUrl ? configuredUrl : (result.auth.baseUrl ?? "");
	if (!raw) {
		ctx.ui.notify(`Configure ${spec.name} with /login ${spec.id}`, "warning");
		return undefined;
	}
	return new LocalOpenAiClient(raw, result.auth.apiKey);
}

function formatCatalog(spec: LocalOpenAiProviderSpec, models: readonly LocalOpenAiModel[]): string {
	if (models.length === 0) return `${spec.name}: no models listed. Pull or start one, then run /${spec.id} again.`;
	const lines = models.map((model) => `- ${model.id}`);
	return `${spec.name} models (${models.length}):\n${lines.join("\n")}\n\nSelect one with /model.`;
}

function registerLocalProvider(porcupine: ExtensionAPI, spec: LocalOpenAiProviderSpec): void {
	const controller = createLocalOpenAiProvider(spec);
	porcupine.registerProvider(controller.provider);

	porcupine.registerCommand(spec.id, {
		description: `List ${spec.name} models on the local server`,
		handler: async (_args, ctx) => {
			const client = await configuredClient(ctx, spec);
			if (!client) return;
			try {
				const catalog = await spec.list(client);
				controller.setCatalog(catalog, client.serverUrl);
				await ctx.modelRegistry.refresh();
				ctx.ui.notify(formatCatalog(spec, catalog));
			} catch (error) {
				ctx.ui.notify(connectionErrorMessage(error, spec), "error");
			}
		},
	});
}

export default function localOpenAiExtension(porcupine: ExtensionAPI): void {
	registerLocalProvider(porcupine, OLLAMA_SPEC);
	registerLocalProvider(porcupine, MLX_SPEC);
}

export { MLX_PROVIDER_ID, OLLAMA_PROVIDER_ID };
