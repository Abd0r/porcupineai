import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServeApi } from "../src/server/http-api.ts";

const out = process.env.WORKBENCH_QA_MOTION;
if (!out) throw new Error("Set WORKBENCH_QA_MOTION to an existing directory");
const root = mkdtempSync(join(tmpdir(), "workbench-motion-"));
const videoDir = join(root, "video");
mkdirSync(videoDir, { recursive: true });
const token = randomBytes(24).toString("hex");
const api = await startServeApi({
	port: 0,
	token,
	session: {
		id: "motion-demo",
		async sendUserMessage() {},
		async abort() {},
		isStreaming: () => false,
		onEvent: () => () => {},
		onConfirm: () => () => {},
	},
});
const browser = await chromium.launch({ headless: true }).catch(async (error) => {
	await api.close();
	throw error;
});
try {
	const context = await browser.newContext({
		viewport: { width: 960, height: 600 },
		recordVideo: { dir: videoDir, size: { width: 960, height: 600 } },
	});
	const page = await context.newPage();
	await page.goto(`http://127.0.0.1:${api.port()}`);
	await page.locator("#token").fill(token);
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("auth")?.hidden === true);

	// A few real message events so the frame is not empty while the glyph cycles.
	for (const [role, text] of [
		["user", "Show me the activity states."],
		[
			"assistant",
			"Watching four states: idle, working, tool use and consolidation. Each glyph is an inline SVG drawn in the theme accent.",
		],
	] as const) {
		await page.evaluate(
			([r, t]) => {
				const feed = document.getElementById("feed");
				if (!feed) return;
				const node = document.createElement("article");
				node.className = `message ${r}`;
				const body = document.createElement("div");
				body.textContent = t;
				node.append(body);
				feed.append(node);
				const welcome = document.getElementById("welcome");
				if (welcome) welcome.hidden = true;
			},
			[role, text],
		);
	}

	// Live thinking: the glyph cycles while the turn is open, then settles.
	const thinking =
		"Three readings, same sensor. I should keep the comparison table small and flag that the uncertainty is supplied, not derived.";
	for (let tick = 0; tick < 6; tick += 1) {
		api.emit({
			type: "message_update",
			message: { role: "assistant", content: [{ type: "thinking", thinking }] },
		});
		await page.waitForTimeout(1200);
	}
	api.emit({ type: "tool_execution_start", toolName: "web_search" });
	await page.waitForTimeout(1400);
	api.emit({ type: "tool_execution_start", toolName: "read" });
	await page.waitForTimeout(1400);
	api.emit({ type: "tool_execution_start", toolName: "bash" });
	await page.waitForTimeout(1200);
	api.emit({
		type: "message_end",
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking },
				{ type: "text", text: "Compared all three readings; the spread is inside the supplied uncertainty." },
			],
		},
	});
	await page.locator(".thinking-head").waitFor();
	await page.waitForTimeout(1400);
	await page.locator(".thinking-head").click();
	await page.waitForTimeout(1800);
	await page.locator(".thinking-head").click();
	await page.waitForTimeout(900);
	// Theme sweep so motion and colour are both visible.
	await page.evaluate(() => document.getElementById("settings-open")?.click());
	await page.waitForTimeout(400);
	for (const theme of ["pixel", "tokyo-night", "cyberpunk", "static", "workbench"]) {
		await page.evaluate((value) => {
			const select = document.getElementById("appearance-theme") as HTMLSelectElement | null;
			if (select) {
				select.value = value;
				select.dispatchEvent(new Event("change"));
			}
		}, theme);
		await page.waitForTimeout(900);
	}
	await page.evaluate(() => {
		const close = document.querySelector<HTMLButtonElement>('.settings-heading button[aria-label="Close settings"]');
		close?.click();
	});
	await page.waitForTimeout(600);

	const video = page.video();
	await context.close();
	if (video) {
		const path = await video.path();
		const { copyFileSync } = await import("node:fs");
		copyFileSync(path, join(out, "Workbench motion.webm"));
		console.log("PASS recorded", join(out, "Workbench motion.webm"));
	}
} finally {
	await browser.close();
	await api.close();
	rmSync(root, { recursive: true, force: true });
}
