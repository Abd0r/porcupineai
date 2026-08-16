import { describe, expect, test, vi } from "vitest";
import { PorcupineRequestTimeoutError } from "../src/errors.ts";
import type { ConnectionStateChange } from "../src/types.ts";
import { collectRequests, connectClient, MemoryByteServer, sessionSnapshot } from "./support.ts";

describe("PorcupineClient", () => {
	test("correlates coalesced out-of-order responses", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const requests = collectRequests(server);
		const listed = client.listSessions();
		const attached = client.attachSession("session-1");
		expect(requests).toHaveLength(2);

		const attachRequest = requests.find((request) => request.request.command === "attach");
		const listRequest = requests.find((request) => request.request.command === "list");
		if (!attachRequest || !listRequest) throw new Error("Missing requests");
		server.sendTogether([
			{
				type: "response",
				id: attachRequest.id,
				ok: true,
				result: { command: "attach", session: sessionSnapshot("session-1") },
			},
			{
				type: "response",
				id: listRequest.id,
				ok: true,
				result: { command: "list", sessions: [] },
			},
		]);

		await expect(listed).resolves.toEqual([]);
		await expect(attached).resolves.toMatchObject({ id: "session-1", attached: true });
	});

	test("rejects a mismatched response instead of leaving its request pending", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const requests = collectRequests(server);
		const listed = client.listSessions();
		expect(requests).toMatchObject([{ request: { command: "list" } }]);
		server.send({
			type: "response",
			id: requests[0]!.id,
			ok: true,
			result: { command: "attach", session: sessionSnapshot("session-1") },
		});

		await expect(listed).rejects.toMatchObject({
			name: "ProtocolValidationError",
			message: "Response command attach does not match list",
		});
		expect(client.connectionState).toBe("disconnected");
	});

	test("surfaces typed request errors", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const requests = collectRequests(server);
		const attaching = client.attachSession("locked");
		server.send({
			type: "response",
			id: requests[0]?.id ?? "missing",
			ok: false,
			error: { code: "session_locked", message: "Already attached" },
		});
		await expect(attaching).rejects.toMatchObject({ name: "PorcupineServerError", code: "session_locked" });
	});

	test("drops a late response after timeout instead of failing the connection (BUG-C3)", async () => {
		vi.useFakeTimers();
		try {
			const server = new MemoryByteServer();
			const client = await connectClient(server, { requestTimeoutMs: 100 });
			const requests = collectRequests(server);
			const changes: ConnectionStateChange[] = [];
			client.onConnectionStateChange((change) => changes.push(change));

			const slow = client.listSessions();
			const slowGuard = slow.catch(() => {}); // avoid unhandled rejection while timers advance
			await vi.advanceTimersByTimeAsync(100); // timeout fires
			await expect(slow).rejects.toBeInstanceOf(PorcupineRequestTimeoutError);
			await slowGuard;
			expect(client.connectionState).toBe("connected");

			// A busy server delivers the response late. It must be dropped, not fatal.
			server.send({
				type: "response",
				id: requests[0]!.id,
				ok: true,
				result: { command: "list", sessions: [] },
			});
			expect(client.connectionState).toBe("connected");
			expect(changes.map((c) => c.state)).not.toContain("disconnected");
			await client.dispose();
		} finally {
			vi.useRealTimers();
		}
	});
});
