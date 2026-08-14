import { Agent } from "@porcupineai/agent-core";
import { type AssistantMessage, getModel, streamSimple, type Usage } from "@porcupineai/ai/compat";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { formatCostSummary, formatUsageTable, SessionUsageTracker } from "../src/core/session-usage.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

function createUsage(input: number, output = 0): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistantMessage(text: string, totalTokens: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(totalTokens),
		stopReason: "stop",
		timestamp,
	};
}

function createUserMessage(text: string, timestamp: number) {
	return { role: "user" as const, content: text, timestamp };
}

async function createSession() {
	const settingsManager = SettingsManager.inMemory();
	const sessionManager = SessionManager.inMemory();
	const authStorage = AuthStorage.inMemory();
	await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			streamFn: streamSimple,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant.",
				tools: [],
				thinkingLevel: "high",
			},
		}),
		sessionManager,
		settingsManager,
		cwd: process.cwd(),
		modelRuntime: getModelRuntime(await createInMemoryModelRegistry(authStorage)),
		resourceLoader: createTestResourceLoader(),
	});

	return { session, sessionManager };
}

function syncAgentMessages(session: AgentSession, sessionManager: SessionManager): void {
	session.agent.state.messages = sessionManager.buildSessionContext().messages;
}

describe("SessionUsageTracker", () => {
	it("accumulates totals and per-turn counts across recorded turns", () => {
		const tracker = new SessionUsageTracker();
		tracker.record(createUsage(100, 20));
		tracker.record(createUsage(300, 50), { provider: "anthropic", model: "claude-sonnet-4-5" });

		expect(tracker.turnCount).toBe(2);
		const totals = tracker.getTotals();
		expect(totals.input).toBe(400);
		expect(totals.output).toBe(70);
		expect(totals.cost).toBe(0);

		const perModel = tracker.getPerModel();
		// Tool/summary turn (no model) grouped separately from the attributed model.
		expect(perModel).toHaveLength(2);
	});

	it("resets to an empty, zero-cost state", () => {
		const tracker = new SessionUsageTracker();
		tracker.record(createUsage(100));
		tracker.reset();

		expect(tracker.turnCount).toBe(0);
		expect(tracker.getTotals()).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
		});
	});

	it("adds cost from the usage record when present", () => {
		const tracker = new SessionUsageTracker();
		const usage = createUsage(100, 50);
		usage.totalTokens = 150;
		usage.cost = { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 };
		tracker.record(usage, { provider: "anthropic", model: "claude-sonnet-4-5" });

		const totals = tracker.getTotals();
		expect(totals.cost).toBeCloseTo(0.3, 10);
	});

	it("populates the disjoint cache split from named provider fields", () => {
		const tracker = new SessionUsageTracker();
		const usage = createUsage(100, 20);
		// The provider reports the split explicitly; the short cacheRead/cacheWrite fields
		// are left at their defaults to prove the named views are honored independently.
		usage.cacheReadTokens = 40;
		usage.cacheWriteTokens = 10;
		tracker.record(usage, { provider: "anthropic", model: "claude-sonnet-4-5" });

		const turn = tracker.turns[0];
		const totals = tracker.getTotals();
		// Disjoint: uncached input stays separate from cache-read and cache-write.
		expect(turn.input).toBe(100);
		expect(turn.output).toBe(20);
		expect(turn.cacheRead).toBe(40);
		expect(turn.cacheWrite).toBe(10);
		expect(totals.input).toBe(100);
		expect(totals.cacheRead).toBe(40);
		expect(totals.cacheWrite).toBe(10);
	});

	it("falls back to canonical cacheRead/cacheWrite fields when named views are absent", () => {
		const tracker = new SessionUsageTracker();
		const usage = createUsage(100);
		usage.cacheRead = 30;
		usage.cacheWrite = 5;
		tracker.record(usage);
		const totals = tracker.getTotals();
		expect(totals.cacheRead).toBe(30);
		expect(totals.cacheWrite).toBe(5);
	});
});

describe("AgentSession /usage and /cost rendering", () => {
	it("renderUsageCommand reports per-turn totals", async () => {
		const { session, sessionManager } = await createSession();
		try {
			sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendMessage(createAssistantMessage("hi", 200, 2));
			syncAgentMessages(session, sessionManager);

			const output = session.renderUsageCommand();
			expect(output).toContain("Input");
			expect(output).toContain("Output");
			expect(output).toContain("TOTAL");
			expect(output).toContain("Turns: 1");
		} finally {
			session.dispose();
		}
	});

	it("renderCostCommand renders an estimate when model cost data is present", async () => {
		const { session, sessionManager } = await createSession();
		try {
			const msg = createAssistantMessage("hi", 200, 2);
			msg.usage.cost = { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 };
			sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendMessage(msg);
			syncAgentMessages(session, sessionManager);
			session.sessionUsageTotals; // force rebuild from persisted entries

			const output = session.renderCostCommand();
			expect(output).toContain("estimate");
			// Cost present for the model attributed turn.
			expect(output).toContain("$0.30");
		} finally {
			session.dispose();
		}
	});
});

describe("formatCostSummary", () => {
	it("marks cost n/a when no model cost config exists", () => {
		const tracker = new SessionUsageTracker();
		tracker.record(createUsage(100, 20), { provider: "anthropic", model: "claude-sonnet-4-5" });
		const totals = tracker.getTotals();
		const perModel = tracker.getPerModel().map((entry) => ({
			key: `${entry.provider}/${entry.model}`,
			cost: entry.cost,
			tokens: entry.input + entry.output + entry.cacheRead + entry.cacheWrite,
		}));

		const output = formatCostSummary(totals, perModel, totals.cost > 0);
		expect(output).toContain("cost: n/a");
		expect(output).toContain("Input: 100");
		expect(output).toContain("Output: 20");
	});

	it("renders estimate with per-model breakdown when cost is available", () => {
		const tracker = new SessionUsageTracker();
		const usage = createUsage(100, 50);
		usage.cost = { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 };
		tracker.record(usage, { provider: "anthropic", model: "claude-sonnet-4-5" });
		const totals = tracker.getTotals();
		const perModel = tracker.getPerModel().map((entry) => ({
			key: `${entry.provider}/${entry.model}`,
			cost: entry.cost,
			tokens: entry.input + entry.output + entry.cacheRead + entry.cacheWrite,
		}));

		const output = formatCostSummary(totals, perModel, totals.cost > 0);
		expect(output).toContain("estimate");
		expect(output).toContain("anthropic/claude-sonnet-4-5: $0.3000");
	});
});

describe("formatUsageTable disjoint split surface", () => {
	it("renders uncached input, cache read, and cache write as separate columns", () => {
		const tracker = new SessionUsageTracker();
		const usage = createUsage(100, 20);
		usage.cacheReadTokens = 40;
		usage.cacheWriteTokens = 10;
		tracker.record(usage, { provider: "anthropic", model: "claude-sonnet-4-5" });
		const totals = tracker.getTotals();
		tracker.getPerModel();
		const output = formatUsageTable(tracker.turns, totals, tracker.turnCount, 170);

		// Headers clearly separate the disjoint buckets.
		expect(output).toContain("Cache Rd");
		expect(output).toContain("Cache Wr");
		// Uncached input (100) appears disjoint from cache read (40) and cache write (10).
		expect(output).toContain("100");
		expect(output).toContain("40");
		expect(output).toContain("10");
	});
});
