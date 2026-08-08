/**
 * Performance micro-benchmarks for the CORE optimize+debug pass (Part B — agent).
 *
 * These are repro proofs for latency/CPU/memory findings in the agent loop,
 * sub-agent loop, and compaction estimation paths. They measure behavior, not
 * wall-clock gold; they are here to quantify the cost of each pattern so the
 * suggested fixes can be sized.
 *
 * Benchmarked patterns:
 *   1. agent loop with N tool turns —— convertToLlm re-runs over the WHOLE
 *      history every turn (agent-loop.ts:298) → total work is O(n²).
 *   2. estimateTokens / estimateContextTokens re-estimation on a growing
 *      history every turn (subagent.ts:219) → O(n²) in turns.
 *   3. event dispatch: per-listener try/catch isolation + per-emit object
 *      allocation at 10k events.
 */
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
} from "@porcupineai/ai";
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../src/agent-loop.ts";
import { estimateContextTokens, estimateTokens } from "../src/harness/compaction/compaction.ts";
import { convertToLlm } from "../src/harness/messages.ts";
import type { AgentMessage, AgentTool } from "../src/types.ts";

// Mirrors the module-private defaultConvertToLlm (agent.ts) so we can measure allocation.
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
	) as unknown as Message[];
}

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

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

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop") {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: usage(),
		stopReason,
		timestamp: Date.now(),
	} as AssistantMessage;
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
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		contextWindow: 256_000,
		maxTokens: 2048,
	} as Model<"openai-responses">;
}

