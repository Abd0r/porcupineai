// Regression: BUG-4 — InMemoryCredentialStore.list() bypassed the per-provider
// serialization chain, so a list() issued concurrently with a slow
// modify(refresh) could observe the stale/undefined pre-write state. list() now
// waits for in-flight writes before snapshotting, so it never serves a stale or
// partial credential.
import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";

describe("InMemoryCredentialStore list serialization", () => {
	it("sees the value written by a concurrent in-flight modify", async () => {
		const store = new InMemoryCredentialStore();

		const modify = store.modify("provider", async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return { type: "api_key" as const, key: "fresh-token" };
		});
		const listing = store.list();

		await modify;
		const entries = await listing;

		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({ providerId: "provider", type: "api_key" });
	});

	it("lists multiple providers after all writes settle", async () => {
		const store = new InMemoryCredentialStore();
		await store.modify("a", async () => ({ type: "api_key" as const, key: "k1" }));
		await store.modify("b", async () => ({
			type: "oauth" as const,
			refresh: "r",
			access: "a",
			expires: 0,
		}));

		const entries = await store.list();
		expect(new Set(entries.map((e) => e.providerId))).toEqual(new Set(["a", "b"]));
	});
});
