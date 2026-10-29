import { readFileSync } from "node:fs";
import { runInNewContext, Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { createVisualizeToolDefinition } from "../src/core/tools/visualize.ts";
import { VISUAL_RENDERER_SCRIPT } from "../src/server/visual-renderer.ts";
import { PORCUPINE_WEB_UI } from "../src/server/web-ui.ts";

class Node {
	children: Node[] = [];
	textContent = "";
	value = "";
	type = "";
	hidden = false;
	disabled = false;
	checked = false;
	open = false;
	isConnected = true;
	dataset: Record<string, string> = {};
	className = "";
	attributes: Record<string, string> = {};
	listeners = new Map<string, () => void | Promise<void>>();
	classList = { add() {} };
	constructor(publicTag: string) {
		this.tag = publicTag;
	}
	tag: string;
	get lastChild() {
		return this.children.at(-1);
	}
	append(...nodes: Node[]) {
		this.children.push(...nodes);
	}
	replaceChildren(...nodes: Node[]) {
		this.children = nodes;
	}
	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	addEventListener(name: string, fn: () => void | Promise<void>) {
		this.listeners.set(name, fn);
	}
	querySelectorAll(selector: string): Node[] {
		return this.children.flatMap((node) => [
			...(node.tag === selector ? [node] : []),
			...node.querySelectorAll(selector),
		]);
	}
	querySelector(selector: string) {
		return this.querySelectorAll(selector)[0];
	}
	getBoundingClientRect() {
		return { width: 640, height: 360 };
	}
	getContext() {
		return {
			setTransform() {},
			clearRect() {},
			beginPath() {},
			moveTo() {},
			lineTo() {},
			stroke() {},
			arc() {},
			fill() {},
			fillText() {},
		};
	}
	click() {
		return this.listeners.get("click")?.();
	}
}
const prefix = PORCUPINE_WEB_UI.slice(
	PORCUPINE_WEB_UI.indexOf("function hasOnlyKeys("),
	PORCUPINE_WEB_UI.indexOf("function renderVisualization("),
);
function environment() {
	const feed = new Node("main"),
		sent = vi.fn(async () => ({})),
		labels = {
			begin() {},
			end() {},
			draw() {
				return false;
			},
		};
	const context = {
		document: { createElement: (tag: string) => new Node(tag) },
		window: {
			addEventListener() {},
			getComputedStyle() {
				return {
					getPropertyValue() {
						return "#777777";
					},
				};
			},
		},
		sessionId: "test",
		devicePixelRatio: 1,
		connected: true,
		streaming: false,
		ui: { feed, welcome: { hidden: false } },
		isRecord: (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v),
		renderMathLabel: (node: Node, value: unknown) => {
			node.textContent = String(value);
		},
		renderRichText: (node: Node, value: unknown) => {
			node.textContent = String(value);
		},
		formatLearningMath: (s: string) => s,
		createCanvasMathLabels: () => labels,
		plotColors: () => ({ text: "#222", axis: "#777" }),
		scrollFeed() {},
		setBusy() {},
		json: sent,
		structuredClone,
		cancelAnimationFrame() {},
	};
	return { feed, sent, context };
}
describe("capacity renderer execution", () => {
	it("parses the actual inline application script", () => {
		const script = PORCUPINE_WEB_UI.split("<script>")[1].split("</script>")[0];
		expect(() => new Script(script)).not.toThrow();
	});
	it("accepts every new resolved example through independent GUI validation", async () => {
		const examples: Array<{ tool: string; input: Record<string, unknown> }> = JSON.parse(
			readFileSync(new URL("../skills/docs/adaptive-gui/references/tool-examples.json", import.meta.url), "utf8"),
		);
		for (const example of examples) {
			if (example.tool !== "visualize") continue;
			const tool = createVisualizeToolDefinition(),
				args = tool.prepareArguments!(example.input),
				result = await tool.execute("test", args, undefined, undefined, undefined as never);
			const env = environment();
			expect(
				runInNewContext(`${prefix}\n${VISUAL_RENDERER_SCRIPT}\nvalidVisual(input)`, {
					...env.context,
					input: result.details.visualization,
				}),
				String(example.input.componentId),
			).toBe(true);
		}
	});
	it("defers dense table rows, pages through exact values, and retains chart points", () => {
		const env = environment(),
			input = {
				version: 2,
				kind: "chart",
				title: "Dense",
				chartType: "line",
				xLabel: "x",
				yLabel: "y",
				series: [
					{
						name: "Measured",
						color: "#247abe",
						points: Array.from({ length: 1000 }, (_, x) => ({ x, y: x / 7 })),
					},
				],
			};
		// This test stops at mounting: canvas drawing is exercised separately for simulations.
		env.context.document.createElement = (tag: string) => {
			const node = new Node(tag);
			if (tag === "canvas") Object.assign(node, { getContext: () => null });
			return node;
		};
		runInNewContext(`${prefix}\n${VISUAL_RENDERER_SCRIPT}\nrenderVisual(input,'dense')`, { ...env.context, input });
		const details = env.feed.querySelector("details")!,
			body = details.querySelector("tbody")!;
		expect(body.children).toHaveLength(0);
		details.open = true;
		details.listeners.get("toggle")!();
		expect(body.children).toHaveLength(200);
		const next = details.querySelectorAll("button").find((n) => n.textContent === "Next rows")!;
		next.click();
		expect(body.children[0].children[1].textContent).toBe("200");
		expect(body.children[0].children[2].textContent).toBe(String(200 / 7));
		expect(input.series[0].points).toHaveLength(1000);
	});
	it("retains choices across quiz pages and restores a submitted 50-question score", async () => {
		const env = environment(),
			input = {
				version: 2,
				kind: "quiz",
				title: "Practice",
				componentId: "quiz",
				questions: Array.from({ length: 50 }, (_, i) => ({
					question: String(i),
					options: ["a", "b"],
					correctAnswers: [0],
					explanation: "a",
				})),
			};
		runInNewContext(`${prefix}\n${VISUAL_RENDERER_SCRIPT}\nrenderVisual(input,'quiz')`, { ...env.context, input });
		const groups = env.feed.querySelectorAll("fieldset");
		expect(groups.filter((n) => !n.hidden)).toHaveLength(5);
		groups[0].querySelectorAll("input")[0].checked = true;
		env.feed
			.querySelectorAll("button")
			.find((n) => n.textContent === "Next questions")!
			.click();
		expect(groups[0].hidden).toBe(true);
		expect(groups[0].querySelectorAll("input")[0].checked).toBe(true);
		for (const group of groups) group.querySelectorAll("input")[0].checked = true;
		await (
			env.feed.querySelector("form")!.listeners.get("submit")! as (event: {
				preventDefault(): void;
			}) => Promise<void>
		)({ preventDefault() {} });
		expect(env.sent).toHaveBeenCalledOnce();
		expect(env.feed.querySelectorAll("p").some((n) => n.textContent === "Score: 50 / 50")).toBe(true);
		expect(groups.filter((n) => !n.hidden)).toHaveLength(5);
	});
	it("executes expression and quantum simulation drawing and time seeking", () => {
		const examples: Array<{ tool: string; input: Record<string, unknown> }> = JSON.parse(
			readFileSync(new URL("../skills/docs/adaptive-gui/references/tool-examples.json", import.meta.url), "utf8"),
		);
		for (const example of examples.filter((e) => ["expression", "quantum1d"].includes(String(e.input.model)))) {
			const env = environment();
			runInNewContext(`${prefix}\n${VISUAL_RENDERER_SCRIPT}\nrenderVisual(input,'sim')`, {
				...env.context,
				input: { version: 2, ...example.input },
			});
			const time = env.feed.querySelectorAll("input").at(-1)!;
			time.value = "1";
			time.listeners.get("input")!();
			expect(
				env.feed
					.querySelectorAll("p")
					.some((n) =>
						n.textContent.includes(example.input.model === "quantum1d" ? "probability 1.000000" : "Time 1.00"),
					),
			).toBe(true);
		}
	});
});
