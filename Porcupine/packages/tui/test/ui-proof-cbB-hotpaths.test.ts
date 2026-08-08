import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { fuzzyFilter, fuzzyMatch } from "../src/fuzzy.ts";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "../src/utils.ts";

// ---------------------------------------------------------------------------
// ui-proof-cbB — Part B of the UI debug+optimize pass.
// TUI component-layer hot paths: wrapTextWithAnsi, visibleWidth cache,
// fuzzyFilter, markdown render, scroll-view math. Reports only.
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

describe("ui-proof-cbB wrapTextWithAnsi", () => {
	it("10KB unbroken line (no spaces) — word-break cost", () => {
		const line = "x".repeat(10000);
		wrapTextWithAnsi(line, 80); // warm
		bench("wrap 10KB unbroken @w80", 200, () => wrapTextWithAnsi(line, 80));
	});

	it("10KB line of normal words — wrap cost", () => {
		const line = "word ".repeat(2000).trimEnd();
		wrapTextWithAnsi(line, 80); // warm
		bench("wrap 10KB normal words @w80", 50, () => wrapTextWithAnsi(line, 80));
	});

	it("10KB CJK line — wrap + width cost", () => {
		const line = "中文".repeat(5000);
		wrapTextWithAnsi(line, 80); // warm
		bench("wrap 10KB CJK @w80", 100, () => wrapTextWithAnsi(line, 80));
	});

	it("correctness: total wrapped width <= requested width", () => {
		const line = "a".repeat(500);
		for (const w of [80, 40, 10]) {
			for (const l of wrapTextWithAnsi(line, w)) {
				assert.ok(visibleWidth(l) <= w, `line width ${visibleWidth(l)} > ${w}`);
				//				assert.equal(l.length % 1, 0);
			}
		}
	});
});

describe("ui-proof-cbB visibleWidth cache thrash", () => {
	it("10k distinct lines / many CJK — measures cache misses + segmentation", () => {
		visibleWidth(""); // warm
		let n = 0;
		const lines = Array.from({ length: 1000 }, (_, i) => `snippet_${i}_中文测试 a`.repeat(3));
		bench("visibleWidth 1000 distinct long MIXED lines", 50, () => {
			for (const l of lines) {
				n += visibleWidth(l);
			}
		});
		if (n === 0) throw new Error("unreachable");
	});

	it("cache: same string repeated should not re-segment (cache hit)", () => {
		const s = "snippet_中文测试 a".repeat(5);
		visibleWidth(s);
		// First call populates cache. Subsequent calls hit the widthCache Map.
		bench("visibleWidth SAME string x50 (cache hit)", 50, () => {
			for (let i = 0; i < 100; i++) visibleWidth(s);
		});
	});
});

describe("ui-proof-cbB fuzzy performance", () => {
	it("fuzzyFilter over 10k candidates", () => {
		const items = Array.from({ length: 10000 }, (_, i) => ({
			value: `path/to/file_${i.toString().padStart(4, "0")}_module`,
			label: `file_${i}`,
		}));
		fuzzyFilter(items, "file_", (i) => i.value); // warm
		bench("fuzzyFilter 10k items / 'fi'", 20, () => fuzzyFilter(items, "fi", (i) => i.value));
		bench("fuzzyFilter 10k items / 'file_'", 20, () => fuzzyFilter(items, "file_", (i) => i.value));
	});

	it("fuzzyMatch micro", () => {
		bench("fuzzyMatch('file_', 30-char) x1000", 1000, () => {
			fuzzyMatch("file_", "abc/def/gio-file_0123_module_xyz");
		});
	});
});

describe("ui-proof-cbB markdown render deep re-parse", () => {
	it("render a 200-line doc multiple times", async () => {
		const base = Array.from({ length: 200 }, (_, i) => {
			const code = "```";
			const closeCode = "```";
			return (
				"## Section " +
				i +
				"\n\nThis is a **paragraph** with a [link](https://x.example/" +
				i +
				") and `code`.\n\n- item one\n- item two\n- item three\n\n> a quote line\n\n" +
				code +
				"js\nconst x = " +
				i +
				";\n" +
				closeCode +
				"\n\n---\n"
			);
		}).join("\n");
		const { Markdown } = await import("../src/components/markdown.ts");
		const theme = {
			heading: (t: string) => t,
			link: (t: string) => t,
			linkUrl: (t: string) => t,
			code: (t: string) => t,
			codeBlock: (t: string) => t,
			codeBlockBorder: (t: string) => t,
			quote: (t: string) => t,
			quoteBorder: (t: string) => t,
			hr: (t: string) => t,
			listBullet: (t: string) => t,
			bold: (t: string) => t,
			italic: (t: string) => t,
			strikethrough: (t: string) => t,
			underline: (t: string) => t,
		};
		const md = new Markdown(base, 1, 1, theme);
		md.render(100); // warm + populate
		bench("markdown render 200-line doc x100", 100, () => md.render(100));

		// render() must return the SAME array when content unchanged (cache identity)
		const a = md.render(100);
		const b = md.render(100);
		assert.equal(a, b, "render() should return the same cached array instance for unchanged content");
	});
});

describe("ui-proof-cbB scroll-view math", () => {
	it("scroll clamp + follow-end behavior", async () => {
		const { ScrollView } = await import("../src/components/scroll-view.ts");
		const { Text } = await import("../src/components/text.ts");
		const child = new Text("line\n".repeat(1000).trimEnd(), 0, 0);
		const sv = new ScrollView(child, { follow: "end", axis: "vertical" });
		const lastScrollTop = -1;
		let callback: string | undefined;
		sv.updateLayout(1000, 30, () => {
			callback = "render-requested";
		});
		sv.scrollToEnd();
		const maxScroll = 1000 - 30;
		assert.equal(sv.scrollTop, maxScroll, "scrollToEnd should clamp to contentHeight - viewport");
		assert.equal(sv.isFollowingEnd, true);

		// scrolling up manually should drop out of following-end
		sv.scrollBy(-5);
		assert.ok(sv.scrollTop < maxScroll, "manual scroll up should reduce scrollTop");
		assert.equal(sv.isFollowingEnd, false, "manual scroll should clear follow-end (unless forced)");

		sv.scrollTo(99999);
		assert.equal(sv.scrollTop, maxScroll, "overscroll clamps to max");

		sv.scrollTo(-5);
		assert.equal(sv.scrollTop, 0, "underscroll clamps to 0");
		void lastScrollTop;
		void callback;
	});

	it("content growth at bottom keeps following-end pinned", async () => {
		const { ScrollView } = await import("../src/components/scroll-view.ts");
		const { Text } = await import("../src/components/text.ts");
		const child = new Text("a", 0, 0);
		const sv = new ScrollView(child, { follow: "end" });
		sv.updateLayout(100, 30, () => {});
		sv.scrollToEnd();
		sv.updateLayout(130, 30, () => {}); // content grows
		assert.equal(sv.scrollTop, 100, "following-end should re-pin to new max after growth");
	});
});

describe("ui-proof-cbB truncate+visibleWidth on styled lines", () => {
	it("truncateToWidth on ANSI-styled 400-char line", () => {
		let line = "";
		for (let i = 0; i < 200; i++) line += `\x1b[31m word${i}\x1b[0m `;
		truncateToWidth(line, 80, "...", true); // warm
		bench("truncateToWidth styled 2KB x100", 100, () => truncateToWidth(line, 80, "...", true));
	});
});
