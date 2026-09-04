import { describe, expect, it } from "vitest";
import { DialogCoordinator } from "../src/modes/interactive/dialog-coordinator.ts";

describe("DialogCoordinator", () => {
	it("aborts every losing participant after the first result", async () => {
		const coordinator = new DialogCoordinator();
		let loserAborted = false;
		const result = coordinator.race(undefined, (signal) => [
			Promise.resolve("winner"),
			new Promise<string | undefined>((resolve) => {
				signal.addEventListener(
					"abort",
					() => {
						loserAborted = true;
						resolve(undefined);
					},
					{ once: true },
				);
			}),
		]);

		expect(await result).toBe("winner");
		expect(loserAborted).toBe(true);
		expect(coordinator.pendingCount).toBe(0);
	});

	it("propagates an external abort to the active dialog", async () => {
		const coordinator = new DialogCoordinator();
		const external = new AbortController();
		const result = coordinator.race({ signal: external.signal }, (signal) => [
			new Promise<string | undefined>((resolve) => {
				if (signal.aborted) {
					resolve(undefined);
					return;
				}
				signal.addEventListener("abort", () => resolve(undefined), { once: true });
			}),
		]);

		external.abort();
		expect(await result).toBeUndefined();
		expect(coordinator.pendingCount).toBe(0);
	});

	it("aborts all active dialogs during teardown", async () => {
		const coordinator = new DialogCoordinator();
		let aborted = 0;
		const result = coordinator.race(undefined, (signal) => [
			new Promise<string | undefined>((resolve) => {
				signal.addEventListener(
					"abort",
					() => {
						aborted++;
						resolve(undefined);
					},
					{ once: true },
				);
			}),
		]);

		coordinator.abortAll();
		expect(await result).toBeUndefined();
		expect(aborted).toBe(1);
		expect(coordinator.pendingCount).toBe(0);
	});
});
