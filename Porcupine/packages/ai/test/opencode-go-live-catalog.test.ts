import { describe, expect, it } from "vitest";
import { OPENCODE_GO_MODELS } from "../src/providers/opencode-go.models.ts";
import { overlayOpenCodeGoCatalog } from "../src/providers/opencode-go.ts";
import type { Model } from "../src/types.ts";

type GoApi = "anthropic-messages" | "openai-completions" | "openai-responses";

const baseline = Object.values(OPENCODE_GO_MODELS) as Model<GoApi>[];

describe("OpenCode Go live catalog overlay", () => {
	it("keeps pinned metadata for known ids and synthesizes new live ids", () => {
		const live = ["deepseek-v4-flash", "muse-spark-1.2-contributor", "glm-5.3"];
		const overlay = overlayOpenCodeGoCatalog(live, baseline);
		expect(overlay.map((model) => model.id)).toEqual(live);
		expect(overlay[0]).toMatchObject({
			id: "deepseek-v4-flash",
			api: "openai-completions",
			provider: "opencode-go",
		});
		expect(overlay.find((model) => model.id === "muse-spark-1.2-contributor")).toMatchObject({
			id: "muse-spark-1.2-contributor",
			api: "openai-responses",
			provider: "opencode-go",
			baseUrl: "https://opencode.ai/zen/go/v1",
		});
	});

	it("returns the pinned catalog when the live list is empty", () => {
		const overlay = overlayOpenCodeGoCatalog([], baseline);
		expect(overlay.map((model) => model.id)).toEqual(baseline.map((model) => model.id));
	});
});
