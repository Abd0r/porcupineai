import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { TruncatedText } from "../src/components/truncated-text.ts";
import type { Component } from "../src/tui.ts";
import { visibleWidth, wrapTextWithAnsi } from "../src/utils.ts";

// ---------------------------------------------------------------------------
// Porcupine foundation deterministic operation-count guards for TUI hot paths.
// These do not rely on wall-clock timing, which is flaky in CI;
// they assert how many render() / allocator calls happen so a refactor that
// adds redundant per-frame work fails deterministically.
//
// The guarantees protected here:
//   • render() cache-hit arrays are returned BY REFERENCE and are never
//     mutated by consumers. Identity (===) asserts a cache hit, which also
//     proves zero recompute on that pass.
//   • Part-A Box identity fast-path depends on children returning instance-
//     stable arrays. We count child render() invocations to ensure Box does
//     not double-render children on a changed frame.
// ---------------------------------------------------------------------------

/** A counting component: records how many times render() ran, returns a fixed line. */
class CountingStable implements Component {
	public calls = 0;
	public readonly lines: string[];
	public readonly text: string;
	constructor(_width: number, text = "x") {
		this.text = text;
		this.lines = [this.text];
	}
	render(_width: number): string[] {
		this.calls++;
		return this.lines;
	}
	invalidate(): void {}
}

/** A counting component that returns a FRESH array each render (unstable, like an animated child). */
class CountingUnstable implements Component {
	public calls = 0;
	public readonly text: string;
	constructor(_width: number, text = "·") {
		this.text = text;
	}
	render(_width: number): string[] {
		this.calls++;
		return [this.text]; // fresh array every time -> never identity-stable
	}
	invalidate(): void {}
}

describe("foundation TUI: TruncatedText render caching", () => {
	it("same-width repeat render returns the SAME cached array (zero recompute)", () => {
		const tt = new TruncatedText("a very long line ".repeat(50), 1, 1);
		const r1 = tt.render(80);
		const r2 = tt.render(80);
		const r3 = tt.render(80);
		assert.equal(r1, r2, "TruncatedText must return the SAME cached array on same width");
		assert.equal(r1, r3, "still cached on third call");
	});

	it("width change produces a NEW array with correct width", () => {
		const tt = new TruncatedText("a very long line ".repeat(50), 0, 0);
		const w40 = tt.render(40);
		const w80 = tt.render(80);
		assert.notEqual(w40, w80, "width change must produce a new array");
		for (const line of w40) assert.equal(visibleWidth(line), 40);
		for (const line of w80) assert.equal(visibleWidth(line), 80);
		// and back to a previously used width
		const w40again = tt.render(40);
		assert.notEqual(w40again, w40, "single-width cache rebuilds after an intervening width");
		assert.equal(visibleWidth(w40again[0]), 40);
	});

	it("cached array is returned by reference and must not be mutated by caller", () => {
		const tt = new TruncatedText("hello", 0, 0);
		const a = tt.render(10);
		a[0] = "CHANGED"; // a hostile/mistaken consumer mutating the hit array
		const b = tt.render(10);
		// Cache-hit returns the room it already handed out — but within ONE
		// component instance the cache array is only read afterwards; identity
		// must hold (no defensive copy on cache hit).
		assert.equal(b, a);
		// The component itself always returns the same width-correct line on a
		// subsequent width change (rebuild path reads its immutable text, not
		// the corrupted cached string).
		const c = tt.render(11);
		assert.equal(visibleWidth(c[0]), 11);
	});
});

