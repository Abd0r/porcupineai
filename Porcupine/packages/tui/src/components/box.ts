import type { Component } from "../tui.ts";
import { applyBackgroundToLine, visibleWidth } from "../utils.ts";

type RenderCache = {
	childLines: string[];
	width: number;
	bgSample: string | undefined;
	lines: string[];
};

/**
 * Box component - a container that applies padding and background to all children
 */
export class Box implements Component {
	children: Component[] = [];
	private paddingX: number;
	private paddingY: number;
	private bgFn?: (text: string) => string;

	// Cache for rendered output
	private cache?: RenderCache;
	// Fast-path bookkeeping: last render width + the array instance each child
	// returned, so an unchanged render (all children returned their cached
	// arrays) skips the childLines rebuild + element-wise cache comparison.
	private lastRenderWidth = -1;
	private lastBgSample: string | undefined = undefined;
	private lastChildRefs: Array<string[] | undefined> = [];

	constructor(paddingX = 1, paddingY = 1, bgFn?: (text: string) => string) {
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.bgFn = bgFn;
	}

	addChild(component: Component): void {
		this.children.push(component);
		this.invalidateCache();
	}

	removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index !== -1) {
			this.children.splice(index, 1);
			this.invalidateCache();
		}
	}

	clear(): void {
		this.children = [];
		this.invalidateCache();
	}

	setBgFn(bgFn?: (text: string) => string): void {
		this.bgFn = bgFn;
		// Don't invalidate here - we'll detect bgFn changes by sampling output
	}

	private invalidateCache(): void {
		this.cache = undefined;
	}

	private matchCache(width: number, childLines: string[], bgSample: string | undefined): boolean {
		const cache = this.cache;
		return (
			!!cache &&
			cache.width === width &&
			cache.bgSample === bgSample &&
			cache.childLines.length === childLines.length &&
			cache.childLines.every((line, i) => line === childLines[i])
		);
	}

	invalidate(): void {
		this.invalidateCache();
		for (const child of this.children) {
			child.invalidate?.();
		}
	}

	render(width: number): string[] {
		if (this.children.length === 0) {
			return [];
		}

		const contentWidth = Math.max(1, width - this.paddingX * 2);
		const bgSample = this.bgFn ? this.bgFn("test") : undefined;

		// Fast path: same width, same bg sample, and every child returned the
		// SAME cached array instance as the previous render — the child lines
		// are identical, so the cached result is valid without rebuilding the
		// padded line list or comparing it element-wise. Children whose renders
		// are instance-stable (Text/Markdown/Box caches) make this the common
		// case; any child that returns a fresh array falls through to the slow
		// path, so behavior never changes.
		if (width === this.lastRenderWidth && bgSample === this.lastBgSample && this.cache) {
			let stable = this.lastChildRefs.length === this.children.length;
			if (stable) {
				for (let i = 0; i < this.children.length; i++) {
					const lines = this.children[i]!.render(contentWidth);
					if (lines !== this.lastChildRefs[i]) {
						stable = false;
						break;
					}
				}
			}
			if (stable) {
				return this.cache.lines;
			}
		}
		this.lastRenderWidth = width;
		this.lastBgSample = bgSample;

		const leftPad = " ".repeat(this.paddingX);

		// Render all children
		const childLines: string[] = [];
		this.lastChildRefs = new Array<string[] | undefined>(this.children.length);
		for (let i = 0; i < this.children.length; i++) {
			const lines = this.children[i]!.render(contentWidth);
			this.lastChildRefs[i] = lines;
			for (const line of lines) {
				childLines.push(leftPad + line);
			}
		}

		if (childLines.length === 0) {
			return [];
		}

		// Check cache validity
		if (this.matchCache(width, childLines, bgSample)) {
			return this.cache!.lines;
		}

		// Apply background and padding
		const result: string[] = [];

		// Top padding
		for (let i = 0; i < this.paddingY; i++) {
			result.push(this.applyBg("", width));
		}

		// Content
		for (const line of childLines) {
			result.push(this.applyBg(line, width));
		}

		// Bottom padding
		for (let i = 0; i < this.paddingY; i++) {
			result.push(this.applyBg("", width));
		}

		// Update cache
		this.cache = { childLines, width, bgSample, lines: result };

		return result;
	}

	private applyBg(line: string, width: number): string {
		const visLen = visibleWidth(line);
		const padNeeded = Math.max(0, width - visLen);
		const padded = line + " ".repeat(padNeeded);

		if (this.bgFn) {
			return applyBackgroundToLine(padded, width, this.bgFn);
		}
		return padded;
	}
}
