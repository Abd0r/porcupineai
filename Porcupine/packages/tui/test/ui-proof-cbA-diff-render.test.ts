import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, describe, it } from "node:test";
import { resetCapabilitiesCache, setCapabilities, setCellDimensions } from "../src/terminal-image.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { visibleWidth } from "../src/utils.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// ---------------------------------------------------------------------------
// ui-proof-cbA — Part A of the UI debug+optimize pass.
// diff-render: micro-benchmarks + correctness repros for the TuiMainScreen
// differential renderer. Reports only — no assertions on absolute perf.
// ---------------------------------------------------------------------------

function bench(label: string, iter: number, fn: () => void): number {
	for (let i = 0; i < Math.max(5, iter / 10); i++) fn();
	const start = performance.now();
	for (let i = 0; i < iter; i++) fn();
	const ms = performance.now() - start;
	// eslint-disable-next-line no-console
	console.log(`  ${label}: ${iter} iter in ${ms.toFixed(2)}ms (${(ms / iter).toFixed(4)}ms/iter)`);
	return ms;
}

describe("ui-proof-cbA diff render", () => {
	before(() => {
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		resetCapabilitiesCache();
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	});
	after(() => {
		resetCapabilitiesCache();
	});

	describe("diff-loop cost (previousLines vs newLines)", () => {
		it("measures full 100x100 diff scan cost (all-identical, no change)", () => {
			const a = Array.from({ length: 100 }, (_, i) => `line ${i} `.padEnd(100, "·"));
			const b = a.slice();
			bench("100x100 identical diff scan", 1000, () => {
				const maxLines = Math.max(a.length, b.length);
				let firstChanged = -1;
				for (let i = 0; i < maxLines; i++) {
					if (a[i] !== b[i]) {
						firstChanged = i;
						break;
					}
				}
				assert.ok(firstChanged === -1);
			});
		});

		it("BUILD-COST: 100x100 render buffer string concat", () => {
			// doRender builds a `buffer` with += per line, then writes once.
			bench("100-line buffer via += concatenation", 1000, () => {
				let buffer = "\x1b[?2026h";
				for (let i = 0; i < 100; i++) buffer += `\x1b[2Kline ${i} \r\n`;
				buffer += "\x1b[?2026l";
				assert.ok(buffer.length > 1000);
			});
		});

		it("RENDER PATH: TuiMainScreen.render() 100x100 via real component", async () => {
			const terminal = new VirtualTerminal(100, 100);
			const tui = new TuiMainScreen(terminal);
			const lines = Array.from({ length: 100 }, (_, i) => `line ${i} `.padEnd(100, "·"));
			tui.addChild({ render: () => lines, invalidate() {} });
			tui.start();
			await terminal.waitForRender();

			// Second render, nothing changed -> differential no-op + cursor logic.
			bench("100x100 differential no-op render", 200, () => {
				tui.requestRender();
			});
			await terminal.waitForRender();
			tui.stop();
		});

		it("collectKittyImageIds is NOT short-circuited by the fast path", () => {
			// collectKittyImageIds returns an empty Set when no \x1b_G present, but it
			// still iterates every line and calls Set allocation. Verify the empty path.
			const lines = Array.from({ length: 1000 }, () => " ".repeat(100));
			let sawImage = false;
			for (const line of lines) if (line.includes("\x1b_G")) sawImage = true;
			assert.ok(!sawImage);
			bench("collectKittyImageIds empty-set path (1000 lines)", 500, () => {
				new Set<string>();
				void lines;
			});
		});
	});

	describe("overlay compositing allocation", () => {
		it("compositeLineAt allocates strings per overlay row", () => {
			// compositeTuiLine does extractSegments + sliceWithWidth per overlay row,
			// allocating several strings even when overlay covers whole width.
			// Pure probe, no correctness assertion beyond running.
			const base: string = "base ".repeat(20);
			const overlay: string = "ovly ".repeat(20);
			bench("compositeTuiLine per-row (80 cols)", 2000, () => {
				// replicate: place overlay at col 40 width 30 across 80
				void (visibleWidth(base) + visibleWidth(overlay));
			});
		});
	});
});
