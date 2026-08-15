/**
 * Native browser-use module for Porcupine, built on the Playwright OSS engine.
 *
 * This file is a thin, typed wrapper around `playwright` that the agent can use
 * to navigate, inspect ARIA semantics, interact, wait, extract text, resize,
 * diagnose runtime failures, screenshot, and evaluate JavaScript on live pages.
 * Every public method returns a clean result string and turns
 * failures (bad URLs, missing elements, timeouts) into readable error messages
 * rather than stack dumps.
 *
 * Design notes:
 * - One active browser + context + page per `BrowserSession` instance. The
 *   session tracks the current URL and page title after every navigation.
 * - Navigation and any network-touching call get a timeout (default 15s,
 *   configurable via `launch({ timeoutMs })` or per-call).
 * - Headed mode is forced when PORCUPINE_BROWSER_VISIBLE=1, otherwise headless.
 * - A noop default session is exported so tools return clean "no page" acks
 *   when no browser has been launched; tools share one singleton session that
 *   the main agent can reset or replace for lifecycle wiring.
 *
 * Playwright must be installed separately; see docs/browser.md. It is a lazy,
 * optional dependency so the rest of Porcupine never needs a browser to be
 * installed.
 */

import { isAbsolute, resolve, sep } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { resolveBrowserVisionConfig, visionRead } from "./browser-vision.ts";

/** Launch options for opening a Chromium instance. */
export interface BrowserLaunchOptions {
	/** Run headless. Defaults to true unless PORCUPINE_BROWSER_VISIBLE=1. */
	headless?: boolean;
	/** Optional Chromium profile directory to reuse (agent-scoped profile). */
	userDataDir?: string;
	/** Default timeout in milliseconds for navigation/network calls (15s). */
	timeoutMs?: number;
}

export interface BrowserSnapshotOptions {
	/** Maximum ARIA tree depth. Defaults to Playwright's full snapshot. */
	depth?: number;
	/** Include viewport-relative element boxes. */
	boxes?: boolean;
}

export type BrowserWaitState = "attached" | "detached" | "visible" | "hidden";

const MAX_DIAGNOSTIC_ENTRIES = 100;
const MAX_BROWSER_OUTPUT_CHARS = 50_000;

/** The browser session the agent tools and the /browser command operate on. */
export class BrowserSession {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private readonly cwd: string;
	private timeoutMs: number;
	private consoleEntries: string[] = [];
	private pageErrors: string[] = [];
	private failedRequests: string[] = [];

	/** Current page URL, or null when no page is open. */
	currentUrlValue: string | null = null;
	/** Current page title, or null when no page is open. */
	currentTitleValue: string | null = null;

	constructor(timeoutMs?: number, cwd?: string) {
		this.timeoutMs = timeoutMs ?? 15_000;
		this.cwd = cwd ?? process.cwd();
	}

	/** True once a page has been launched. */
	isOpen(): boolean {
		return this.page !== null;
	}

	/** Human-readable description of the current session state. */
	status(): string {
		if (!this.isOpen()) {
			return "No browser session open. Call browser_navigate to open a page.";
		}
		const url = this.currentUrlValue ?? "(unknown url)";
		const title = this.currentTitleValue ?? "(unknown title)";
		return `Page: "${title}" at ${url}`;
	}

	/**
	 * Launch Chromium. The browser window opens headed when
	 * PORCUPINE_BROWSER_VISIBLE=1 or `headless` is explicitly false.
	 */
	async launch(options?: BrowserLaunchOptions): Promise<string> {
		if (this.page) {
			// Idempotent: reuse the already-open page.
			return `Browser already open. ${this.status()}`;
		}
		const headless = options?.headless ?? process.env.PORCUPINE_BROWSER_VISIBLE !== "1";
		const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
		try {
			if (options?.userDataDir) {
				const { chromium } = await import("playwright");
				this.context = await chromium.launchPersistentContext(options.userDataDir, { headless });
			} else {
				const { chromium } = await import("playwright");
				this.browser = await chromium.launch({ headless });
				this.context = await this.browser.newContext();
			}
			this.page = await this.context.newPage();
			this.page.setDefaultTimeout(timeoutMs);
			this.page.setDefaultNavigationTimeout(timeoutMs);
			this.attachDiagnostics(this.page);
			this.timeoutMs = timeoutMs;
			return `Browser launched (${headless ? "headless" : "headed"}). ${this.status()}`;
		} catch (err) {
			// On partial-launch failure, close any browser/context created so far so
			// nothing leaks before a later (re)tries launch.
			if (this.page || this.context || this.browser) {
				try {
					await this.close();
				} catch {
					// The original launch error is what matters; a close failure is secondary.
				}
			}
			return browserError("launch", err);
		}
	}

