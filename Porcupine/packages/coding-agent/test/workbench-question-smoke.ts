import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServeApi } from "../src/server/http-api.ts";
import type { WorkbenchReplayEvent } from "../src/server/workbench-transcript.ts";

const listeners = new Set<(event: unknown) => void>();
const answers: string[] = [];
const timeline: WorkbenchReplayEvent[] = [];
const api = await startServeApi({
	port: 0,
	token: "question-smoke-token",
	session: {
		id: "question-smoke",
		async sendUserMessage(text) {
			answers.push(text);
			timeline.push({ type: "message_end", message: { role: "user", content: text } });
		},
		getTimeline() {
			return timeline;
		},
		async abort() {},
		isStreaming() {
			return false;
		},
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
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`http://127.0.0.1:${api.port()}`);
	await page.locator("#token").fill("question-smoke-token");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("auth")?.hidden);
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	const questionEvent = {
		type: "tool_execution_end",
		toolCallId: "physics-question",
		toolName: "visualize",
		isError: false,
		result: {
			content: [],
			details: {
				visualization: {
					version: 2,
					componentId: "physics",
					kind: "question",
					title: "Physics check",
					question: "What is $F=ma$?",
					options: ["Force", "Energy"],
				},
			},
		},
	} satisfies WorkbenchReplayEvent;
	timeline.push(questionEvent);
	for (const fn of listeners) fn(questionEvent);
	await page.getByLabel("Force", { exact: true }).check();
	await page.getByRole("button", { name: "Send answer" }).click();
	await page.getByText("Answer sent.", { exact: true }).waitFor();
	assert.equal(answers.length, 1);
	assert.match(answers[0], /Force/);
	assert.equal(await page.locator(".katex").count(), 1);
	assert.equal(await page.locator("fieldset:disabled").count(), 1);
	await page.reload();
	await page.locator("#token").fill("question-smoke-token");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.getByText("Answer sent.", { exact: true }).waitFor();
	assert.equal(await page.getByLabel("Force", { exact: true }).isChecked(), true);
	assert.equal(await page.locator("fieldset:disabled").count(), 1);
	assert.equal(
		await page
			.locator(".message.user")
			.innerText()
			.then((text) => text.includes("[Adaptive UI response]")),
		false,
	);
	for (const fn of listeners) fn(questionEvent);
	await page.waitForTimeout(50);
	assert.equal(await page.locator("[data-component-id=physics]").count(), 1);
	assert.equal(await page.getByLabel("Force", { exact: true }).isChecked(), true);
	const revised = structuredClone(questionEvent);
	revised.result.details.visualization.question = "Which quantity is measured in joules?";
	for (const fn of listeners) fn(revised);
	await page.getByText("Which quantity is measured in joules?", { exact: true }).waitFor();
	assert.equal(await page.locator("fieldset:disabled").count(), 0);
	assert.equal(await page.getByLabel("Force", { exact: true }).isChecked(), false);
	assert.equal(await page.locator("[data-component-id=physics]").count(), 1);
	const quizEvent = {
		type: "tool_execution_end",
		toolCallId: "quiz-1",
		toolName: "visualize",
		isError: false,
		result: {
			content: [],
			details: {
				visualization: {
					version: 2,
					kind: "quiz",
					componentId: "quiz-physics",
					title: "Units quiz",
					questions: [
						{
							question: "Unit of energy?",
							options: ["Joule", "Newton"],
							correctAnswers: [0],
							hint: "Think of work.",
							explanation: "Energy is measured in joules.",
						},
						{
							question: "Select SI units",
							options: ["Metre", "Second", "Foot"],
							correctAnswers: [0, 1],
							explanation: "Metre and second are SI base units.",
						},
					],
				},
			},
		},
	} satisfies WorkbenchReplayEvent;
	timeline.push(quizEvent);
	for (const fn of listeners) fn(quizEvent);
	await page.getByRole("button", { name: "Check answers" }).waitFor();
	assert.equal(await page.getByText("Energy is measured in joules.", { exact: true }).count(), 0);
	await page.getByLabel("Joule", { exact: true }).check();
	await page.getByLabel("Metre", { exact: true }).check();
	await page.getByLabel("Second", { exact: true }).check();
	await page.getByRole("button", { name: "Check answers" }).click();
	await page.getByText("Score: 2 / 2", { exact: true }).waitFor();
	assert.equal(answers.length, 2);
	await page.reload();
	await page.locator("#token").fill("question-smoke-token");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.getByText("Score: 2 / 2", { exact: true }).waitFor();
	assert.equal(await page.getByLabel("Metre", { exact: true }).isChecked(), true);
	assert.deepEqual(errors, []);
	console.log("Question submission and local LaTeX rendering passed.");
} finally {
	await browser.close();
	await api.close();
}
