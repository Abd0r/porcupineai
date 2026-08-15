/**
 * Browser vision layer: a small vision-language model gives text-only agents
 * eyes on the rendered page.
 *
 * Text-only models (DeepSeek V4 Flash and similar) cannot see screenshots, so
 * browser work for them stops at the ARIA tree: canvas-rendered text, images,
 * PDFs, WebGL, and visual state are invisible. This module sends a screenshot
 * to an OpenAI-compatible image-to-text model with a natural-language prompt
 * and returns a bounded text layer the agent can actually read: visible text,
 * approximate element positions, layout, and visual state.
 *
 * Recommended model: LiquidAI/LFM2.5-VL-3B (general VLM, ~3B, reads text AND
 * describes state). Florence-2 (OCR + regions), DeepSeek-OCR-2, or any
 * OpenAI-compatible image-to-text model also work via the same wire format.
 * Serve with vLLM/SGLang/a small wrapper; configure with
 * PORCUPINE_BROWSER_VISION_* env vars.
 *
 * Fail-closed: any failure returns a short note, never an exception, and never
 * breaks the browser session.
 */

import { createHash } from "node:crypto";

/** Default prompt for a text-only agent looking at a web page. */
export const DEFAULT_VISION_PROMPT =
	"You are the eyes of an AI agent that cannot see images. Describe this web page screenshot precisely. " +
	"List every visible text element (labels, buttons, links, inputs, headings) with its approximate viewport " +
	"position (x,y). Describe the overall layout, and call out visual state: error messages, toasts, disabled " +
	"elements, loading indicators, dialogs, and anything unusual.";

export interface BrowserVisionConfig {
	/** Master switch. Defaults to false; enabled via PORCUPINE_BROWSER_VISION=1. */
	enabled: boolean;
	/** OpenAI-compatible base URL, e.g. http://127.0.0.1:8011/v1 (vLLM). */
	baseUrl: string;
	/** Optional bearer token for the endpoint. */
	apiKey?: string;
	/** Model id advertised by the endpoint. Defaults to lfm2.5-vl-3b. */
	model: string;
	/** Natural-language prompt sent with the image. */
	prompt: string;
	/** Per-request timeout in ms. */
	timeoutMs: number;
	/** Max characters of vision text returned to the model. */
	maxOutputChars: number;
	/** Max tokens requested from the endpoint. */
	maxTokens: number;
	/** LRU cache size (image hash -> text). */
	cacheSize: number;
}

export const DEFAULT_BROWSER_VISION_CONFIG: BrowserVisionConfig = {
	enabled: false,
	baseUrl: "http://127.0.0.1:8011/v1",
	apiKey: undefined,
	model: "lfm2.5-vl-3b",
	prompt: DEFAULT_VISION_PROMPT,
	timeoutMs: 30_000,
	maxOutputChars: 12_000,
	maxTokens: 2048,
	cacheSize: 64,
};

/** Resolve vision config from the environment (PORCUPINE_BROWSER_VISION_*). */
export function resolveBrowserVisionConfig(env: NodeJS.ProcessEnv = process.env): BrowserVisionConfig {
	const config = { ...DEFAULT_BROWSER_VISION_CONFIG };
	config.enabled = env.PORCUPINE_BROWSER_VISION === "1";
	if (env.PORCUPINE_BROWSER_VISION_BASE_URL) config.baseUrl = env.PORCUPINE_BROWSER_VISION_BASE_URL;
	if (env.PORCUPINE_BROWSER_VISION_API_KEY) config.apiKey = env.PORCUPINE_BROWSER_VISION_API_KEY;
	if (env.PORCUPINE_BROWSER_VISION_MODEL) config.model = env.PORCUPINE_BROWSER_VISION_MODEL;
	if (env.PORCUPINE_BROWSER_VISION_PROMPT) config.prompt = env.PORCUPINE_BROWSER_VISION_PROMPT;
	return config;
}

/** LRU cache keyed by image hash + prompt so the loop never re-reads the same shot. */
class VisionCache {
	private readonly max: number;
	private readonly map = new Map<string, string>();

	constructor(max: number) {
		this.max = Math.max(1, max);
	}

	get(key: string): string | undefined {
		const hit = this.map.get(key);
		if (hit !== undefined) {
			// Refresh recency.
			this.map.delete(key);
			this.map.set(key, hit);
		}
		return hit;
	}

	set(key: string, value: string): void {
		this.map.delete(key);
		this.map.set(key, value);
		if (this.map.size > this.max) {
			const oldest = this.map.keys().next().value;
			if (oldest !== undefined) this.map.delete(oldest);
		}
	}
}

const cache = new VisionCache(DEFAULT_BROWSER_VISION_CONFIG.cacheSize);

function imageKey(imageBytes: Uint8Array, prompt: string): string {
	return `${createHash("sha256").update(imageBytes).digest("hex")}:${createHash("sha1").update(prompt).digest("hex")}`;
}

/**
 * Send a screenshot to the vision endpoint and return the bounded text layer.
 * Returns a short `VISUAL LAYER: unavailable (...) note` on any failure
 * (fail-closed) and "" when disabled or given no bytes.
 */
export async function visionRead(imageBytes: Uint8Array, config: BrowserVisionConfig): Promise<string> {
	if (!config.enabled || imageBytes.length === 0) {
		return "";
	}
	const key = imageKey(imageBytes, config.prompt);
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const base64 = Buffer.from(imageBytes).toString("base64");
	const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), config.timeoutMs);
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
				},
				body: JSON.stringify({
					model: config.model,
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: config.prompt },
								{ type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
							],
						},
					],
					max_tokens: config.maxTokens,
					temperature: 0,
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				return `VISUAL LAYER: unavailable (vision endpoint ${response.status})`;
			}
			const data = (await response.json()) as {
				choices?: Array<{ message?: { content?: unknown } }>;
			};
			const content = data.choices?.[0]?.message?.content;
			const text =
				typeof content === "string" ? content : Array.isArray(content) ? content.map(String).join(" ") : "";
			const bounded = text.slice(0, config.maxOutputChars);
			cache.set(key, bounded);
			return bounded;
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		return `VISUAL LAYER: unavailable (${error instanceof Error ? error.message : String(error)})`;
	}
}

/**
 * Compose the full model-facing snapshot: ARIA tree + optional vision layer.
 * Returns the ARIA text unchanged when the vision layer is empty.
 */
export function composeVisualLayer(ariaSnapshot: string, visualLayer: string): string {
	if (!visualLayer) return ariaSnapshot;
	return `${ariaSnapshot}\n\nVISUAL LAYER (model read of the rendered page, positions are viewport pixels):\n${visualLayer}`;
}
