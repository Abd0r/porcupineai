import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PORCUPINE_WEB_UI } from "../src/server/web-ui.ts";

class FakeCanvasContext {
	clearCount = 0;
	fillCount = 0;
	strokeCount = 0;
	readonly texts: string[] = [];
	fillRect(): void {
		this.fillCount += 1;
	}
	setTransform(): void {}
	clearRect(): void {
		this.clearCount += 1;
	}
	beginPath(): void {}
	moveTo(): void {}
	lineTo(): void {}
	closePath(): void {}
	fill(): void {
		this.fillCount += 1;
	}
	stroke(): void {
		this.strokeCount += 1;
	}
	arc(): void {}
	fillText(text: string): void {
		this.texts.push(text);
	}
	createRadialGradient(): { addColorStop(): void } {
		return { addColorStop() {} };
	}
}

class FakeElement {
	readonly dataset: Record<string, string> = {};
	readonly children: FakeElement[] = [];
	parentNode?: FakeElement;
	get parentElement(): FakeElement | undefined {
		return this.parentNode;
	}
	get nextElementSibling(): FakeElement | undefined {
		return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1];
	}
	contains(node?: FakeElement): boolean {
		return node === this || this.children.some((child) => child.contains(node));
	}
	focus(): void {}
	remove(): void {
		if (this.parentNode) {
			const siblings = this.parentNode.children;
			siblings.splice(siblings.indexOf(this), 1);
			this.parentNode = undefined;
		}
	}
	insertBefore(item: FakeElement, before: FakeElement): void {
		item.remove();
		item.parentNode = this;
		this.children.splice(this.children.indexOf(before), 0, item);
	}
	readonly attributes = new Map<string, string>();
	readonly listeners = new Set<string>();
	readonly handlers = new Map<string, () => void | Promise<void>>();
	readonly classes = new Set<string>();
	readonly classList = {
		add: (name: string) => {
			this.classes.add(name);
		},
		remove: (name: string) => {
			this.classes.delete(name);
		},
		contains: (name: string) => this.classes.has(name),
		toggle: (name: string, force?: boolean) => {
			const next = force ?? !this.classes.has(name);
			if (next) this.classes.add(name);
			else this.classes.delete(name);
			return next;
		},
	};
	readonly style = { setProperty: (_name: string, _value: string) => {} };
	className = "";
	private text = "";
	get textContent(): string {
		return this.text + this.children.map((child) => child.textContent).join("");
	}
	set textContent(value: string) {
		this.text = value;
		this.children.splice(0);
	}
	hidden = false;
	tabIndex = -1;
	width = 0;
	height = 0;
	scrollTop = 0;
	scrollHeight = 0;
	role = "";
	value = "";
	clientHeight = 640;
	querySelectorAll(): FakeElement[] {
		return [];
	}
	readonly tagName: string;
	private readonly canvasContext: FakeCanvasContext;
	constructor(tagName: string, canvasContext: FakeCanvasContext) {
		this.tagName = tagName;
		this.canvasContext = canvasContext;
	}
	get lastChild(): FakeElement | undefined {
		return this.children[this.children.length - 1];
	}
	addEventListener(type: string, handler?: () => void): void {
		this.listeners.add(type);
		if (handler) this.handlers.set(type, handler);
	}
	append(...items: FakeElement[]): void {
		for (const item of items) {
			item.remove();
			item.parentNode = this;
		}
		this.children.push(...items);
	}
	appendChild(item: FakeElement): FakeElement {
		item.parentNode = this;
		this.children.push(item);
		return item;
	}
	replaceChildren(...items: FakeElement[]): void {
		this.text = "";
		this.children.splice(0, this.children.length, ...items);
	}
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}
	getBoundingClientRect(): { width: number; height: number } {
		return { width: 640, height: 320 };
	}
	getContext(): FakeCanvasContext {
		return this.canvasContext;
	}
	setPointerCapture(): void {}
	open = false;
	showModal(): void {
		this.open = true;
	}
	close(): void {
		this.open = false;
		this.handlers.get("close")?.();
	}
}

