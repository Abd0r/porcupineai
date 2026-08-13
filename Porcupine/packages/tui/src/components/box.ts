import type { Component } from "../tui.ts";
import { applyBackgroundToLine, visibleWidth } from "../utils.ts";

type RenderCache = {
	childLines: string[];
	width: number;
	bgSample: string | undefined;
	bgFn: ((text: string) => string) | undefined;
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
	// Scratch buffer, reused across renders to hold the CURRENT frame's child
	// outputs without re-allocating. It is distinct from lastChildRefs (the
	// previous frame's baseline) so the identity comparison stays valid.
	private scanBuffer: Array<string[] | undefined> = [];

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
			cache.bgFn === this.bgFn &&
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
		const n = this.children.length;

		// Render every child exactly ONCE into the reusable scan buffer.
		// Children whose renders are instance-stable (Text/Markdown/Box caches)
		// return their cached arrays here, so the scan is cheap for the common
		// all-stable case; a child that returns a fresh array marks the frame
		// as changed. Collecting all outputs in one pass means the rebuild below
		// reuses this frame's outputs instead of re-rendering children a second
		// time (the previous code re-rendered every child on a changed frame,
		// and double-rendered the first unstable child during identity probing).
		if (this.scanBuffer.length !== n) {
			this.scanBuffer = new Array<string[] | undefined>(n);
		}
		const scanned = this.scanBuffer;
		let stable =
			this.cache !== undefined &&
			width === this.lastRenderWidth &&
			bgSample === this.lastBgSample &&
			this.cache.bgFn === this.bgFn;
		for (let i = 0; i < n; i++) {
			const lines = this.children[i]!.render(contentWidth);
			scanned[i] = lines;
			if (lines !== this.lastChildRefs[i]) {
				stable = false;
			}
		}

		// Fully stable, same width + bg: the cached output is still valid.
		// Return it by reference (zero rebuild).
		if (stable) {
			return this.cache!.lines;
		}
		this.lastRenderWidth = width;
		this.lastBgSample = bgSample;
		// Promote this frame's outputs as the next render's identity baseline.
		if (this.lastChildRefs.length !== n) {
			this.lastChildRefs = new Array<string[] | undefined>(n);
		}
		for (let i = 0; i < n; i++) {
			this.lastChildRefs[i] = scanned[i];
		}

		const leftPad = " ".repeat(this.paddingX);

		// Build padded child lines from the already-rendered scan buffer.
		const childLines: string[] = [];
		for (let i = 0; i < n; i++) {
			const lines = scanned[i]!;
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
		this.cache = { childLines, width, bgSample, bgFn: this.bgFn, lines: result };

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