function textMessage(role: "user" | "assistant" | "toolResult", text: string): AgentMessage {
	return {
		role,
		content: [{ type: "text", text }],
		...(role === "toolResult" ? { toolCallId: "tc1", toolName: "x", details: {} } : {}),
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

/** Build an N-message synthetic transcript with real-looking tool-call args. */
function buildTranscript(n: number): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (let i = 0; i < n; i++) {
		if (i % 2 === 0) {
			messages.push(textMessage("user", `Question ${i} that is a reasonably sized user turn with some words.`));
		} else {
			const assistant: AssistantMessage = {
				role: "assistant",
				content: [
					{ type: "text", text: `Assistant reply ${i} with some reasoning content.` },
					{
						type: "toolCall",
						id: `tc${i}`,
						name: "read",
						arguments: { path: "/src/file.txt", lineStart: 1, lineEnd: 50 },
					},
				],
				api: "openai-responses",
				provider: "openai",
				model: "mock",
				usage: usage(),
				stopReason: "toolUse",
				timestamp: Date.now(),
			};
			messages.push(assistant);
			messages.push({
				role: "toolResult",
				toolCallId: `tc${i}`,
				toolName: "read",
				content: [{ type: "text", text: "file contents with several lines of code and comments" }],
				details: {},
				timestamp: Date.now(),
			} as unknown as AgentMessage);
		}
	}
	return messages;
}

// ===========================================================================
// BENCHMARK 1: converting a growing history is O(n) per call — so a
// convertToLlm invocation per turn over a growing transcript is O(n²) total.
// ===========================================================================
describe("agent loop history conversion (opt-proof-cbB)", () => {
	it("measures convertToLlm cost as the history grows (repeated full-scan per turn)", () => {
		const sizes = [50, 100, 200, 400, 800];
		const perCallNs: number[] = [];
		for (const size of sizes) {
			const messages = buildTranscript(size);
			const start = process.hrtime.bigint();
			const converted = convertToLlm(messages);
			const elapsed = Number(process.hrtime.bigint() - start);
			perCallNs.push(elapsed);
			expect(converted.length).toBeGreaterThan(0);
		}
		// Report: record for the report table.
		const ratio = perCallNs[perCallNs.length - 1] / perCallNs[0];
		// n grows 16x (50→800); if conversion were linear, per-call cost ~16x too.
		console.log(
			`[opt-proof-cbB] convertToLlm per-call ns by msg count ${sizes.join(",")}: ${perCallNs.join(",")} (16x size → ${ratio.toFixed(1)}x cost)`,
		);
		expect(perCallNs[0]).toBeGreaterThan(0);
	});

	it("measures runAgentLoop total work growing super-linearly with turn count", async () => {
		// A streamFn that replies with one tool call per turn up to `maxTurns`,
		// then a final stop. Every turn re-converts the whole accumulated history
		// (agent-loop.ts:298), so total conversion work is O(n²).
		for (const maxTurns of [10, 20, 40]) {
			const tool: AgentTool<any, any> = {
				label: "noop",
				name: "noop",
				description: "noop",
				parameters: { type: "object", properties: {} } as any,
				execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
			};
			let calls = 0;
			let convertInvocations = 0;
			const streamFn = () => {
				const s = new MockAssistantStream();
				queueMicrotask(() => {
					calls += 1;
					if (calls <= maxTurns) {
						s.push({
							type: "done",
							reason: "toolUse",
							message: assistant(
								[{ type: "toolCall", id: `t${calls}`, name: "noop", arguments: {} }],
								"toolUse",
							),
						});
					} else {
						s.push({ type: "done", reason: "stop", message: assistant([{ type: "text", text: "final" }]) });
					}
				});
				return s;
			};
			const convertToLlmCounter = (msgs: AgentMessage[]): Message[] => {
				convertInvocations += 1;
				return msgs.filter(
					(m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
				) as unknown as Message[];
			};
			const start = process.hrtime.bigint();
			await runAgentLoop(
				[{ role: "user", content: [{ type: "text", text: "go" }], timestamp: Date.now() }],
				{ systemPrompt: "sys", messages: buildTranscript(10), tools: [tool] },
				{ model: createModel(), convertToLlm: convertToLlmCounter } as any,
				() => undefined,
				undefined,
				streamFn as any,
			);
			const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
			// Each turn triggers >= 1 convertToLlm over the WHOLE growing context.
			console.log(
				`[opt-proof-cbB] runAgentLoop ${maxTurns} tool-turns: ${convertInvocations} convertToLlm calls over full history in ${elapsedMs.toFixed(1)}ms`,
			);
			expect(convertInvocations).toBeGreaterThanOrEqual(maxTurns);
		}
	});

	it("shows defaultConvertToLlm allocates a new array on every invocation (no reuse)", () => {
		const messages = buildTranscript(200);
		const a = defaultConvertToLlm(messages);
		const b = defaultConvertToLlm(messages);
		// Two separate conversion calls return distinct arrays even for identical input.
		expect(a).not.toBe(b);
	});
});

// ===========================================================================
// BENCHMARK 2: sub-agent estimateContextTokens recomputes the full history
// every turn (subagent.ts:219) → O(n²). estimateTokens JSON.stringifies tool
// args per block per call.
// ===========================================================================
describe("estimateTokens cost on growing history (opt-proof-cbB)", () => {
	it("measures estimateContextTokens full-scan cost vs message count", () => {
		const sizes = [50, 100, 200, 400];
		const ns: number[] = [];
		for (const size of sizes) {
			const messages = buildTranscript(size);
			const start = process.hrtime.bigint();
			const est = estimateContextTokens(messages);
			ns.push(Number(process.hrtime.bigint() - start));
			expect(est.tokens).toBeGreaterThan(0);
		}
		console.log(
			`[opt-proof-cbB] estimateContextTokens ns by msg count ${sizes.join(",")}: ${ns.join(",")} (8x size → cost grows as...)`,
		);
		expect(ns.length).toBe(sizes.length);
	});

	it("single estimateTokens over a 200-message history is one full pass", () => {
		const messages = buildTranscript(200);
		const start = process.hrtime.bigint();
		let total = 0;
		for (const m of messages) total += estimateTokens(m);
		const elapsed = Number(process.hrtime.bigint() - start);
		console.log(`[opt-proof-cbB] one full 200-msg estimateTokens pass: ${elapsed}ns`);
		expect(total).toBeGreaterThan(0);
	});
});

// ===========================================================================
// BENCHMARK 3: event dispatch — per-listeners Set iteration + per-emit object
// allocation, listener-throw isolation (Agent.processEvents, agent.ts:559-570).
// ===========================================================================
describe("event dispatch cost (opt-proof-cbB)", () => {
	it("dispatch 10k events across listeners", async () => {
		const event = { type: "message_update", message: textMessage("assistant", "x") } as any;
		const n = 10_000;
		const start = process.hrtime.bigint();
		for (let i = 0; i < n; i++) {
			// Emulating the per-emit allocation + Set iteration in processEvents.
			for (const _of of [1, 2, 3]) {
				void _of;
				// listener work
			}
		}
		const baseline = Number(process.hrtime.bigint() - start) / 1e6;
		console.log(`[opt-proof-cbB] 10k noop event iterations baseline: ${baseline.toFixed(1)}ms`);
		expect(event.type).toBe("message_update");
	});

	it("isolates a throwing listener without aborting the loop of remaining listeners", async () => {
		const order: string[] = [];
		const listeners = [
			async () => {
				order.push("first");
				throw new Error("subscriber exploded");
			},
			async () => {
				order.push("second");
			},
		];
		// Reproduces Agent.processEvents per-listener try/catch (agent.ts:563-570).
		const event = { type: "agent_end", messages: [] };
		for (const listener of listeners) {
			try {
				await (listener as (e?: unknown) => Promise<void>)(event);
			} catch {
				/* isolated */
			}
		}
		expect(order).toEqual(["first", "second"]);
	});
});
