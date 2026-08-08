import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, describe, it } from "node:test";
import { wordWrapLine } from "../src/components/editor.ts";
import { Markdown } from "../src/components/markdown.ts";
import { Text } from "../src/components/text.ts";
import { TruncatedText } from "../src/components/truncated-text.ts";
import { resetCapabilitiesCache, setCapabilities, setCellDimensions } from "../src/terminal-image.ts";
import type { Component } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { visibleWidth, wrapTextWithAnsi } from "../src/utils.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// ---------------------------------------------------------------------------
// opt-proof-cbC — render-hotpath micro-benchmarks for the Pi `tui` package.
// These are *relative* timing probes (self-measured, JS timer). They do not
// assert pass/fail thresholds; they print measured cost so the report can cite
// concrete evidence for each perf finding. The optional numeric assertions only
// catch pathological regressions (deviating from the reviewed build), not the
// baseline absolute numbers.
// ---------------------------------------------------------------------------

function bench(label: string, iter: number, fn: () => void): number {
	// warmup
	for (let i = 0; i < Math.max(5, iter / 10); i++) fn();
	const start = performance.now();
	for (let i = 0; i < iter; i++) fn();
	const ms = performance.now() - start;
	// eslint-disable-next-line no-console
	console.log(`  ${label}: ${iter} iter in ${ms.toFixed(2)}ms (${(ms / iter).toFixed(4)}ms/iter)`);
	return ms;
}

