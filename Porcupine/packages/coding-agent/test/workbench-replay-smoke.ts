import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@porcupineai/ai/compat";
import { chromium } from "playwright";
import { SessionManager } from "../src/core/session-manager.ts";
import { type ServeApiSession, startServeApi } from "../src/server/http-api.ts";
import { serializeWorkbenchHistory } from "../src/server/workbench-transcript.ts";

const root = mkdtempSync(join(tmpdir(), "workbench-replay-"));
const mathSnippet = String.raw`

Inline \(\frac{\alpha_i^2}{\sqrt{x}}\) and $E=mc^2$.

\[
\begin{aligned}
i\hbar\frac{\partial\psi}{\partial t}&=\hat H\psi\\
\int_0^1 x^2\,dx&=\frac13
\end{aligned}
\]

$$\begin{pmatrix}1&0\\0&1\end{pmatrix}$$

| Quantity | Value |
| --- | --- |
| State | $\langle x|y\rangle$ |

Prices \$5 and \$10. Unsupported $\notacommand{x}$ stays visible.
`;
const manager = SessionManager.create(root, join(root, "sessions"));
manager.appendMessage({ role: "user", content: "Repair main.ts", timestamp: Date.now() });
manager.appendMessage(
	fauxAssistantMessage([
		{ type: "thinking", thinking: "Inspect the saved source.", thinkingSignature: "opaque-provider-token" },
		{
			type: "toolCall",
			id: "edit-1",
			name: "edit",
			arguments: { path: "main.ts", edits: [{ oldText: "false", newText: "true" }] },
		},
	]),
);
const fullOutput = `START\n${"Recorded output\n".repeat(2000)}END-OF-SAVED-OUTPUT`;
manager.appendMessage({
	role: "toolResult",
	toolCallId: "edit-1",
	toolName: "edit",
	content: [{ type: "text", text: fullOutput }],
	details: { diff: "- const ready = false;\n+ const ready = true;", firstChangedLine: 1 },
	isError: false,
	timestamp: Date.now(),
});
manager.appendMessage(
	fauxAssistantMessage([
		{ type: "thinking", thinking: "The saved edit is ready for verification." },
		{ type: "text", text: `\`\`\`ts\nconst ready = true;\n\`\`\`${mathSnippet}` },
	]),
);
for (const [name, visualization] of [
	[
		"visualize",
		{
			version: 2,
			kind: "chart",
			title: "Saved chart",
			chartType: "line",
			xLabel: "Time (s)",
			yLabel: "Distance (m)",
			series: [
				{
					name: "Data",
					color: "#80a0c0",
					points: [
						{ x: 0, y: 0 },
						{ x: 1, y: 2 },
					],
				},
			],
		},
	],
	[
		"visualize_3d",
		{
			version: 1,
			title: "Saved scene",
			objects: [{ type: "sphere", position: [0, 0, 0], radius: 1, color: "#80a0c0" }],
		},
	],
] as const) {
	manager.appendMessage(fauxAssistantMessage([{ type: "toolCall", id: name, name, arguments: {} }]));
	manager.appendMessage({
		role: "toolResult",
		toolCallId: name,
		toolName: name,
		content: [{ type: "text", text: "Saved figure" }],
		details: { visualization },
		isError: false,
		timestamp: Date.now(),
	});
}
const file = manager.forceFlushToDisk()!;
const reopened = SessionManager.open(file);
const listeners = new Set<(event: unknown) => void>();
const emit = (event: unknown) => {
	for (const listener of listeners) listener(event);
};
const session: ServeApiSession = {
	id: reopened.getSessionId(),
	getControls: () => ({
		interactionMode: "normal",
		reasoningMode: "medium",
		availableReasoningModes: ["off", "medium", "high", "adaptive"],
		busy: false,
		model: { id: "faux", name: "Test model", provider: "faux" },
	}),
	sendUserMessage: async () => {},
	abort: async () => {},
	isStreaming: () => false,
	getTimeline: () => serializeWorkbenchHistory(reopened.getBranch()),
	onEvent: (listener) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
	onConfirm: () => () => {},
};
const other = { ...session, id: "other", getTimeline: () => [] };
const server = await startServeApi({ session, sessions: [other], token: "local-test", port: 0 });
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
	const page = await browser.newPage();
	page.setDefaultTimeout(6000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("requestfailed", (request) => {
		if (!request.url().endsWith("/events")) errors.push(request.url());
	});
	const connect = async () => {
		await page.locator("#token").fill("local-test");
		await page.locator("#auth-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
		await page.locator(".code-block").waitFor();
	};
	const inspect = async () => {
		assert.equal(await page.locator(".thinking").count(), 2, "Both saved reasoning disclosures must replay");
		assert.deepEqual(await page.locator(".thinking-label").allTextContents(), ["Reasoning", "Reasoning"]);
		for (const button of await page.locator(".thinking-head").all()) await button.click();
		assert.deepEqual(await page.locator(".thinking-body").allTextContents(), [
			"Inspect the saved source.",
			"The saved edit is ready for verification.",
		]);
		await page.locator(".tool-activity").filter({ hasText: "main.ts" }).locator("summary").click();
		await page.getByRole("button", { name: "Show full output", exact: true }).click();
		const output = await page.locator(".tool-activity").filter({ hasText: "main.ts" }).locator("pre").innerText();
		assert.ok(output.includes("main.ts") && output.includes("oldText") && output.includes("END-OF-SAVED-OUTPUT"));
		assert.ok(
			output.includes("- const ready = false;\n+ const ready = true;"),
			"Saved edit diff must remain inspectable",
		);
		assert.equal(await page.locator(".code-block code").innerText(), "const ready = true;");
		assert.equal(
			await page.locator(".message.assistant .katex").count(),
			5,
			"All supported delimiters and table math must render",
		);
		assert.equal(
			await page.locator(".message.assistant math mtable").count(),
			2,
			"Aligned equations and matrices must retain structure",
		);
		assert.ok((await page.locator(".message.assistant math mfrac").count()) >= 2);
		assert.equal(await page.locator(".math-fallback").count(), 1, "Invalid math must remain visible");
		assert.ok(!(await page.locator("#feed").innerText()).includes("opaque-provider-token"));
	};
	await page.goto(`http://127.0.0.1:${server.port()}`);
	await connect();
	await inspect();
	await page.locator(".session[title='other']").click();
	await page.waitForFunction(() => document.getElementById("welcome")?.hidden === false);
	await page.locator(`.session[title='${session.id}']`).click();
	await page.locator(".code-block").waitFor();
	await inspect();
	await page.reload();
	await connect();
	await inspect();
	for (const theme of ["workbench", "pixel", "cyberpunk", "static", "tokyo-night"]) {
		for (const mode of ["light", "dark", "system"]) {
			await page.getByRole("button", { name: "Settings", exact: true }).click();
			await page.locator("#appearance-theme").selectOption(theme);
			await page.locator("#appearance-mode").selectOption(mode);
			await page.getByRole("switch", { name: "Always show reasoning", exact: false }).check();
			await page.getByRole("button", { name: "Close settings" }).click();
			for (const system of mode === "system" ? (["light", "dark"] as const) : ([mode] as Array<"light" | "dark">)) {
				await page.emulateMedia({ colorScheme: system, reducedMotion: "no-preference" });
				await page.waitForFunction((expected) => document.documentElement.dataset.colourMode === expected, system);
				assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
				assert.equal(await page.locator(".visualization-card canvas").count(), 2);
				assert.equal(await page.locator(".visualization-card table tbody tr").count(), 2);
				for (const canvas of await page.locator(".visualization-card canvas").all()) {
					assert.ok(
						await canvas.evaluate((node) => {
							const canvas = node as HTMLCanvasElement;
							return (
								canvas.width > 0 &&
								canvas.height > 0 &&
								canvas
									.getContext("2d")!
									.getImageData(0, 0, canvas.width, canvas.height)
									.data.some((value, index) => index % 4 === 3 && value > 0)
							);
						}),
					);
				}
				emit({ type: "agent_start" });
				emit({ type: "message_end", message: { role: "user", content: `Request ${theme} ${mode} ${system}` } });
				emit({
					type: "message_update",
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "Review the supplied evidence." }],
					},
				});
				await page.locator(".thinking-live").waitFor();
				assert.equal(
					await page.locator(".thinking-live .thinking-body").isVisible(),
					true,
					"Reasoning preference must expand new live blocks",
				);
				await page.locator(".thinking-live .thinking-head").click();
				emit({
					type: "message_update",
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "Review the supplied evidence. Continue checking." }],
					},
				});
				await page.waitForFunction(() =>
					document.querySelector(".thinking-live .thinking-body")?.textContent?.includes("Continue checking."),
				);
				assert.equal(
					await page.locator(".thinking-live .thinking-body").isHidden(),
					true,
					"Streaming updates must respect a manually collapsed disclosure",
				);
				const flow = await page
					.locator("#feed > *")
					.evaluateAll((nodes) => nodes.slice(-2).map((node) => node.className));
				assert.deepEqual(
					flow,
					["message user", "thinking thinking-live"],
					"User prompt must precede its reasoning",
				);
				assert.equal(await page.locator(".thinking-live .glyph-pulse").count(), 1);
				assert.equal(
					await page
						.locator(".thinking-live .glyph-pulse")
						.first()
						.evaluate((node) => getComputedStyle(node).animationName),
					"glyph-blink",
				);
				await page.emulateMedia({ reducedMotion: "reduce" });
				assert.equal(
					await page
						.locator(".thinking-live .glyph-pulse")
						.first()
						.evaluate((node) => getComputedStyle(node).animationName),
					"none",
				);
				await page.emulateMedia({ reducedMotion: "no-preference" });
				emit({
					type: "message_end",
					message: {
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "Review the supplied evidence." },
							{ type: "text", text: `\`\`\`ts\nconst verified = true;\n\`\`\`${mathSnippet}` },
						],
					},
				});
				emit({ type: "agent_end" });
				await page.waitForFunction(() => !document.querySelector(".thinking-live"));
				assert.equal(await page.locator(".message.assistant .label").last().innerText(), "Copy");
				assert.equal(await page.locator(".message.assistant").last().locator(".katex").count(), 5);
				assert.equal(await page.locator(".message.assistant").last().locator("math mtable").count(), 2);
				assert.equal(
					await page
						.locator(".glyph-pulse")
						.last()
						.evaluate((node) => getComputedStyle(node).animationName),
					"none",
				);
				assert.ok(
					await page
						.locator("#feed")
						.innerText()
						.then((text) => text.includes("END-OF-SAVED-OUTPUT")),
				);
				for (const width of [1280, 390]) {
					await page.setViewportSize({ width, height: 900 });
					assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
					assert.ok(
						await page
							.locator("#prompt-form")
							.evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight),
					);
				}
				await page.setViewportSize({ width: 1280, height: 900 });
				if (process.env.WORKBENCH_QA_SCREENSHOTS)
					await page.screenshot({
						path: join(process.env.WORKBENCH_QA_SCREENSHOTS, `replay-${theme}-${mode}-${system}.png`),
						animations: "disabled",
					});
			}
		}
	}
	await page.reload();
	await connect();
	assert.equal(
		await page.locator(".thinking-body").first().isVisible(),
		true,
		"Reasoning display preference must survive reload",
	);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	assert.equal(await page.getByRole("switch", { name: "Always show reasoning", exact: false }).isChecked(), true);
	await page.getByRole("switch", { name: "Always show reasoning", exact: false }).uncheck();
	await page.getByRole("button", { name: "Close settings" }).click();
	assert.equal(await page.locator(".thinking-body").first().isHidden(), true);
	assert.deepEqual(errors, []);
	console.log(
		"PASS disk-backed reasoning, tool arguments, complete output, edit diffs and code across session switch and reload",
	);
} finally {
	await browser.close();
	await server.close();
	rmSync(root, { recursive: true, force: true });
}
