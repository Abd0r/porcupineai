import { getKeybindings } from "../keybindings.ts";
import { matchesKey } from "../keys.ts";
import type { Component } from "../tui.ts";
import { visibleWidth } from "../utils.ts";
import { Markdown, type MarkdownTheme } from "./markdown.ts";

export interface MarkdownViewerStyle {
	/** Top/bottom horizontal border line */
	border: (text: string) => string;
	/** Title bar text */
	title: (text: string) => string;
	/** Footer hint text */
	footer: (text: string) => string;
	/** Left/right vertical border per content line (optional). */
	contentEdge?: (text: string) => string;
}

export interface MarkdownViewerOptions {
	/** Terminal height provider in rows. Used to size the full-screen viewer. */
	getHeight: () => number;
	/** Title shown in the title bar. */
	title: string;
	/** Raw markdown to display. */
	text: string;
	/** Markdown theme used to render the document body. */
	markdownTheme: MarkdownTheme;
	/** Color/style functions. */
	style: MarkdownViewerStyle;
	/** Footer hint line (rendered below the content). */
	footerHint: string;
	/** Called when the user closes the viewer. */
	onClose: () => void;
	/** Called to request a re-render (e.g. after scrolling). */
	requestRender: () => void;
}

/**
 * Full-screen, agent- or user-initiated markdown viewer.
 *
 * Because TUI overlays are rendered through `Component.render(width)` (not the
 * layout system), an overlay cannot participate in the viewport layout that
 * normally clips and scrolls a {@link ScrollView}. This viewer therefore
 * manages its own scroll window over the rendered markdown lines and clips the
 * visible slice to the terminal height supplied by `getHeight`.
 *
 * Keybindings: q / Escape close, arrows / PgUp / PgDn scroll.
 */
export class MarkdownViewer implements Component {
	private readonly options: MarkdownViewerOptions;
	private readonly markdown: Markdown;
	private scrollTop = 0;
	private cachedWidth?: number;

	constructor(options: MarkdownViewerOptions) {
		this.options = options;
		this.markdown = new Markdown(options.text, 3, 1, options.markdownTheme);
	}

	/** Scroll down (positive) or up (negative), clamped to the content bounds. */
	scrollBy(lines: number): void {
		const contentWidth = Math.max(1, this.overlayWidth() - 4);
		const maxScrollTop = Math.max(0, this.markdown.render(contentWidth).length - this.visibleContentHeight());
		this.scrollTop = Math.max(0, Math.min(maxScrollTop, this.scrollTop + lines));
		this.options.requestRender();
	}

	invalidate(): void {
		this.markdown.invalidate();
		this.cachedWidth = undefined;
	}

	private overlayWidth(): number {
		return this.cachedWidth ?? 80;
	}

	private visibleContentHeight(): number {
		// Available overlay rows = terminal height minus 2 (top+bottom margin).
		// Subtract border, title, spacer, spacer, footer, border = 6 fixed rows.
		const availableRows = Math.max(1, this.options.getHeight() - 2);
		return Math.max(1, availableRows - 6);
	}

	render(width: number): string[] {
		this.cachedWidth = width;

		const totalHeight = this.options.getHeight();
		// Available overlay rows (terminal minus top+bottom margin).
		const availableRows = Math.max(1, totalHeight - 2);
		const contentWidth = Math.max(1, width - 4);
		const contentLines = this.markdown.render(contentWidth);
		const viewportHeight = this.visibleContentHeight();
		const maxScrollTop = Math.max(0, contentLines.length - viewportHeight);
		if (this.scrollTop > maxScrollTop) {
			this.scrollTop = maxScrollTop;
		}

		const lines: string[] = [];
		lines.push(this.options.style.border("─".repeat(Math.max(1, width))));
		lines.push(this.options.style.title(this.options.title));
		lines.push("");

		const visible = contentLines.slice(this.scrollTop, this.scrollTop + viewportHeight);
		const edge = this.options.style.contentEdge;
		for (const line of visible) {
			if (edge) {
				const padded = line + " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
				lines.push(edge("│ ") + padded + edge(" │"));
			} else {
				lines.push(`  ${line}`);
			}
		}

		while (lines.length < availableRows - 3) {
			lines.push(edge ? edge("│ ") + " ".repeat(contentWidth) + edge(" │") : "  ");
		}

		lines.push("");
		lines.push(this.options.style.footer(this.options.footerHint));
		lines.push(this.options.style.border("─".repeat(Math.max(1, width))));

		// Trim to the available overlay height (terminal minus margins).
		return lines.slice(0, Math.max(1, availableRows));
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (matchesKey(data, "q") || kb.matches(data, "tui.select.cancel")) {
			this.options.onClose();
			return;
		}
		if (matchesKey(data, "up") || kb.matches(data, "tui.select.up")) {
			this.scrollBy(-1);
			return;
		}
		if (matchesKey(data, "down") || kb.matches(data, "tui.select.down")) {
			this.scrollBy(1);
			return;
		}
		if (matchesKey(data, "pageUp") || kb.matches(data, "tui.select.pageUp")) {
			this.scrollBy(-this.visibleContentHeight());
			return;
		}
		if (matchesKey(data, "pageDown") || kb.matches(data, "tui.select.pageDown")) {
			this.scrollBy(this.visibleContentHeight());
			return;
		}
	}
}
