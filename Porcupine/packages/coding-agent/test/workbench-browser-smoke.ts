import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { chromium } from "playwright";
import { createVisualizeToolDefinition, type VisualParameters } from "../src/core/tools/visualize.ts";
import { createVisualize3DToolDefinition, type VisualizationParameters } from "../src/core/tools/visualize-3d.ts";
import { startServeApi } from "../src/server/http-api.ts";

// Run with tsx. Requires Playwright's Chromium; screenshots are opt-in to an existing directory.
const screenshots = process.env.WORKBENCH_QA_SCREENSHOTS;
const listeners = new Set<(e: unknown) => void>();
const token = randomBytes(24).toString("hex");
const api = await startServeApi({
	port: 0,
	token,
	session: {
		id: "visual-qa",
		async sendUserMessage() {},
		async abort() {},
		isStreaming() {
			return false;
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
const browser = await chromium
	.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
	.catch(async (error) => {
		await api.close();
		throw error;
	});
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});
	page.on("requestfailed", (r) => errors.push(r.failure()?.errorText || "failed request"));
	page.on("response", (response) => {
		if (response.status() >= 400) errors.push(`HTTP ${response.status()}`);
	});
	await page.goto(`http://127.0.0.1:${api.port()}`);
	const streamReady = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/events"));
	await page.locator("#token").fill(token);
	await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await page.waitForFunction(() => document.getElementById("auth")?.hidden === true);
	assert.equal(
		await page.locator("#auth").isVisible(),
		false,
		"Authentication overlay must disappear after connection",
	);
	await streamReady;
	const scene = {
		title: "Spatial relationship",
		description: "Illustrative vectors in space.",
		objects: [
			{ type: "sphere", position: [0, 0, 0], radius: 1, color: "#8197ba", label: "Origin" },
			{ type: "arrow", from: [0, 0, 0], to: [3, 3, 0], color: "#d0bfa0", label: "Vector" },
		],
	} satisfies VisualizationParameters;
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
	} satisfies VisualParameters;
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
	} satisfies VisualParameters;
	const emit = (name: string, result: unknown) => {
		for (const fn of listeners) fn({ type: "tool_execution_end", toolName: name, result, isError: false });
	};
	const visualTool = createVisualizeToolDefinition(),
		spatialTool = createVisualize3DToolDefinition();
	for (const fn of listeners) {
		fn({ type: "message_end", message: { role: "user", content: "Can you explain force and motion visually?" } });
		fn({
			type: "message_end",
			message: {
				role: "assistant",
				content:
					"Start with direction. A force is a vector: its orientation matters as much as its magnitude. Then compare the forces on the object and how its position changes over time. These diagrams and data are illustrative, not measurements.",
			},
		});
	}
	emit("visualize_3d", await spatialTool.execute("qa-3d", scene, undefined, undefined, undefined as never));
	emit("visualize", await visualTool.execute("qa-2d", diagram, undefined, undefined, undefined as never));
	for (const chartType of ["line", "scatter", "bar"] as const)
		emit(
			"visualize",
			await visualTool.execute(`qa-${chartType}`, { ...chart, chartType }, undefined, undefined, undefined as never),
		);
	await page.locator(".visualization-card").nth(4).waitFor();
	assert.equal(await page.locator("canvas").count(), 5);
	assert.equal(await page.locator("table").count(), 3);
	const visualStyle = await page
		.locator(".visualization-card")
		.first()
		.evaluate((element) => {
			const style = getComputedStyle(element);
			return { background: style.backgroundImage, shadow: style.boxShadow };
		});
	assert.deepEqual(
		visualStyle,
		{ background: "none", shadow: "none" },
		"Visuals should read as conversation content, not decorative dashboard cards",
	);
	await page.locator(".visualization-card").nth(2).getByText("Data and uncertainty", { exact: true }).click();
	assert.equal(await page.locator("table").nth(0).locator("tbody tr").count(), 6);
	await page.locator(".visualization-card").nth(2).getByRole("button", { name: "Ask about this visual" }).click();
	assert.match(await page.locator("#prompt").inputValue(), /Illustrative displacement/);
	await page.locator(".visualization-card").nth(2).getByText("Data and uncertainty", { exact: true }).click();
	for (const width of [1280, 700, 390]) {
		await page.setViewportSize({ width, height: 960 });
		const metrics = await page.evaluate(() => ({
			width: innerWidth,
			scroll: document.documentElement.scrollWidth,
			height: innerHeight,
			composerBottom: document.getElementById("prompt-form")?.getBoundingClientRect().bottom,
			headerTop: document.querySelector(".topbar")?.getBoundingClientRect().top,
			canvases: Array.from(document.querySelectorAll("canvas")).map((c) => ({ width: c.width, height: c.height })),
		}));
		assert.ok(metrics.scroll <= width, JSON.stringify(metrics));
		assert.ok(
			metrics.composerBottom !== undefined && metrics.composerBottom <= metrics.height,
			`Composer must stay visible: ${JSON.stringify(metrics)}`,
		);
		assert.ok(
			metrics.headerTop !== undefined && metrics.headerTop >= 0,
			`Header must stay visible: ${JSON.stringify(metrics)}`,
		);
		assert.ok(metrics.canvases.every((c) => c.width > 0 && c.height > 0));
		if (screenshots) {
			await page.locator("#feed").evaluate((element) => {
				element.scrollTop = 0;
			});
			await page.screenshot({ path: join(screenshots, `${width}-conversation.png`) });
		}
		await page
			.locator(".visualization-card")
			.nth(2)
			.evaluate((element) => element.scrollIntoView({ block: "start" }));
		if (screenshots) {
			await page.screenshot({ path: join(screenshots, `${width}.png`) });
			for (const index of [0, 1, 3, 4]) {
				await page
					.locator(".visualization-card")
					.nth(index)
					.evaluate((element) => element.scrollIntoView({ block: "start" }));
				await page.screenshot({ path: join(screenshots, `${width}-card-${index}.png`) });
			}
		}
		console.log(
			`PASS viewport ${width} no horizontal page overflow; five visual cards, full data tables and follow-up prompt`,
		);
	}
	assert.deepEqual(errors, []);
	console.log("PASS browser diagnostics: no console errors, page errors or failed requests");
} finally {
	await browser.close();
	await api.close();
}
