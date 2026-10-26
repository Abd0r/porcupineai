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
	readonly children: FakeElement[] = [];
	readonly attributes = new Map<string, string>();
	readonly listeners = new Set<string>();
	readonly classList = { toggle: (_name: string, _force?: boolean) => {} };
	readonly style = { setProperty: (_name: string, _value: string) => {} };
	className = "";
	textContent = "";
	hidden = false;
	tabIndex = -1;
	width = 0;
	height = 0;
	scrollTop = 0;
	scrollHeight = 0;
	role = "";
	constructor(
		readonly tagName: string,
		private readonly canvasContext: FakeCanvasContext,
	) {}
	get lastChild(): FakeElement | undefined {
		return this.children[this.children.length - 1];
	}
	addEventListener(type: string): void {
		this.listeners.add(type);
	}
	append(...items: FakeElement[]): void {
		this.children.push(...items);
	}
	appendChild(item: FakeElement): FakeElement {
		this.children.push(item);
		return item;
	}
	replaceChildren(...items: FakeElement[]): void {
		this.children.splice(0, this.children.length, ...items);
	}
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
	getBoundingClientRect(): { width: number; height: number } {
		return { width: 640, height: 320 };
	}
	getContext(): FakeCanvasContext {
		return this.canvasContext;
	}
	setPointerCapture(): void {}
}

function loadRenderer(): {
	render(scene: unknown): void;
	event(event: unknown): void;
	feed: FakeElement;
	canvasContext: FakeCanvasContext;
} {
	const canvasContext = new FakeCanvasContext();
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
		"prompt",
		"send",
		"stop",
		"error",
		"status-text",
		"status-dot",
		"session-title",
		"session-controls",
		"plan-toggle",
		"reasoning-mode",
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
		"settings-open",
		"appearance-theme",
		"appearance-mode",
		"appearance-image",
		"appearance-remove",
		"appearance-opacity",
		"appearance-opacity-value",
		"appearance-error",
		"chat-backdrop",
	]) {
		elements.set(id, new FakeElement("div", canvasContext));
	}
	const document = {
		documentElement: new FakeElement("html", canvasContext),
		getElementById(id: string): FakeElement {
			const element = elements.get(id);
			if (!element) throw new Error(`Unknown test element: ${id}`);
			return element;
		},
		createElement(tagName: string): FakeElement {
			return new FakeElement(tagName, canvasContext);
		},
	};
	const sandbox = {
		document,
		window: {
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
		"globalThis.__renderVisualization=renderVisual;globalThis.__renderEvent=renderEvent;})();",
	);
	if (instrumented === script) throw new Error("Could not expose the renderer to its test harness");
	runInNewContext(instrumented, sandbox);
	const render = runInNewContext("globalThis.__renderVisualization", sandbox) as (scene: unknown) => void;
	const feed = elements.get("feed");
	if (!feed) throw new Error("Test feed element is missing");
	const event = runInNewContext("globalThis.__renderEvent", sandbox) as (event: unknown) => void;
	return { render, event, feed, canvasContext };
}

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

	it("rejects malformed new visuals before adding content", () => {
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
		expect(feed.children).toHaveLength(0);
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
		const canvas = card.children.find((child) => child.tagName === "canvas");
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
