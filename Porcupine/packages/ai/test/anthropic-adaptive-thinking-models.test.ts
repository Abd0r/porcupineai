import { describe, expect, it } from "vitest";
import { getModels, getProviders } from "../src/compat.ts";
import type { Api, Model } from "../src/types.ts";

const ADAPTIVE_THINKING_ID = /(opus[-.](4[-.][678]|5)|sonnet[-.]4[-.]6|sonnet[-.]5|fable[-.]5|kimi-coding\/)/;

const EXPECTED_ADAPTIVE_THINKING_FAMILIES = [
	"anthropic/claude-fable-5",
	"anthropic/claude-opus-4",
	"anthropic/claude-opus-5",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-sonnet-5",
	"cloudflare-ai-gateway/claude-fable-5",
	"cloudflare-ai-gateway/claude-opus-4",
	"cloudflare-ai-gateway/claude-opus-5",
	"cloudflare-ai-gateway/claude-sonnet-4",
	"cloudflare-ai-gateway/claude-sonnet-5",
	"github-copilot/claude-opus-4",
	"github-copilot/claude-opus-5",
	"github-copilot/claude-sonnet-4",
	"github-copilot/claude-sonnet-5",
	"kimi-coding/",
	"opencode/claude-fable-5",
	"opencode/claude-opus-4",
	"opencode/claude-opus-5",
	"opencode/claude-sonnet-4",
	"opencode/claude-sonnet-5",
	"vercel-ai-gateway/anthropic/claude-fable-5",
	"vercel-ai-gateway/anthropic/claude-opus-4",
	"vercel-ai-gateway/anthropic/claude-opus-5",
	"vercel-ai-gateway/anthropic/claude-sonnet-4",
	"vercel-ai-gateway/anthropic/claude-sonnet-5",
];

function getAllModels(): Model<Api>[] {
	return getProviders().flatMap((provider) => getModels(provider) as Model<Api>[]);
}

function normalizeAdaptiveId(modelId: string): string {
	return modelId.replace(/[-.](?=\d)/g, "-");
}

describe("Anthropic adaptive thinking model metadata", () => {
	it("marks built-in Anthropic Messages models that use adaptive thinking", () => {
		const flaggedModels = getAllModels()
			.filter((model): model is Model<"anthropic-messages"> => model.api === "anthropic-messages")
			.filter((model) => model.compat?.forceAdaptiveThinking === true)
			.map((model) => `${model.provider}/${model.id}`)
			.sort();

		// Families, not exact catalog spellings: hyphen vs dotted ids drift
		// between local pinned JSON and a freshly generated CI catalog.
		for (const family of EXPECTED_ADAPTIVE_THINKING_FAMILIES) {
			expect(flaggedModels.some((id) => normalizeAdaptiveId(id).includes(family.replace(/[-.](?=\d)/g, "-")))).toBe(
				true,
			);
		}
		expect(flaggedModels.length).toBeGreaterThan(0);
		expect(flaggedModels).toEqual(flaggedModels.filter((modelId) => ADAPTIVE_THINKING_ID.test(modelId)));
	});
});
