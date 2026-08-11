import { describe, expect, it } from "vitest";
import { parseNotebook, renderNotebook } from "../src/core/tools/notebook-read.ts";

/**
 * Build a minimal but REAL ipynb JSON string inline (no fixture files).
 * 3 cells:
 *   1. markdown         — plain doc string
 *   2. code + text out  — stdout + a small dataframe-style text output
 *   3. code + huge out  — a single output longer than the runtime cap
 */
function buildNotebook(): string {
	const cells = [
		{
			cell_type: "markdown",
			metadata: {},
			source: ["# Hello", "", "this is a **markdown** cell"],
		},
		{
			cell_type: "code",
			execution_count: 1,
			metadata: {},
			outputs: [
				{
					output_type: "stream",
					name: "stdout",
					text: ["hello from", " execution\n"],
				},
			],
			source: ["print('hello from execution')"],
		},
		{
			cell_type: "code",
			execution_count: 2,
			metadata: {},
			outputs: [
				{
					output_type: "execute_result",
					execution_count: 2,
					metadata: {},
					data: {
						"text/plain": ["a ".repeat(6000)], // 12,000 chars > default 10,000 cap
					},
				},
			],
			source: ["df.describe()"],
		},
	];
	return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells });
}

describe("read tool: notebook render (part 9)", () => {
	it("parses a valid notebook and tags cells with kind + number", () => {
		const nb = parseNotebook(Buffer.from(buildNotebook(), "utf-8"));
		expect(nb).not.toBeNull();
		expect(nb!.cells).toHaveLength(3);
		expect(nb!.cells[0]).toMatchObject({ index: 1, kind: "markdown" });
		expect(nb!.cells[1]).toMatchObject({ index: 2, kind: "code" });
		expect(nb!.cells[2]).toMatchObject({ index: 3, kind: "code" });
	});

	it("joins the per-character source arrays into a single string", () => {
		const nb = parseNotebook(Buffer.from(buildNotebook(), "utf-8"));
		expect(nb!.cells[0].source).toContain("# Hello");
		expect(nb!.cells[1].source).toBe("print('hello from execution')");
	});

	it("renders cell tags, inline text outputs and numbered markdown", () => {
		const nb = parseNotebook(Buffer.from(buildNotebook(), "utf-8"));
		const res = renderNotebook(nb!);
		expect(res.text).toContain("[1 markdown]");
		expect(res.text).toContain("[2 code]");
		expect(res.text).toContain("hello from execution");
		expect(res.text).toContain("# Hello");
	});

	it("turns any single cell output over maxCellOutputChars into a jq pointer", () => {
		const nb = parseNotebook(Buffer.from(buildNotebook(), "utf-8"));
		// The huge output is cell index 3, output slot 0 -> '.cells[2].outputs[0]'.
		const res = renderNotebook(nb!, { maxCellOutputChars: 10000 });
		expect(res.text).not.toContain("a ".repeat(100)); // no raw dump inline
		expect(res.text).toContain("use jq '.cells[2].outputs[0]' to inspect");
		expect(res.text).toContain("output truncated: 12000 chars");
	});

	it("honours a custom per-cell output cap (lower than default)", () => {
		const nb = parseNotebook(Buffer.from(buildNotebook(), "utf-8"));
		// Small text output ("hello from execution\n") would exceed a tiny cap.
		const res = renderNotebook(nb!, { maxCellOutputChars: 5 });
		expect(res.text).toContain("use jq '.cells[1].outputs[0]' to inspect");
	});

	it("collects image outputs separately as data URLs and marks them inline", () => {
		const ipynb = JSON.stringify({
			nbformat: 4,
			cells: [
				{
					cell_type: "code",
					source: ["plt.plot(); plt.show()"],
					outputs: [
						{
							output_type: "display_data",
							data: {
								// A 1x1 transparent PNG as a placeholder payload.
								"image/png":
									"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
								"text/plain": ["<Figure size 640x480 with 1 Axes>"],
							},
						},
					],
				},
			],
		});
		const nb = parseNotebook(Buffer.from(ipynb, "utf-8"));
		expect(nb).not.toBeNull();
		const res = renderNotebook(nb!);
		expect(res.images).toHaveLength(1);
		expect(res.images[0]).toMatch(/^data:image\/png;base64,/);
		// marker present inline so non-vision models still get a hint
		expect(res.text).toContain("[plot: base64 image data follows]");
	});

	it("renders error outputs with an ename/evalue + traceback block", () => {
		const ipynb = JSON.stringify({
			nbformat: 4,
			cells: [
				{
					cell_type: "code",
					source: ["1 / 0"],
					outputs: [
						{
							output_type: "error",
							ename: "ZeroDivisionError",
							evalue: "division by zero",
							traceback: ["ZeroDivisionError: division by zero"],
						},
					],
				},
			],
		});
		const nb = parseNotebook(Buffer.from(ipynb, "utf-8"));
		const res = renderNotebook(nb!);
		expect(res.text).toContain("ZeroDivisionError: division by zero");
		expect(res.images).toHaveLength(0);
	});

	it("returns null for invalid JSON / non-notebook json", () => {
		expect(parseNotebook(Buffer.from("not json", "utf-8"))).toBeNull();
		expect(parseNotebook(Buffer.from('{"cells": 5}', "utf-8"))).toBeNull();
		expect(parseNotebook(Buffer.from('{"foo": 1}', "utf-8"))).toBeNull();
		expect(parseNotebook(Buffer.from("[]", "utf-8"))).toBeNull();
	});
});
