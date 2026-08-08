import { describe, expect, it } from "vitest";
import { getPorcupineUserAgent } from "../src/utils/porcupine-user-agent.ts";

describe("getPorcupineUserAgent", () => {
	it("formats the Porcupine user agent", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getPorcupineUserAgent("1.2.3");

		expect(userAgent).toBe(`porcupine/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^porcupine\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
