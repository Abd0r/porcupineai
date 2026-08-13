// Regression: BUG-1 — parseStreamingJsonThrottled cached its result in a single
// module-global slot, so two concurrent streams calling within the 50ms throttle
// window could cross-read each other's mid-stream tool-argument parse. The cache
// is now keyed by content identity, so a different buffer always re-parses.
import { describe, expect, it } from "vitest";
import { parseStreamingJsonThrottled } from "../src/utils/json-parse.ts";

describe("parseStreamingJsonThrottled (content-keyed cache)", () => {
	it("re-parses when the input buffer differs within the throttle window", () => {
		// Both calls happen back-to-back, well inside the 50ms window.
		// Before the fix, the second call returned the FIRST buffer's cached parse.
		const streamA = '{"tool":"alpha","arguments":{"x":1}';
		const streamB = '{"tool":"beta","arguments":{"y":2}';
		parseStreamingJsonThrottled(streamA);
		const resultB = parseStreamingJsonThrottled<{ tool: string }>(streamB);

		expect(resultB.tool).toBe("beta");
	});

	it("serves a repeating identical buffer from the throttle cache (same key)", () => {
		const same = '{"tool":"gamma","arguments":{"z":1}';
		parseStreamingJsonThrottled<{ tool: string }>(same);
		const again = parseStreamingJsonThrottled<{ tool: string }>(same);
		expect(again.tool).toBe("gamma");
	});
});
