import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StdinBuffer } from "../src/stdin-buffer.ts";

// ---------------------------------------------------------------------------
// ui-proof-cbA — stdin chunk-split parsing edge cases (FIXED behavior).
// flush() re-splits complete input, then emits an expired incomplete prefix as
// literal characters. This prevents later input from completing a stale escape
// prefix into a ghost shortcut.
// ---------------------------------------------------------------------------

function _collect(processChunks: string[]): string[] {
	const buffer = new StdinBuffer({ timeout: 5 });
	const emitted: string[] = [];
	buffer.on("data", (seq) => emitted.push(seq));
	for (const chunk of processChunks) {
		buffer.process(chunk);
	}
	if (buffer.getBuffer().length > 0) {
		for (const seq of buffer.flush()) emitted.push(seq);
	}
	return emitted;
}

describe("ui-proof-cbA stdin chunk splitting (fixed)", () => {
	it("two complete sequences in one buffer are emitted as separate sequences", () => {
		const buffer = new StdinBuffer({ timeout: 5 });
		const emitted: string[] = [];
		buffer.on("data", (seq) => emitted.push(seq));

		buffer.process("\x1b[<0;10;11M\x1b[<1;12;13m");
		for (const seq of buffer.flush()) emitted.push(seq);

		assert.deepEqual(emitted, ["\x1b[<0;10;11M", "\x1b[<1;12;13m"]);
	});

	it("emits an expired incomplete escape tail literally", () => {
		const buffer = new StdinBuffer({ timeout: 5 });
		buffer.process("\x1b[27;5;");

		assert.deepEqual(buffer.flush(), ["\x1b", "[", "2", "7", ";", "5", ";"]);
		assert.equal(buffer.getBuffer(), "");
	});

	it("does not let a slow tail complete an expired escape prefix", () => {
		const buffer = new StdinBuffer({ timeout: 0 });
		const emitted: string[] = [];
		buffer.on("data", (seq) => emitted.push(seq));

		buffer.process("\x1b[<0;10;11");
		for (const seq of buffer.flush()) emitted.push(seq);
		assert.deepEqual(emitted, ["\x1b", "[", "<", "0", ";", "1", "0", ";", "1", "1"]);
		assert.equal(buffer.getBuffer(), "");

		buffer.process("M");
		for (const seq of buffer.flush()) emitted.push(seq);
		assert.deepEqual(emitted, ["\x1b", "[", "<", "0", ";", "1", "0", ";", "1", "1", "M"]);
	});

	it("multi-byte codepoints survive buffer.process() calls", () => {
		const buffer = new StdinBuffer({ timeout: 5 });
		const emitted: string[] = [];
		buffer.on("data", (seq) => emitted.push(seq));
		buffer.process("é");
		for (const seq of buffer.flush()) emitted.push(seq);
		assert.ok(emitted.some((e) => e === "é"));
	});
});