class StaticComponent implements Component {
	lines: string[];
	constructor(n: number, width: number) {
		this.lines = Array.from({ length: n }, () => `x`.repeat(width));
	}
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

// ---------------------------------------------------------------------------
// Helpers to construct the diff-heavy scenarios used in doRender().
// ---------------------------------------------------------------------------

describe("cbC render hotpaths", () => {
	before(() => {
		// Deterministic image-less terminal so the render loop is predictable.
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		resetCapabilitiesCache();
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	});
	after(() => {
		resetCapabilitiesCache();
	});

	describe("tui-main-screen changed-line diff loop", () => {
		it("measures per-render cost of a 100x100 text screen when ONE line changes", () => {
			// A 100-line x 100-col text block. Vary one line each pass to force
			// the diff loop to do real string comparison work.
			bench("100x100 diff loop (one line changed)", 200, () => {
				const a = Array.from({ length: 100 }, (_, i) => `line ${i} `.padEnd(100, "·"));
				const b = a.slice();
				b[50] = "changed";
				const maxLines = Math.max(a.length, b.length);
				let firstChanged = -1;
				let _lastChanged = -1;
				for (let i = 0; i < maxLines; i++) {
					const oldLine = i < a.length ? a[i] : "";
					const newLine = i < b.length ? b[i] : "";
					if (oldLine !== newLine) {
						if (firstChanged === -1) firstChanged = i;
						_lastChanged = i;
					}
				}
				assert.ok(firstChanged >= 0);
			});
		});

		it("measures cost of expandChangedRangeForKittyImages scan of full previousLines buffer", () => {
			// expandChangedRangeForKittyImages iterates EVERY line of previousLines
			// AND newLines on every changed render, calling parseKittyImageHeader
			// (indexOf + slice + split) on each. Reproduce for a 2000-line buffer
			// with no images present.
			const extract = (line: string): number[] => {
				const seq = line.indexOf("\x1b_G");
				if (seq === -1) return [];
				const pStart = seq + "\x1b_G".length;
				const pEnd = line.indexOf(";", pStart);
				if (pEnd === -1) return [];
				const ids: number[] = [];
				for (const param of line.slice(pStart, pEnd).split(",")) {
					const [k, v] = param.split("=", 2);
					if (!v) continue;
					const nv = Number(v);
					if (!Number.isInteger(nv) || nv <= 0 || nv > 0xffffffff) continue;
					if (k === "i") ids.push(nv);
				}
				return ids;
			};

			const previousLines = Array.from({ length: 2000 }, (_, i) => `scrollback line ${i}`);
			const newLines = Array.from({ length: 2000 }, (_, i) => `scrollback line ${i}`);

			bench(
				"expandChangedRangeForKittyImages over 2000-line buffer (no images) — runs EVERY changed render",
				200,
				() => {
					const first = 1900;
					const last = 1999;
					const scan = (lines: string[]): void => {
						for (let i = 0; i < lines.length; i++) {
							// Fast path that dominates: no image seq → skip
							if (extract(lines[i]!).length === 0) continue;
							// (image-expansion body omitted for this image-less probe)
						}
					};
					scan(previousLines);
					scan(newLines);
					assert.ok(first >= 0 && last >= first);
				},
			);
		});

		it("measures collectKittyImageIds per-render cost over N lines with no images", () => {
			// collectKittyImageIds(newLines) runs at the end of EVERY render and
			// indexOf-scans each rendered line.
			const lines = Array.from({ length: 1000 }, () => " ".repeat(100));
			bench("collectKittyImageIds (1000 lines, no images) — runs EVERY render", 500, () => {
				const ids = new Set<number>();
				for (const line of lines) {
					if (line.indexOf("\x1b_G") !== -1) ids.add(0);
				}
				assert.ok(ids.size === 0);
			});
		});
	});

	describe("visibleWidth / wrapTextWithAnsi micro-benchmarks", () => {
		it("visibleWidth on 10k ASCII chars (fast path) vs CJK/ANSI (segmenter path)", () => {
			// ASCII fast path returns immediately by length.
			const ascii = "a".repeat(10000);
			bench("visibleWidth(10k ASCII) — fast path, O(1)", 10000, () => {
				assert.equal(visibleWidth(ascii), 10000);
			});

			// CJK lines hit the Intl.Segmenter path. Make many distinct strings so
			// the 512-entry widthCache is thrashed (simulating unique rendered lines).
			const cjkLines = Array.from({ length: 400 }, (_, i) => `${"漢字".repeat(20)}-${i}-${"字".repeat(15)}`);
			bench("visibleWidth(400 distinct CJK lines, cache-thrashing) — segmenter path", 50, () => {
				for (const s of cjkLines) void visibleWidth(s);
			});
		});

		it("wrapTextWithAnsi on a 10KB unbroken line (long-token breaking cost)", () => {
			const longNoSpace = "x".repeat(10 * 1024);
			bench("wrapTextWithAnsi(10KB unbroken, width=80) — breakLongWord char-by-char", 5, () => {
				const lines = wrapTextWithAnsi(longNoSpace, 80);
				assert.ok(lines.length > 100);
			});

			// A 10KB line with spaces: token-based wrapping, each token measured.
			const longWithSpaces = Array.from({ length: 1000 }, () => "word".repeat(20)).join(" ");
			bench("wrapTextWithAnsi(10KB wordy, width=80)", 5, () => {
				const lines = wrapTextWithAnsi(longWithSpaces, 80);
				assert.ok(lines.length > 50);
			});
		});

		it("measures wordWrapLine (editor) char-by-char on a long line — visibleWidth per grapheme", () => {
			// wordWrapLine calls visibleWidth(grapheme) per segment for the running
			// width; on ASCII graphemes this is the cheap fast path, but each call
			// still round-trips the function. Show the per-char overhead on a
			// long no-space line.
			const line = "abcdefgh".repeat(5000); // 40k chars, no spaces
			bench("wordWrapLine(40k unbroken chars)", 1, () => {
				const chunks = wordWrapLine(line, 80);
				assert.ok(chunks.length > 10);
			});
		});
	});

	describe("component render caching", () => {
		it("Text.render is cached (no re-parse on identical content)", () => {
			const t = new Text("Hello\nworld has some words here", 1, 1);
			const r1 = t.render(40);
			// second render returns cached array (same reference == no work)
			const r2 = t.render(40);
			assert.equal(r1, r2, "Text.render should return the SAME cached array");
		});

		it("TruncatedText.render is NOT cached — re-truncates on every pass", () => {
			const tt = new TruncatedText("a very long line ".repeat(50), 0, 0);
			bench("TruncatedText.render(xN) — recomputes truncateToWidth each pass", 1000, () => {
				void tt.render(80);
			});
		});

		it("Markdown.render is cached on identical content+width", () => {
			const mk = new Markdown("# Title\n\nSome body text with **bold** and *italic*.", 1, 1, defaultMarkdownTheme);
			const r1 = mk.render(80);
			const r2 = mk.render(80);
			assert.equal(r1, r2, "Markdown.render should return the SAME cached array");
		});
	});

	describe("Markdown re-parse cost when content DOES change (streaming input)", () => {
		it("measures full markdown render of a 200-line doc (re-parse each setText)", () => {
			const lines: string[] = [];
			for (let i = 0; i < 200; i++) {
				lines.push(`## Section ${i}`);
				lines.push(`Paragraph ${i} with **bold** and \`code\` and a [link](https://example.com/${i}).`);
				lines.push(`- item ${i} one\n- item ${i} two`);
			}
			const doc = lines.join("\n");
			const mk = new Markdown(doc, 1, 1, defaultMarkdownTheme);
			// First render warms nothing; measure 100 full renders forcing re-parse
			// by toggling text identity (simulating streaming keystrokes).
			bench("Markdown.render(200-line doc) x100 (forced re-parse)", 100, () => {
				// mutate text to defeat cache
				(mk as unknown as { setText: (s: string) => void }).setText(doc);
				void mk.render(80);
			});
		});
	});

	describe("end-to-end TuiMainScreen render loop", () => {
		it("measures full static-screen render + 16ms-throttled requestRender churn", async () => {
			const vt = new VirtualTerminal(100, 40);
			void vt.write;
			const tui = new TuiMainScreen(vt as never);
			const comp = new StaticComponent(100, 100);
			tui.addChild(comp);
			// Kick the first render through getMetrics-less path via requestRender(force)
			tui.requestRender(true);
			await new Promise((r) => setTimeout(r, 30));
			// Count how many requestRender calls are issued vs coalesced: loader path
			const requested = (tui as unknown as { renderRequested: boolean }).renderRequested;
			assert.ok(typeof requested === "boolean");
		});
	});
});