function loadRenderer(mockFetch?: typeof fetch): {
	render(scene: unknown): void;
	event(event: unknown): void;
	feed: FakeElement;
	elements: Map<string, FakeElement>;
	canvasContext: FakeCanvasContext;
	rich(node: FakeElement, text: string): FakeElement;
	connect(id: string): Promise<void>;
	text(value: unknown): string;
	mathCalls: Array<{ source: string; displayMode: boolean; trust: boolean }>;
} {
	const canvasContext = new FakeCanvasContext();
	const mathCalls: Array<{ source: string; displayMode: boolean; trust: boolean }> = [];
	const elements = new Map<string, FakeElement>();
	for (const id of [
		"auth",
		"auth-form",
		"token",
		"auth-error",
		"sessions",
		"new-session",
		"feed",
		"welcome",
		"prompt-form",
		"command-menu",
		"chat-files",
		"attach-files",
		"chat-attachments",
		"prompt",
		"send",
		"stop",
		"error",
		"status-text",
		"status-dot",
		"session-title",
		"limit-compact",
		"limit-subagents",
		"limits-apply",
		"limits-status",
		"subagent-card",
		"subagent-toggle",
		"subagent-state",
		"subagent-list",
		"subagent-empty",
		"status-text",
		"model-dialog",
		"model-search",
		"model-list",
		"model-status",
		"model-scope-note",
		"model-default-open",
		"sidebar-toggle",
		"model-subagent-open",
		"subagent-model-current",
		"context-ring",
		"ring-fill",
		"context-tip",
		"goal-card",
		"goal-toggle",
		"goal-body",
		"goal-state",
		"goal-objective",
		"goal-steps",
		"goal-empty",
		"session-controls",
		"reasoning-mode",
		"reasoning-icon",
		"autonomy-icon",
		"reasoning-control",
		"autonomy-control",
		"autonomy-mode",
		"session-model",
		"stacks-tree",
		"stack-dialog",
		"skills-folder",
		"skills-count",
		"skills-search",
		"skills-items",
		"skills-more",
		"tools-folder",
		"tools-count",
		"tools-search",
		"tools-items",
		"tools-more",
		"projects-tree",
		"projects-count",
		"project-list",
		"project-new",
		"project-dialog",
		"project-title",
		"project-delete",
		"project-conversation",
		"conversation-menu",
		"conversation-menu-title",
		"conversation-project",
		"conversation-delete",
		"conversation-action-error",
		"project-summary",
		"project-files",
		"project-preview",
		"project-upload",
		"project-upload-status",
		"new-project-dialog",
		"new-project-name",
		"new-project-title-input",
		"new-project-error",
		"new-project-create",
		"settings-dialog",
		"artifact-dialog",
		"artifact-title",
		"artifact-content",
		"artifact-open",
		"artifact-download",
		"settings-open",
		"appearance-theme",
		"appearance-todos-placement",
		"appearance-workers-placement",
		"appearance-mode",
		"appearance-reasoning",
		"appearance-motion",
		"appearance-image",
		"appearance-remove",
		"appearance-opacity",
		"appearance-opacity-value",
		"appearance-error",
		"chat-backdrop",
		"sidebar",
		"sidebar-dismiss",
		"jump-latest",
		"reconnect",
		"session-search",
		"agent-inspector",
		"inspector-toggle",
		"history-notice",
		"work-rail",
		"work-rail-overlay",
		"rail-toggle",
		"todos-panel",
		"todos-objective",
		"todos-goal",
		"todos-count",
		"todos-list",
		"workers-panel",
		"workers-count",
		"workers-list",
	]) {
		elements.set(id, new FakeElement("div", canvasContext));
	}
	new FakeElement("div", canvasContext).append(elements.get("feed")!);
	const document = {
		documentElement: new FakeElement("html", canvasContext),
		addEventListener(): void {},
		querySelector(): FakeElement {
			return new FakeElement("div", canvasContext);
		},
		querySelectorAll(): FakeElement[] {
			return [];
		},
		getElementById(id: string): FakeElement {
			const element = elements.get(id);
			if (!element) throw new Error(`Unknown test element: ${id}`);
			return element;
		},
		createElementNS(_namespace: string, tagName: string): FakeElement {
			return new FakeElement(tagName, canvasContext);
		},
		createElement(tagName: string): FakeElement {
			return new FakeElement(tagName, canvasContext);
		},
		createTextNode(text: string): FakeElement {
			const node = new FakeElement("#text", canvasContext);
			node.textContent = text;
			return node;
		},
	};
	const sandbox = {
		fetch: mockFetch ?? (async () => Response.json({ supported: false, sessions: [] })),
		Headers,
		URL,
		AbortController,
		TextDecoder,
		innerHeight: 960,
		requestAnimationFrame: (callback: () => void) => {
			callback();
			return 0;
		},
		cancelAnimationFrame: () => {},
		setInterval: () => 0,
		clearInterval: () => {},
		setTimeout: () => 0,
		document,
		window: {
			katex: {
				render(source: string, node: FakeElement, options: { displayMode: boolean; trust: boolean }) {
					if (source.includes("notacommand")) throw new Error("Unsupported math");
					mathCalls.push({ source, displayMode: options.displayMode, trust: options.trust });
					const math = document.createElement("math");
					math.textContent = source;
					node.append(math);
				},
			},
			devicePixelRatio: 1,
			addEventListener() {},
			getComputedStyle: () => ({ getPropertyValue: () => "#a0a0a0" }),
			localStorage: { getItem: () => null, setItem() {} },
			matchMedia: () => ({ matches: true, addEventListener() {} }),
			dispatchEvent() {},
		},
		Event: class {},
		ResizeObserver: class {
			observe(): void {}
			disconnect(): void {}
		},
	};
	const script = PORCUPINE_WEB_UI.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1];
	if (!script) throw new Error("Workbench script is missing");
	const instrumented = script.replace(
		/\}\)\(\);\s*$/,
		"globalThis.__connect=connectEvents;globalThis.__text=textOf;globalThis.__renderVisualization=renderVisual;globalThis.__renderEvent=renderEvent;globalThis.__renderRichText=renderRichText;})();",
	);
	if (instrumented === script) throw new Error("Could not expose the renderer to its test harness");
	runInNewContext(instrumented, sandbox);
	const render = runInNewContext("globalThis.__renderVisualization", sandbox) as (scene: unknown) => void;
	const feed = elements.get("feed");
	if (!feed) throw new Error("Test feed element is missing");
	const event = runInNewContext("globalThis.__renderEvent", sandbox) as (event: unknown) => void;
	const rich = (node: FakeElement, text: string): FakeElement => {
		Object.assign(sandbox, { __node: node, __source: text });
		return runInNewContext("globalThis.__renderRichText(__node,__source)", sandbox, { timeout: 500 }) as FakeElement;
	};
	const connect = runInNewContext("globalThis.__connect", sandbox) as (id: string) => Promise<void>;
	const text = runInNewContext("globalThis.__text", sandbox) as (value: unknown) => string;
	return { render, event, rich, feed, elements, canvasContext, connect, text, mathCalls };
}

