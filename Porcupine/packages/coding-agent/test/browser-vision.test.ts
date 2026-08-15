import { describe, expect, test } from "vitest";
import {
	composeVisualLayer,
	DEFAULT_BROWSER_VISION_CONFIG,
	resolveBrowserVisionConfig,
	visionRead,
} from "../src/porcupine/browser-vision.ts";

/** Stub global fetch so tests never touch the network. */
function stubFetch(response: { status?: number; body?: unknown; throwError?: boolean }): () => void {
	const original = globalThis.fetch;
	globalThis.fetch = (async () => {
		if (response.throwError) throw new Error("connection refused");
		return {
			ok: (response.status ?? 200) < 400,
			status: response.status ?? 200,
			json: async () => response.body ?? { choices: [{ message: { content: "" } }] },
		};
	}) as unknown as typeof fetch;
	return () => {
		globalThis.fetch = original;
	};
}

/** Distinct bytes per test so the module-level LRU cache never leaks between tests. */
function freshImage(seed: number): Uint8Array {
	return new Uint8Array([seed, seed + 1, seed + 2, seed + 3, seed + 4, seed + 5, seed + 6, seed + 7]);
}

function enabledConfig(overrides: Partial<typeof DEFAULT_BROWSER_VISION_CONFIG> = {}) {
	return { ...DEFAULT_BROWSER_VISION_CONFIG, enabled: true, ...overrides };
}

describe("browser vision layer (LFM2.5-VL-3B default)", () => {
	test("returns empty when disabled", async () => {
		const restore = stubFetch({});
		try {
			const result = await visionRead(freshImage(1), { ...DEFAULT_BROWSER_VISION_CONFIG, enabled: false });
			expect(result).toBe("");
		} finally {
			restore();
		}
	});

	test("sends the natural-language prompt with a base64 image to the endpoint", async () => {
		let sent:
			| {
					url: string;
					body: {
						model: string;
						messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
					};
			  }
			| undefined;
		const original = globalThis.fetch;
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			sent = { url, body: JSON.parse(String(init.body)) };
			return {
				ok: true,
				status: 200,
				json: async () => ({ choices: [{ message: { content: "Submit button at (120, 40). Nav bar at top." } }] }),
			} as unknown as Response;
		}) as typeof fetch;
		try {
			const result = await visionRead(freshImage(2), enabledConfig());
			expect(result).toContain("Submit button");
			expect(sent?.url).toBe("http://127.0.0.1:8011/v1/chat/completions");
			expect(sent!.body.model).toBe("lfm2.5-vl-3b");
			const content = sent!.body.messages[0]!.content;
			expect(content[0]!.text).toContain("Describe this web page screenshot");
			expect(content[1]!.image_url!.url).toContain("data:image/png;base64,");
			const b64 = content[1]!.image_url!.url.split(",")[1]!;
			expect(Array.from(Buffer.from(b64, "base64"))).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
		} finally {
			globalThis.fetch = original;
		}
	});

	test("caches by image hash: same bytes hit the endpoint once", async () => {
		let calls = 0;
		const original = globalThis.fetch;
		globalThis.fetch = (async () => {
			calls++;
			return {
				ok: true,
				status: 200,
				json: async () => ({ choices: [{ message: { content: "cached read" } }] }),
			} as unknown as Response;
		}) as typeof fetch;
		try {
			const config = enabledConfig();
			const img = freshImage(3);
			const first = await visionRead(img, config);
			const second = await visionRead(img, config);
			expect(first).toBe("cached read");
			expect(second).toBe("cached read");
			expect(calls).toBe(1);
		} finally {
			globalThis.fetch = original;
		}
	});

	test("fail-closed on network error and non-2xx", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error("connection refused");
		}) as typeof fetch;
		try {
			const result = await visionRead(freshImage(4), enabledConfig());
			expect(result).toContain("VISUAL LAYER: unavailable");
		} finally {
			globalThis.fetch = original;
		}

		const restore = stubFetch({ status: 500 });
		try {
			const result = await visionRead(freshImage(5), enabledConfig());
			expect(result).toContain("unavailable (vision endpoint 500)");
		} finally {
			restore();
		}
	});

	test("bounds output to maxOutputChars", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			({
				ok: true,
				status: 200,
				json: async () => ({ choices: [{ message: { content: "x".repeat(50_000) } }] }),
			}) as unknown) as typeof fetch;
		try {
			const result = await visionRead(freshImage(6), enabledConfig({ maxOutputChars: 100 }));
			expect(result.length).toBe(100);
		} finally {
			globalThis.fetch = original;
		}
	});

	test("composeVisualLayer appends the vision layer and keeps ARIA when empty", () => {
		expect(composeVisualLayer("ARIA snapshot:\n[button] Submit", "Submit button at (120, 40)")).toContain(
			"VISUAL LAYER (model read of the rendered page",
		);
		expect(composeVisualLayer("ARIA snapshot:\n[button] Submit", "")).toBe("ARIA snapshot:\n[button] Submit");
	});

	test("resolveBrowserVisionConfig reads PORCUPINE_BROWSER_VISION_* env", () => {
		const env = {
			PORCUPINE_BROWSER_VISION: "1",
			PORCUPINE_BROWSER_VISION_BASE_URL: "http://127.0.0.1:9000/v1",
			PORCUPINE_BROWSER_VISION_MODEL: "florence-2-base-ft",
			PORCUPINE_BROWSER_VISION_PROMPT: "list the text",
		} as NodeJS.ProcessEnv;
		const config = resolveBrowserVisionConfig(env);
		expect(config.enabled).toBe(true);
		expect(config.baseUrl).toBe("http://127.0.0.1:9000/v1");
		expect(config.model).toBe("florence-2-base-ft");
		expect(config.prompt).toBe("list the text");
	});
});
