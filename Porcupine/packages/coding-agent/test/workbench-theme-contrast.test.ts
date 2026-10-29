import { describe, expect, it } from "vitest";
import { WORKBENCH_STYLES } from "../src/server/web-ui-styles.ts";
import { APPEARANCE_STYLES } from "../src/server/workbench-appearance.ts";

function colors(source: string) {
	return Object.fromEntries(
		[...source.matchAll(/--([a-z-]+):\s*(#[a-f0-9]{6});/gi)].map((match) => [match[1], match[2]]),
	);
}
function luminance(hex: string) {
	return hex
		.slice(1)
		.match(/../g)!
		.map((value) => Number.parseInt(value, 16) / 255)
		.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
		.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
const defaults = colors(WORKBENCH_STYLES.match(/:root\s*{([^}]+)}/s)![1]);
const light = colors(APPEARANCE_STYLES.match(/:root\[data-colour-mode="light"\]\s*{([^}]+)}/s)![1]);

describe("theme text contrast", () => {
	for (const theme of ["workbench", "pixel", "cyberpunk", "static", "tokyo-night"])
		for (const mode of ["dark", "light"]) {
			it(`${theme} ${mode} keeps small text legible on common surfaces`, () => {
				const block = APPEARANCE_STYLES.match(
					new RegExp(`:root\\[data-theme="${theme}"\\]\\[data-colour-mode="${mode}"\\]\\s*{([^}]+)}`, "s"),
				);
				const palette = { ...defaults, ...(mode === "light" ? light : {}), ...colors(block?.[1] || "") };
				for (const foreground of ["text", "muted", "quiet", "accent", "danger"])
					for (const background of ["bg", "surface", "sidebar"]) {
						const a = luminance(palette[foreground]),
							b = luminance(palette[background]),
							ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
						expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
					}
			});
		}
});