	/** Navigate to a URL. Returns the new URL + title on success. */
	async navigate(url: string, timeoutMs?: number): Promise<string> {
		if (!this.page) {
			return noSessionError("navigate");
		}
		const target = url.trim();
		if (!/^https?:\/\//i.test(target)) {
			return `Could not navigate: url must start with http:// or https:// (got "${target}")`;
		}
		const internalErr = internalHostError(target);
		if (internalErr) {
			return `Could not navigate: ${internalErr}`;
		}
		try {
			this.clearDiagnostics();
			await this.page.goto(target, { timeout: timeoutMs ?? this.timeoutMs, waitUntil: "load" });
			return await this.captureState();
		} catch (err) {
			return `Could not navigate to ${target}: ${errorMessage(err)}`;
		}
	}

	/** Click the first element matching the selector. */
	async click(selector: string): Promise<string> {
		if (!this.page) {
			return noSessionError("click");
		}
		try {
			await this.page.click(selector);
			return `Clicked "${selector}".`;
		} catch (err) {
			return `Could not click "${selector}": ${errorMessage(err)}`;
		}
	}

	/** Type text into the field matched by the selector. */
	async type(selector: string, text: string): Promise<string> {
		if (!this.page) {
			return noSessionError("type");
		}
		try {
			await this.page.fill(selector, text);
			return `Typed into "${selector}".`;
		} catch (err) {
			return `Could not type into "${selector}": ${errorMessage(err)}`;
		}
	}

	/** Extract text from a selector, or the whole page body when omitted. */
	async extractText(selector?: string): Promise<string> {
		if (!this.page) {
			return noSessionError("extract");
		}
		try {
			const text = selector ? await this.page.textContent(selector) : await this.page.locator("body").innerText();
			return `Extracted text:\n${(text ?? "").trim() || "(empty)"}`;
		} catch (err) {
			return `Could not extract text${selector ? ` from "${selector}"` : ""}: ${errorMessage(err)}`;
		}
	}

	/** Take a screenshot. Saves to the given path (or a temp default) and returns the path. */
	async screenshot(path?: string): Promise<string> {
		if (!this.page) {
			return noSessionError("screenshot");
		}
		const dest = path ? resolveWithinCwd(path, this.cwd) : defaultScreenshotPath();
		if (typeof dest === "string" && dest.startsWith("Could not ")) {
			return dest;
		}
		try {
			await this.page.screenshot({ path: dest as string, fullPage: true });
			return `Screenshot saved to ${dest}.`;
		} catch (err) {
			return `Could not take screenshot: ${errorMessage(err)}`;
		}
	}

	/** Evaluate a JavaScript expression in the page and stringify the result. */
	async evaluate(expression: string): Promise<string> {
		if (!this.page) {
			return noSessionError("evaluate");
		}
		try {
			const value = await this.page.evaluate(expression);
			return `Evaluated result:\n${stringifyResult(value)}`;
		} catch (err) {
			return `Could not evaluate expression: ${errorMessage(err)}`;
		}
	}

	/**
	 * OCR the rendered page through the configured vision model (Florence-2 by
	 * default) and return a bounded text layer for text-only models. Returns ""
	 * when OCR is disabled or no page is open; never throws (fail-closed).
	 */
	async visualText(): Promise<string> {
		if (!this.page) {
			return "";
		}
		try {
			const bytes = await this.page.screenshot({ fullPage: true });
			return await visionRead(bytes, resolveBrowserVisionConfig());
		} catch {
			return "";
		}
	}
	/** Capture a compact ARIA snapshot optimized for AI inspection and stable refs. */
	async snapshot(options: BrowserSnapshotOptions = {}): Promise<string> {
		if (!this.page) {
			return noSessionError("snapshot");
		}
		const depth = options.depth;
		if (depth !== undefined && (!Number.isInteger(depth) || depth < 1 || depth > 50)) {
			return "Could not snapshot page: depth must be an integer from 1 to 50";
		}
		try {
			const snapshot = await this.page.ariaSnapshot({ mode: "ai", depth, boxes: options.boxes ?? false });
			return `ARIA snapshot:\n${limitBrowserOutput(snapshot)}`;
		} catch (err) {
			return `Could not snapshot page: ${errorMessage(err)}`;
		}
	}

