import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServeApi } from "../src/server/http-api.ts";
import { ContextFileStore } from "../src/server/workbench-context-files.ts";

const root = mkdtempSync(join(tmpdir(), "workbench-settings-")),
	agentDir = join(root, "agent");
mkdirSync(agentDir);
writeFileSync(join(agentDir, "USER.md"), "# USER\nSynthetic demo preferences.\n");
const token = randomBytes(24).toString("hex");
const api = await startServeApi({
	port: 0,
	token,
	contextFiles: new ContextFileStore(root, agentDir),
	session: {
		id: "settings-demo",
		async sendUserMessage() {},
		async abort() {},
		isStreaming: () => false,
		onEvent: () => () => {},
		onConfirm: () => () => {},
	},
});
const browser = await chromium
	.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
	.catch(async (error) => {
		await api.close();
		throw error;
	});
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(5000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`http://127.0.0.1:${api.port()}`);
	await page.locator("#token").fill(token);
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("auth")?.hidden === true);
	assert.equal(await page.getByRole("button", { name: "Send message", exact: true }).locator("svg").count(), 1);
	assert.equal((await page.locator("#send").innerText()).trim(), "");
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	assert.equal(await page.getByRole("dialog", { name: "Settings", exact: true }).isVisible(), true);
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(
		await page.locator("#settings-dialog").evaluate((element) => getComputedStyle(element).transitionDuration),
		"0s",
	);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	assert.notEqual(
		await page.locator("#settings-dialog").evaluate((element) => getComputedStyle(element).transitionDuration),
		"0s",
	);
	for (const theme of ["workbench", "pixel", "cyberpunk", "static", "tokyo-night"]) {
		await page.locator("#appearance-theme").selectOption(theme);
		for (const mode of ["light", "dark"]) {
			await page.locator("#appearance-mode").selectOption(mode);
			assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
			assert.equal(await page.locator("html").getAttribute("data-colour-mode"), mode);
			assert.equal(await page.locator("html").evaluate((element) => getComputedStyle(element).colorScheme), mode);
			const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
			assert.ok(sizes.scroll <= sizes.width);
			if (process.env.WORKBENCH_QA_SCREENSHOTS)
				await page.screenshot({
					path: join(process.env.WORKBENCH_QA_SCREENSHOTS, `Settings - ${theme} - ${mode}.png`),
					animations: "disabled",
				});
		}
	}
	assert.equal(await page.locator("#appearance-image").count(), 0);
	assert.equal(await page.locator("#chat-backdrop").count(), 0);
	await page.getByRole("switch", { name: "Always show reasoning", exact: false }).check();
	const restored = await context.newPage();
	await restored.goto(`http://127.0.0.1:${api.port()}`);
	assert.equal(await restored.locator("html").getAttribute("data-theme"), "tokyo-night");
	assert.equal(await restored.locator("#appearance-reasoning").isChecked(), true);
	await restored.close();
	await page.locator("#appearance-theme").selectOption("workbench");
	await page.locator("#appearance-mode").selectOption("dark");
	await page.getByRole("tab", { name: "Context", exact: true }).click();
	await page.getByRole("combobox", { name: "Context file", exact: true }).selectOption("global:USER.md");
	const editor = page.getByRole("textbox", { name: "Context file contents", exact: true });
	await page.waitForFunction(() =>
		document.querySelector<HTMLTextAreaElement>(".context-editor")?.value.includes("Synthetic demo"),
	);
	assert.equal(await editor.evaluate((element) => (element as HTMLTextAreaElement).readOnly), true);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const draft = "# USER\n- Prefers precise scientific explanations.\n";
	await editor.fill(draft);
	writeFileSync(join(agentDir, "USER.md"), "# USER\nUpdated by the agent.\n");
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await page.getByRole("alert").filter({ hasText: "changed since" }).waitFor();
	assert.equal(await editor.inputValue(), draft);
	assert.match(readFileSync(join(agentDir, "USER.md"), "utf8"), /Updated by the agent/);
	await page.getByRole("button", { name: "Discard & reload", exact: true }).click();
	await page.waitForFunction(() =>
		document.querySelector<HTMLTextAreaElement>(".context-editor")?.value.includes("Updated by the agent"),
	);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await editor.fill(draft);
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await page.getByText("Saved to disk.", { exact: false }).waitFor();
	assert.equal(readFileSync(join(agentDir, "USER.md"), "utf8"), draft);
	if (process.env.WORKBENCH_QA_SCREENSHOTS)
		await page.screenshot({
			path: join(process.env.WORKBENCH_QA_SCREENSHOTS, "Settings - Context files.png"),
			animations: "disabled",
		});
	assert.ok(
		!(await page.evaluate(() => JSON.stringify(window.localStorage))).includes(token),
		"Bearer token must not be persisted",
	);
	await page.getByRole("button", { name: "Close settings" }).click();
	assert.equal(await page.getByRole("dialog", { name: "Settings", exact: true }).isVisible(), false);
	assert.deepEqual(errors, []);
	console.log(
		"PASS paper-plane send, 5 themes × light/dark, reasoning preference persistence, no custom backgrounds, context editing and dialog controls",
	);
} finally {
	await browser.close();
	await api.close();
	rmSync(root, { recursive: true, force: true });
}
