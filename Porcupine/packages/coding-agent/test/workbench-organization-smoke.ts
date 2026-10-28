import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "../src/core/session-manager.ts";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";
import { createWorkbenchCommands } from "../src/server/workbench-commands.ts";
import { WorkbenchProjectStore } from "../src/server/workbench-projects.ts";
import { getSessionProject, moveSessionToTrash, setSessionProject } from "../src/server/workbench-session-projects.ts";
import { serializeWorkbenchHistory } from "../src/server/workbench-transcript.ts";
import { createHarness } from "./test-harness.ts";

const root = mkdtempSync(join(tmpdir(), "porcupine-organization-"));
const h = await createHarness(),
	commands = createWorkbenchCommands(h.session, h.tempDir),
	projects = new WorkbenchProjectStore(root);
projects.create("research", "Research");
const managers = new Map<string, SessionManager>();
for (const name of ["First conversation", "Second conversation"]) {
	const manager = SessionManager.create(root, join(root, "sessions"));
	manager.appendSessionInfo(name);
	manager.forceFlushToDisk();
	managers.set(manager.getSessionId(), manager);
}
const ids = [...managers.keys()];
const makeSession = (id: string): ServeApiSession => ({
	id,
	sendUserMessage: async () => {},
	abort: async () => {},
	isStreaming: () => false,
	onEvent: () => () => {},
	onConfirm: () => () => {},
	getCommands: commands.catalog,
	runCommand: commands.execute,
	getTimeline: () => serializeWorkbenchHistory(h.session.sessionManager.getBranch()),
});
const server = await startServeApi({
	session: makeSession(ids[0]!),
	sessions: [makeSession(ids[1]!)],
	projects,
	port: 0,
	token: "organization-qa",
	listSessions: async () =>
		[...managers].map(([id, manager]) => ({
			id,
			name: manager.getSessionName(),
			project: projects.nameForPath(getSessionProject(manager)),
		})),
	assignProject: async (id, name) => {
		const manager = managers.get(id);
		assert.ok(manager);
		setSessionProject(manager, name === null ? null : projects.path(name));
	},
	deleteSession: async (id) => {
		const manager = managers.get(id);
		assert.ok(manager);
		moveSessionToTrash(manager);
		managers.delete(id);
	},
	createSession: async () => {
		const manager = SessionManager.create(root, join(root, "sessions"));
		manager.forceFlushToDisk();
		managers.set(manager.getSessionId(), manager);
		return makeSession(manager.getSessionId());
	},
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
	page.on("dialog", (dialog) => void dialog.accept());
	await page.goto(`http://127.0.0.1:${server.port()}`);
	await page.locator("#token").fill("organization-qa");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	await page.locator("#projects-tree > summary").click();
	await page.locator('[data-project="research"]').waitFor();
	await page.locator(`.session[title="${ids[0]}"]`).dragTo(page.locator('[data-project="research"] > summary'));
	await page.locator('[data-project="research"] .session').waitFor();
	assert.equal(
		getSessionProject(SessionManager.open(managers.get(ids[0]!)!.getSessionFile()!)),
		projects.path("research"),
	);
	await page.locator('[data-project="research"] .session-options').click();
	await page.locator("#conversation-project").selectOption("");
	await page.locator(`#sessions .session[title="${ids[0]}"]`).waitFor();
	assert.equal(getSessionProject(managers.get(ids[0]!)!), null);
	await page.locator("#prompt").fill("/comm");
	await page.locator("#command-menu").waitFor();
	await page.locator("#prompt").press("Tab");
	assert.equal(await page.locator("#prompt").inputValue(), "/commands ");
	await page.locator("#prompt").press("Enter");
	await page.locator(".command-result").filter({ hasText: "/reasoning" }).waitFor();
	await page.locator("#prompt").fill("/reasoning adaptive");
	await page.locator("#prompt").press("Enter");
	await page.locator(".command-result").filter({ hasText: "Reasoning: adaptive" }).waitFor();
	assert.equal(h.session.getReasoningMode(), "adaptive");
	assert.equal(h.faux.callCount, 0);
	await page.locator("#prompt").fill("/settings");
	await page.locator("#prompt").press("Enter");
	await page.locator("#settings-dialog").waitFor();
	await page.getByRole("button", { name: "Close settings" }).click();
	const original = managers.get(ids[1]!)!.getSessionFile()!;
	await page.locator(`.session[title="${ids[1]}"]`).locator("..").locator(".session-options").click();
	await page.locator("#conversation-delete").click();
	await page.waitForFunction((id) => !document.querySelector(`.session[title="${id}"]`), ids[1]);
	assert.equal(existsSync(original), false);
	await page.getByRole("button", { name: "Open project Research", exact: true }).click();
	await page.locator("#project-delete").click();
	await page.waitForFunction(() => !document.querySelector('[data-project="research"]'));
	assert.equal(projects.list().length, 0);
	await page.reload();
	await page.locator("#token").fill("organization-qa");
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("auth")?.hidden);
	await page.locator(".command-result").filter({ hasText: "Reasoning: adaptive" }).waitFor();
	assert.equal(await page.locator(`.session[title="${ids[1]}"]`).count(), 0);
	assert.deepEqual(errors, []);
	console.log(
		"PASS persistent project drag/drop, accessible move menu, session/project deletion, real slash command settings, keyboard completion and command replay",
	);
} finally {
	await browser.close();
	await server.close();
	h.cleanup();
	rmSync(root, { recursive: true, force: true });
}