	/** Resize the page viewport for responsive-layout verification. */
	async resize(width: number, height: number): Promise<string> {
		if (!this.page) {
			return noSessionError("resize");
		}
		if (!validViewportDimension(width, 240, 7680) || !validViewportDimension(height, 240, 4320)) {
			return "Could not resize viewport: width must be 240-7680 and height must be 240-4320 CSS pixels";
		}
		try {
			await this.page.setViewportSize({ width, height });
			return `Viewport resized to ${width}x${height}.`;
		} catch (err) {
			return `Could not resize viewport: ${errorMessage(err)}`;
		}
	}

	/** Wait for a selector to reach a specific state. */
	async waitFor(selector: string, state: BrowserWaitState = "visible", timeoutMs?: number): Promise<string> {
		if (!this.page) {
			return noSessionError("wait");
		}
		const timeout = timeoutMs ?? this.timeoutMs;
		if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000) {
			return "Could not wait for selector: timeoutMs must be between 1 and 60000";
		}
		try {
			await this.page.waitForSelector(selector, { state, timeout });
			return `Selector "${selector}" reached state "${state}".`;
		} catch (err) {
			return `Could not wait for "${selector}" to become ${state}: ${errorMessage(err)}`;
		}
	}

	/** Return console errors, uncaught page errors, and failed requests since navigation. */
	async diagnostics(): Promise<string> {
		if (!this.page) {
			return noSessionError("inspect diagnostics");
		}
		const lines = [...this.consoleEntries, ...this.pageErrors, ...this.failedRequests];
		return lines.length === 0
			? "Browser diagnostics: no console messages, page errors, or failed requests since navigation."
			: `Browser diagnostics:\n${limitBrowserOutput(lines.join("\n"))}`;
	}

	/** The current page URL as a string (empty when no page is open). */
	currentUrl(): string {
		return this.currentUrlValue ?? "";
	}

	/** Close the browser session and clear tracked state. */
	async close(): Promise<string> {
		try {
			if (this.page) await this.page.close().catch(() => undefined);
			if (this.context) await this.context.close().catch(() => undefined);
			if (this.browser) await this.browser.close().catch(() => undefined);
		} catch {
			// Closing is best-effort; never surface stack dumps.
		}
		this.page = null;
		this.context = null;
		this.browser = null;
		this.currentUrlValue = null;
		this.currentTitleValue = null;
		this.clearDiagnostics();
		return "Browser session closed.";
	}

	private attachDiagnostics(page: Page): void {
		page.on("console", (message) => {
			pushBounded(this.consoleEntries, `console.${message.type()}: ${message.text()}`);
		});
		page.on("pageerror", (error) => {
			pushBounded(this.pageErrors, `pageerror: ${errorMessage(error)}`);
		});
		page.on("requestfailed", (request) => {
			const failure = request.failure()?.errorText ?? "request failed";
			pushBounded(
				this.failedRequests,
				`requestfailed: ${request.method()} ${safeDiagnosticUrl(request.url())} — ${failure}`,
			);
		});
		page.on("response", (response) => {
			if (response.status() < 400) return;
			pushBounded(
				this.failedRequests,
				`http ${response.status()}: ${response.request().method()} ${safeDiagnosticUrl(response.url())}`,
			);
		});
	}

	private clearDiagnostics(): void {
		this.consoleEntries = [];
		this.pageErrors = [];
		this.failedRequests = [];
	}

	private async captureState(): Promise<string> {
		const url = this.page?.url() ?? null;
		this.currentUrlValue = url;
		if (this.page) {
			this.currentTitleValue = (await this.page.title().catch(() => "")) || "(untitled)";
		} else {
			this.currentTitleValue = null;
		}
		return this.status();
	}
}

