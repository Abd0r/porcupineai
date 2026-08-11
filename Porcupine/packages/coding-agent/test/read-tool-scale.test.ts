import { describe, expect, it } from "vitest";

/**
 * SCAFFOLD — read-tool image scale-factor disclosure.
 *
 * SOURCE API (NOT YET LANDED): when an image is read and auto-resized (or
 * scaled) for the model, the read tool should disclose the applied scale factor
 * so downstream accounting/token-estimation knows the real pixel size sent.
 *
 * Intended disclosure surfaces:
 *   - a field on the result details, e.g. result.details.scaleFactor, and/or
 *   - a human note in the text payload, e.g. "[Scaled image to 2000x2000]".
 *
 * The seam will likely be an extension of `processImage` hints and/or
 * `ReadToolDetails`. Do NOT import anything below until the source exports it.
 */
//
// TODO(parent): import { …readImageScale… } from "../src/core/tools/read.ts";
// TODO(parent): import { …processImage hints type… } from "../src/utils/image-process.ts";
//

describe("read tool: image scale-factor disclosure (SCAFFOLD — TODO)", () => {
	it("TODO: a downscaled image discloses the applied scale factor", () => {
		// read a large PNG; expect(result.details.scaleFactor).toBeGreaterThan(0);
		// expect(getText(result)).toMatch(/Scale(d| factor).*to \d+x\d+/i);
		expect(true).toBe(true); // placeholder — replace when API lands
	});

	it("TODO: an image already within bounds reports scale factor 1 (no scaling note)", () => {
		// expect(result.details?.scaleFactor).toBeUndefinedOr(1);
		// expect(getText(result)).not.toMatch(/Scale/i);
		expect(true).toBe(true); // placeholder — replace when API lands
	});

	it("TODO: scale factor number is consistent with the bytes/resolution disclosed", () => {
		// const bytesAfter = …; const expected = …; cross-check math.
		expect(true).toBe(true); // placeholder — replace when API lands
	});

	it("TODO: non-image text reads carry no scale-factor details", () => {
		// expect(result.details?.scaleFactor).toBeUndefined();
		expect(true).toBe(true); // placeholder — replace when API lands
	});
});
