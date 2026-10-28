import { describe, expect, it } from "vitest";
import { formatLearningMath } from "../src/server/learning-math.ts";

describe("learning math formatting", () => {
	it("preserves existing LaTeX operators while normalizing bare operators", () => {
		expect(formatLearningMath("y = \\sin(x) + cos(x)")).toBe("\\(y = \\sin(x) + \\cos(x)\\)");
		expect(formatLearningMath("\\lim_{h->0} x^2")).toBe("\\(\\lim_{h\\to 0} x^2\\)");
	});
	it("typesets the timeline and flashcard examples from the screenshot", () => {
		expect(formatLearningMath("f'(x) = lim_{h->0} [(x+h)^2 - x^2]/h")).toBe(
			"\\(f'(x) = \\lim_{h\\to 0} \\frac{(x+h)^2 - x^2}{h}\\)",
		);
		expect(formatLearningMath("Power rule: d/dx x^n")).toBe("Power rule: \\(\\frac{d}{dx} x^n\\)");
	});
	it("preserves prose, existing delimiters, currency, URLs and code", () => {
		expect(formatLearningMath("\\[\nx^2\n\\]")).toBe("\\[\nx^2\n\\]");
		for (const source of [
			"Write the difference quotient",
			"The price is $5.",
			"Learn at https://example.com/x^2",
			"$x^2$",
			"\\(x^2\\)",
			"x is 4^2",
			"```ts\nx^2\n```",
			"Use `x^2` in code",
		])
			expect(formatLearningMath(source)).toBe(source);
	});
});
