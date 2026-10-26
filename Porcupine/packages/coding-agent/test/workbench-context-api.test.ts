import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServeApi } from "../src/server/http-api.ts";
import { ContextFileStore } from "../src/server/workbench-context-files.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
	const root = mkdtempSync(join(tmpdir(), "context-api-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	const agent = join(root, "agent");
	mkdirSync(agent);
	const handle = await startServeApi({
		port: 0,
		token: "test-token",
		contextFiles: new ContextFileStore(root, agent),
		session: {
			id: "s",
			async sendUserMessage() {},
			async abort() {},
			isStreaming: () => false,
			onEvent: () => () => {},
			onConfirm: () => () => {},
		},
	});
	cleanups.push(() => handle.close());
	const base = `http://127.0.0.1:${handle.port()}`;
	return { base, auth: { authorization: "Bearer test-token", "content-type": "application/json" } };
}
describe("context Settings API", () => {
	it("requires authentication and same-origin requests for inspection and saving", async () => {
		const { base, auth } = await fixture();
		expect((await fetch(`${base}/workbench/context`)).status).toBe(401);
		expect(
			(
				await fetch(`${base}/workbench/context/global%3AUSER.md`, {
					method: "PUT",
					headers: { ...auth, origin: "https://other.example" },
					body: JSON.stringify({ content: "x", revision: "x" }),
				})
			).status,
		).toBe(403);
	});
	it("round-trips a document, rejects stale writes and never serves credential files", async () => {
		const { base, auth } = await fixture();
		const path = `${base}/workbench/context/global%3AUSER.md`;
		const initial = await fetch(path, { headers: auth });
		expect(initial.headers.get("cache-control")).toBe("no-store");
		const original = await initial.json();
		const save = (content: string) =>
			fetch(path, { method: "PUT", headers: auth, body: JSON.stringify({ content, revision: original.revision }) });
		expect((await save("# USER\nExplicit test preference\n")).status).toBe(200);
		expect((await save("stale overwrite")).status).toBe(409);
		expect((await fetch(`${base}/workbench/context/global%3Aauth.json`, { headers: auth })).status).toBe(404);
		expect((await fetch(path, { method: "DELETE", headers: auth })).status).toBe(405);
	});
});
