import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";

// Offline behavioral acceptance: no model, account credentials, or paid requests.
const listeners = new Set<(event: unknown) => void>();
const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
let busy = false;
let rejectNext = true;
let received = 0;
let confirm: Parameters<ServeApiSession["onConfirm"]>[0] | undefined;
const emit = (event: unknown) => {
	for (const listener of listeners) listener(event);
};
const session: ServeApiSession = {
	id: "workspace-one",
	async sendUserMessage(text) {
		received++;
		if (rejectNext) {
			rejectNext = false;
			throw new Error("Synthetic send failure");
		}
		busy = true;
		messages.push({ role: "user", content: text });
		emit({ type: "agent_start" });
		emit({ type: "message_end", message: messages.at(-1) });
	},
	async abort() {
		busy = false;
		emit({ type: "agent_end" });
	},
	isStreaming: () => busy,
	getTranscript: () => messages,
	onEvent: (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	onConfirm: (handler) => {
		confirm = handler;
		return () => {
			confirm = undefined;
		};
	},
	getControls: () => ({
		interactionMode: "normal",
		reasoningMode: "medium",
		availableReasoningModes: ["off", "medium", "high"],
		busy,
		model: { provider: "faux", id: "test", name: "Local test model" },
	}),
	getGoalPlan: () => ({ goal: null }),
};
const other: ServeApiSession = {
	...session,
	id: "workspace-two",
	onConfirm: () => () => {},
	onEvent: () => () => {},
	getTranscript: () => [{ role: "user", content: "A separate conversation" }],
};
const server = await startServeApi({
	session,
	sessions: [other],
	token: "synthetic-local-token",
	port: 0,
	listSessions: async () => [{ id: "saved-session", name: "Saved Porcupine investigation" }],
	openSession: async (id) => ({
		...other,
		id,
		getTranscript: () => [{ role: "assistant", content: "Restored saved session" }],
	}),
});
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
	page.setDefaultTimeout(6000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`http://127.0.0.1:${server.port()}`);
	await page.locator("#token").fill("synthetic-local-token");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	assert.equal(await page.locator(".permission[data-resolved='true']").count(), 0);
	const shot = async (name: string) => {
		if (process.env.WORKBENCH_QA_SCREENSHOTS)
			await page.screenshot({ path: join(process.env.WORKBENCH_QA_SCREENSHOTS, name), animations: "disabled" });
	};
	assert.equal(await page.locator("#agent-inspector").count(), 0);
	assert.equal(await page.locator("#send").isEnabled(), false);
	await shot("workbench-welcome.png");
	await page.getByRole("button", { name: "Fix something broken", exact: false }).click();
	const prompt = page.locator("#prompt");
	assert.match(await prompt.inputValue(), /debug/);
	await prompt.fill("Repair the workbench and verify it.");
	await prompt.press("Enter");
	await page.getByRole("alert").filter({ hasText: "Synthetic send failure" }).waitFor();
	assert.equal(
		await prompt.inputValue(),
		"Repair the workbench and verify it.",
		"Failed submission must preserve the draft",
	);
	await prompt.press("Enter");
	await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
	const answer =
		"## Findings\n\nThe event stream is **working**. The agent is still running.\n\n```ts\nconst verified = true;\n```\n\n| Check | Result |\n| --- | --- |\n| Session state | Verified |";
	messages.push({ role: "assistant", content: answer });
	emit({ type: "message_end", message: messages.at(-1) });
	await page.locator(".code-block").waitFor();
	assert.equal(
		await page.locator("#stop").isVisible(),
		true,
		"Assistant message end must not settle a tool-using agent turn",
	);
	await prompt.fill("Draft for later");
	await prompt.press("Enter");
	assert.equal(received, 2, "Enter while busy must not submit a second turn");
	assert.equal(await prompt.inputValue(), "Draft for later");
	emit({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: { path: "README.md" } });
	emit({
		type: "tool_execution_end",
		toolCallId: "read-1",
		toolName: "read",
		result: { content: [{ type: "text", text: "# PorcupineAI" }] },
		isError: false,
	});
	emit({
		type: "goal_plan",
		status: {
			goal: {
				objective: "Repair the workbench",
				status: "active",
				steps: [{ objective: "Verify the interaction", status: "active" }],
			},
		},
	});
	emit({
		type: "subagents",
		runs: [
			{ id: "buck", name: "buck", task: "Run the focused checks", status: "running", steps: 1, lastTool: "bash" },
		],
	});
	await page.locator("#todos-panel").filter({ hasText: "Repair the workbench" }).waitFor({ state: "attached" });
	await page.locator(".worker").filter({ hasText: "@buck" }).waitFor({ state: "attached" });
	assert.equal(await page.locator(".tool-activity").getByText("Done", { exact: true }).count(), 1);
	assert.equal(await page.locator("#feed .worker").count(), 0);
	assert.equal(await page.locator(".worker details").count(), 0);
	if (await page.locator("#todos-panel").isHidden()) await page.locator("#rail-toggle").click();

	await shot("workbench-agent-workspace.png");
	await page.locator("#stop").click();
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	assert.equal(await page.locator(".thinking-live").count(), 0);

	emit({ type: "agent_start" });
	emit({
		type: "message_update",
		message: {
			role: "assistant",
			content: [{ type: "thinking", thinking: "Compare the evidence before answering." }],
		},
	});
	emit({
		type: "message_end",
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Compare the evidence before answering." },
				{ type: "text", text: "Evidence compared." },
			],
		},
	});
	emit({ type: "agent_end" });
	await page.locator(".message-body").filter({ hasText: "Evidence compared." }).waitFor();
	await page.locator(".thinking-head").last().click();
	assert.equal(await page.locator(".thinking-body").last().innerText(), "Compare the evidence before answering.");
	const beforeComposition = received;
	await prompt.dispatchEvent("keydown", { key: "Enter", isComposing: true });
	assert.equal(received, beforeComposition, "IME confirmation must not submit a message");
	for (let index = 0; index < 20; index++) {
		const message = {
			role: "assistant" as const,
			content: `Recorded result ${index}. ${"Evidence from the local run. ".repeat(12)}`,
		};
		messages.push(message);
		emit({ type: "message_end", message });
	}
	await page.locator("#feed").evaluate((element) => {
		element.scrollTop = 0;
	});
	await page.locator("#jump-latest").waitFor();
	const later = { role: "assistant" as const, content: "New output while reading earlier work." };
	messages.push(later);
	emit({ type: "message_end", message: later });
	await page.locator(".message-body").filter({ hasText: later.content }).waitFor({ state: "attached" });
	assert.equal(
		await page.locator("#feed").evaluate((element) => element.scrollTop),
		0,
		"New output must not steal the reading position",
	);
	const reconnected = page.waitForResponse((response) => response.url().endsWith("/workspace-one/events"));
	await page.locator("#reconnect").evaluate((button) => (button as HTMLButtonElement).click());
	await reconnected;
	await page.locator(".message.restored").last().waitFor({ state: "attached" });
	assert.equal(
		await page.locator("#feed").evaluate((element) => element.scrollTop),
		0,
		"Reconnecting must preserve the reading position",
	);
	await page.locator(".session[title='workspace-two']").click();
	await page.locator(".message-body").filter({ hasText: "A separate conversation" }).waitFor();
	await page.locator(".session[title='workspace-one']").click();
	await page.locator(".message.restored").last().waitFor({ state: "attached" });
	assert.equal(
		await page.locator("#feed").evaluate((element) => element.scrollTop),
		0,
		"Returning to a conversation must preserve the reading position",
	);
	await page.locator("#jump-latest").click();
	await page.waitForFunction(() => {
		const feed = document.getElementById("feed")!;
		return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 100;
	});
	await page.locator(".session[title='workspace-two']").click();
	await page.locator(".message-body").filter({ hasText: "A separate conversation" }).waitFor();
	await page.locator(".session[title='workspace-one']").click();
	await page.locator(".code-block").waitFor({ state: "attached" });
	assert.equal(await prompt.inputValue(), "Draft for later", "Switching sessions must preserve each draft");
	let decision: boolean | undefined;
	confirm!({ id: "pending-1", title: "Run local verification?", message: "node verify.js" }, (allow) => {
		decision = allow;
	});
	await page.locator(".permission").waitFor();
	await page.reload();
	await page.locator("#token").fill("synthetic-local-token");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.locator(".permission").waitFor();
	await page.getByRole("button", { name: "Allow", exact: true }).click();
	assert.equal(decision, true, "Pending approval must survive client reconnection");
	await page.locator(".permission[data-resolved='true']").getByText("Allowed", { exact: true }).waitFor();
	await page.locator(".code-block").waitFor();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByRole("tab", { name: "Limits", exact: true }).click();
	assert.equal(await page.locator("#limit-compact").isVisible(), true);
	assert.equal(await page.locator("#appearance-theme").isVisible(), false);
	await page.getByRole("tab", { name: "Appearance", exact: true }).click();
	await shot("workbench-settings.png");
	await page.getByRole("button", { name: "Close settings" }).click();
	let releaseLimits: (() => void) | undefined;
	const limitsGate = new Promise<void>((resolve) => {
		releaseLimits = resolve;
	});
	let limitsRequested = false;
	await page.route("**/session/workspace-one/context", async (route) => {
		if (route.request().method() !== "POST") {
			await route.continue();
			return;
		}
		limitsRequested = true;
		await limitsGate;
		await route.fulfill({
			json: {
				supported: true,
				tokens: 1,
				contextWindow: 1000,
				percent: 0.1,
				compactAtPercent: 91,
				maxSubagents: 7,
				reserveTokens: 90,
			},
		});
	});
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByRole("tab", { name: "Limits", exact: true }).click();
	const limitsRequest = page.waitForRequest(
		(request) => request.method() === "POST" && request.url().endsWith("/context"),
	);
	await page.locator("#limits-apply").click();
	await limitsRequest;
	assert.ok(limitsRequested);
	await page.getByRole("button", { name: "Close settings" }).click();
	await page.locator(".session[title='workspace-two']").click();
	await page.locator(".message-body").filter({ hasText: "A separate conversation" }).waitFor();
	const limitsResponse = page.waitForResponse(
		(response) => response.request().method() === "POST" && response.url().endsWith("/context"),
	);
	releaseLimits!();
	await limitsResponse;
	await page.waitForFunction(() => !(document.getElementById("limits-apply") as HTMLButtonElement).disabled);
	assert.equal(
		await page.locator("#context-ring").isHidden(),
		true,
		"An old settings response must not populate another session",
	);
	await page.getByRole("button", { name: "Saved Porcupine investigation", exact: true }).click();
	await page.locator(".message-body").filter({ hasText: "Restored saved session" }).waitFor();
	assert.equal(await page.locator(".session.active").getAttribute("title"), "saved-session");
	let releaseModels: (() => void) | undefined;
	const modelsGate = new Promise<void>((resolve) => {
		releaseModels = resolve;
	});
	let modelLoads = 0;
	await page.route("**/session/saved-session/models", async (route) => {
		modelLoads++;
		const first = modelLoads === 1;
		if (first) await modelsGate;
		await route.fulfill({
			json: {
				supported: true,
				current: null,
				subagentModel: null,
				models: [
					{
						provider: "faux",
						id: first ? "old" : "new",
						name: first ? "Stale model list" : "Current model list",
						contextWindow: 1000,
						reasoning: true,
					},
				],
			},
		});
	});
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByRole("tab", { name: "Models", exact: true }).click();
	const firstModelsRequest = page.waitForRequest((request) => request.url().endsWith("/models"));
	await page.locator("#model-default-open").click();
	await firstModelsRequest;
	await page.getByRole("button", { name: "Close model picker" }).click();
	await page.locator("#model-subagent-open").click();
	await page.locator(".model-name").filter({ hasText: "Current model list" }).waitFor();
	const staleModelsResponse = page.waitForResponse((response) => response.url().endsWith("/models"));
	releaseModels!();
	await staleModelsResponse;
	await page.evaluate(() => new Promise(requestAnimationFrame));
	assert.equal(
		await page.locator(".model-name").innerText(),
		"Current model list",
		"An older model request must not overwrite the current picker",
	);
	await page.getByRole("button", { name: "Close model picker" }).click();
	await page.getByRole("button", { name: "Close settings" }).click();
	for (const width of [1440, 1100, 700, 390]) {
		await page.setViewportSize({ width, height: 900 });
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		assert.ok(
			await page
				.locator("#prompt-form")
				.evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight),
		);
	}
	await page.locator("#sidebar-toggle").click();
	assert.equal(await page.locator("#sidebar").isVisible(), true);
	assert.equal(await page.locator("#sidebar").evaluate((element) => (element as HTMLElement).inert), false);
	await page.keyboard.press("Escape");
	assert.equal(await page.locator("#sidebar").evaluate((element) => (element as HTMLElement).inert), true);
	assert.deepEqual(errors, []);
	console.log(
		"PASS draft recovery, busy guard, rich transcript restoration, approvals on reconnect, inline execution order, settings tabs, responsive navigation",
	);
} finally {
	await browser.close();
	await server.close();
}
