/** Conservative fallback for standalone ASCII formulas in learning components. */
export function formatLearningMath(source: string): string {
	if (/\\[([]|\$\$/.test(source)) return source;
	const output: string[] = [];
	let fence = "";
	for (const line of source.split("\n")) {
		const marker = /^\s*(```|~~~)/.exec(line)?.[1];
		if (marker) {
			fence = fence === marker ? "" : fence || marker;
			output.push(line);
			continue;
		}
		if (fence || line.length > 2000 || /[$`]|https?:\/\/|\\[([]/.test(line)) {
			output.push(line);
			continue;
		}
		const colon = line.indexOf(":"),
			start = colon >= 0 ? colon + 1 : 0;
		const prefix = line.slice(0, start) + (/^\s*/.exec(line.slice(start))?.[0] || "");
		let formula = line.slice(start).trim();
		if (
			!/[=^_∫]|\\(?:frac|sqrt|int|sum|lim)|\bd\/d[A-Za-z]\b/.test(formula) ||
			/[^A-Za-z0-9_\s\\{}()[\].,+\-*/^=<>|'!%∫∞→\u0370-\u03ff]/.test(formula)
		) {
			output.push(line);
			continue;
		}
		const words = formula.replace(/\\[A-Za-z]+/g, "").match(/[A-Za-z]{2,}/g) || [];
		if (
			words.some(
				(word) =>
					![
						"lim",
						"sin",
						"cos",
						"tan",
						"log",
						"ln",
						"exp",
						"infty",
						"dx",
						"dy",
						"dt",
						"du",
						"dv",
						"dz",
						"ma",
						"mc",
					].includes(word),
			)
		) {
			output.push(line);
			continue;
		}
		formula = formula
			.replace(/\blim(?=[_{\s(])/g, "\\lim")
			.replace(/->|→/g, "\\to ")
			.replace(/∫/g, "\\int ")
			.replace(/∞/g, "\\infty ");
		formula = formula
			.replace(/\bd\/d([A-Za-z])\b/g, "\\frac{d}{d$1}")
			.replace(/\[([^[\]]+)\]\s*\/\s*([A-Za-z]|[0-9]+)(?![A-Za-z0-9])/g, "\\frac{$1}{$2}");
		formula = formula.replace(/\b(sin|cos|tan|log|ln|exp)(?=[(\s])/g, "\\$1");
		output.push(`${prefix}\\(${formula}\\)`);
	}
	return output.join("\n");
}
