import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServeApi } from "../src/server/http-api.ts";
import { ContextFileStore } from "../src/server/workbench-context-files.ts";
import { WorkbenchProjectStore } from "../src/server/workbench-projects.ts";
import type { SessionSurfaces } from "../src/server/workbench-session-surfaces.ts";

const out = process.env.WORKBENCH_QA_SCREENSHOTS;
if (!out) throw new Error("Set WORKBENCH_QA_SCREENSHOTS to an existing directory");
const root = mkdtempSync(join(tmpdir(), "workbench-gallery-"));
const agentDir = join(root, "agent");
mkdirSync(agentDir);
writeFileSync(
	join(agentDir, "USER.md"),
	"# USER\n\n- [preference:table-form] Prefers table form.\n- [preference:concise] Short, direct answers.\n",
);
writeFileSync(join(agentDir, "MEMORY.md"), "# MEMORY\n\n- [fact:workspace] Local project notes.\n");
const projects = new WorkbenchProjectStore(root);
projects.create("battery-aging", "Battery Aging Study");
projects.upload(
	"battery-aging",
	"measurements.md",
	Buffer.from("# Measurements\n\nCapacity fade after 200 cycles: 4.2%.\n"),
);
projects.upload("battery-aging", "protocol.pdf", Buffer.from("%PDF-1.7\nsynthetic fixture\n"));
writeFileSync(
	join(root, "Project", "battery-aging", "STATUS.md"),
	"# Status: Battery Aging Study\n\n## State\n`active`\n\n## Next verified action\nRerun the 200-cycle measurement.\n",
);

