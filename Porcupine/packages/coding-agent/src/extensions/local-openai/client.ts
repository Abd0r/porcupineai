export interface LocalOpenAiModel {
	id: string;
	name: string;
	contextWindow?: number;
}

export function normalizeLocalServerUrl(value: string): string {
	const url = new URL(value.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Server URL must use http or https");
	}
	url.hash = "";
	url.search = "";
	url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "") || "/";
	return url.toString().replace(/\/$/u, "");
}

export function localInferenceUrl(serverUrl: string): string {
	return `${normalizeLocalServerUrl(serverUrl)}/v1`;
}

function errorMessage(payload: unknown, fallback: string): string {
	if (typeof payload !== "object" || payload === null) return fallback;
	const error = (payload as { error?: unknown }).error;
	if (typeof error === "string" && error) return error;
	if (typeof error === "object" && error !== null) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message) return message;
	}
	return fallback;
}

export class LocalOpenAiClient {
	readonly serverUrl: string;
	private readonly apiKey: string | undefined;

	constructor(serverUrl: string, apiKey?: string) {
		this.serverUrl = normalizeLocalServerUrl(serverUrl);
		this.apiKey = apiKey;
	}

	private async request(path: string, init: RequestInit = {}): Promise<unknown> {
		const headers = new Headers(init.headers);
		if (init.body !== undefined) headers.set("Content-Type", "application/json");
		if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
		const timeout = AbortSignal.timeout(15_000);
		const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
		const response = await fetch(`${this.serverUrl}${path}`, { ...init, headers, signal });
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			payload = undefined;
		}
		if (!response.ok) throw new Error(errorMessage(payload, `Local server returned HTTP ${response.status}`));
		return payload;
	}

	async listOpenAiModels(signal?: AbortSignal): Promise<LocalOpenAiModel[]> {
		const payload = await this.request("/v1/models", { signal });
		const data = typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : undefined;
		if (!Array.isArray(data)) throw new Error("Server returned an invalid OpenAI model catalog");
		const models: LocalOpenAiModel[] = [];
		for (const entry of data) {
			if (typeof entry !== "object" || entry === null) continue;
			const id = (entry as { id?: unknown }).id;
			if (typeof id !== "string" || !id) continue;
			const name = (entry as { name?: unknown }).name;
			models.push({ id, name: typeof name === "string" && name ? name : id });
		}
		return models;
	}

	async listOllamaTags(signal?: AbortSignal): Promise<LocalOpenAiModel[]> {
		const payload = await this.request("/api/tags", { signal });
		const rows =
			typeof payload === "object" && payload !== null ? (payload as { models?: unknown }).models : undefined;
		if (!Array.isArray(rows)) throw new Error("Ollama returned an invalid model catalog");
		const models: LocalOpenAiModel[] = [];
		for (const entry of rows) {
			if (typeof entry !== "object" || entry === null) continue;
			const id = (entry as { name?: unknown; model?: unknown }).name ?? (entry as { model?: unknown }).model;
			if (typeof id !== "string" || !id) continue;
			models.push({ id, name: id });
		}
		return models;
	}

	async listOllama(signal?: AbortSignal): Promise<LocalOpenAiModel[]> {
		try {
			return await this.listOllamaTags(signal);
		} catch {
			return await this.listOpenAiModels(signal);
		}
	}

	async listMlx(signal?: AbortSignal): Promise<LocalOpenAiModel[]> {
		return await this.listOpenAiModels(signal);
	}
}
