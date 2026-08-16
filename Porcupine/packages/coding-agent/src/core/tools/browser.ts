/**
 * Native browser-use tools for Porcupine, built on the Playwright wrapper in
 * src/porcupine/browser.ts. These provide semantic inspection, interaction,
 * responsive checks, diagnostics, screenshots, and evaluation through one
 * shared browser session.
 *
 * The definitions are registered in tools/index.ts; Playwright itself remains
 * lazy and is imported only when the shared browser session launches.
 */

import type { AgentTool, AgentToolResult } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { getBrowserSession } from "../../porcupine/browser.ts";
import { composeVisualLayer } from "../../porcupine/browser-vision.ts";
import type { ToolDefinition, ToolRenderContext, ToolRenderResultOptions } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const browserNavigateSchema = Type.Object({
	url: Type.String({ description: "HTTP(S) URL to navigate to" }),
	timeoutMs: Type.Optional(Type.Number({ description: "Navigation timeout in ms (default 15000)" })),
});

const browserClickSchema = Type.Object({
	selector: Type.String({ description: "CSS or Playwright selector of the element to click" }),
});

const browserTypeSchema = Type.Object({
	selector: Type.String({ description: "CSS or Playwright selector of the input field" }),
	text: Type.String({ description: "Text to type into the field" }),
});

const browserExtractSchema = Type.Object({
	selector: Type.Optional(
		Type.String({ description: "CSS selector to extract text from (defaults to whole page body)" }),
	),
});

const browserScreenshotSchema = Type.Object({
	path: Type.Optional(
		Type.String({ description: "Path inside the working directory (defaults to a timestamped PNG)" }),
	),
});

const browserEvaluateSchema = Type.Object({
	expression: Type.String({ description: "JavaScript expression to evaluate in the page" }),
});

const browserSnapshotSchema = Type.Object({
	depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum ARIA tree depth (1-50)" })),
	boxes: Type.Optional(Type.Boolean({ description: "Include viewport-relative element bounding boxes" })),
});

const browserResizeSchema = Type.Object({
	width: Type.Integer({ minimum: 240, maximum: 7680, description: "Viewport width in CSS pixels" }),
	height: Type.Integer({ minimum: 240, maximum: 4320, description: "Viewport height in CSS pixels" }),
});

const browserWaitSchema = Type.Object({
	selector: Type.String({ description: "CSS or Playwright selector to wait for" }),
	state: Type.Optional(
		Type.Union(
			[Type.Literal("visible"), Type.Literal("hidden"), Type.Literal("attached"), Type.Literal("detached")],
			{ description: "Required selector state (default visible)" },
		),
	),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 60_000, description: "Timeout in milliseconds" })),
});

const browserDiagnosticsSchema = Type.Object({});

export type BrowserNavigateToolInput = Static<typeof browserNavigateSchema>;
export type BrowserClickToolInput = Static<typeof browserClickSchema>;
export type BrowserTypeToolInput = Static<typeof browserTypeSchema>;
export type BrowserExtractToolInput = Static<typeof browserExtractSchema>;
export type BrowserScreenshotToolInput = Static<typeof browserScreenshotSchema>;
export type BrowserEvaluateToolInput = Static<typeof browserEvaluateSchema>;
export type BrowserSnapshotToolInput = Static<typeof browserSnapshotSchema>;
export type BrowserResizeToolInput = Static<typeof browserResizeSchema>;
export type BrowserWaitToolInput = Static<typeof browserWaitSchema>;
export type BrowserDiagnosticsToolInput = Static<typeof browserDiagnosticsSchema>;

interface BrowserToolDetails {
	action: string;
}

function renderCall(title: string, details: string): Text {
	return new Text(`${theme.fg("toolTitle", theme.bold(title))} ${theme.fg("toolOutput", details)}`, 0, 0);
}