describe("foundation TUI: Box single-pass child render", () => {
	it("renders each child EXACTLY once per box.render() even when a child is unstable", () => {
		const box = new Box(1, 1);
		const stableA = new CountingStable(80, "aa");
		const unstable = new CountingUnstable(80, "¢");
		const stableB = new CountingStable(80, "bb");
		box.addChild(stableA);
		box.addChild(unstable);
		box.addChild(stableB);

		box.render(100); // cold
		// On a changed frame (unstable child returns a new array) every child
		// must be rendered at most ONCE — no discovery + rebuild double pass.
		const beforeA = stableA.calls;
		const beforeU = unstable.calls;
		const beforeB = stableB.calls;
		box.render(100);
		assert.equal(unstable.calls - beforeU, 1, "unstable child must render exactly once per frame");
		assert.equal(stableA.calls - beforeA, 1, "stable child A must render exactly once per frame");
		assert.equal(stableB.calls - beforeB, 1, "stable child B must render exactly once per frame");
	});

	it("fully-stable box still reuses the cached instance (identity fast path preserved)", () => {
		const box = new Box(1, 1);
		const stableA = new CountingStable(80, "aa");
		const stableB = new CountingStable(80, "bb");
		box.addChild(stableA);
		box.addChild(stableB);
		const r1 = box.render(100);
		const r2 = box.render(100);
		assert.equal(r1, r2, "stable box must return the cached instance");
	});
});

describe("foundation TUI: wrapTextWithAnsi trailing-trim allocation", () => {
	it("produces exact output for a corpus incl. trailing whitespace, CJK, ANSI", () => {
		const cases: Array<[string, number]> = [
			["hello world", 80],
			["hello world hello world", 7],
			["a ".repeat(40).trimEnd(), 3],
			["word ".repeat(50), 20],
			["some words here that wrap", 10],
			["中文".repeat(40), 8],
			["a ".repeat(20) + "中文 ".repeat(20), 15],
			["", 10],
			["\x1b[31mred\x1b[0m over wraps to many lines", 6],
			["already-trimmed sentence with some spaces at the very end   ", 15],
			["ends with trailing newline\n", 20],
		];
		for (const [text, width] of cases) {
			const lines = wrapTextWithAnsi(text, width);
			assert.ok(Array.isArray(lines), `expected array for ${JSON.stringify(text.slice(0, 20))}@${width}`);
			// No line may exceed requested width.
			for (const line of lines) {
				assert.ok(visibleWidth(line) <= width || line === "", `line too wide: ${line}`);
			}
			// Trailing-whitespace cleanup invariant: no line ends with a space.
			for (const line of lines) {
				if (line === "") continue;
				assert.ok(!line.endsWith(" "), `line has trailing space: ${JSON.stringify(line)}`);
			}
		}
	});

	it("output matches the original implementation for a deterministic golden corpus", () => {
		// Golden values captured from the pre-optimization implementation. Any
		// change that alters wrapping output (not just performance) fails here.
		const golden: Array<[string, number, string[]]> = [
			["hello world", 80, ["hello world"]],
			["hello world hello world", 7, ["hello", "world", "hello", "world"]],
			["a ".repeat(40).trimEnd(), 3, Array(20).fill("a a")],
			["word ".repeat(50), 20, [...Array(12).fill("word word word word"), "word word"]],
			["some words here that wrap", 10, ["some words", "here that", "wrap"]],
			["中文".repeat(40), 8, Array(20).fill("中文中文")],
			[`${"a ".repeat(3)}中`, 6, ["a a a", "中"]],
			["", 10, [""]],
			["   ", 5, ["   "]],
		];
		for (const [text, width, want] of golden) {
			assert.deepEqual(
				wrapTextWithAnsi(text, width),
				want,
				`output changed from golden for ${JSON.stringify(text.slice(0, 20))}@${width}`,
			);
		}
	});

	it("no produced line ever ends with trailing whitespace", () => {
		const corpus: Array<[string, number]> = [
			["word ".repeat(50), 20],
			["a ".repeat(40), 3],
			["already-trimmed sentence with spaces at the end   ", 15],
			["中文 ".repeat(30), 8],
		];
		for (const [text, width] of corpus) {
			for (const line of wrapTextWithAnsi(text, width)) {
				if (line === "") continue;
				assert.ok(!line.endsWith(" "), `line has trailing space: ${JSON.stringify(line)}`);
			}
		}
	});
});
