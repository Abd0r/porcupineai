import { describe, expect, it } from "vitest";
import { replayWorkbenchTimeline } from "../src/server/workbench-replay.ts";

describe("responsive history replay", () => {
	it("keeps all events ordered and yields before a long transcript is complete", async () => {
		const input = Array.from({ length: 600 }, (_, i) => i),
			seen: number[] = [],
			yieldSizes: number[] = [];
		const complete = await replayWorkbenchTimeline(
			input,
			(item) => seen.push(item),
			() => true,
			async () => {
				yieldSizes.push(seen.length);
			},
		);
		expect(complete).toBe(true);
		expect(seen).toEqual(input);
		expect(yieldSizes.length).toBeGreaterThan(1);
		expect(yieldSizes[0]).toBeLessThan(100);
	});
	it("stops applying old events when the conversation changes during a yield", async () => {
		let current = true;
		const seen: number[] = [];
		const complete = await replayWorkbenchTimeline(
			Array.from({ length: 600 }, (_, i) => i),
			(item) => seen.push(item),
			() => current,
			async () => {
				current = false;
			},
		);
		expect(complete).toBe(false);
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.length).toBeLessThan(100);
	});
});