function renderResult(
	result: AgentToolResult<BrowserToolDetails | undefined>,
	_options: ToolRenderResultOptions,
	_theme: unknown,
	_context: ToolRenderContext<any, any>,
): Text {
	const text = (result.content ?? [])
		.map((c) => (c.type === "text" ? c.text : ""))
		.join("")
		.trim();
	return new Text(`\n${theme.fg("toolOutput", text || "(empty)")}`, 0, 0);
}

export function createBrowserNavigateToolDefinition(): ToolDefinition<
	typeof browserNavigateSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_navigate",
		label: "browser_navigate",
		description:
			"Open a URL in the shared browser session. Launches a headless Chromium on first use and returns the page URL and title. Use other browser_* tools to operate on the open page.",
		promptSnippet: "Open a web page in the browser",
		promptGuidelines: [
			"Use browser_navigate to open a page, inspect with browser_snapshot, interact with browser_click/browser_type, wait on meaningful state, then verify with extract/diagnostics/screenshot. The session stays open across calls.",
		],
		parameters: browserNavigateSchema,
		async execute(_toolCallId, { url, timeoutMs }) {
			const session = getBrowserSession();
			const result = await session.launch();
			if (!result.startsWith("Browser already")) {
				// First launch; if it failed the message describes why.
				if (result.startsWith("Could not")) {
					return errorResult("browser_navigate", result);
				}
			}
			const nav = await session.navigate(url, timeoutMs);
			if (nav.startsWith("Could not") || nav.startsWith("No browser")) {
				return errorResult("browser_navigate", nav);
			}
			return {
				content: [{ type: "text", text: nav }],
				details: { action: "navigate" },
			};
		},
		renderCall(args) {
			return renderCall("browser_navigate", String(args?.url ?? "..."));
		},
		renderResult,
	};
}

export function createBrowserClickToolDefinition(): ToolDefinition<
	typeof browserClickSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_click",
		label: "browser_click",
		description: "Click the first element matching a CSS or Playwright selector in the open browser page.",
		promptSnippet: "Click an element on the page",
		promptGuidelines: ["Use browser_click on an element visible in the current browser_navigate page."],
		parameters: browserClickSchema,
		async execute(_toolCallId, { selector }) {
			const result = await getBrowserSession().click(selector);
			return ackResult("browser_click", result);
		},
		renderCall(args) {
			return renderCall("browser_click", String(args?.selector ?? "..."));
		},
		renderResult,
	};
}

export function createBrowserTypeToolDefinition(): ToolDefinition<
	typeof browserTypeSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_type",
		label: "browser_type",
		description: "Type text into an input field matching a CSS or Playwright selector in the open browser page.",
		promptSnippet: "Type text into a field",
		promptGuidelines: ["Use browser_type to fill a form input after navigating to the page."],
		parameters: browserTypeSchema,
		async execute(_toolCallId, { selector, text }) {
			const result = await getBrowserSession().type(selector, text);
			return ackResult("browser_type", result);
		},
		renderCall(args) {
			return renderCall("browser_type", `"${String(args?.selector ?? "...")}"`);
		},
		renderResult,
	};
}

export function createBrowserExtractToolDefinition(): ToolDefinition<
	typeof browserExtractSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_extract",
		label: "browser_extract",
		description:
			"Extract visible text from the open browser page. Extracts whole page body text when no selector is given, or a specific element's text when a selector is provided.",
		promptSnippet: "Extract text from the page",
		promptGuidelines: ["Use browser_extract to read rendered page content after navigating."],
		parameters: browserExtractSchema,
		async execute(_toolCallId, { selector }) {
			const result = await getBrowserSession().extractText(selector);
			return ackResult("browser_extract", result);
		},
		renderCall(args) {
			return renderCall("browser_extract", String(args?.selector ?? "(page body)"));
		},
		renderResult,
	};
}