describe("workbench transport regressions", () => {
	it("keeps sub-agent tools internal and updates one task row without tool chatter", () => {
		const { event, feed, elements } = loadRenderer();
		const run = {
			id: "worker",
			name: "buck",
			task: "Verify the change",
			status: "running",
			steps: 1,
			lastTool: "bash",
			lastToolArgs: { command: "internal-command-marker" },
		};
		event({ type: "subagents", runs: [run] });
		event({
			type: "subagents",
			runs: [{ ...run, steps: 2, lastTool: "read", lastToolArgs: { path: "internal-file-marker" } }],
		});
		expect(feed.children).toHaveLength(0);
		const workers = elements.get("workers-list")!;
		expect(workers.children).toHaveLength(1);
		expect(workers.children[0]?.tagName).toBe("section");
		expect(workers.textContent).toContain("Verify the change");
		expect(workers.textContent).not.toMatch(/internal-command-marker|internal-file-marker|Running a command|Reading/);
	});
	it("keeps main activity in order and puts goals and workers in the overview", () => {
		const { event, feed, elements } = loadRenderer();
		event({ type: "message_end", message: { role: "user", content: "Fix this" } });
		event({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: { path: "AGENTS.md" } });
		event({
			type: "goal_plan",
			status: {
				goal: { objective: "Fix this", status: "active", steps: [{ objective: "Verify", status: "active" }] },
			},
		});
		event({
			type: "subagents",
			runs: [{ id: "worker", name: "buck", task: "Verify the fix", status: "running", steps: 1 }],
		});
		event({ type: "message_end", message: { role: "assistant", content: "Verified." } });
		expect(feed.children.filter((node) => node.className !== "thinking").map((node) => node.className)).toEqual([
			"message user",
			"tool-activity",
			"message assistant",
		]);
		expect(elements.get("todos-objective")?.textContent).toBe("Fix this");
		expect(elements.get("todos-list")?.textContent).toContain("Verify");
		expect(elements.get("workers-list")?.textContent).toContain("Verify the fix");
	});
	it("renders real SSE frames split across network chunks", async () => {
		const wire = `data: ${JSON.stringify({ type: "message_end", message: { role: "user", content: "Real event" } })}\n\n`;
		const encoder = new TextEncoder();
		const { connect, feed } = loadRenderer(async (path) => {
			if (!String(path).endsWith("/events")) return Response.json({ supported: false });
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(wire.slice(0, 19)));
						controller.enqueue(encoder.encode(wire.slice(19)));
						controller.close();
					},
				}),
			);
		});
		await connect("test");
		expect(descendants(feed).some((node) => node.textContent === "Real event")).toBe(true);
	});
	it("joins content blocks with actual newlines", () => {
		const { text } = loadRenderer();
		expect(
			text([
				{ type: "text", text: "First" },
				{ type: "text", text: "Second" },
			]),
		).toBe("First\nSecond");
	});
});