const controls = {
	interactionMode: "normal" as const,
	reasoningMode: "medium" as const,
	availableReasoningModes: ["off", "low", "medium", "high", "adaptive"] as const,
	busy: false,
	planFence: false,
	model: { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "opencode-go" },
};
const surfaces: SessionSurfaces = {
	getControls: () => ({ ...controls, availableReasoningModes: [...controls.availableReasoningModes] }),
	configure: (patch) => {
		if (patch.interactionMode) controls.interactionMode = patch.interactionMode;
		if (patch.reasoningMode) controls.reasoningMode = patch.reasoningMode as typeof controls.reasoningMode;
		if (patch.planFence !== undefined) controls.planFence = patch.planFence;
		return surfaces.getControls();
	},
	getCatalog: (kind, query = "", offset = 0, limit = 50) => {
		const all = [
			{
				name: "incremental-implementation",
				kind: "skills" as const,
				description: "Build multi-file changes as small verified vertical slices.",
				stack: "coding",
				scope: "user",
				availability: "available" as const,
			},
			{
				name: "test-driven-development",
				kind: "skills" as const,
				description: "Prove behaviour changes with red-green-refactor tests.",
				stack: "coding",
				scope: "user",
				availability: "available" as const,
			},
			{
				name: "web-accessibility",
				kind: "skills" as const,
				description: "Build and audit toward WCAG 2.2 A/AA.",
				stack: "webdev",
				scope: "user",
				availability: "available" as const,
			},
			{
				name: "project-hygiene",
				kind: "skills" as const,
				description: "Create a durable, evidence-backed project workspace.",
				stack: "meta",
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
				description: "Present a bounded 2D diagram or line/scatter/bar chart.",
				scope: "user",
				availability: "active" as const,
			},
			{
				name: "visualize_3d",
				kind: "tools" as const,
				description: "Present an interactive 3D scene.",
				scope: "user",
				availability: "active" as const,
			},
			{
				name: "projects",
				kind: "tools" as const,
				description: "List, search and view Project workspaces.",
				scope: "user",
				availability: "active" as const,
			},
		]
			.filter((entry) => (kind ? entry.kind === kind : false))
			.filter((entry) => !query || `${entry.name} ${entry.description}`.includes(query))
			.sort((a, b) => a.name.localeCompare(b.name));
		return { skillsCount: 4, toolsCount: 4, entries: all.slice(offset, offset + limit), total: all.length, offset };
	},
	getContext: () => ({
		tokens: 128400,
		contextWindow: 1000000,
		percent: 12.8,
		compactAtPercent: 80,
		reserveTokens: null,
		maxSubagents: 3,
	}),
	setLimits: (patch) => ({ ...surfaces.getContext!(), ...patch }),
	getGoalPlan: () => ({
		supported: true,
		goal: {
			objective: "Explain force, motion and displacement with visuals",
			status: "active",
			steps: [
				{ id: "free-body-1", objective: "Draw the free-body diagram", status: "done", note: "shown above" },
				{ id: "spatial-2", objective: "Show the spatial relationship in 3D", status: "done" },
				{ id: "data-3", objective: "Chart displacement with uncertainty", status: "active" },
				{ id: "summarise-4", objective: "Summarise the assumptions", status: "pending" },
			],
			createdAt: "2026-10-27T00:00:00.000Z",
			updatedAt: "2026-10-27T00:00:00.000Z",
		},
		busy: false,
	}),
	inspectCatalog: (kind, name) => ({
		entry: { name, kind, description: "Verified local capability.", scope: "user", availability: "available" },
		content:
			kind === "skills"
				? `# ${name}\n\n## Procedure\n\n1. Inspect the repository.\n2. Make one verified change.\n3. Run the focused test.`
				: `{ "name": "${name}", "parameters": { "type": "object" } }`,
	}),
};
const listeners = new Set<(event: unknown) => void>();
const token = randomBytes(24).toString("hex");
const api = await startServeApi({
	port: 0,
	token,
	contextFiles: new ContextFileStore(root, agentDir),
	projects,
	session: {
		id: "gallery-session",
		async sendUserMessage() {},
		async abort() {},
		isStreaming: () => false,
		onEvent: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		onConfirm: () => () => {},
		...surfaces,
	},
});
const emit = (event: unknown) => {
	for (const listener of listeners) listener(event);
};
const browser = await chromium.launch({ headless: true }).catch(async (error) => {
	await api.close();
	throw error;
});
const shot = async (page: import("playwright").Page, name: string) =>
	page.screenshot({ path: join(out!, name), animations: "disabled" });
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") pageErrors.push(message.text());
	});
	await page.goto(`http://127.0.0.1:${api.port()}`);
	await shot(page, "01 Authentication.png");
	await page.locator("#token").fill(token);
	const streamReady = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/events"));
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("auth")?.hidden === true);
	await page.locator("#session-controls").waitFor();
	await page.locator("#goal-card").waitFor();
	await streamReady;
	await page.waitForTimeout(150);
	await shot(page, "02 Workbench with tracked goal.png");
	await page.locator("#goal-toggle").click();
	await shot(page, "02b Tracker collapsed.png");
	await page.locator("#goal-toggle").click();

	const scene = {
		title: "Spatial relationship",
		description: "Illustrative vectors in space.",
		objects: [
			{ type: "sphere", position: [0, 0, 0], radius: 1, color: "#8197ba", label: "Origin" },
			{ type: "arrow", from: [0, 0, 0], to: [3, 3, 0], color: "#d0bfa0", label: "Vector" },
		],
	};
	const diagram = {
		kind: "diagram",
		title: "Newton’s second law",
		description: "Illustrative free-body diagram, not measured data.",
		objects: [
			{ type: "rectangle", position: [0, 0], size: [3, 2], color: "#899aaa", label: "Mass m" },
			{ type: "arrow", from: [0, 1], to: [0, 4], color: "#b9b4a5", label: "Normal force (N)" },
			{ type: "arrow", from: [0, -1], to: [0, -4], color: "#879eb7", label: "Weight mg (N)" },
			{ type: "text", position: [-5, 0], text: "ΣF = ma", color: "#ffffff" },
		],
	};
	const chart = {
		kind: "chart",
		title: "Illustrative displacement",
		description: "Synthetic data for teaching; error bars are supplied illustrative ±y values.",
		chartType: "line",
		xLabel: "Time (s)",
		yLabel: "Position (m)",
		series: [
			{
				name: "Example A",
				color: "#8faadc",
				points: [
					{ x: 0, y: -2, error: 0.5 },
					{ x: 1, y: 0, error: 0.4 },
					{ x: 2, y: 4, error: 0.8, label: "Peak" },
				],
			},
			{
				name: "Example B",
				color: "#c39f80",
				points: [
					{ x: 0, y: -1 },
					{ x: 1, y: 1 },
					{ x: 2, y: 2 },
				],
			},
		],
	};
	emit({
		type: "message_end",
		message: { role: "user", content: "Explain force, motion and displacement — with a diagram and a chart." },
	});
	emit({
		type: "message_end",
		message: {
			role: "assistant",
			content:
				"Force changes motion; motion changes position. Below: a free-body diagram, the same relationship in 3D, and synthetic displacement data with supplied uncertainty.",
		},
	});
	emit({
		type: "tool_execution_end",
		toolName: "visualize",
		isError: false,
		result: { details: { visualization: { version: 2, ...diagram } } },
	});
	emit({
		type: "tool_execution_end",
		toolName: "visualize_3d",
		isError: false,
		result: { details: { visualization: { version: 1, ...scene } } },
	});
	for (const chartType of ["line", "scatter", "bar"] as const)
		emit({
			type: "tool_execution_end",
			toolName: "visualize",
			isError: false,
			result: { details: { visualization: { version: 2, ...chart, chartType } } },
		});
	await page.waitForTimeout(700);
	await page.locator(".visualization-card").nth(4).waitFor();
	console.log("ERRORS:", pageErrors.slice(0, 3));
	await page
		.locator(".visualization-card")
		.first()
		.evaluate((element) => element.scrollIntoView({ block: "start" }));
	await shot(page, "03 Conversation with visuals.png");
	for (const [index, name] of [
		[1, "04 2D diagram"],
		[2, "05 3D scene"],
		[3, "06 Line chart"],
		[4, "07 Scatter chart"],
		[5, "08 Bar chart"],
	] as const) {
		await page
			.locator(".visualization-card")
			.nth(index - 1)
			.evaluate((element) => element.scrollIntoView({ block: "start" }));
		await shot(page, `${name}.png`);
	}
	emit({
		type: "permission_request",
		permissionId: "perm-demo",
		title: "Run shell command?",
		message: "rm -rf ./dist && npm run build",
	});
	await page.locator(".permission").waitFor();
	await shot(page, "09 Permission approval.png");
	await page.locator(".permission").evaluate((element) => element.remove());
	emit({ type: "agent_start" });
	await page.waitForFunction(() => document.getElementById("activity-label")?.textContent === "Working");
	await shot(page, "10 Working state.png");
	emit({ type: "agent_end" });

	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await shot(page, "11 Settings appearance.png");
	const themes = [
		["workbench", "Workbench"],
		["pixel", "Pixel"],
		["cyberpunk", "Cyberpunk"],
		["static", "Static monochrome"],
		["tokyo-night", "Tokyo Night"],
	] as const;
	let index = 12;
	for (const [theme, label] of themes) {
		await page.locator("#appearance-theme").selectOption(theme);
		for (const mode of ["dark", "light"] as const) {
			await page.locator("#appearance-mode").selectOption(mode);
			await page.getByRole("button", { name: "Close settings" }).click();
			await page
				.locator(".visualization-card")
				.first()
				.evaluate((element) => element.scrollIntoView({ block: "start" }));
			await shot(page, `${String(index).padStart(2, "0")} Theme ${label} ${mode}.png`);
			index += 1;
			await page.getByRole("button", { name: "Settings", exact: true }).click();
			await page.locator("#appearance-theme").waitFor();
		}
	}
	await page.locator("#appearance-theme").selectOption("workbench");
	await page.locator("#appearance-mode").selectOption("dark");
	await page.getByRole("combobox", { name: "Context file", exact: true }).selectOption("global:USER.md");
	await page.waitForFunction(() =>
		document.querySelector<HTMLTextAreaElement>(".context-editor")?.value.includes("table-form"),
	);
	await page.locator("#context-settings").evaluate((element) => element.scrollIntoView({ block: "start" }));
	await shot(page, "22 Settings context files.png");
	await page.getByRole("button", { name: "Close settings" }).click();

	await page.locator("#stacks-tree > summary").click();
	await page.locator("#skills-folder > summary").click();
	await page.getByRole("button", { name: "project-hygiene", exact: true }).waitFor();
	await shot(page, "23 Stacks skills.png");
	await page.locator("#tools-folder > summary").click();
	await page.getByRole("button", { name: "visualize", exact: true }).waitFor();
	await shot(page, "24 Stacks tools.png");
	await page.getByRole("button", { name: "incremental-implementation", exact: true }).click();
	await page.getByText("## Procedure").waitFor();
	await shot(page, "25 Stack details.png");
	await page.getByRole("button", { name: "Close stack details" }).click();

	await page.locator("#projects-tree > summary").click();
	await page.getByRole("button", { name: /Battery Aging Study/ }).click();
	await page.locator("#project-files button").filter({ hasText: "protocol.pdf" }).waitFor();
	await shot(page, "26 Project files.png");
	await page.locator("#project-files button").filter({ hasText: "measurements.md" }).click();
	await page.getByText("Capacity fade after 200 cycles").waitFor();
	await shot(page, "27 Project preview.png");
	await page.getByRole("button", { name: "Close project" }).click();
	await page.getByRole("button", { name: "＋ New project", exact: true }).click();
	await shot(page, "28 New project.png");
	await page.getByRole("button", { name: "Close new project" }).click();

	await page.setViewportSize({ width: 390, height: 844 });
	await page
		.locator(".visualization-card")
		.nth(1)
		.evaluate((element) => element.scrollIntoView({ block: "start" }));
	await shot(page, "29 Phone diagram.png");
	await page.setViewportSize({ width: 700, height: 960 });
	await page
		.locator(".visualization-card")
		.nth(3)
		.evaluate((element) => element.scrollIntoView({ block: "start" }));
	await shot(page, "30 Tablet chart.png");
	console.log("PASS captured 30 UI screenshots");
} finally {
	await browser.close();
	await api.close();
	rmSync(root, { recursive: true, force: true });
}