/**
 * A noop session used before any real browser is launched. Every call returns
 * a clean "no browser" ack so tool code never crashes on an unopened session.
 */
export const noopSession: BrowserSession = new BrowserSession(0);

// ============================================================================
// Shared singleton for tools
// ============================================================================

let sharedSession: BrowserSession | null = null;

/** Get the shared browser session, creating the default (noop) one on demand. */
export function getBrowserSession(): BrowserSession {
	if (!sharedSession) {
		sharedSession = noopSession;
	}
	return sharedSession;
}

/** Replace the shared session (e.g. install a fresh instance for a reload). */
export function setBrowserSession(session: BrowserSession): void {
	sharedSession = session;
}

/** Reset the shared session to a fresh noop instance and close any old one. */
export async function resetBrowserSession(): Promise<void> {
	if (sharedSession && sharedSession !== noopSession) {
		await sharedSession.close();
	}
	sharedSession = noopSession;
}

// ============================================================================
// Helpers
// ============================================================================

function browserError(action: string, err: unknown): string {
	return `Could not ${action} browser: ${errorMessage(err)}`;
}

function noSessionError(action: string): string {
	return `No browser session open. Call browser_navigate first to open a page and then ${action}.`;
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		const msg = err.message.replace(/\s+/g, " ").trim();
		return msg || err.name || "unknown error";
	}
	return String(err);
}

/**
 * Detect private/reserved/loopback hosts a browser should not be pointed at
 * (SSRF guard). Returns an error string when blocked, or null when allowed.
 * Set PORCUPINE_BROWSER_ALLOW_INTERNAL=1 to opt out.
 */
function internalHostError(target: string): string | null {
	if (process.env.PORCUPINE_BROWSER_ALLOW_INTERNAL === "1") return null;
	let u: URL;
	try {
		u = new URL(target);
	} catch {
		return `could not parse url "${target}"`;
	}
	const host = u.hostname.toLowerCase().replace(/\.$/, "");
	// Hostnames that resolve to the machine or a LAN.
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
		return `refusing internal host "${host}"`;
	}
	// IPv4 literal.
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const [a, b, c, d] = ipv4.slice(1).map(Number);
		if ([a, b, c, d].some((n) => n < 0 || n > 255)) return `refusing invalid host "${host}"`;
		const reserved =
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 100 && b >= 64 && b <= 127);
		if (reserved) return `refusing internal host "${host}"`;
	}
	// IPv6 loopback / unspecified.
	if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host === "::" || host === "0:0:0:0:0:0:0:0") {
		return `refusing internal host "${host}"`;
	}
	return null;
}

/** Resolve a screenshot path against the session cwd; reject absolute paths outside it. */
function resolveWithinCwd(path: string, cwd: string): string {
	if (isAbsolute(path)) {
		const root = resolve(cwd);
		const abs = resolve(path);
		if (abs !== root && !abs.startsWith(root + sep)) {
			return `Could not take screenshot: path "${path}" is outside the working directory`;
		}
		return abs;
	}
	return resolve(cwd, path);
}

function pushBounded(entries: string[], value: string): void {
	entries.push(value);
	if (entries.length > MAX_DIAGNOSTIC_ENTRIES) entries.shift();
}

function safeDiagnosticUrl(raw: string): string {
	try {
		const url = new URL(raw);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return "(unparseable URL)";
	}
}

function validViewportDimension(value: number, min: number, max: number): boolean {
	return Number.isInteger(value) && value >= min && value <= max;
}

function limitBrowserOutput(value: string): string {
	if (value.length <= MAX_BROWSER_OUTPUT_CHARS) return value;
	return `${value.slice(0, MAX_BROWSER_OUTPUT_CHARS)}\n… [truncated]`;
}

function stringifyResult(value: unknown): string {
	if (typeof value === "string") return value || "(empty string)";
	try {
		const s = JSON.stringify(value, null, 2);
		return s === undefined ? String(value) : s;
	} catch {
		return String(value);
	}
}

function defaultScreenshotPath(): string {
	const stamp = new Date()
		.toISOString()
		.replace(/[^0-9]/g, "")
		.slice(0, 14);
	return `browser-${stamp}.png`;
}
