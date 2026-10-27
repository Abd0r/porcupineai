import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServeApi } from "../src/server/http-api.ts";

const listeners = new Set<(event: unknown) => void>();
const emit = (event: unknown) => {
	for (const fn of listeners) fn(event);
};
const api = await startServeApi({
	port: 0,
	token: "render-test",
	session: {
		id: "render",
		async sendUserMessage() {},
		async abort() {},
		isStreaming: () => false,
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
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`http://127.0.0.1:${api.port()}/#token=render-test`);
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	await page.evaluate(() => {
		const w = window as unknown as { katex: { render: (...args: unknown[]) => unknown }; mathRenders: number };
		w.mathRenders = 0;
		const original = w.katex.render;
		w.katex.render = (...args) => {
			w.mathRenders++;
			return original(...args);
		};
	});
	emit({ type: "agent_start" });
	for (let i = 0; i < 100; i++)
		emit({
			type: "message_update",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Compute $F=ma$ carefully." },
					{ type: "text", text: `$F=ma$ ${"Answer ".repeat(i + 1)}` },
				],
			},
		});
	emit({
		type: "message_end",
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Compute $F=ma$ carefully." },
				{ type: "text", text: "$F=ma$ final answer." },
			],
		},
	});
	emit({ type: "agent_end" });
	await page.getByText("final answer.", { exact: false }).waitFor();
	const renders = await page.evaluate(() => (window as unknown as { mathRenders: number }).mathRenders);
	assert.ok(renders <= 5, `Repeated streamed math should reuse rendering; observed ${renders} KaTeX calls`);
	await page.locator("#prompt").fill("Typing remains available");
	assert.equal(await page.locator("#prompt").inputValue(), "Typing remains available");
	await page.locator(".thinking-head").click();
	assert.equal(await page.locator(".thinking-body .katex").count(), 1);
	assert.deepEqual(errors, []);
	console.log(`PASS coalesced streaming math, final answer, reasoning disclosure and typing; KaTeX calls: ${renders}`);
} finally {
	await browser.close();
	await api.close();
}
