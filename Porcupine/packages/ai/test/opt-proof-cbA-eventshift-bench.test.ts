import { describe, expect, it } from "vitest";
import { EventStream } from "../src/utils/event-stream.ts";

describe("EventStream burst-drain benchmark", () => {
	it("burst push (10k events) then drain: shift() is O(n^2)", async () => {
		const stream = new EventStream<number, number>(
			(e) => e === -1,
			(e) => e,
		);
		const N = 200_000;
		const t0 = performance.now();
		for (let i = 0; i < N; i++) stream.push(i);
		stream.push(-1);
		const pushMs = performance.now() - t0;

		const t1 = performance.now();
		let count = 0;
		for await (const _ of stream) count++;
		const drainMs = performance.now() - t1;

		console.log(`BENCH shift-drain: push ${pushMs.toFixed(1)}ms, drain ${drainMs.toFixed(1)}ms (${N} events)`);
		expect(count).toBe(N + 1);
	});

	it("interleaved push/drain (steady state)", async () => {
		const stream = new EventStream<number, number>(
			(e) => e === -1,
			(e) => e,
		);
		const N = 200_000;
		const t0 = performance.now();
		const drain = (async () => {
			let c = 0;
			for await (const _ of stream) c++;
			return c;
		})();
		for (let i = 0; i < N; i++) {
			stream.push(i);
			await new Promise((r) => setImmediate(r));
		}
		stream.push(-1);
		const ms = performance.now() - t0;
		console.log(`BENCH interleaved: ${ms.toFixed(1)}ms (${N} events)`);
		expect(await drain).toBe(N + 1);
	});
});