export function createBrowserScreenshotToolDefinition(): ToolDefinition<
	typeof browserScreenshotSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_screenshot",
		label: "browser_screenshot",
		description:
			"Take a full-page screenshot and save it inside the working directory. Returns the path and defaults to a timestamped PNG when omitted.",
		promptSnippet: "Screenshot the current page",
		promptGuidelines: ["Use browser_screenshot to capture visual state of the open page."],
		parameters: browserScreenshotSchema,
		async execute(_toolCallId, { path }) {
			const result = await getBrowserSession().screenshot(path);
			return ackResult("browser_screenshot", result);
		},
		renderCall(args) {
			return renderCall("browser_screenshot", String(args?.path ?? "(temp file)"));
		},
		renderResult,
	};
}

export function createBrowserEvaluateToolDefinition(): ToolDefinition<
	typeof browserEvaluateSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_evaluate",
		label: "browser_evaluate",
		description:
			"Evaluate a JavaScript expression in the open browser page and return the result. Useful for reading dynamic state, counting elements, or running inline scripts.",
		promptSnippet: "Run JavaScript in the page",
		promptGuidelines: ["Use browser_evaluate for page state that plain text extraction cannot capture."],
		parameters: browserEvaluateSchema,
		async execute(_toolCallId, { expression }) {
			const result = await getBrowserSession().evaluate(expression);
			return ackResult("browser_evaluate", result);
		},
		renderCall(args) {
			return renderCall("browser_evaluate", String(args?.expression ?? "..."));
		},
		renderResult,
	};
}

export interface BrowserSnapshotToolOptions {
	/** True when the active model cannot see images; adds an OCR visual layer. */
	isTextOnlyModel?: () => boolean;
}

export function createBrowserSnapshotToolDefinition(
	options: BrowserSnapshotToolOptions = {},
): ToolDefinition<typeof browserSnapshotSchema, BrowserToolDetails | undefined> {
	return {
		name: "browser_snapshot",
		label: "browser_snapshot",
		description:
			"Capture an AI-oriented ARIA snapshot of the current page. Returns semantic roles, accessible names, and stable refs such as aria-ref=e2 for resilient browser inspection and interaction. When the active model cannot see images, a VISUAL LAYER (OCR of the rendered page) is appended so canvas, image, and rendered text is readable.",
		promptSnippet: "Inspect the page's semantic accessibility tree",
		promptGuidelines: [
			"Prefer browser_snapshot before browser_click/browser_type. Use returned refs with selectors such as aria-ref=e2 instead of brittle CSS when possible.",
		],
		parameters: browserSnapshotSchema,
		async execute(_toolCallId, { depth, boxes }) {
			const session = getBrowserSession();
			const snapshotText = await session.snapshot({ depth, boxes });
			if (options.isTextOnlyModel?.()) {
				const visual = await session.visualText();
				if (visual) {
					return ackResult("browser_snapshot", composeVisualLayer(snapshotText, visual));
				}
			}
			return ackResult("browser_snapshot", snapshotText);
		},
		renderCall(args) {
			return renderCall("browser_snapshot", `depth=${String(args?.depth ?? "all")}`);
		},
		renderResult,
	};
}

export function createBrowserResizeToolDefinition(): ToolDefinition<
	typeof browserResizeSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_resize",
		label: "browser_resize",
		description: "Resize the browser viewport to verify responsive layouts at an exact CSS-pixel width and height.",
		promptSnippet: "Resize the browser viewport",
		promptGuidelines: [
			"Use browser_resize before screenshots or snapshots at mobile, tablet, and desktop breakpoints.",
		],
		parameters: browserResizeSchema,
		async execute(_toolCallId, { width, height }) {
			return ackResult("browser_resize", await getBrowserSession().resize(width, height));
		},
		renderCall(args) {
			return renderCall("browser_resize", `${String(args?.width ?? "?")}x${String(args?.height ?? "?")}`);
		},
		renderResult,
	};
}

