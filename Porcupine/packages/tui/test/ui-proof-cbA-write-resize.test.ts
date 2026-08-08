import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, describe, it } from "node:test";
import { resetCapabilitiesCache, setCapabilities, setCellDimensions } from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// ---------------------------------------------------------------------------
// ui-proof-cbA — write-burst and resize-churn probes.
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

describe("ui-proof-cbA write burst", () => {
	before(() => {
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		resetCapabilitiesCache();
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	});
	after(() => {
		resetCapabilitiesCache();
	});

	it("10KB single terminal.write string", async () => {
		const terminal = new VirtualTerminal(100, 24);
		const tui: TuiMainScreen = new TuiMainScreen(terminal);
		tui.start();
		// Build a 100-col x 100-row payload (~10KB).
		const payload = Array.from({ length: 100 }, (_, r) => `line ${r} `.padEnd(100, "/")).join("\r\n");
		assert.ok(payload.length > 9000);
		bench("10KB terminal.write(1 large string)", 200, () => {
			terminal.write(payload);
		});
		await terminal.flush();
		tui.stop();
	});

	it("main-screen many-line diff write burst", async () => {
		const terminal = new VirtualTerminal(100, 24);
		const lines = Array.from({ length: 40 }, (_, i) => `item ${i} `.padEnd(100, "~"));
		const tui = new TuiMainScreen(terminal);
		tui.addChild({ render: () => lines, invalidate() {} });
		tui.start();
		await terminal.waitForRender();

		// Change every even line each iteration -> differential path.
		let tick = 0;
		bench("40x100 differential write (churn all lines)", 100, () => {
			tick++;
			tui.children[0] = { render: () => lines.map((l, i) => (i % 2 === 0 ? `${l}${tick}` : l)), invalidate() {} };
			tui.requestRender();
		});
		await terminal.waitForRender();
		tui.stop();
	});
});

describe("ui-proof-cbA resize churn", () => {
	before(() => {
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		resetCapabilitiesCache();
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	});
	after(() => {
		resetCapabilitiesCache();
	});

	it("two resizes in one tick: width then height", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const lines = Array.from({ length: 60 }, (_, i) => `r ${i} `.padEnd(80, "·"));
		const tui = new TuiMainScreen(terminal);
		tui.addChild({ render: () => lines, invalidate() {} });
		tui.start();
		await terminal.waitForRender();

		// Two synchronous resize events before the 16ms render timer fires.
		terminal.resize(100, 30);
		terminal.resize(60, 20);
		await terminal.waitForRender();

		// The second resize should win; viewport reflects terminal dimensions.
		const viewport = terminal.getViewport();
		assert.ok(viewport.length === 20);
		const fullRedraws = tui.fullRedraws;
		// eslint-disable-next-line no-console
		console.log("two-resize-in-one-tick fullRedraws:", fullRedraws);
		tui.stop();
	});

	it("100 alternating resizes (width/height churn)", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const lines = Array.from({ length: 1200 }, (_, i) => `scroll ${i}`.padEnd(80, " "));
		const tui = new TuiMainScreen(terminal);
		tui.addChild({ render: () => lines, invalidate() {} });
		tui.start();
		await terminal.waitForRender();

		const t0 = performance.now();
		for (let i = 0; i < 100; i++) {
			// Alternate to force width- and height-change full redraws.
			terminal.resize(60 + (i % 2) * 50, 15 + (i % 3) * 5);
			await terminal.waitForRender();
		}
		const ms = performance.now() - t0;
		// eslint-disable-next-line no-console
		console.log(
			`100 resizes: ${ms.toFixed(2)}ms total, ${(ms / 100).toFixed(2)}ms/resize, fullRedraws=${tui.fullRedraws}`,
		);
		assert.ok(tui.fullRedraws > 0);
		tui.stop();
	});

	it("alt-screen resize triggers full redraw each time", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const doc = Array.from({ length: 50 }, (_, i) => `doc ${i} `.padEnd(80, "-"));
		const tui = new TuiAltScreen(terminal);
		tui.addChild({ render: () => doc, invalidate() {} });
		tui.start();
		await terminal.waitForRender();

		const t0 = performance.now();
		for (let i = 0; i < 30; i++) {
			terminal.resize(70 + (i % 3) * 5, 20 + (i % 2) * 4);
			await terminal.waitForRender();
		}
		const ms = performance.now() - t0;
		// eslint-disable-next-line no-console
		console.log(`alt-screen 30 resizes: ${ms.toFixed(2)}ms total, fullRedraws=${tui.fullRedraws}`);
		assert.ok(tui.fullRedraws > 0);
		tui.stop();
	});
});
