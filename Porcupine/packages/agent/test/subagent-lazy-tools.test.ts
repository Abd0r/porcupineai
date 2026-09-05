import {
	type FauxProviderRegistration,
	fauxAssistantMessage,
	fauxToolCall,
	registerFauxProvider,
	streamSimple,
} from "@porcupineai/ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { runSubagent } from "../src/porcupine/subagent.ts";
import type { AgentTool } from "../src/types.ts";
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

const noteSchema = Type.Object({ text: Type.String() });

function noteTool(): AgentTool<typeof noteSchema, { text: string }> {
	return {
		name: "note",
		label: "Note",
		description: "Record a note",
		parameters: noteSchema,
		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text", text: `noted:${params.text}` }],
				details: { text: params.text },
			};
		},
	};
}

function toolResultTexts(result: { messages: Array<{ role: string; content?: unknown }> }): string {
	return result.messages
		.filter((m) => m.role === "toolResult")
		.flatMap((m) => {
			const content = (m.content ?? []) as Array<{ type: string; text?: string }>;
			return content.filter((c) => c.type === "text").map((c) => c.text ?? "");
		})
		.join("\n");
}

describe("runSubagent lazy tools", () => {
	it("executes a dormant pool tool on attempted call", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("note", { text: "hi" })]),
			fauxAssistantMessage("Done: recorded the note."),
		]);

		const result = await runSubagent({
			task: "Record a note.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [calculateTool],
			lazyTools: [noteTool()],
			systemPrompt: "You are a sub-agent.",
		});

		expect(result.ok).toBe(true);
		expect(toolResultTexts(result)).toContain("noted:hi");
		expect(result.summary).toContain("Done");
	});

	it("resolves dotted guesses against the pool", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("default.note", { text: "hi" })]),
			fauxAssistantMessage("Done."),
		]);

		const result = await runSubagent({
			task: "Record a note.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [calculateTool],
			lazyTools: [noteTool()],
			systemPrompt: "You are a sub-agent.",
		});

		expect(result.ok).toBe(true);
		expect(toolResultTexts(result)).toContain("noted:hi");
	});

	it("keeps the generic not-found error outside the pool", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("nope", { text: "hi" })]),
			fauxAssistantMessage("Done without tools."),
		]);

		const result = await runSubagent({
			task: "Try something.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [calculateTool],
			lazyTools: [noteTool()],
			systemPrompt: "You are a sub-agent.",
		});

		expect(result.ok).toBe(true);
		expect(toolResultTexts(result)).toContain("Tool nope not found");
	});

	it("counts lazy tool calls against the step budget", async () => {
		const faux = createFauxRegistration();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("note", { text: "one" })]),
			fauxAssistantMessage([fauxToolCall("note", { text: "two" })]),
			fauxAssistantMessage("Done."),
		]);

		const result = await runSubagent({
			task: "Record two notes.",
			model: faux.getModel(),
			streamFn: streamSimple,
			tools: [],
			lazyTools: [noteTool()],
			systemPrompt: "You are a sub-agent.",
			maxSteps: 1,
		});

		expect(toolResultTexts(result)).toContain("noted:one");
		expect(toolResultTexts(result)).toContain("step budget exceeded");
		expect(result.budgetExhausted).toBe(true);
	});
});
