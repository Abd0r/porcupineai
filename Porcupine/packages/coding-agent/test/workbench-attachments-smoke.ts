import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";
import { prepareWorkbenchAttachments } from "../src/server/workbench-attachments.ts";
import { serializeWorkbenchTimeline } from "../src/server/workbench-transcript.ts";

const root = mkdtempSync(join(tmpdir(), "porcupine-chat-qa-"));
const listeners = new Set<(event: unknown) => void>();
const history: Array<{ role: string; content: unknown }> = [];
let rejectNext = true;
const emit = (event: unknown) => {
	for (const listener of listeners) listener(event);
};
const session: ServeApiSession = {
	id: "chat-one",
	isStreaming: () => false,
	abort: async () => {},
	onConfirm: () => () => {},
	onEvent: (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	getTimeline: () => serializeWorkbenchTimeline(history),
	async sendUserMessage(text, attachments = []) {
		if (rejectNext) {
			rejectNext = false;
			throw new Error("Synthetic failure; retry preserved attachments");
		}
		const content = await prepareWorkbenchAttachments(root, "chat-one", text, attachments);
		const message = { role: "user", content };
		history.push(message);
		emit({ type: "agent_start" });
		emit({ type: "message_end", message });
		emit({ type: "agent_end" });
	},
};
const server = await startServeApi({
	session,
	sessions: [{ ...session, id: "chat-two", getTimeline: () => [], onEvent: () => () => {} }],
	port: 0,
	token: "attachment-qa",
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
	await page.locator("#token").fill("attachment-qa");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
		"base64",
	);
	await page.locator("#chat-files").setInputFiles([
		{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Document evidence") },
		{ name: "photo.png", mimeType: "image/png", buffer: png },
	]);
	await page.waitForFunction(() => document.querySelectorAll(".attachment-chip").length === 2);
	assert.equal(await page.locator(".attachment-chip img").count(), 1);
	await page.getByRole("button", { name: "Remove notes.txt", exact: true }).click();
	assert.equal(await page.locator(".attachment-chip").count(), 1);
	await page.locator('.session[title="chat-two"]').click();
	await page.waitForFunction(() => document.getElementById("chat-attachments")?.hidden);
	await page.locator('.session[title="chat-one"]').click();
	await page.waitForFunction(() => document.querySelectorAll(".attachment-chip").length === 1);
	await page.locator("#prompt").fill("Inspect the photo");
	await page.locator("#send").click();
	await page.locator("#error").filter({ hasText: "Synthetic failure" }).waitFor();
	assert.equal(await page.locator("#prompt").inputValue(), "Inspect the photo");
	assert.equal(await page.locator(".attachment-chip").count(), 1);
	await page.locator("#send").click();
	await page.locator(".message-photo").waitFor();
	assert.equal(await page.locator(".attachment-chip").count(), 0);
	assert.equal(await page.locator(".message-photo").evaluate((image) => (image as HTMLImageElement).naturalWidth), 1);
	const text = JSON.stringify(history);
	assert.ok(text.includes('"type":"image"'));
	assert.ok(text.includes("photo.png"));
	await page
		.locator("#chat-files")
		.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Document evidence") });
	await page.waitForFunction(() => document.querySelectorAll(".attachment-chip").length === 1);
	await page.locator("#send").click();
	await page.waitForFunction(() => document.querySelectorAll(".message.user").length === 2);
	const documentText = history[1]?.content as Array<{ type: string; text?: string }>;
	const path = documentText.find((p) => p.text?.startsWith("Attached file: notes.txt"))?.text?.split("\nPath: ")[1];
	assert.ok(path);
	assert.equal(readFileSync(path, "utf8"), "Document evidence");
	await page.reload();
	await page.locator("#token").fill("attachment-qa");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.locator(".message-photo").waitFor();
	assert.equal(await page.locator(".message.user").count(), 2);
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	}
	assert.deepEqual(errors, []);
	console.log(
		"PASS photo pixels, file tool paths, preview/remove, session drafts, failed-send recovery, attachment-only send, saved photo replay and responsive composer",
	);
} finally {
	await browser.close();
	await server.close();
	rmSync(root, { recursive: true, force: true });
}
