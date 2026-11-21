import assert from "node:assert/strict";
import { chromium } from "playwright";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";
import type { WorkbenchReplayEvent } from "../src/server/workbench-transcript.ts";

const timeline: WorkbenchReplayEvent[] = Array.from({ length: 10_000 }, (_, index) => ({
	type: "message_end",
	message: {
		role: index % 2 ? "assistant" : "user",
		content: [
			{
				type: "text",
				text: `## Update ${index}\n\n- Reviewed the **sample**\n\n| item | status |\n| --- | --- |\n| example | ready |${index < 9880 ? `\n\n${"A synthetic older message with details. ".repeat(110)}` : ""}`,
			},
		],
	},
}));
let emit: Parameters<ServeApiSession["onEvent"]>[0] | undefined;
const server = await startServeApi({
	port: 0,
	token: "local-history-fixture",
	session: {
		id: "long-history",
		sendUserMessage: async () => {},
		abort: async () => {},
		isStreaming: () => false,
		onEvent: (listener) => {
			emit = listener;
			return () => {};
		},
		onConfirm: () => () => {},
		getTimeline: () => timeline,
	},
});
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
try {
	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 },
	]) {
		const page = await browser.newPage({ viewport });
		page.setDefaultTimeout(6000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const start = performance.now();
		await page.goto(`http://127.0.0.1:${server.port()}/#token=local-history-fixture`);
		const rows = page.locator("#feed .message");
		const older = page.getByRole("button", { name: "Load older history" });
		await older.waitFor({ state: "attached" });
		assert.equal(await rows.count(), 120);
		assert.match(await rows.first().innerText(), /Update 9880\b/);
		assert.match(await rows.last().innerText(), /Update 9999\b/);
		console.log(`${viewport.width}px ready in ${Math.round(performance.now() - start)} ms`);
		await page.locator("#prompt").fill("Unsaved draft");
		await older.scrollIntoViewIfNeeded();
		const before = await rows.first().boundingBox();
		assert.ok(before);
		await older.click();
		await rows.first().filter({ hasText: "Update 9760" }).waitFor({ state: "attached" });
		assert.equal(await rows.count(), 240);
		assert.match(await rows.nth(120).innerText(), /Update 9880\b/);
		const after = await rows.nth(120).boundingBox();
		assert.ok(after && Math.abs(after.y - before.y) < 3);
		assert.equal(await page.locator("#prompt").inputValue(), "Unsaved draft");
		assert.ok(emit);
		emit({ type: "message_end", message: { role: "assistant", content: "Live after history page" } });
		await rows.last().filter({ hasText: "Live after history page" }).waitFor({ state: "attached" });
		assert.equal(await rows.count(), 241);
		await older.click();
		await rows.first().filter({ hasText: "Update 9640" }).waitFor({ state: "attached" });
		assert.equal(await rows.count(), 241);
		const newer = page.getByRole("button", { name: "Newer history" });
		await newer.click();
		await rows.first().filter({ hasText: "Update 9760" }).waitFor({ state: "attached" });
		await newer.click();
		await rows.first().filter({ hasText: "Update 9880" }).waitFor({ state: "attached" });
		assert.equal(await rows.count(), 121);
		assert.equal(await page.locator("#prompt").inputValue(), "Unsaved draft");
		assert.deepEqual(errors, []);
		await page.close();
	}
	console.log(
		"PASS 10,000-event history window, bounded paging, scroll anchor, draft and live append on desktop/mobile",
	);
} finally {
	await browser.close();
	await server.close();
}
