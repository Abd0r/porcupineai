import type { Component } from "../tui.ts";
import { truncateToWidth, visibleWidth } from "../utils.ts";

/**
 * Text component that truncates to fit viewport width.
 *
 * This component is immutable after construction (text + paddings are only
 * ever read, never mutated). render() therefore caches its output per width and
 * returns the SAME array instance on repeated same-width renders. That makes it
 * instance-stable, so Container/Box identity fast-paths can skip re-rendering
 * and the box-of-truncated-texts layout churn drops to zero when nothing changed.
 *
 * The cached array is handed out by reference to consumers per the render()
 * contract, so consumers must not mutate it.
 */
export class TruncatedText implements Component {
	private readonly text: string;
	private readonly paddingX: number;
	private readonly paddingY: number;

	private cacheWidth = -1;
	private cachedLines: string[] | undefined = undefined;

	constructor(text: string, paddingX: number = 0, paddingY: number = 0) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
	}

	invalidate(): void {
		// Immutable component - nothing to recompute; the cache is keyed on width
		// and rebuilt automatically when width changes.
	}

	render(width: number): string[] {
		// Same width -> the immutable component's output is identical; return the
		// cached instance by reference (zero recompute, instance-stable identity).
		if (width === this.cacheWidth && this.cachedLines !== undefined) {
			return this.cachedLines;
		}

		const result: string[] = [];

		// Empty line padded to width
		const emptyLine = " ".repeat(width);

		// Add vertical padding above
		for (let i = 0; i < this.paddingY; i++) {
			result.push(emptyLine);
		}

		// Calculate available width after horizontal padding
		const availableWidth = Math.max(1, width - this.paddingX * 2);

		// Take only the first line (stop at newline)
		let singleLineText = this.text;
		const newlineIndex = this.text.indexOf("\n");
		if (newlineIndex !== -1) {
			singleLineText = this.text.substring(0, newlineIndex);
		}

		// Truncate text if needed (accounting for ANSI codes)
		const displayText = truncateToWidth(singleLineText, availableWidth);

		// Add horizontal padding
		const leftPadding = " ".repeat(this.paddingX);
		const rightPadding = " ".repeat(this.paddingX);
		const lineWithPadding = leftPadding + displayText + rightPadding;

		// Pad line to exactly width characters
		const lineVisibleWidth = visibleWidth(lineWithPadding);
		const paddingNeeded = Math.max(0, width - lineVisibleWidth);
		const finalLine = lineWithPadding + " ".repeat(paddingNeeded);

		result.push(finalLine);

		// Add vertical padding below
		for (let i = 0; i < this.paddingY; i++) {
			result.push(emptyLine);
		}

		this.cacheWidth = width;
		this.cachedLines = result;
		return result;
	}
}
