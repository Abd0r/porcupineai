import { describe, expect, test } from "vitest";
import {
	decodeCbor,
	encodeCbor,
	encodeClientMessage,
	encodeServerMessage,
	type ServerMessage,
	ServerMessageDecoder,
	type SessionSnapshot,
} from "../src/index.ts";

/**
 * opt-proof-cbD — protocol encode/decode micro-benchmarks.
 * These prove the cost of the encoder's double validation pass and the
 * decoder's per-key allocation + duplicate-key set overhead on hot paths.
 * They are diagnostic only; they do not assert exact timings (CI variance).
 */

function makeSessionSnapshot(n: number, revision = 1): SessionSnapshot {
	const transcript: SessionSnapshot["transcript"] = [];
	for (let i = 0; i < n; i += 1) {
		transcript.push({
			id: `m${i}`,
			role: "user",
			content: [{ type: "text", text: `message number ${i} long enough to be realistic` }],
			timestamp: i,
		});
	}
	return {
		id: "session-1",
		cwd: "/workspace",
		createdAt: 1,
		updatedAt: 2,
		phase: "idle",
		model: { provider: "faux", id: "model" },
		thinkingLevel: "off",
		attached: true,
		locked: true,
		revision,
		transcript,
		queuedSteer: [],
		queuedSteerCount: 0,
	};
}

function makeServerSnapshot(n: SessionSnapshot): ServerMessage {
	return {
		type: "event",
		event: { type: "session_snapshot", snapshot: n },
	};
}

function time(fn: () => void): number {
	const start = performance.now();
	fn();
	return performance.now() - start;
}

describe("opt-proof-cbD protocol hot-path costs", () => {
	test("encodeClientMessage: 10k small request envelopes", () => {
		const envelope = { type: "request" as const, id: "request-1", request: { command: "list" as const } };
		const iterations = 2_000;
		let checksum = 0;
		const ms = time(() => {
			for (let i = 0; i < iterations; i += 1) checksum += encodeClientMessage(envelope).length;
		});
		expect(checksum).toBeGreaterThan(0);
		// Diagnostic log only.
		// eslint-disable-next-line no-console
		console.log(`[opt-proof-cbD] encodeClientMessage 10k list = ${ms.toFixed(1)}ms`);
	});

	test("encodeServerMessage: 10k medium session_snapshot frames (30 transcript items x3 sessions)", () => {
		const message = makeServerSnapshot(makeSessionSnapshot(30));
		const iterations = 2_000;
		let checksum = 0;
		const encoded = time(() => {
			for (let i = 0; i < iterations; i += 1) checksum += encodeServerMessage(message).byteLength;
		});
		expect(checksum).toBeGreaterThan(0);
		// eslint-disable-next-line no-console
		console.log(`[opt-proof-cbD] encodeServerMessage 10k medium = ${encoded.toFixed(1)}ms`);
	});

	test("round-trip 10k medium server messages through ServerMessageDecoder", () => {
		const message = makeServerSnapshot(makeSessionSnapshot(30));
		const frame = encodeServerMessage(message);
		let messages: ServerMessage[] = [];
		const iterations = 2_000;
		let checksum = 0;
		const ms = time(() => {
			for (let i = 0; i < iterations; i += 1) {
				const decoder = new ServerMessageDecoder();
				messages = decoder.push(frame);
				decoder.end();
				checksum += messages.length;
			}
		});
		expect(checksum).toBe(iterations);
		// eslint-disable-next-line no-console
		console.log(`[opt-proof-cbD] decodeServerMessage 10k medium = ${ms.toFixed(1)}ms`);
	}, 30_000);

	test("reuses a single decoder across messages (streaming hot path)", () => {
		const message = makeServerSnapshot(makeSessionSnapshot(30));
		const frame = encodeServerMessage(message);
		const decoder = new ServerMessageDecoder();
		const iterations = 2_000;
		let checksum = 0;
		const ms = time(() => {
			for (let i = 0; i < iterations; i += 1) checksum += decoder.push(frame).length;
		});
		// Reuse across many messages; the construction cost above dominates,
		// so this is the true per-message marginal cost.
		expect(checksum).toBe(iterations);
		// eslint-disable-next-line no-console
		console.log(`[opt-proof-cbD] decodeServerMessage reused-decoder 10k = ${ms.toFixed(1)}ms`);
		decoder.end();
	}, 30_000);

	test("isolate CBOR encode cost vs TypeBox validation overhead", () => {
		const message = makeServerSnapshot(makeSessionSnapshot(30));
		let a = 0;
		let b = 0;
		const full = time(() => {
			for (let i = 0; i < 2_000; i++) a += encodeServerMessage(message).length;
		});
		const cborOnly = time(() => {
			for (let i = 0; i < 2_000; i++) b += encodeCbor(message).length;
		});
		expect(a > 0 && b > 0).toBe(true);
		// eslint-disable-next-line no-console
		console.log(
			`[opt-proof-cbD] encode 5k full=${full.toFixed(1)}ms cbor-only=${cborOnly.toFixed(1)}ms validation-ratio=${(full / cborOnly).toFixed(2)}x`,
		);
	});

	test("isolate CBOR decode cost vs TypeBox validation overhead (decode path)", () => {
		const message = makeServerSnapshot(makeSessionSnapshot(30));
		const frame = encodeServerMessage(message);
		const dec = new ServerMessageDecoder();
		let a = 0;
		const fullDecode = time(() => {
			for (let i = 0; i < 2_000; i++) a += dec.push(frame).length;
		});
		dec.end();
		let b = 0;
		const cborOnly = time(() => {
			for (let i = 0; i < 2_000; i++) {
				decodeCbor(frame.subarray(4));
				b++;
			}
		});
		expect(a > 0 && b > 0).toBe(true);
		// eslint-disable-next-line no-console
		console.log(
			`[opt-proof-cbD] decode 5k full=${fullDecode.toFixed(1)}ms cbor-only=${cborOnly.toFixed(1)}ms validation-ratio=${(fullDecode / cborOnly).toFixed(2)}x`,
		);
	});
});