const scene = {
	version: 1,
	title: "<img src=x onerror=alert(1)>",
	description: "A bounded test scene.",
	objects: [
		{ type: "box", position: [0, 1, 0], size: [1, 1, 1], color: "#80c060", label: "block" },
		{ type: "sphere", position: [1, 1, 0], radius: 0.5, color: "#6080d0", label: "orb" },
		{ type: "arrow", from: [0, 0, 0], to: [1, 2, 0], color: "#f0a050", label: "up" },
	],
} as const;

function descendants(element: FakeElement): FakeElement[] {
	return [element, ...element.children.flatMap(descendants)];
}

const diagram = {
	version: 2,
	kind: "diagram",
	title: "Force diagram",
	description: "An illustrative free-body diagram.",
	objects: [
		{ type: "rectangle", position: [0, 0], size: [2, 1], color: "#80c060", label: "Mass" },
		{ type: "circle", position: [-3, 0], radius: 1, color: "#6080d0" },
		{ type: "arrow", from: [0, 0], to: [0, 4], color: "#f0a050", label: "Force (N)" },
		{ type: "line", from: [-4, -1], to: [4, -1], color: "#ffffff" },
		{ type: "text", position: [0, -3], text: "F = ma <script>", color: "#ffffff" },
	],
};
const chart = {
	version: 2,
	kind: "chart",
	title: "Illustrative displacement",
	chartType: "line",
	xLabel: "Time (s)",
	yLabel: "Position (m)",
	series: [
		{
			name: "Example",
			color: "#80c060",
			points: [
				{ x: 0, y: -2, error: 0.5 },
				{ x: 1, y: 4, label: "Peak" },
			],
		},
	],
};

