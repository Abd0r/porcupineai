import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PORCUPINE_WEB_UI } from "../src/server/web-ui.ts";

class FakeCanvasContext {
	clearCount = 0;
	fillCount = 0;
	strokeCount = 0;
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
	fillText(): void {}
	createRadialGradient(): { addColorStop(): void } {
		return { addColorStop() {} };
	}
}

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes = new Map<string, string>();
	readonly listeners = new Set<string>();
	readonly classList = { toggle: (_name: string, _force?: boolean) => {} };
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

function loadRenderer(): { render(scene: unknown): void; feed: FakeElement; canvasContext: FakeCanvasContext } {
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
	]) {
		elements.set(id, new FakeElement("div", canvasContext));
	}
	const document = {
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
		window: { devicePixelRatio: 1, addEventListener() {} },
		ResizeObserver: class {
			observe(): void {}
		},
	};
	const script = PORCUPINE_WEB_UI.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1];
	if (!script) throw new Error("Workbench script is missing");
	const instrumented = script.replace(/\}\)\(\);\s*$/, "globalThis.__renderVisualization=renderVisualization;})();");
	if (instrumented === script) throw new Error("Could not expose the renderer to its test harness");
	runInNewContext(instrumented, sandbox);
	const render = runInNewContext("globalThis.__renderVisualization", sandbox) as (scene: unknown) => void;
	const feed = elements.get("feed");
	if (!feed) throw new Error("Test feed element is missing");
	return { render, feed, canvasContext };
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
