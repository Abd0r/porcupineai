import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { THINKING_SCRIPT } from "../src/server/workbench-thinking.ts";

class ThinkingElement {
	textContent = "";
	hidden = false;
	children: ThinkingElement[] = [];
	attributes = new Map<string, string>();
	listeners = new Map<string, () => void>();
	classList = { add() {}, remove() {} };
	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}
	getAttribute(name: string) {
		return this.attributes.get(name);
	}
	append(...nodes: ThinkingElement[]) {
		this.children.push(...nodes);
	}
	replaceChildren(...nodes: ThinkingElement[]) {
		this.children = nodes;
	}
	addEventListener(name: string, fn: () => void) {
		this.listeners.set(name, fn);
	}
}

function thinkingHarness(expand = false) {
	const frames = new Map<number, () => void>();
	let nextFrame = 0;
	const render = vi.fn((node: ThinkingElement, text: string) => {
		node.textContent = text;
	});
	const context = {
		document: { createElement: () => new ThinkingElement() },
		appearancePreferences: { showReasoning: expand },
		activityGlyph: () => new ThinkingElement(),
		renderRichText: render,
		scrollFeed: vi.fn(),
		requestAnimationFrame: (fn: () => void) => {
			frames.set(++nextFrame, fn);
			return nextFrame;
		},
		cancelAnimationFrame: (id: number) => frames.delete(id),
	};
	const api = runInNewContext(
		`${THINKING_SCRIPT}\nconst row=createThinkingRow();startThinking(row);({row,update:text=>setReasoningText(row,text),stop:()=>stopThinking(row,2)})`,
		context,
	);
	return {
		api,
		render,
		frames,
		flush() {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const fn of callbacks) fn();
		},
	};
}

describe("streamed reasoning cost", () => {
	it("keeps collapsed reasoning as text until the user opens it, including after completion", () => {
		const h = thinkingHarness();
		for (let i = 0; i < 200; i++) h.api.update(`Reasoning ${i}: $v=2t$`);
		expect(h.render.mock.calls.length).toBe(0);
		expect(h.frames.size).toBe(0);
		h.api.stop();
		expect(h.api.row.label.textContent).toBe("Thought for 2 seconds");
		h.api.row.head.listeners.get("click")();
		expect(h.render).toHaveBeenCalledOnce();
		expect(h.api.row.body.textContent).toBe("Reasoning 199: $v=2t$");
	});
	it("batches expanded reasoning updates into one paint and flushes the final text", () => {
		const h = thinkingHarness(true);
		for (let i = 0; i < 200; i++) h.api.update(`Reasoning ${i}`);
		expect(h.frames.size).toBe(1);
		h.flush();
		expect(h.render).toHaveBeenCalledOnce();
		expect(h.api.row.body.textContent).toBe("Reasoning 199");
		h.api.update("Final reasoning");
		h.api.stop();
		expect(h.api.row.body.textContent).toBe("Final reasoning");
		expect(h.frames.size).toBe(0);
	});
});
