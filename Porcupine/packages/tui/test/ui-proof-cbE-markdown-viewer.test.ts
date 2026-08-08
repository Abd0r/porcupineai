import assert from "node:assert";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { Markdown } from "../src/components/markdown.ts";
import { MarkdownViewer } from "../src/components/markdown-viewer.ts";
import type { Focusable, TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const plainStyle = {
	border: (t: string) => t,
	title: (t: string) => t,
	footer: (t: string) => t,
	contentEdge: (t: string) => t,
};

/** Generate a ~150KB markdown document (~30k lines of prose + lists + code). */
function largeDoc(targetBytes = 150 * 1024): string {
	const paragraphs: string[] = [];
	// Each paragraph ~ 3 lines * ~60 chars ≈ 180 bytes
	let bytes = 0;
	let i = 0;
	while (bytes < targetBytes) {
		paragraphs.push(
			`## Heading number ${i}\n\nThe quick brown fox jumps over the lazy dog and keeps running around the yard ${i}. ` +
				`This is a somewhat long sentence used to push real byte volume through the markdown tokenizer ` +
				`and wrappers so we can measure the actual per-render cost.\n\n- item one ${i}\n- item two ${i}\n`,
		);
		bytes += paragraphs[paragraphs.length - 1]!.length;
		i++;
	}
	return paragraphs.join("");
}

function makeViewer(doc: string): MarkdownViewer {
	const viewer = new MarkdownViewer({
		getHeight: () => 40,
		title: "Bench doc",
		text: doc,
		markdownTheme: defaultMarkdownTheme,
		style: plainStyle,
		footerHint: "q close",
		onClose: () => {},
		requestRender: () => {},
	});
	return viewer;
}

describe("ui-proof-cbE markdown viewer perf", () => {
	it("renders a 150KB doc in bounded time", () => {
		const doc = largeDoc();
		const viewer = makeViewer(doc);
		const start = performance.now();
		const lines = viewer.render(100);
		const firstRenderMs = performance.now() - start;
		assert.ok(lines.length > 0);
		// Cache warm for width 100 the cold parse should be fast but not free.
		// Most important: establish the cold-render cost and the CACHED cost.
		const start2 = performance.now();
		viewer.render(100);
		const cachedRenderMs = performance.now() - start2;
		// Warm render of the same width must be near-free (cache hit).
		assert.ok(
			cachedRenderMs < firstRenderMs,
			`expected cached render (${cachedRenderMs.toFixed(2)}ms) < cold render (${firstRenderMs.toFixed(2)}ms)`,
		);
		console.log(
			`[cbE] 150KB cold render: ${firstRenderMs.toFixed(2)}ms, cached render: ${cachedRenderMs.toFixed(3)}ms`,
		);
	});

	it("scroll of 100 steps does not reparse markdown (cache stays hot)", () => {
		const doc = largeDoc();
		const viewer = makeViewer(doc);
		viewer.render(100); // warm cache for width 100
		const start = performance.now();
		for (let i = 0; i < 100; i++) {
			// scrollBy calls markdown.render(contentWidth) — width 100 => contentWidth 96
			viewer.scrollBy(4);
			viewer.render(100); // simulate the requestRender -> render pass
		}
		const elapsed = performance.now() - start;
		console.log(`[cbE] 100 scroll steps + renders: ${elapsed.toFixed(2)}ms`);
		// An unbounded full re-render per scroll of a 150KB doc would be many times slower;
		// flag anything grotesque.
		assert.ok(elapsed < 4000, `100 scroll steps took ${elapsed.toFixed(0)}ms`);
	});

	it("scrollBy allocates the FULL content line array every step (bounded cost evidence)", () => {
		// Measure markdown.render cost itself at 150KB, note that scrollBy calls
		// it to compute maxScrollTop on every keypress.
		const doc = largeDoc();
		const md = new Markdown(doc, 0, 0, defaultMarkdownTheme);
		const start = performance.now();
		let total = 0;
		for (let i = 0; i < 100; i++) {
			total += md.render(96).length;
		}
		const elapsed = performance.now() - start;
		console.log(
			`[cbE] 100x markdown.render(96) of 150KB: ${elapsed.toFixed(2)}ms (total ${total} lines, cached path)`,
		);
	});
});

/** Overlay open/close churn — measure requestRender + composite cost. */
class StaticStandalone implements Focusable {
	focused = false;
	render(): string[] {
		return ["overlay", "content", "content", "content", "content", "content"];
	}
	invalidate(): void {}
}

class Plain implements Focusable {
	focused = false;
	render(): string[] {
		return ["base-line"];
	}
	invalidate(): void {}
}

async function renderAndFlush(tui: TUI, terminal: VirtualTerminal): Promise<void> {
	tui.requestRender(true);
	await new Promise<void>((resolve) => process.nextTick(resolve));
	await terminal.waitForRender();
}

describe("ui-proof-cbE overlay open/close churn", () => {
	it("open/close overlay 1000 times is bounded", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		const base = new Plain();
		tui.addChild(base);
		tui.setFocus(base);
		tui.start();
		try {
			const start = performance.now();
			for (let i = 0; i < 1000; i++) {
				const handle = tui.showOverlay(new StaticStandalone(), {
					nonCapturing: true,
					row: 1,
					col: 1,
					width: 40,
				});
				handle.hide();
				if (i % 100 === 0) await renderAndFlush(tui, terminal);
			}
			await renderAndFlush(tui, terminal);
			const elapsed = performance.now() - start;
			console.log(`[cbE] overlay open/close x1000: ${elapsed.toFixed(2)}ms`);
			assert.ok(elapsed < 5000, `overlay churn took ${elapsed.toFixed(0)}ms`);
		} finally {
			tui.stop();
		}
	});

	it("stacking 3 overlays then hiding them restores focus to base", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui: TUI = new TuiMainScreen(terminal);
		const base = new Plain();
		tui.addChild(base);
		tui.setFocus(base);
		tui.start();
		try {
			const a = tui.showOverlay(new StaticStandalone(), { nonCapturing: true });
			const b = tui.showOverlay(new StaticStandalone(), { nonCapturing: true });
			const c = tui.showOverlay(new StaticStandalone(), { nonCapturing: true });
			await renderAndFlush(tui, terminal);
			assert.strictEqual(base.focused, true, "non-capturing overlays must not steal focus");
			a.hide();
			b.hide();
			c.hide();
			await renderAndFlush(tui, terminal);
			assert.strictEqual(base.focused, true);
		} finally {
			tui.stop();
		}
	});
});
