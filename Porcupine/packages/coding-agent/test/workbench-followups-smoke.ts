import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServeApi } from "../src/server/http-api.ts";

const listeners = new Set<(event: unknown) => void>();
const pending: string[] = [];
const emit = (event: unknown) => {
	for (const fn of listeners) fn(event);
};
let busy = true;
const api = await startServeApi({
	port: 0,
	token: "queue-test",
	session: {
		id: "queue",
		isStreaming: () => busy,
		getFollowUps: () => pending,
		async sendUserMessage() {
			throw new Error("Active work must not be interrupted");
		},
		async queueFollowUp(text) {
			pending.push(text);
			emit({ type: "queue_update", followUp: pending });
		},
		removeFollowUp(index, expected) {
			if (pending[index] !== expected) return false;
			pending.splice(index, 1);
			emit({ type: "queue_update", followUp: pending });
			return true;
		},
		async abort() {
			busy = false;
			emit({ type: "agent_end" });
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
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`http://127.0.0.1:${api.port()}/#token=queue-test`);
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Working");
	await page.getByRole("textbox", { name: "Message Porcupine" }).fill("First follow-up");
	await page.getByRole("button", { name: "Queue follow-up", exact: true }).click();
	await page.locator(".followup-queue").getByText("First follow-up", { exact: true }).waitFor();
	await page.getByRole("textbox", { name: "Message Porcupine" }).fill("Second follow-up");
	await page.getByRole("textbox", { name: "Message Porcupine" }).press("Enter");
	await page.locator(".followup-queue li").nth(1).waitFor();
	assert.deepEqual(pending, ["First follow-up", "Second follow-up"]);
	await page.reload();
	await page.locator("#token").fill("queue-test");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.locator(".followup-queue li").nth(1).waitFor();
	await page.getByRole("button", { name: "Remove queued prompt 1", exact: true }).click();
	await page.waitForFunction(() => document.querySelectorAll(".followup-queue li").length === 1);
	assert.deepEqual(pending, ["Second follow-up"]);
	pending.splice(0);
	emit({ type: "queue_update", followUp: pending });
	busy = false;
	emit({ type: "agent_end" });
	await page.waitForFunction(() => document.querySelector<HTMLElement>(".followup-queue")?.hidden === true);
	assert.deepEqual(errors, []);
	console.log("PASS mid-work queue, order, reconnect, cancellation and consumption");
} finally {
	await browser.close();
	await api.close();
}
