import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServeApi } from "../src/server/http-api.ts";

const listeners = new Set<(event: unknown) => void>();
let runs = [{ id: "worker", name: "Research", task: "Read sources", status: "running" }];
const api = await startServeApi({
	port: 0,
	token: "panels-test",
	session: {
		id: "panels",
		async sendUserMessage() {},
		async abort() {},
		isStreaming: () => false,
		getGoalPlan: () => ({
			goal: { objective: "Inspect evidence", steps: [{ objective: "Read sources", status: "active" }] },
		}),
		getSubagents: () => runs,
		onConfirm() {
			return () => {};
		},
		onEvent(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	},
});
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`http://127.0.0.1:${api.port()}/#token=panels-test`);
	await page.locator("#todos-panel").waitFor();
	await page.locator(".worker").waitFor();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.locator("#appearance-todos-placement").selectOption("overlay");
	await page.locator("#appearance-workers-placement").selectOption("hidden");
	await page.getByRole("button", { name: "Close settings" }).click();
	assert.equal(await page.locator("#todos-panel").evaluate((n) => n.parentElement?.id), "work-rail-overlay");
	assert.equal(await page.locator("#workers-panel").isVisible(), false);
	assert.equal(await page.locator("#work-rail").isVisible(), false);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.locator("#appearance-todos-placement").selectOption("hidden");
	await page.locator("#appearance-workers-placement").selectOption("side");
	await page.getByRole("button", { name: "Close settings" }).click();
	assert.equal(await page.locator("#todos-panel").isVisible(), false);
	assert.equal(await page.locator("#workers-panel").isVisible(), true);
	runs = [];
	for (const fn of listeners)
		fn({
			type: "message_end",
			message: {
				role: "custom",
				customType: "subagent_report",
				content: "⚙️ Sub-agent worker ✓ done after 16 step(s) (~11,994 ctx).",
				details: { id: "worker", ok: true },
			},
		});
	await page.waitForFunction(() => document.querySelectorAll(".worker").length === 0);
	assert.equal(await page.locator("#workers-panel").isVisible(), false);
	assert.equal((await page.locator("body").innerText()).includes("11,994 ctx"), false);
	for (const fn of listeners)
		fn({ type: "subagents", runs: [{ id: "worker", name: "Research", task: "Read sources", status: "done" }] });
	assert.equal(await page.locator(".worker").count(), 0);
	await page.reload();
	await page.locator("#token").fill("panels-test");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	assert.equal(await page.locator("#appearance-todos-placement").inputValue(), "hidden");
	assert.equal(await page.locator("#appearance-workers-placement").inputValue(), "side");
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 960 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	}
	assert.deepEqual(errors, []);
	console.log("PASS independent panel placement, persistence, hidden gutter and active-only workers");
} finally {
	await browser.close();
	await api.close();
}
