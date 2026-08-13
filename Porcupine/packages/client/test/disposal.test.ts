import { describe, expect, test } from "vitest";
import { PorcupineClient, PorcupineClientDisposedError } from "../src/index.ts";
import { attachSession, baseServerSnapshot, connectClient, MemoryByteServer, sessionSnapshot } from "./support.ts";

describe("PorcupineClient disposal", () => {
	test("connects through its ownership factory", async () => {
		const server = new MemoryByteServer();
		server.onMessage((message) => {
			if (message.type !== "hello") return;
			server.send({
				type: "hello",
				version: 2,
				connectionId: "connection-1",
				snapshot: baseServerSnapshot,
			});
		});

		const client = await PorcupineClient.connect({
			token: "secret",
			transportFactory: (handlers) => server.connect(handlers),
		});

		expect(client.connected).toBe(true);
		await client.dispose();
	});

	test("disconnects, invalidates child handles, and rejects pending requests", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const handle = await attachSession(client, server, sessionSnapshot("session-1"));
		const pending = client.listSessions();

		const firstDisposal = client.dispose();
		const secondDisposal = client.dispose();

		expect(secondDisposal).toBe(firstDisposal);
		expect(client.disposed).toBe(true);
		expect(client.connected).toBe(false);
		expect(handle.attached).toBe(false);
		await expect(pending).rejects.toBeInstanceOf(PorcupineClientDisposedError);
		await expect(handle.prompt("after disposal")).rejects.toBeInstanceOf(PorcupineClientDisposedError);
		await firstDisposal;
	});

	test("supports explicit async disposal", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);

		await client[Symbol.asyncDispose]();

		expect(client.disposed).toBe(true);
		expect(client.connectionState).toBe("disconnected");
	});

	test("disposing an inactive session handle never throws synchronously (BUG-C1)", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const handle = await attachSession(client, server, sessionSnapshot("session-1"));

		expect(handle.attached).toBe(true);
		await client.dispose();
		expect(handle.attached).toBe(false);

		// dispose() must conform to the AsyncDisposable contract: return a promise even
		// when the underlying lease release would assert (it must never throw synchronously).
		let syncThrow: unknown;
		let disposal: unknown;
		try {
			disposal = handle.dispose();
		} catch (error) {
			syncThrow = error;
		}
		expect(syncThrow).toBeUndefined();
		expect(disposal).toBeInstanceOf(Promise);
		await expect(disposal as Promise<void>).resolves.toBeUndefined();
	});
});
