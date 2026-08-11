import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Terminal } from "../src/terminal.ts";
import { type Component, Container, CURSOR_MARKER } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";

// ---------------------------------------------------------------------------
// Porcupine foundation, SECOND wave: smoothness optimization guards.
//
// These are deterministic (no wall-clock) counts that pin the exact render /
// terminal-write budgets per frame so a regression that reintroduces redundant
// work fails immediately:
//   • Container no longer probe-then-re-renders children on a changed frame.
//     Every child renders AT MOST ONCE per frame even when an unstable
//     sibling breaks the cache — while the all-stable fast path still returns
//     the cached array BY REFERENCE (identity fast path preserved).
//   • positionHardwareCursor emits no terminal bytes on an unchanged (no-op)
//     frame. Repeated identical cursor placement costs zero writes.
// ---------------------------------------------------------------------------

class CountingStable implements Component {
	calls = 0;
	readonly lines: string[];
	constructor(text = "s") {
		this.lines = [text];
	}
	render(_width: number): string[] {
		this.calls++;
		return this.lines;
	}
	invalidate(): void {}
}

/** Returns a FRESH array every render (unstable — an animated/typing child). */
class CountingUnstable implements Component {
	calls = 0;
	render(_width: number): string[] {
		this.calls++;
		return [`u${this.calls}`];
	}
	invalidate(): void {}
}

describe("foundation TUI: Container single-pass child render", () => {
	it("renders EVERY child at most ONCE even when an unstable sibling breaks the cache", () => {
		const c = new Container();
		const s1 = new CountingStable("a");
		const unstable = new CountingUnstable();
		const s2 = new CountingStable("b");
		c.addChild(s1);
		c.addChild(unstable);
		c.addChild(s2);

		c.render(80); // cold pass establishes baseline
		const b1 = s1.calls;
		const bU = unstable.calls;
		const b2 = s2.calls;
		c.render(80); // changed frame (unstable returns a new array)

		assert.equal(unstable.calls - bU, 1, "unstable child must render exactly once, not probe+rebuild twice");
		assert.equal(
			s1.calls - b1,
			1,
			"stable sibling BEFORE the unstable child must not re-render (probe result reused)",
		);
		assert.equal(s2.calls - b2, 1, "stable sibling AFTER the unstable child must render exactly once");
	});

	it("with only unstable children, the first unstable child renders exactly once too", () => {
		const c = new Container();
		const u1 = new CountingUnstable();
		const u2 = new CountingUnstable();
		c.addChild(u1);
		c.addChild(u2);
		c.render(80);
		const b1 = u1.calls;
		const b2 = u2.calls;
		const r = c.render(80); // both children changed
		assert.equal(u1.calls - b1, 1, "first unstable child must render once");
		assert.equal(u2.calls - b2, 1, "second unstable child must render once");
		assert.notEqual(r.length, 0);
	});
});

describe("foundation TUI: Container stable-composite identity fast path preserved", () => {
	it("all-stable container returns the SAME cached array by reference across renders", () => {
		const c = new Container();
		const a = new CountingStable("aa");
		const b = new CountingStable("bb");
		c.addChild(a);
		c.addChild(b);
		const r1 = c.render(100);
		const r2 = c.render(100);
		const r3 = c.render(100);
		assert.equal(r1, r2, "stable container must return the cached instance");
		assert.equal(r1, r3, "still cached on third call");
		// The identity fast path still probes children once (to learn they are
		// stable) but never re-materializes the composite. One cold render + two
		// probe frames = exactly three render() calls per child, none duplicated.
		assert.equal(a.calls, 3, "stable children render at most once per frame");
		assert.equal(b.calls, 3);
	});

	it("width change produces a fresh composite with correct concatenation", () => {
		const c = new Container();
		c.addChild(new CountingStable("x"));
		c.addChild(new CountingStable("y"));
		const w40 = c.render(40);
		const w80 = c.render(80);
		assert.notEqual(w40, w80, "width change must rebuild");
		assert.deepEqual(w40, ["x", "y"]);
		assert.deepEqual(w80, ["x", "y"]);
	});

	it("identity fast path survives a structural rebuild through the reusable scan buffer", () => {
		const c = new Container();
		c.addChild(new CountingStable("a"));
		c.addChild(new CountingStable("b"));
		const warmed = c.render(80);
		assert.deepEqual(warmed, ["a", "b"]);

		// A child-count change rebuilds through the reusable scan buffer.
		c.addChild(new CountingStable("c"));
		const rebuilt = c.render(80);
		assert.deepEqual(rebuilt, ["a", "b", "c"], "rebuild must concatenate all current children");

		// Once stable again, the composite is returned BY REFERENCE (no rebuild),
		// proving the scan buffer does not alias/corrupt the cached baseline.
		assert.equal(c.render(80), rebuilt, "stable container must return the rebuilt instance by reference");
		assert.equal(c.render(80), rebuilt);
	});
});

