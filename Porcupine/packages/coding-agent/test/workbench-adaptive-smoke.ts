import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createVisualizeToolDefinition } from "../src/core/tools/visualize.ts";
import { startServeApi } from "../src/server/http-api.ts";
import type { WorkbenchReplayEvent } from "../src/server/workbench-transcript.ts";
import { workspaceExamples } from "./adaptive-workspace-fixtures.ts";

const listeners = new Set<(event: unknown) => void>();
const timeline: WorkbenchReplayEvent[] = [];
const received: string[] = [];
const emit = (event: unknown) => {
	for (const listener of listeners) listener(event);
};
const api = await startServeApi({
	port: 0,
	token: "adaptive-smoke",
	session: {
		id: "adaptive",
		getTimeline: () => timeline,
		async sendUserMessage(text) {
			received.push(text);
			const event = { type: "message_end", message: { role: "user", content: text } } as const;
			timeline.push(event);
			emit(event);
			emit({ type: "agent_end" });
		},
		async abort() {},
		isStreaming: () => false,
		onEvent(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		onConfirm() {
			return () => {};
		},
	},
});
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
	const errors: string[] = [];
	page.on("pageerror", (error) => {
		errors.push(error.message);
		console.error(error.message);
	});
	async function login() {
		await page.locator("#token").fill("adaptive-smoke");
		await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
		await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	}
	await page.goto(`http://127.0.0.1:${api.port()}/#token=adaptive-smoke`);
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	assert.equal(new URL(page.url()).hash, "", "GUI launch token must be removed from the address bar");
	for (const example of workspaceExamples) {
		const result = await createVisualizeToolDefinition().execute(
			`adaptive-${example.kind}`,
			{ ...example, title: example.kind, componentId: example.kind } as never,
			undefined,
			undefined,
			undefined as never,
		);
		const event: WorkbenchReplayEvent = {
			type: "tool_execution_end",
			toolCallId: `adaptive-${example.kind}`,
			toolName: "visualize",
			result: { content: [], details: result.details },
			isError: false,
		};
		timeline.push(event);
		emit(event);
	}
	const card = (id: string) => page.locator(`[data-component-id="${id}"]`);
	await card("motion").waitFor();
	assert.equal(await page.locator(".visualization-card").count(), 11);
	await card("form").getByRole("button", { name: "Send to agent" }).click();
	assert.equal(received.length, 0);
	await card("form").getByLabel("Name", { exact: true }).fill("Abdur");
	await card("form").getByLabel("Budget", { exact: true }).fill("5");
	await card("form").getByLabel("Theme", { exact: true }).selectOption("Dark");
	await card("form").getByRole("button", { name: "Send to agent" }).click();
	await card("form").getByText("Sent to agent.", { exact: true }).waitFor();
	assert.match(received[0], /Abdur/);
	await card("table").getByRole("button", { name: "Name", exact: true }).click();
	await card("table").getByLabel("Value row 1", { exact: true }).fill("7");
	await card("table").getByLabel("Value row 1", { exact: true }).blur();
	await card("table").getByLabel("Row 1", { exact: true }).check();
	await card("table").getByRole("button", { name: "Send to agent" }).click();
	await card("table").getByText("Sent to agent.", { exact: true }).waitFor();
	await card("graph").getByRole("button", { name: "Output", exact: true }).click();
	await card("graph").getByText("Output result", { exact: true }).waitFor();
	await card("timeline").getByRole("button", { name: "Next", exact: true }).click();
	await card("timeline").getByText("Second step", { exact: true }).waitFor();
	await card("comparison").getByLabel("Cost", { exact: true }).fill("5");
	await card("flashcards").getByRole("button", { name: "Reveal answer" }).click();
	assert.equal(await card("flashcards").locator(".katex").count(), 1);
	await card("flashcards").getByRole("button", { name: "Remembered" }).click();
	await card("flashcards").getByRole("button", { name: "Send to agent" }).click();
	await card("flashcards").getByText("Sent to agent.", { exact: true }).waitFor();
	await card("evidence").locator("summary").click();
	assert.match((await card("evidence").locator("a").getAttribute("href")) || "", /^https:/);
	await card("progress").getByRole("button", { name: "Proceed", exact: true }).click();
	await card("code").getByRole("button", { name: "after", exact: true }).click();
	await card("code").getByText("let x = 2;", { exact: true }).waitFor();
	await card("code").getByRole("button", { name: "edit", exact: true }).click();
	await card("code").getByLabel("Proposed content").fill("let x = 3;");
	await card("code").getByRole("button", { name: "Request apply", exact: true }).click();
	await card("code").getByRole("button", { name: "Send to agent", exact: true }).click();
	await card("code").getByText("Sent to agent.", { exact: true }).waitFor();
	assert.match(received.at(-1) || "", /let x = 3;/);
	assert.match(received.at(-1) || "", /request_apply/);
	await card("motion").getByRole("button", { name: "Play", exact: true }).click();
	await card("motion").getByRole("button", { name: "Pause", exact: true }).click();
	await card("simulation").getByLabel("Slope", { exact: true }).fill("0");
	await card("simulation").getByRole("button", { name: "Send to agent", exact: true }).click();
	await card("simulation").getByText("Sent to agent.", { exact: true }).waitFor();
	await page.reload();
	await login();
	assert.equal(await card("form").getByLabel("Name", { exact: true }).inputValue(), "Abdur");
	assert.equal(
		(await page.locator("#session-title").innerText()).includes("[Adaptive UI response]"),
		false,
		"Internal response envelopes must not become the visible conversation title",
	);
	assert.equal(await card("table").getByLabel("Value row 1", { exact: true }).inputValue(), "7");
	assert.equal(
		await card("simulation").getByLabel("Slope", { exact: true }).inputValue(),
		"0",
		"A saved zero must not revert to the nonzero default",
	);
	await card("flashcards")
		.getByText(/Next review:/)
		.waitFor();
	for (const width of [390, 1280]) {
		await page.setViewportSize({ width, height: 960 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	}
	for (const theme of ["workbench", "pixel", "cyberpunk", "static", "tokyo-night"]) {
		for (const mode of ["dark", "light"]) {
			await page.locator("#appearance-theme").selectOption(theme, { force: true });
			await page.locator("#appearance-mode").selectOption(mode, { force: true });
			assert.equal(await page.locator(".visualization-card").count(), 11);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		}
	}
	assert.deepEqual(errors, []);
	await page.locator("#appearance-theme").selectOption("pixel", { force: true });
	for (const mode of ["dark", "light"]) {
		await page.locator("#appearance-mode").selectOption(mode, { force: true });
		for (const width of [1280, 390]) {
			await page.setViewportSize({ width, height: 960 });
			await card("form").scrollIntoViewIfNeeded();
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
			assert.equal(
				await card("form")
					.getByRole("button", { name: "Send to agent" })
					.evaluate((node) => getComputedStyle(node).borderRadius),
				"0px",
			);
			await page.screenshot({ path: `/tmp/porcupine-pixel-${mode}-${width}.png` });
		}
	}
	await card("form").screenshot({ path: "/tmp/porcupine-adaptive-form.png" });
	await card("motion").screenshot({ path: "/tmp/porcupine-adaptive-motion.png" });
	console.log("PASS 11 adaptive workspaces, interaction, persistence, math and responsive layouts");
} finally {
	await browser.close();
	await api.close();
}
