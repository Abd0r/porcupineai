/**
 * Sub-agent compaction (sub-agent style): when the estimated context crosses
 * the 80% threshold, runSubagent summarizes the conversation with its own
 * model, keeps the recent tail, and continues — instead of hard-stopping.
 */
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	type Model,
} from "@porcupineai/ai";
import { describe, expect, it } from "vitest";
import { runSubagent, type SubagentProgressEvent } from "../src/porcupine/subagent.ts";

function usage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistant(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: usage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createModel() {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	} as Model<"openai-responses">;
}

function makeStream(message: AssistantMessage): EventStream<AssistantMessageEvent, AssistantMessage> {
	void message;
	const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
		(event) => event.type === "done" || event.type === "error",
		(event) => {
			if (event.type === "done") return event.message;
			if (event.type === "error") return event.error;
			throw new Error("Unexpected event type");
		},
	);
	queueMicrotask(() => {
		stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}

describe("runSubagent compaction", () => {
	it("summarizes + continues instead of hard-stopping at the context threshold", async () => {
		const progress: SubagentProgressEvent[] = [];
		let streamCalls = 0;
		// Turn 1 answers with a LARGE text so the second turn's context estimate
		// crosses 80% of a deliberately small window (maxContextTokens 4000).
		const longText = "x".repeat(20_000);

		const streamFn = async (
			model: Model<any>,
			context: Context,
		): Promise<EventStream<AssistantMessageEvent, AssistantMessage>> => {
			void model;
			streamCalls += 1;
			if ((context.systemPrompt ?? "").toLowerCase().includes("summarizing")) {
				// The compaction summary call: reply with a short summary.
				return makeStream(assistant("SUMMARY: task about X, did Y, saw Z.", "stop"));
			}
			if (streamCalls === 1) {
				return makeStream(assistant(longText, "stop"));
			}
			// Second (post-compaction) segment: final answer.
			return makeStream(assistant("DONE after compaction.", "stop"));
		};

		const result = await runSubagent({
			task: "research thing",
			notes: undefined,
			systemPrompt: "subagent system prompt for compaction test",
			tools: [],
			model: createModel(),
			maxSteps: 10,
			maxContextTokens: 4000,
			streamFn,
			onProgress: (event) => progress.push(event),
		});

		// A compaction pass happened and the run still completed successfully.
		expect(progress.some((e) => e.type === "compacting")).toBe(true);
		expect(result.ok).toBe(true);
		expect(streamCalls).toBeGreaterThanOrEqual(3); // turn1 + summary + final
		// The full transcript (both segments) is preserved in the result.
		const full = result.messages.map((m) => (m.role === "assistant" ? JSON.stringify(m.content).length : 0));
		expect(full.reduce((a, b) => a + b, 0)).toBeGreaterThan(12_000);
		// The final summary reflects the last segment's answer.
		expect(result.summary).toContain("DONE after compaction.");
	});

	it("never compacts when the context stays under the threshold", async () => {
		const progress: SubagentProgressEvent[] = [];
		const streamFn = async (): Promise<EventStream<AssistantMessageEvent, AssistantMessage>> =>
			makeStream(assistant("small answer", "stop"));
		const result = await runSubagent({
			task: "t",
			notes: undefined,
			systemPrompt: "s",
			tools: [],
			model: createModel(),
			maxSteps: 10,
			maxContextTokens: 256_000,
			streamFn,
			onProgress: (event) => progress.push(event),
		});
		expect(progress.some((e) => e.type === "compacting")).toBe(false);
		expect(result.ok).toBe(true);
	});
});
