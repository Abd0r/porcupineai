import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServeApi } from "../src/server/http-api.ts";
import { ContextFileStore } from "../src/server/workbench-context-files.ts";
import { WorkbenchProjectStore } from "../src/server/workbench-projects.ts";
import type { SessionSurfaces } from "../src/server/workbench-session-surfaces.ts";

const root = mkdtempSync(join(tmpdir(), "workbench-workspace-"));
const agentDir = join(root, "agent");
mkdirSync(agentDir);
const controls = {
	interactionMode: "normal" as const,
	reasoningMode: "medium" as const,
	availableReasoningModes: ["off", "low", "medium", "high", "adaptive"] as const,
	busy: false,
	model: { id: "faux-1", name: "Faux Model", provider: "faux" },
};
const surfaces: SessionSurfaces = {
	getControls: () => ({ ...controls, availableReasoningModes: [...controls.availableReasoningModes] }),
	configure: (patch) => {
		if (patch.interactionMode) controls.interactionMode = patch.interactionMode;
		if (patch.reasoningMode) controls.reasoningMode = patch.reasoningMode as typeof controls.reasoningMode;
		return surfaces.getControls();
	},
	getCatalog: (kind, query = "", offset = 0, limit = 50) => {
		const all = [
			{
				name: "incremental-implementation",
				kind: "skills" as const,
				description: "Build multi-file changes as verified vertical slices.",
				stack: "coding",
				scope: "user",
				availability: "available" as const,
			},
			{
				name: "web-accessibility",
				kind: "skills" as const,
				description: "Audit toward WCAG 2.2 A/AA.",
				stack: "webdev",
				scope: "user",
				availability: "available" as const,
			},
			{
				name: "bash",
				kind: "tools" as const,
				description: "Run a shell command.",
				scope: "user",
				availability: "active" as const,
			},
			{
				name: "visualize",
				kind: "tools" as const,
				description: "Present a bounded 2D diagram or chart.",
				scope: "user",
				availability: "active" as const,
			},
		]
			.filter((entry) => (kind ? entry.kind === kind : false))
			.filter((entry) => !query || entry.name.includes(query))
			.sort((a, b) => a.name.localeCompare(b.name));
		return { skillsCount: 2, toolsCount: 2, entries: all.slice(offset, offset + limit), total: all.length, offset };
	},
	inspectCatalog: (kind, name) => ({
		entry: { name, kind, description: "Test entry", scope: "user", availability: "available" },
		content: kind === "skills" ? `# ${name}\n\nTest skill instructions.` : `{"name":"${name}"}`,
	}),
};
const token = randomBytes(24).toString("hex");
const api = await startServeApi({
	port: 0,
	token,
	contextFiles: new ContextFileStore(root, agentDir),
	projects: new WorkbenchProjectStore(root),
	session: {
		id: "workspace-demo",
		async sendUserMessage() {},
		async abort() {},
		isStreaming: () => false,
		onEvent: () => () => {},
		onConfirm: () => () => {},
		...surfaces,
	},
});
const browser = await chromium.launch({ headless: true }).catch(async (error) => {
	await api.close();
	throw error;
});
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
	page.setDefaultTimeout(6000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.goto(`http://127.0.0.1:${api.port()}`);
	await page.locator("#token").fill(token);
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("auth")?.hidden === true);

	// Real reasoning / autonomy / plan controls.
	await page.locator("#session-controls").waitFor();
	assert.equal(await page.locator("#reasoning-mode").inputValue(), "medium");
	assert.equal(await page.locator("#autonomy-mode").inputValue(), "normal");
	await page.locator("#reasoning-mode").selectOption("high");
	await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#reasoning-mode")?.value === "high");
	assert.equal(controls.reasoningMode, "high");
	await page.locator("#autonomy-mode").selectOption("ask");
	await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#autonomy-mode")?.value === "ask");
	assert.equal(controls.interactionMode, "ask");

	// Stacks: live skills and tools with source inspection.
	await page.locator("#stacks-tree > summary").click();
	await page.locator("#skills-folder > summary").click();
	await page.getByRole("button", { name: "web-accessibility", exact: true }).waitFor();
	await page.locator("#tools-folder > summary").click();
	await page.getByRole("button", { name: "visualize", exact: true }).waitFor();
	await page.locator("#skills-search").fill("incremental");
	await page.getByRole("button", { name: "incremental-implementation", exact: true }).waitFor();
	await page.waitForFunction(
		() => !document.getElementById("skills-items")?.textContent?.includes("web-accessibility"),
	);
	await page.getByRole("button", { name: "incremental-implementation", exact: true }).click();
	await page.getByText("Test skill instructions.").waitFor();
	await page.getByRole("button", { name: "Close stack details" }).click();

	// Projects: create, upload, inspect.
	await page.locator("#projects-tree > summary").click();
	await page.getByRole("button", { name: "＋ New project", exact: true }).click();
	await page.locator("#new-project-name").fill("Battery Aging");
	await page.locator("#new-project-title-input").fill("Battery Aging Study");
	await page.locator("#new-project-create").click();
	await page.locator("#project-summary").filter({ hasText: "supported document" }).waitFor();
	await page.locator("#project-upload").setInputFiles({
		name: "measurements.md",
		mimeType: "text/markdown",
		buffer: Buffer.from("# Measurements\nCapacity fade after 200 cycles.\n"),
	});
	await page.getByText("Saved to uploads/measurements.md").waitFor();
	await page.locator("#project-files button").filter({ hasText: "measurements" }).first().click();
	await page.getByText("Capacity fade after 200 cycles.").waitFor();
	assert.match(readFileSync(join(root, "Project", "battery-aging", "STATUS.md"), "utf8"), /planning/);
	if (process.env.WORKBENCH_QA_SCREENSHOTS) {
		await page.screenshot({
			path: join(process.env.WORKBENCH_QA_SCREENSHOTS, "Workspace - Projects.png"),
			animations: "disabled",
		});
	}
	await page.getByRole("button", { name: "Close project" }).click();
	assert.deepEqual(errors, []);
	console.log("PASS live controls, plan fence, Stacks skills/tools inspection, project create + upload + preview");
} finally {
	await browser.close();
	await api.close();
	rmSync(root, { recursive: true, force: true });
}