export function createBrowserWaitToolDefinition(): ToolDefinition<
	typeof browserWaitSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_wait",
		label: "browser_wait",
		description: "Wait for a page selector to become visible, hidden, attached, or detached with a bounded timeout.",
		promptSnippet: "Wait for asynchronous page state",
		promptGuidelines: ["Wait on a meaningful selector or state transition, never add arbitrary sleeps."],
		parameters: browserWaitSchema,
		async execute(_toolCallId, { selector, state, timeoutMs }) {
			return ackResult("browser_wait", await getBrowserSession().waitFor(selector, state, timeoutMs));
		},
		renderCall(args) {
			return renderCall("browser_wait", `${String(args?.selector ?? "...")} → ${String(args?.state ?? "visible")}`);
		},
		renderResult,
	};
}

export function createBrowserDiagnosticsToolDefinition(): ToolDefinition<
	typeof browserDiagnosticsSchema,
	BrowserToolDetails | undefined
> {
	return {
		name: "browser_diagnostics",
		label: "browser_diagnostics",
		description:
			"Report bounded console messages, uncaught page errors, failed requests, and HTTP 4xx/5xx responses since navigation. Request URL credentials, queries, and fragments are omitted.",
		promptSnippet: "Inspect runtime browser errors and failed requests",
		promptGuidelines: [
			"Use browser_diagnostics after exercising a page; do not declare UI work complete with unexplained errors.",
		],
		parameters: browserDiagnosticsSchema,
		async execute() {
			return ackResult("browser_diagnostics", await getBrowserSession().diagnostics());
		},
		renderCall() {
			return renderCall("browser_diagnostics", "since navigation");
		},
		renderResult,
	};
}

function ackResult(
	toolName: string,
	result: string,
): {
	content: { type: "text"; text: string }[];
	details: BrowserToolDetails | undefined;
} {
	const isError = result.startsWith("Could not") || result.startsWith("No browser");
	if (isError) {
		return {
			content: [{ type: "text", text: `[${toolName} error] ${result}` }],
			details: { action: toolName },
		};
	}
	return {
		content: [{ type: "text", text: result }],
		details: { action: toolName },
	};
}

function errorResult(
	toolName: string,
	msg: string,
): {
	content: { type: "text"; text: string }[];
	details: BrowserToolDetails | undefined;
} {
	return {
		content: [{ type: "text", text: `[${toolName} error] ${msg}` }],
		details: { action: toolName },
	};
}

// ---------------------------------------------------------------------------
// AgentTool wrappers (registered by the main agent in src/core/tools/index.ts)
// ---------------------------------------------------------------------------

export function createBrowserNavigateTool(): AgentTool<typeof browserNavigateSchema> {
	return wrapToolDefinition(createBrowserNavigateToolDefinition());
}

export function createBrowserClickTool(): AgentTool<typeof browserClickSchema> {
	return wrapToolDefinition(createBrowserClickToolDefinition());
}

export function createBrowserTypeTool(): AgentTool<typeof browserTypeSchema> {
	return wrapToolDefinition(createBrowserTypeToolDefinition());
}

export function createBrowserExtractTool(): AgentTool<typeof browserExtractSchema> {
	return wrapToolDefinition(createBrowserExtractToolDefinition());
}

export function createBrowserScreenshotTool(): AgentTool<typeof browserScreenshotSchema> {
	return wrapToolDefinition(createBrowserScreenshotToolDefinition());
}

export function createBrowserEvaluateTool(): AgentTool<typeof browserEvaluateSchema> {
	return wrapToolDefinition(createBrowserEvaluateToolDefinition());
}

export function createBrowserSnapshotTool(): AgentTool<typeof browserSnapshotSchema> {
	return wrapToolDefinition(createBrowserSnapshotToolDefinition());
}

export function createBrowserResizeTool(): AgentTool<typeof browserResizeSchema> {
	return wrapToolDefinition(createBrowserResizeToolDefinition());
}

export function createBrowserWaitTool(): AgentTool<typeof browserWaitSchema> {
	return wrapToolDefinition(createBrowserWaitToolDefinition());
}

export function createBrowserDiagnosticsTool(): AgentTool<typeof browserDiagnosticsSchema> {
	return wrapToolDefinition(createBrowserDiagnosticsToolDefinition());
}
