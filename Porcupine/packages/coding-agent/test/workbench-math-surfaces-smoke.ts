import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createVisualizeToolDefinition } from "../src/core/tools/visualize.ts";
import { createVisualize3DToolDefinition } from "../src/core/tools/visualize-3d.ts";
import { startServeApi } from "../src/server/http-api.ts";
import { workspaceExamples } from "./adaptive-workspace-fixtures.ts";

const listeners = new Set<(event: unknown) => void>();
const api = await startServeApi({
	port: 0,
	token: "math-surfaces",
	session: {
		id: "math",
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
	const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
	const errors: string[] = [];
	page.on("pageerror", (e) => {
		errors.push(e.message);
		console.error(e.message);
	});
	await page.goto(`http://127.0.0.1:${api.port()}/#token=math-surfaces`);
	await page.waitForFunction(() => document.getElementById("status-text")?.textContent === "Ready");
	const emit = (toolName: string, id: string, result: unknown) => {
		for (const fn of listeners) fn({ type: "tool_execution_end", toolName, toolCallId: id, result });
	};
	const specs: Array<Record<string, unknown>> = [
		{
			kind: "timeline",
			steps: [{ label: "Write the difference quotient", detail: "f'(x) = lim_{h->0} [(x+h)^2 - x^2]/h" }],
		},
		{ kind: "flashcards", cards: [{ front: "Power rule: d/dx x^n", back: "$n x^{n-1}$" }] },
		{
			kind: "form",
			fields: [
				{ label: "$x^2$", type: "number" },
				{ label: "Expression", type: "choice", options: ["$2x$", "$x$"] },
			],
		},
		{ kind: "table", columns: ["$x$"], rows: [["$\\frac{1}{2}$"]] },
		{ kind: "graph", nodes: [{ id: "x", label: "$x^2$", detail: "$\\lim_{h\\to 0} h$" }], edges: [] },
		{ kind: "comparison", criteria: ["$x^2$"], options: [{ name: "A", scores: [1], detail: "$E=mc^2$" }] },
		{
			kind: "evidence",
			claims: [
				{
					claim: "$F=ma$",
					evidence: "$\\int_0^1 x dx$",
					source: "Example",
					url: "https://example.com",
					confidence: "low",
				},
			],
		},
		{
			kind: "progress",
			milestones: [{ label: "$x^2$", status: "pending", evidence: "$x=2$" }],
			decisions: ["$x=3$"],
		},
		{ kind: "code", filename: "math.md", language: "markdown", before: "", after: "$\\frac{1}{2}$" },
		{
			...workspaceExamples.find((s) => s.kind === "simulation"),
			parameters: [
				{ name: "slope", label: "$m$", min: -5, max: 5, value: 1, step: 0.1 },
				{ name: "intercept", label: "$b$", min: -5, max: 5, value: 0, step: 0.1 },
			],
		},
		{
			kind: "motion",
			duration: 2,
			objects: [
				{
					type: "text",
					label: "$x^2$",
					color: "#80a0e0",
					keyframes: [{ time: 0, x: 40, y: 50, scale: 1, opacity: 1, rotation: 0 }],
				},
			],
		},
		{
			kind: "diagram",
			objects: [
				{ type: "rectangle", position: [0, 0], size: [4, 2], color: "#80a0e0", label: "$\\frac{d}{dx}x^2$" },
			],
		},
		{
			kind: "chart",
			chartType: "line",
			xLabel: "$t$",
			yLabel: "$x^2$",
			series: [
				{
					name: "$x(t)$",
					color: "#80a0e0",
					points: [
						{ x: 0, y: 1, label: "$x_0$" },
						{ x: 1, y: 2 },
					],
				},
			],
		},
		{ kind: "question", question: "$x^2$", options: ["$2x$"] },
		{
			kind: "quiz",
			questions: [
				{ question: "$x^2$", options: ["$2x$", "$x$"], correctAnswers: [0], explanation: "$\\frac{d}{dx}x^2=2x$" },
			],
		},
	];
	for (const spec of specs) {
		const tool = createVisualizeToolDefinition(),
			input = { ...spec, title: String(spec.kind), componentId: String(spec.kind) };
		const args = tool.prepareArguments!(input);
		emit("visualize", String(spec.kind), await tool.execute("math", args, undefined, undefined, undefined as never));
	}
	const three = createVisualize3DToolDefinition();
	emit(
		"visualize_3d",
		"three",
		await three.execute(
			"three",
			{
				title: "3D math",
				objects: [{ type: "sphere", position: [0, 0, 0], radius: 1, color: "#80a0e0", label: "$x^2$" }],
			},
			undefined,
			undefined,
			undefined as never,
		),
	);
	await page.getByRole("heading", { name: "3D math" }).waitFor();
	const card = (id: string) => page.locator(`[data-component-id="${id}"]`);
	await card("form").getByLabel("Expression", { exact: true }).selectOption("$2x$");
	assert.equal(await card("form").locator(".field-math-preview .katex").count(), 1);
	await card("code").getByRole("button", { name: "preview", exact: true }).click();
	for (const spec of specs) {
		const node = card(String(spec.kind));
		assert.ok((await node.locator(".katex").count()) > 0, `${String(spec.kind)} must typeset math in its content`);
		assert.equal(await node.locator(".math-fallback").count(), 0);
	}
	assert.equal(await page.locator(".visualization-card").last().locator(".canvas-math-layer .katex").count(), 1);
	await card("flashcards").getByRole("button", { name: "Reveal answer" }).click();
	assert.equal(await card("flashcards").locator(".katex").count(), 2);
	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 960 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await card("timeline").screenshot({ path: `/tmp/porcupine-math-timeline-${width}.png` });
		await card("flashcards").screenshot({ path: `/tmp/porcupine-math-flashcards-${width}.png` });
	}
	assert.deepEqual(errors, []);
	console.log("PASS math across 15 adaptive kinds and 3D, including screenshot expressions");
} finally {
	await browser.close();
	await api.close();
}