describe("browser teaching visuals", () => {
	it("routes successful visualization events and ignores failed or unrelated tools", () => {
		const { event, feed } = loadRenderer();
		const payload = {
			type: "tool_execution_end",
			toolName: "visualize",
			result: { details: { visualization: chart } },
		};
		event({ ...payload, isError: true });
		event({ ...payload, toolName: "other" });
		expect(feed.children).toHaveLength(0);
		event(payload);
		event({ ...payload, toolName: "visualize_3d", result: { details: { visualization: scene } } });
		expect(feed.children).toHaveLength(2);
	});
	it("draws all 2D primitives and exposes their text descriptions", () => {
		const { render, feed, canvasContext } = loadRenderer();
		render(diagram);
		expect(feed.children).toHaveLength(1);
		expect(canvasContext.texts).toContain("F = ma <script>");
		const nodes = descendants(feed);
		expect(nodes.some((node) => node.textContent.includes("Force (N)") && node.tagName === "li")).toBe(true);
		expect(nodes.find((node) => node.tagName === "canvas")?.attributes.get("role")).toBe("img");
	});

	it.each(["line", "scatter", "bar"])("draws %s charts with units and a full accessible data table", (chartType) => {
		const { render, feed, canvasContext } = loadRenderer();
		render({ ...chart, chartType });
		expect(feed.children).toHaveLength(1);
		const nodes = descendants(feed);
		expect(nodes.some((node) => node.tagName === "table")).toBe(true);
		expect(nodes.filter((node) => node.tagName === "th").map((node) => node.textContent)).toEqual([
			"Series",
			"Time (s)",
			"Position (m)",
			"± y uncertainty",
			"Label",
		]);
		expect(nodes.filter((node) => node.tagName === "td").map((node) => node.textContent)).toContain("0.5");
		expect(canvasContext.texts).toContain("Time (s)");
		expect(canvasContext.texts).toContain("Position (m)");
		expect(canvasContext.strokeCount).toBeGreaterThan(0);
	});

	it("handles constant, zero, negative, and extreme bounded data without losing the chart", () => {
		for (const y of [0, -5, 1e12]) {
			const { render, feed } = loadRenderer();
			render({ ...chart, series: [{ ...chart.series[0], points: [{ x: 0, y }] }] });
			expect(feed.children).toHaveLength(1);
		}
	});

	it("rejects malformed new visuals and explains why no figure appeared", () => {
		const { render, feed } = loadRenderer();
		for (const input of [
			{ ...diagram, objects: [{ ...diagram.objects[0], script: "alert(1)" }] },
			{ ...diagram, objects: [{ type: "circle", position: [0, 0], radius: -1, color: "#ffffff" }] },
			{ ...chart, xLabel: " " },
			{ ...chart, series: [{ ...chart.series[0], points: [{ x: NaN, y: 2 }] }] },
			{ ...chart, series: [{ ...chart.series[0], points: [{ x: 0, y: 2, error: -1 }] }] },
			{ ...chart, chartType: "execute" },
			{ ...chart, source: "https://example.com" },
		])
			render(input);
		expect(feed.children).toHaveLength(7);
		expect(descendants(feed).some((node) => node.tagName === "canvas")).toBe(false);
		expect(feed.textContent).toContain("could not be displayed");
	});
});

describe("browser 3D scene renderer", () => {
	it("renders supported primitives with accessible controls and literal model text", () => {
		const { render, feed, canvasContext } = loadRenderer();
		render(scene);

		expect(feed.children).toHaveLength(1);
		const card = feed.children[0];
		if (!card) throw new Error("Visualization card was not created");
		expect(card.children[0]?.textContent).toBe(scene.title);
		expect(canvasContext.clearCount).toBe(1);
		expect(canvasContext.fillCount).toBeGreaterThan(0);
		const canvas = descendants(card).find((child) => child.tagName === "canvas");
		expect(canvas?.attributes.get("role")).toBe("img");
		expect(canvas?.listeners.has("keydown")).toBe(true);
		const controls = card.children.find((child) => child.className === "scene-controls");
		expect(controls?.children.map((button) => button.textContent)).toEqual([
			"Rotate left",
			"Rotate right",
			"Tilt up",
			"Tilt down",
			"Reset",
		]);
	});

	it("fails closed for malformed scenes before adding any DOM content", () => {
		const { render, feed } = loadRenderer();
		render({ ...scene, objects: [{ type: "mesh", source: "<script>" }] });
		render({ ...scene, objects: Array.from({ length: 81 }, () => scene.objects[0]) });
		expect(feed.children).toHaveLength(0);
	});
});

