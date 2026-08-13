// Regression: BUG-6 — InMemoryCredentialStore.read() bypassed the per-provider
// write-serialization chain, so a read issued concurrently with a slow
// modify(refresh) could observe the stale/undefined pre-write state. Reads now
// route through the same enqueue chain and observe post-modify state.
import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";

describe("InMemoryCredentialStore read serialization", () => {
	it("sees the value written by a concurrent in-flight modify", async () => {
		const store = new InMemoryCredentialStore();

		// Slow modify that resolves after a delay, simulating a refresh that writes
		// a new token. A read() issued while it is in flight must NOT race ahead.
		const modify = store.modify("provider", async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return { type: "api_key" as const, key: "fresh-token" };
		});
		const read = store.read("provider");

		await modify;
		const value = await read;

		// With the fix the read is serialized after modify and returns the new token;
		// before the fix it returned `undefined` (stale/none).
		expect(value?.type).toBe("api_key");
		expect("key" in value! && (value as { key: string }).key).toBe("fresh-token");
	});
});
