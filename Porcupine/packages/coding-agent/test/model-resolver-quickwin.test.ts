import type { Model } from "@porcupineai/ai";
import { describe, expect, test } from "vitest";
import { defaultModelPerProvider, findInitialModel } from "../src/core/model-resolver.ts";

const FREE_CLINE_MODEL_ID = "deepseek/deepseek-v4-flash";

const freeClineModel: Model<"openai-completions"> = {
	id: FREE_CLINE_MODEL_ID,
	name: "DeepSeek V4 Flash (Cline, free)",
	api: "openai-completions",
	provider: "cline",
	baseUrl: "https://cli.example.invalid",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256000,
	maxTokens: 64000,
};

describe("model-resolver quick win: free cline default", () => {
	test("defaultModelPerProvider tracks the free cline model", () => {
		expect(defaultModelPerProvider.cline).toBe(FREE_CLINE_MODEL_ID);
	});

	test("findInitialModel resolves the free cline model when cline is the first available provider", async () => {
		const registry = {
			getAvailable: async () => [freeClineModel],
		} as unknown as Parameters<typeof findInitialModel>[0]["modelRuntime"];

		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			modelRuntime: registry,
		});

		expect(result.model?.provider).toBe("cline");
		expect(result.model?.id).toBe(FREE_CLINE_MODEL_ID);
	});
});
