import { afterEach, describe, expect, it, vi } from "vitest";
import { type ServeApiHandle, type ServeApiSession, startServeApi } from "../src/server/http-api.ts";

const handles = new Set<ServeApiHandle>();
afterEach(async () => {
	for (const handle of handles) await handle.close();
	handles.clear();
	vi.useRealTimers();
});
async function fixture() {
	const decisions: Array<{ id: string; allow: boolean }> = [];
	let confirm!: Parameters<ServeApiSession["onConfirm"]>[0];
	const handle = await startServeApi({
		port: 0,
		token: "approval-test",
		session: {
			id: "a",
			async sendUserMessage() {},
			async abort() {},
			isStreaming: () => false,
			onEvent: () => () => {},
			onConfirm(handler) {
				confirm = handler;
				return () => {};
			},
		},
	});
	handles.add(handle);
	return {
		handle,
		decisions,
		fire(id: string) {
			confirm({ id, title: "Approve", message: "Fixture operation" }, (allow) => decisions.push({ id, allow }));
		},
		async approve(id: string) {
			const res = await fetch(`http://127.0.0.1:${handle.port()}/session/a/permissions/${id}/response`, {
				method: "POST",
				headers: { authorization: "Bearer approval-test" },
				body: '{"allow":true}',
			});
			await res.json();
			return res.status;
		},
	};
}
describe("approval lifecycle", () => {
	it("denies pending approvals immediately when the server closes", async () => {
		const h = await fixture();
		h.fire("pending");
		await h.handle.close();
		handles.delete(h.handle);
		expect(h.decisions).toEqual([{ id: "pending", allow: false }]);
	});
	it("does not let an earlier timeout deny a later request reusing an approval ID", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const h = await fixture();
		h.fire("reused");
		expect(await h.approve("reused")).toBe(200);
		vi.advanceTimersByTime(30000);
		h.fire("reused");
		vi.advanceTimersByTime(30000);
		expect(h.decisions).toEqual([{ id: "reused", allow: true }]);
		expect(await h.approve("reused")).toBe(200);
		expect(h.decisions).toEqual([
			{ id: "reused", allow: true },
			{ id: "reused", allow: true },
		]);
	});
});
