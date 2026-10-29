import { describe, expect, it } from "vitest";
import { PORCUPINE_WEB_UI } from "../src/server/web-ui.ts";

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
const style = PORCUPINE_WEB_UI.match(/<style>([\s\S]*?)<\/style>/)![1];
function paletteFor(theme: string, mode: string) {
	const palette: Record<string, string> = {};
	for (const match of style.matchAll(/(:root(?:\[[^\]]+\])*)\s*{([^}]+)}/g)) {
		const themeMatch = match[1].match(/data-theme="([^"]+)"/);
		const modeMatch = match[1].match(/data-colour-mode="([^"]+)"/);
		if ((!themeMatch || themeMatch[1] === theme) && (!modeMatch || modeMatch[1] === mode))
			Object.assign(palette, colors(match[2]));
	}
	return palette;
}

describe("theme text contrast", () => {
	for (const theme of ["workbench", "pixel", "cyberpunk", "static", "tokyo-night"])
		for (const mode of ["dark", "light"]) {
			it(`${theme} ${mode} keeps small text legible on common surfaces`, () => {
				const palette = paletteFor(theme, mode);
				for (const foreground of [
					"text",
					"muted",
					"quiet",
					"accent",
					"danger",
					"success",
					"warning",
					"activity-code",
					"activity-skill",
					"activity-web",
					"activity-peer",
					"reasoning",
				])
					for (const background of [
						"bg",
						"surface",
						"sidebar",
						"elevated",
						"user-bg",
						"selected-bg",
						"surface-hover",
					]) {
						expect(palette[foreground], foreground).toMatch(/^#[a-f0-9]{6}$/i);
						expect(palette[background], background).toMatch(/^#[a-f0-9]{6}$/i);
						const a = luminance(palette[foreground]),
							b = luminance(palette[background]),
							ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
						expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
					}
				for (const [foreground, background] of [
					["accent-ink", "accent"],
					["text", "selection-bg"],
					["text", "code-bg"],
				]) {
					const a = luminance(palette[foreground]),
						b = luminance(palette[background]);
					expect(
						(Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
						`${foreground} on ${background}`,
					).toBeGreaterThanOrEqual(4.5);
				}
			});
		}
});
