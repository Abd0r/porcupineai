import {
	type FauxProviderRegistration,
	fauxAssistantMessage,
	fauxToolCall,
	registerFauxProvider,
	streamSimple,
} from "@porcupineai/ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_SUBAGENT_CONTEXT_TOKENS,
	normalizeContextWindow,
	runSubagent,
	SUBAGENT_CONTEXT_WINDOW_MAX,
	SUBAGENT_CONTEXT_WINDOW_MIN,
	type SubagentProgressEvent,
} from "../src/porcupine/subagent.ts";
import { calculateTool } from "./utils/calculate.ts";

const registrations: FauxProviderRegistration[] = [];

function createFauxRegistration(options: Parameters<typeof registerFauxProvider>[0] = {}) {
	const registration = registerFauxProvider(options);
	registrations.push(registration);
	return registration;
}

afterEach(() => {
	while (registrations.length > 0) {
		registrations.pop()?.unregister();
	}
});

describe("runSubagent", () => {
	it("runs a task in an isolated context and returns the final summary", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([fauxAssistantMessage("Done: read the file at src/index.ts and verified it.")]);

		const result = await runSubagent({
			task: "Inspect src/index.ts and report what it does.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [],
			systemPrompt: "You are a sub-agent.",
		});

		expect(result.ok).toBe(true);
		expect(result.budgetExhausted).toBe(false);
		expect(result.summary).toContain("Done");
		expect(result.messages[0]?.role).toBe("user");
		expect(result.messages[result.messages.length - 1]?.role).toBe("assistant");
	});

	it("executes tools with a step counter and reports steps", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("calculate", { expression: "2+2" })]),
			fauxAssistantMessage("The result is 4."),
		]);

		const result = await runSubagent({
			task: "Calculate 2+2 and report the result.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [calculateTool],
			systemPrompt: "You are a sub-agent.",
		});

		expect(result.ok).toBe(true);
		expect(result.steps).toBeGreaterThanOrEqual(1);
		expect(result.summary).toContain("4");
	});

	it("stops gracefully when the step budget is exhausted", async () => {
		const faux = createFauxRegistration();
		// Factory that always requests another tool call → infinite loop unless budgeted.
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("calculate", { expression: "1+1" })]),
			() => fauxAssistantMessage([fauxToolCall("calculate", { expression: "2+2" })]),
			() => fauxAssistantMessage([fauxToolCall("calculate", { expression: "3+3" })]),
			() => fauxAssistantMessage([fauxToolCall("calculate", { expression: "4+4" })]),
			() => fauxAssistantMessage("finally done"),
		]);

		const result = await runSubagent({
			task: "Keep calculating.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [calculateTool],
			systemPrompt: "You are a sub-agent.",
			maxSteps: 2,
		});

		expect(result.ok).toBe(false);
		expect(result.budgetExhausted).toBe(true);
		expect(result.error).toContain("budget");
	});

	it("retries a transient assistant error and returns the subsequent result", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "upstream server error" }),
			fauxAssistantMessage("Recovered after retry."),
		]);

		const result = await runSubagent({
			task: "Retry if the provider is temporarily unavailable.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [],
			systemPrompt: "You are a sub-agent.",
		});

		expect(result.ok).toBe(true);
		expect(result.summary).toContain("Recovered after retry.");
	});

	it("emits start / step / turn / done progress events", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("calculate", { expression: "7*6" })]),
			fauxAssistantMessage("42"),
		]);

		const events: SubagentProgressEvent[] = [];
		await runSubagent({
			task: "Compute 7*6.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [calculateTool],
			systemPrompt: "You are a sub-agent.",
			onProgress: (event) => events.push(event),
		});

		expect(events[0]?.type).toBe("start");
		expect(events.some((event) => event.type === "step")).toBe(true);
		expect(events.some((event) => event.type === "turn")).toBe(true);
		expect(events[events.length - 1]?.type).toBe("done");
	});

	it("respects the context-token budget and reports it in usage", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("calculate", { expression: "1+1" })]),
			fauxAssistantMessage("2"),
		]);

		const result = await runSubagent({
			task: "Compute 1+1.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [calculateTool],
			systemPrompt: "You are a sub-agent.",
			maxContextTokens: 10, // tiny window: any turn busts it
		});

		expect(result.budgetExhausted).toBe(true);
		expect(result.usage.contextTokens).toBeGreaterThan(0);
	});

	it("never starts and reports cancelled when the abort signal is already aborted", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([fauxAssistantMessage("Should never run.")]);

		const result = await runSubagent({
			task: "Do something.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [],
			systemPrompt: "You are a sub-agent.",
			signal: AbortSignal.abort(),
		});

		expect(result.ok).toBe(false);
		expect(result.cancelled).toBe(true);
		expect(result.error).toContain("cancelled");
		expect(result.steps).toBe(0);
	});

	it("cancels a mid-run sub-agent when the abort signal fires", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([fauxAssistantMessage("Done: nothing.")]);

		const controller = new AbortController();
		const run = runSubagent({
			task: "Do something slow.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [],
			systemPrompt: "You are a sub-agent.",
			signal: controller.signal,
		});

		// Abort while the run is in flight; the run must settle as cancelled.
		controller.abort();
		const result = await run;

		expect(result.cancelled).toBe(true);
		expect(result.ok).toBe(false);
	});
});

describe("normalizeContextWindow", () => {
	it("defaults to 256K when unset", () => {
		expect(normalizeContextWindow(undefined)).toBe(DEFAULT_SUBAGENT_CONTEXT_TOKENS);
	});

	it("clamps into the 128K–256K supported range", () => {
		expect(normalizeContextWindow(10_000)).toBe(SUBAGENT_CONTEXT_WINDOW_MIN);
		expect(normalizeContextWindow(500_000)).toBe(SUBAGENT_CONTEXT_WINDOW_MAX);
		expect(normalizeContextWindow(192_000)).toBe(192_000);
	});
});
