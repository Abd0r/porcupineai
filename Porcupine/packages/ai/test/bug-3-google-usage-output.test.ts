// Regression: BUG-3 — the Gemini Google AI adapter double-counted thinking tokens
// in usage.output by adding thoughtsTokenCount to candidatesTokenCount. On this API
// candidatesTokenCount already includes thinking tokens, so output must equal
// candidatesTokenCount alone. (Vertex AI is intentionally unchanged.)
import { describe, expect, it, vi } from "vitest";

vi.mock("@google/genai", () => {
	class GoogleGenAI {
		models = {
			generateContentStream: async function* () {
				yield {
					responseId: "google-response-id",
					candidates: [{ finishReason: "STOP" }],
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 100,
						thoughtsTokenCount: 40,
						totalTokenCount: 150,
					},
				};
			},
		};
	}

	return {
		FinishReason: {
			STOP: "STOP",
			MAX_TOKENS: "MAX_TOKENS",
			BLOCKLIST: "BLOCKLIST",
			PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
			SPII: "SPII",
			SAFETY: "SAFETY",
			IMAGE_SAFETY: "IMAGE_SAFETY",
			IMAGE_PROHIBITED_CONTENT: "IMAGE_PROHIBITED_CONTENT",
			IMAGE_RECITATION: "IMAGE_RECITATION",
			IMAGE_OTHER: "IMAGE_OTHER",
			RECITATION: "RECITATION",
			FINISH_REASON_UNSPECIFIED: "FINISH_REASON_UNSPECIFIED",
			OTHER: "OTHER",
			LANGUAGE: "LANGUAGE",
			MALFORMED_FUNCTION_CALL: "MALFORMED_FUNCTION_CALL",
			UNEXPECTED_TOOL_CALL: "UNEXPECTED_TOOL_CALL",
			NO_IMAGE: "NO_IMAGE",
		},
		FunctionCallingConfigMode: {
			AUTO: "AUTO",
			NONE: "NONE",
			ANY: "ANY",
			VALIDATED: "VALIDATED",
		},
		GoogleGenAI,
		ResourceScope: {
			COLLECTION: "COLLECTION",
		},
		ThinkingLevel: {
			THINKING_LEVEL_UNSPECIFIED: "THINKING_LEVEL_UNSPECIFIED",
			MINIMAL: "MINIMAL",
			LOW: "LOW",
			MEDIUM: "MEDIUM",
			HIGH: "HIGH",
		},
	};
});

import { stream as streamGoogleGenerativeAi } from "../src/api/google-generative-ai.ts";
import { getModel } from "../src/compat.ts";
import type { Context } from "../src/types.ts";

const context: Context = {
	messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

describe("Gemini Google AI output usage (thinking not double-counted)", () => {
	it("counts output as candidatesTokenCount only (which already includes thinking)", async () => {
		const stream = streamGoogleGenerativeAi(getModel("google", "gemini-2.5-flash"), context, {
			apiKey: "test-api-key",
		});

		const message = await stream.result();
		const usage = message.usage!;

		// candidatesTokenCount=100, thoughtsTokenCount=40. Before the fix output was 140.
		expect(usage.output).toBe(100);
		// Reasoning is still reported from thoughtsTokenCount on its own.
		expect(usage.reasoning).toBe(40);
	});
});