describe("rich message rendering", () => {
	it("ignores a file response that arrives after its preview was closed", async () => {
		let finish: ((response: Response) => void) | undefined;
		const { rich, elements } = loadRenderer(async (path) => {
			if (String(path).includes("/artifact?"))
				return new Promise<Response>((resolve) => {
					finish = resolve;
				});
			return Response.json({ supported: false });
		});
		const node = rich(new FakeElement("div", new FakeCanvasContext()), "[Report](report.pdf)");
		const pending = descendants(node)
			.find((child) => child.tagName === "button")
			?.handlers.get("click")?.();
		elements.get("artifact-dialog")?.close();
		finish!(
			new Response("%PDF-1.7", { headers: { "content-type": "application/pdf", "x-porcupine-preview": "pdf" } }),
		);
		await pending;
		expect(elements.get("artifact-content")?.children).toHaveLength(0);
		expect(elements.get("artifact-open")?.attributes.has("href")).toBe(false);
	});
	it("renders local files as preview cards, fetches on demand and previews text literally", async () => {
		const requests: string[] = [];
		const { rich, connect, elements } = loadRenderer(async (path) => {
			requests.push(String(path));
			if (String(path).includes("/artifact?"))
				return new Response("<script>literal text</script>", {
					headers: {
						"content-type": "text/plain",
						"x-porcupine-preview": "text",
						"x-porcupine-name": "notes.txt",
					},
				});
			return Response.json({ supported: false });
		});
		await connect("files");
		const node = rich(
			new FakeElement("div", new FakeCanvasContext()),
			"[Notes](notes.txt) and ![Plot](plot.png) and [Unsafe](javascript:alert)",
		);
		const cards = descendants(node).filter((child) => child.className === "artifact-card");
		expect(cards).toHaveLength(2);
		expect(requests.filter((path) => path.includes("/artifact?"))).toHaveLength(0);
		await descendants(cards[0])
			.find((child) => child.tagName === "button")
			?.handlers.get("click")?.();
		expect(requests).toContain("/session/files/artifact?path=notes.txt");
		expect(elements.get("artifact-content")?.children[0]?.tagName).toBe("pre");
		expect(elements.get("artifact-content")?.textContent).toBe("<script>literal text</script>");
		expect(elements.get("artifact-download")?.hidden).toBe(false);
		expect(
			descendants(node)
				.find((child) => child.textContent === "Unsafe")
				?.attributes.get("href"),
		).toBeUndefined();
		elements.get("artifact-dialog")?.close();
		expect(elements.get("artifact-content")?.children).toHaveLength(0);
	});
	it.each(["| A plain line, not a table", "``` typescript with a title"])(
		"does not stall on incomplete Markdown: %s",
		(source) => {
			const { rich } = loadRenderer();
			const node = rich(new FakeElement("div", new FakeCanvasContext()), source);
			expect(descendants(node).some((child) => child.textContent === source)).toBe(true);
		},
	);
	it("renders fenced code with a language label and copy control", () => {
		const { rich } = loadRenderer();
		const node = rich(new FakeElement("div", new FakeCanvasContext()), "Intro\n\n```ts\nconst x = 1 < 2;\n```");
		const block = descendants(node).find((child) => child.className === "code-block");
		if (!block) throw new Error("code block missing");
		expect(descendants(block).some((child) => child.textContent === "ts")).toBe(true);
		expect(descendants(block).some((child) => child.textContent === "const x = 1 < 2;")).toBe(true);
		expect(
			descendants(block)
				.filter((child) => child.tagName === "button")
				.map((child) => child.textContent),
		).toEqual(["Copy"]);
	});

	it("renders a Markdown table with scoped headers", () => {
		const { rich } = loadRenderer();
		const node = rich(
			new FakeElement("div", new FakeCanvasContext()),
			"| Step | Time (s) |\n| --- | --- |\n| warm | 0.4 |",
		);
		const table = descendants(node).find((child) => child.tagName === "table");
		if (!table) throw new Error("table missing");
		expect(
			descendants(table)
				.filter((child) => child.tagName === "th")
				.map((child) => child.textContent),
		).toEqual(["Step", "Time (s)"]);
		expect(
			descendants(table)
				.filter((child) => child.tagName === "td")
				.map((child) => child.textContent),
		).toEqual(["warm", "0.4"]);
	});

	it("delegates complete LaTeX expressions to the trusted renderer with untrusted-input options", () => {
		const { rich, mathCalls } = loadRenderer();
		const node = rich(
			new FakeElement("div", new FakeCanvasContext()),
			"Inline $\\frac{a}{b}$ and $x^2 + \\sqrt{y}$ then $$\\sum_{i=1}^{n} \\alpha_i$$",
		);
		const tags = descendants(node).map((child) => child.tagName);
		expect(tags).toContain("math");
		expect(mathCalls.map((call) => call.source)).toEqual([
			"\\frac{a}{b}",
			"x^2 + \\sqrt{y}",
			"\\sum_{i=1}^{n} \\alpha_i",
		]);
		expect(mathCalls.every((call) => call.trust === false)).toBe(true);
		const display = rich(new FakeElement("div", new FakeCanvasContext()), "$$\\int_0^1 f(x)\\,dx$$");
		expect(descendants(display).some((child) => child.className === "math-display")).toBe(true);
		expect(descendants(display).some((child) => child.tagName === "math")).toBe(true);
	});

	it("keeps unsupported LaTeX visible instead of silently dropping it", () => {
		const { rich } = loadRenderer();
		const node = rich(new FakeElement("div", new FakeCanvasContext()), "$\\notacommand{x}$");
		expect(descendants(node).some((child) => child.textContent?.includes("\\notacommand"))).toBe(true);
	});

	it("renders headings, lists, blockquotes and links without HTML injection", () => {
		const { rich } = loadRenderer();
		const node = rich(
			new FakeElement("div", new FakeCanvasContext()),
			"## Notes\n- one\n- **two**\n\n> quoted\n\n[site](https://example.com) and <img src=x onerror=alert(1)>",
		);
		const tags = descendants(node).map((child) => child.tagName);
		expect(tags).toContain("h3");
		expect(tags).toContain("ul");
		expect(tags).toContain("blockquote");
		expect(tags).toContain("strong");
		const link = descendants(node).find((child) => child.tagName === "a");
		expect(link?.attributes.get("href")).toBe("https://example.com");
		expect(link?.attributes.get("rel")).toBe("noopener noreferrer");
		expect(descendants(node).some((child) => child.tagName === "img")).toBe(false);
		expect(descendants(node).some((child) => child.textContent?.includes("<img src=x"))).toBe(true);
	});
});

