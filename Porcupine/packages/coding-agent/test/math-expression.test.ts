import katex from "katex";
import { describe, expect, it } from "vitest";
import { compileMathExpression } from "../src/core/tools/math-expression.ts";
import "katex/contrib/mhchem";
import { WORKBENCH_MATH_MACROS } from "../src/server/math-macros.ts";

describe("safe mathematical expressions", () => {
	it.each([
		["2^3^2", 512],
		["-2^2", -4],
		["2^-2", 0.25],
		["sin(pi/2)+cos(0)", 2],
		["sqrt(9)+log(e)", 4],
		["max(2,3)*1e-2", 0.03],
	])("evaluates %s with mathematical precedence", (source, result) =>
		expect(compileMathExpression(String(source), [])({})).toBeCloseTo(Number(result), 12),
	);
	it.each([
		"x.y",
		"globalThis",
		"constructor()",
		"2x",
		"1;process.exit()",
		"sin()",
		"min(1)",
		"(1+2",
		"x=>1",
		"2**3",
		" ".repeat(1100),
		`${"(".repeat(40)}1${")".repeat(40)}`,
	])("rejects unsupported syntax %s", (source) => expect(() => compileMathExpression(source, ["x"])).toThrow());
	it("rejects nonfinite evaluations and excessive numeric output", () => {
		for (const expression of ["1/0", "sqrt(-1)", "exp(10000)", "10^13"])
			expect(() => compileMathExpression(expression, [])({})).toThrow();
	});
	it.each([
		String.raw`\ce{2 H2 + O2 -> 2 H2O}`,
		String.raw`\pu{12.3 kJ/mol}`,
		String.raw`\bra{\psi}\ket{\phi}`,
		String.raw`\braket{\psi}{\phi}`,
		String.raw`\ketbra{a}{b}`,
		String.raw`\pdv{\psi}{t}+\dv{f}{x}`,
		String.raw`\norm{v}+\abs{x}`,
	])("typesets chemistry and physics: %s", (source) => {
		const rendered = katex.renderToString(source, {
			throwOnError: true,
			trust: false,
			maxExpand: 1000,
			macros: { ...WORKBENCH_MATH_MACROS },
		});
		expect(rendered).toContain("katex");
		expect(rendered).not.toContain("katex-error");
	});
});
