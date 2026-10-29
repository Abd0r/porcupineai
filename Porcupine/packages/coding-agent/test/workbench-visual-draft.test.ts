import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { VISUAL_RENDERER_SCRIPT } from "../src/server/visual-renderer.ts";

class TestNode {
	textContent = "";
	value = "";
	children: TestNode[] = [];
	listeners = new Map<string, () => void>();
	dataset = {};
	classList = { add() {} };
	focus = vi.fn();
	append(...nodes: TestNode[]) {
		this.children.push(...nodes);
	}
	setAttribute() {}
	addEventListener(name: string, handler: () => void) {
		this.listeners.set(name, handler);
	}
	getContext() {
		return null;
	}
}

function renderChart(draft: string) {
	const prompt = new TestNode();
	prompt.value = draft;
	const feed = new TestNode();
	const resizeComposer = vi.fn();
	const context = {
		document: { createElement: () => new TestNode() },
		window: { addEventListener() {} },
		ui: { prompt, feed, welcome: { hidden: false } },
		resizeComposer,
		scrollFeed() {},
		renderMathLabel(node: TestNode, text: string) {
			node.textContent = text;
		},
		isRecord: (value: unknown) => Boolean(value) && typeof value === "object",
		hasOnlyKeys: (value: object, required: string[], optional: string[] = []) =>
			required.every((key) => key in value) &&
			Object.keys(value).every((key) => [...required, ...optional].includes(key)),
		validColor: () => true,
		validLabel: () => true,
	};
	runInNewContext(
		`${VISUAL_RENDERER_SCRIPT}\nrenderVisual({version:2,kind:'chart',title:'Trajectory',chartType:'line',xLabel:'Time (s)',yLabel:'Position (m)',series:[{name:'Example',color:'#315da8',points:[{x:0,y:0}]}]},'chart');`,
		context,
	);
	const ask = feed.children[0].children.find((node) => node.textContent === "Ask about this visual");
	if (!ask) throw new Error("Chart follow-up button was not rendered");
	return { prompt, resizeComposer, click: () => ask.listeners.get("click")!() };
}

describe("visual follow-up drafts", () => {
	it("preserves an existing draft and adds the chart question without sending", () => {
		const chart = renderChart("Keep my draft.");
		chart.click();
		expect(chart.prompt.value).toBe(
			'Keep my draft.\n\nExplain "Trajectory" step by step, including its labels and assumptions.',
		);
		expect(chart.prompt.focus).toHaveBeenCalledOnce();
		expect(chart.resizeComposer).toHaveBeenCalledOnce();
	});
	it("fills an empty draft and does not duplicate a repeated visual question", () => {
		const chart = renderChart("");
		chart.click();
		const once = chart.prompt.value;
		chart.click();
		expect(chart.prompt.value).toBe(once);
		expect(once).toBe('Explain "Trajectory" step by step, including its labels and assumptions.');
	});
});
