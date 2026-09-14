import { describe, expect, it } from "vitest";
import {
	formatNodeVersionError,
	isNodeVersionSupported,
	MINIMUM_NODE_VERSION,
	parseNodeVersion,
} from "../src/cli/node-version.ts";

describe("cli node version guard", () => {
	it("parses versions with a v prefix, missing patch, and major only", () => {
		expect(parseNodeVersion("v22.19.0")).toEqual([22, 19, 0]);
		expect(parseNodeVersion("22.19")).toEqual([22, 19, 0]);
		expect(parseNodeVersion("24")).toEqual([24, 0, 0]);
	});

	it("accepts the minimum and anything newer", () => {
		for (const version of ["22.19.0", "22.19.1", "22.20.0", "23.0.0", "24.1.0"]) {
			expect(isNodeVersionSupported(version)).toBe(true);
		}
	});

	it("rejects older runtimes, including the ones whose undici import crashes", () => {
		// 20.20.2 is the version where the bare `undici` import throws
		// "webidl.util.markAsUncloneable is not a function".
		for (const version of ["18.20.0", "20.20.2", "21.7.3", "22.18.0"]) {
			expect(isNodeVersionSupported(version)).toBe(false);
		}
	});

	it("names the running version, the requirement, and a way to fix it", () => {
		const message = formatNodeVersionError("20.20.2");
		expect(message).toContain("Node.js 20.20.2");
		expect(message).toContain(MINIMUM_NODE_VERSION);
		expect(message).toContain("nodejs.org");
	});
});
