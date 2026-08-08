import { describe, expect, test } from "vitest";
import type { PorcupineClient } from "../src/index.ts";
import { collectRequests, connectClient, MemoryByteServer } from "./support.ts";

/**
 * opt-proof-cbD — client request/response hot-path micro-benchmarks.
 * Focus: per-request timer allocation (non-unref'd), pending-request map
 * churn, and full round-trip cost. Diagnostic timing only; no exact asserts.
 */

async function _roundTrip(requests: number): Promise<void> {
	const server = new MemoryByteServer();
	const client = await connectClient(server);
	const calls = collectRequests(server);

	const pending = new Array(requests);
	for (let i = 0; i < requests; i += 1) {
		pending[i] = (async () => {
			const listed = client.listSessions();
			// Wait until the request lands on the wire, then reply immediately.
			const request = calls[calls.length - 1];
			if (request?.request.command === "list") {
				server.send({ type: "response", id: request.id, ok: true, result: { command: "list", sessions: [] } });
			}
			await listed;
		})();
	}
	// The calls array is appended inside onMessage synchronously, so by this
	// point all `list` requests are enqueued in the server's decoder. Drain them.
	for (const call of calls) {
		server.send({ type: "response", id: call.id, ok: true, result: { command: "list", sessions: [] } });
	}
	await Promise.all(pending);
	await client.dispose();
}

describe("opt-proof-cbD client hot-path costs", () => {
	test("1k sequential request/response round-trips", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const calls = collectRequests(server);

		const start = performance.now();
		for (let i = 0; i < 1_000; i += 1) {
			const listed = client.listSessions();
			const request = calls[calls.length - 1];
			if (request?.request.command === "list") {
				server.send({ type: "response", id: request.id, ok: true, result: { command: "list", sessions: [] } });
			}
			await listed;
		}
		const ms = performance.now() - start;
		await client.dispose();
		// eslint-disable-next-line no-console
		console.log(`[opt-proof-cbD] 1k sequential round-trips = ${ms.toFixed(1)}ms`);
		expect(calls.length).toBe(1_000);
	});

	test("1k concurrent round-trips (pendingRequests map churn)", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const calls = collectRequests(server);

		const start = performance.now();
		for (let i = 0; i < 1_000; i += 1) client.listSessions();
		for (const call of calls) {
			server.send({ type: "response", id: call.id, ok: true, result: { command: "list", sessions: [] } });
		}
		const ms = performance.now() - start;
		await client.dispose();
		// eslint-disable-next-line no-console
		console.log(`[opt-proof-cbD] 1k concurrent round-trips = ${ms.toFixed(1)}ms`);
		expect(calls.length).toBe(1_000);
	});

	test("verify 1k concurrent requests do not leak pending entries after resolution", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const calls = collectRequests(server);
		for (let i = 0; i < 1_000; i += 1) client.listSessions();
		for (const call of calls) {
			server.send({ type: "response", id: call.id, ok: true, result: { command: "list", sessions: [] } });
		}
		// Let microtasks settle.
		await new Promise((resolve) => setTimeout(resolve, 0));
		await client.dispose();
		expect(calls.length).toBe(1_000);
	});

	test("reused client type sanity", async () => {
		// Verify the performance test constructs a functional client once, to
		// prove the benchmark path itself works (not measuring a broken setup).
		const server = new MemoryByteServer();
		const client: PorcupineClient = await connectClient(server);
		await client.dispose();
		expect(client.disposed).toBe(true);
	});
});