// ---------------------------------------------------------------------------
// Fake terminal that counts writes deterministically.
// ---------------------------------------------------------------------------
class CountingTerminal implements Terminal {
	writeCount = 0;
	writeBytes = "";
	columns = 80;
	rows = 24;
	kittyProtocolActive = false;
	start(): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.writeCount++;
		this.writeBytes += data;
	}
	moveBy(): void {}
	hideCursor(): void {
		this.writeCount++;
		this.writeBytes += "\x1b[?25l";
	}
	showCursor(): void {
		this.writeCount++;
		this.writeBytes += "\x1b[?25h";
	}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
}

class MarkerComponent implements Component {
	render(_width: number): string[] {
		return ["spinner\x1b[0m", `line2${CURSOR_MARKER}`];
	}
	invalidate(): void {}
}

/** Mutable component: keeps the SAME cursor marker column but changes content each render. */
class MutableMarker implements Component {
	private n = 0;
	render(_width: number): string[] {
		this.n++;
		const content = this.n === 1 ? "first-content----" : "second-content---";
		return [content, `stable${CURSOR_MARKER}`];
	}
	invalidate(): void {}
}

function render(tui: TuiMainScreen): void {
	(tui as unknown as { doRender(): void }).doRender();
}

describe("foundation TUI: no-op hardware-cursor placement costs zero writes", () => {
	function buildTui(): { term: CountingTerminal; tui: TuiMainScreen } {
		const term = new CountingTerminal();
		const tui = new TuiMainScreen(term, false);
		tui.addChild(new MarkerComponent());
		return { term, tui };
	}

	it("an unchanged frame with a fixed cursor position emits NO terminal writes", () => {
		const previous = process.env.PORCUPINE_HARDWARE_CURSOR;
		process.env.PORCUPINE_HARDWARE_CURSOR = "1";
		try {
			const { term, tui } = buildTui();
			// First render establishes the cursor position; expect some writes.
			render(tui);
			const writesAfterFirst = term.writeCount;
			assert.ok(writesAfterFirst > 0, "first render should write to the terminal");

			// Subsequent no-op renders (stable component) must not emit cursor bytes.
			render(tui);
			render(tui);
			assert.equal(term.writeCount, writesAfterFirst, "no-op frames must not re-write cursor position/show");
		} finally {
			if (previous === undefined) delete process.env.PORCUPINE_HARDWARE_CURSOR;
			else process.env.PORCUPINE_HARDWARE_CURSOR = previous;
		}
	});

	it("the same cursor placement repeated never re-emits the absolute-column escape", () => {
		const { term, tui } = buildTui();
		render(tui);
		const before = term.writeBytes;
		// A no-op render keeps the same cursor position — marker col unchanged.
		render(tui);
		assert.equal(term.writeBytes, before, "identical cursor placement must not grow the write stream");
	});

	it("a changed frame that rewrites content MUST re-emit the absolute-column move even at the same cached col", () => {
		const term = new CountingTerminal();
		const tui = new TuiMainScreen(term, false);
		tui.addChild(new MutableMarker());

		render(tui); // cold render positions cursor at the marker's column
		// The marker sits at the end of "stable...", independent of the varying
		// first line — record its absolute-column escape once.
		const colEscape = `\x1b[${6 + 1}G`; // before-marker width 6 ("stable") → 1-indexed col 7
		assert.ok(term.writeBytes.includes(colEscape), "first render must place the cursor at the cached column");
		term.writeCount = 0;
		term.writeBytes = "";

		// A content-changing render lands at the SAME marker column. Because a
		// rendered buffer may have left the column anywhere, the stale column
		// cache must be invalidated so the absolute-column move is re-emitted.
		render(tui);
		assert.ok(
			term.writeBytes.includes(colEscape),
			"content-changing render must re-emit the absolute-column move (stale col cache invalidated)",
		);
	});
});
