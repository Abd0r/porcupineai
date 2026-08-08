import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StdinBuffer } from "../src/stdin-buffer.ts";

// ---------------------------------------------------------------------------
// ui-proof-cbA — stdin chunk-split parsing edge cases (FIXED behavior).
// flush() now re-splits with extractCompleteSequences and keeps an incomplete
// escape tail buffered so a slow escape split across a flush boundary is
// reassembled instead of leaking as a broken partial + garbage tail.
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

	it("an incomplete escape tail is kept buffered, not flushed raw", () => {
		const buffer = new StdinBuffer({ timeout: 5 });
		const emitted: string[] = [];
		buffer.on("data", (seq) => emitted.push(seq));

		buffer.process("\x1b[27;5;");
		const flushed = buffer.flush();
		assert.equal(flushed.length, 0, "incomplete tail must not be emitted");
		assert.equal(buffer.getBuffer(), "\x1b[27;5;", "tail stays buffered for reassembly");
	});

	it("a slow escape split across a flush() boundary is reassembled", () => {
		const buffer = new StdinBuffer({ timeout: 0 });
		const emitted: string[] = [];
		buffer.on("data", (seq) => emitted.push(seq));

		// Fragment 1: start of an SGR mouse sequence, still incomplete.
		buffer.process("\x1b[<0;10;11");
		for (const seq of buffer.flush()) emitted.push(seq);
		assert.equal(emitted.length, 0, "nothing complete yet");
		assert.equal(buffer.getBuffer(), "\x1b[<0;10;11");

		// Fragment 2 arrives after the flush: the buffered prefix + tail now form
		// one complete sequence — emitted as a single reassembled event.
		buffer.process("M");
		for (const seq of buffer.flush()) emitted.push(seq);
		assert.deepEqual(emitted, ["\x1b[<0;10;11M"], "reassembled, no bare tail leak");
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
