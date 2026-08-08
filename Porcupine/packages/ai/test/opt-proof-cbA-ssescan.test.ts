/**
 * opt-proof-cbA — Micro-benchmark of the manual SSE parsers used by
 * openai-codex-responses.ts (`parseSSE`) and porcupine-messages.ts
 * (`readPorcupineMessagesEvents`).
 *
 * Current strategy (openai-codex-responses.ts:790, porcupine-messages.ts:275):
 *   buffer = buffer.replace(/\r\n/g, "\n");   // re-scan + rewrite ENTIRE buffer
 *   ... buffer.slice(idx + 2) ...             // re-copy per event
 *
 * MEASURED OUTCOME: despite the theoretical O(n^2) byte-copying, a JS rewrite
 * is NOT faster here — V8's native regex + substring operators are far faster
 * than a pure-JS per-char linear scanner (the rewrite measured ~10x SLOWER at
 * 2KB payloads). Conclusion: this parser is NOT a practical latency bottleneck
 * at realistic SSE sizes and should be LEFT AS-IS. Numbers are reported for
 * honesty ("before" = current, "after" = hypothetical rewrite).
 *
 * Run: npx vitest --run test/opt-proof-cbA-ssescan.test.ts
 */
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Current implementation (mirror of openai-codex-responses.ts parseSSE inner loop)
// ---------------------------------------------------------------------------
function currentParse(chunks: string[]): string[] {
	const out: string[] = [];
	let buffer = "";
	for (const raw of chunks) {
		buffer += raw;
		buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); // whole-buffer regex (O(B))
		let idx = buffer.indexOf("\n\n");
		while (idx !== -1) {
			const chunk = buffer.slice(0, idx); // copy
			buffer = buffer.slice(idx + 2); // copy the tail (O(B))
			const data = chunk
				.split("\n")
				.filter((l) => l.startsWith("data:"))
				.map((l) => l.slice(5).trim())
				.join("\n")
				.trim();
			if (data) out.push(data);
			idx = buffer.indexOf("\n\n");
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Fixed linear-charset decoder (no regex, no whole-buffer rewrite)
// ---------------------------------------------------------------------------
function fixedParse(chunks: string[]): string[] {
	const out: string[] = [];
	let buffer = "";
	for (const raw of chunks) {
		buffer += raw;
		let cursor = 0,
			lineStart = 0,
			eventBuf = "";
		let collecting = false;
		while (cursor < buffer.length) {
			const c = buffer[cursor];
			let next = -1;
			if (c === "\n") {
				next = cursor + 1;
			} else if (c === "\r") {
				next = buffer[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
			}
			if (next === -1) {
				cursor++;
				continue;
			}
			const line = buffer.slice(lineStart, cursor);
			if (line.startsWith("data:")) {
				const v = line.slice(5).trim();
				if (v) {
					eventBuf = eventBuf.length ? `${eventBuf}\n${v}` : v;
					collecting = true;
				}
			}
			if (line.length === 0 && collecting) {
				out.push(eventBuf);
				eventBuf = "";
				collecting = false;
			}
			lineStart = next;
			cursor = next;
		}
		buffer = buffer.slice(lineStart); // drop consumed lines
	}
	return out;
}

function buildSSE(nEvents: number, payloadBytes: number, crlf: boolean): string[] {
	const delimiter = crlf ? "\r\n\r\n" : "\n\n";
	const payload = "x".repeat(payloadBytes - 16);
	const chunks: string[] = [];
	let acc = "";
	for (let i = 0; i < nEvents; i++) {
		const ev = `data: ${JSON.stringify({ i, p: payload })}${delimiter}`;
		acc += ev;
		// cut into ~8KB TCP-like chunks so several events accumulate in buffer
		while (acc.length >= 4096) {
			chunks.push(acc.slice(0, 4096));
			acc = acc.slice(4096);
		}
	}
	if (acc.length) chunks.push(acc);
	return chunks;
}

function bench(fn: (c: string[]) => string[], chunks: string[]): number {
	fn(chunks); // warm
	const t0 = performance.now();
	const runs = 10;
	for (let r = 0; r < runs; r++) fn(chunks);
	return (performance.now() - t0) / runs;
}

describe("opt-proof-cbA: SSE parser scan complexity", () => {
	for (const payloadBytes of [64, 2048]) {
		for (const crlf of [false, true]) {
			const label = `payload=${payloadBytes}B-${crlf ? "CRLF" : "LF"}`;
			it(`1000 SSE events (${label}): current regex-rewrite vs linear decoder`, () => {
				const chunks = buildSSE(1000, payloadBytes, crlf);
				const a = currentParse(chunks);
				const b = fixedParse(chunks);
				expect(a.length).toBe(b.length); // correctness parity on count
				expect(a[0].length).toBe(b[0].length);
				const cur = bench(currentParse, chunks);
				const fixed = bench(fixedParse, chunks);
				console.log(
					`BENCH sse ${label}: current=${cur.toFixed(2)}ms fixed=${fixed.toFixed(2)}ms (${(cur / fixed).toFixed(1)}x)`,
				);
			});
		}
	}
});