describe("inline thinking state", () => {
	it("does not create empty assistant bubbles for reasoning and tool-only messages", () => {
		const { event, feed } = loadRenderer();
		const message = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Inspect the file" },
				{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } },
			],
		};
		event({ type: "message_update", message });
		event({ type: "message_end", message });
		expect(feed.children.filter((node) => node.className === "message assistant")).toHaveLength(0);
	});
	it("starts a live row, names real tool activity, and settles with the chain of thought", () => {
		const { event, feed } = loadRenderer();
		event({ type: "agent_start" });
		expect(feed.children).toHaveLength(0);
		event({ type: "message_end", message: { role: "user", content: "Explain this" } });
		expect(feed.children).toHaveLength(2);
		const row = feed.children[1];
		if (!row) throw new Error("thinking row missing");
		const label = () => descendants(row).find((child) => child.className === "thinking-label")?.textContent;
		expect(label()).toBe("Working…");

		event({
			type: "message_update",
			message: {
				role: "assistant",
				content: [{ type: "thinking", thinking: "I should compare the three readings." }],
			},
		});
		for (const [toolName, args, kind, summary] of [
			["web_search", { query: "Qubits" }, "web", "Searching Qubits"],
			["read", { path: "USER.md" }, "reading", "Reading USER.md"],
			["bash", { command: "npm run check" }, "terminal", "Running checks"],
			["edit", { path: "Quatrix.ts" }, "coding", "Editing Quatrix.ts"],
			["write", { path: "plan.md" }, "writing", "Writing plan.md"],
		] as const) {
			event({ type: "tool_execution_start", toolName, args });
			expect(feed.lastChild?.dataset.kind).toBe(kind);
			expect(feed.lastChild?.children[0]?.textContent).toContain(summary);
		}

		event({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Compared." }],
			},
		});
		expect(label()).toMatch(/^Thought for \d+ seconds?$/);
		const body = descendants(feed).find((child) => child.className === "thinking-body");
		expect(body?.textContent).toBe("");
		descendants(row)
			.find((child) => child.className === "thinking-head")
			?.handlers.get("click")?.();
		expect(body?.textContent).toContain("compare the three readings");
		expect(descendants(feed).some((child) => child.textContent === "Compared.")).toBe(true);
	});

	it("does not create a row for an unrelated tool completion", () => {
		const { event, feed } = loadRenderer();
		event({ type: "tool_execution_end", toolName: "visualize", isError: true });
		expect(feed.children).toHaveLength(0);
	});
});
