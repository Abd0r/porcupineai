import assert from "node:assert/strict";
import { test } from "node:test";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/**
 * FLICKER REGRESSION: with a buffer longer than the terminal (scrolled/session
 * view), a change ABOVE the visible viewport must NOT trigger a full clear +
 * redraw (the old code hit `firstChanged < prevViewportTop -> fullRender(true)`
 * = "\x1b[2J\x1b[H\x1b[3J" screen flash on every such update).
 */
class CaptureTerminal extends VirtualTerminal {
	output = "";
	constructor() {
		super(80, 20);
	}
	override write(data: string): void {
		this.output += data;
		super.write(data);
	}
}

function makeScreen(lines: string[]): { screen: TuiMainScreen; term: CaptureTerminal } {
	const term = new CaptureTerminal();
	const screen = new TuiMainScreen(term);
	screen.addChild({
		render: () => lines,
		invalidate() {},
	});
	return { screen, term };
}

test("change above the viewport does not clear the screen", async () => {
	const lines = Array.from({ length: 500 }, (_, i) => `row ${i} `.padEnd(79, "."));
	const { screen, term } = makeScreen(lines);

	// First render writes everything once.
	screen.requestRender();
	await new Promise((r) => setTimeout(r, 20));
	assert.ok(term.output.length > 0);
	const firstLen = term.output.length;
	term.output = "";

	// Change row 0 (above the viewport at the bottom of a 500-line buffer).
	lines[0] = "ROW 0 CHANGED".padEnd(79, ".");
	screen.requestRender();
	await new Promise((r) => setTimeout(r, 20));

	// The update must be incremental or skipped — never a full-screen clear.
	assert.ok(!term.output.includes("\x1b[2J"), "no clear-screen on off-viewport change");
	assert.ok(!term.output.includes("\x1b[3J"), "no scrollback wipe on off-viewport change");
	assert.ok(term.output.length < firstLen, "off-viewport change writes far less than a full render");
});

test("change inside the viewport still renders incrementally", async () => {
	const lines = Array.from({ length: 500 }, (_, i) => `row ${i} `.padEnd(79, "."));
	const { screen, term } = makeScreen(lines);
	screen.requestRender();
	term.output = "";

	// Change a row in the visible window (the bottom 20 rows).
	lines[490] = "ROW 490 CHANGED".padEnd(79, ".");
	screen.requestRender();
	await new Promise((r) => setTimeout(r, 20));

	assert.ok(!term.output.includes("\x1b[2J"), "in-viewport change must not clear");
	assert.ok(term.output.length > 0, "in-viewport change writes the changed rows");
});

test("append at the bottom (follow-end) still renders", async () => {
	const lines = Array.from({ length: 500 }, (_, i) => `row ${i} `.padEnd(79, "."));
	const { screen, term } = makeScreen(lines);
	screen.requestRender();
	term.output = "";

	lines.push("new row at the bottom".padEnd(79, "."));
	screen.requestRender();
	await new Promise((r) => setTimeout(r, 20));

	assert.ok(!term.output.includes("\x1b[2J"), "append must not clear the screen");
	assert.ok(term.output.length > 0, "append writes the new rows");
});
