import { describe, expect, it } from "vitest";
import { processImage } from "../src/utils/image-process.ts";
import { detectSupportedImageMimeType } from "../src/utils/mime.ts";
import { loadPhoton } from "../src/utils/photon.ts";

function createTinyBmp1x1Red24bpp(): Buffer {
	const buffer = Buffer.alloc(58);
	buffer.write("BM", 0, "ascii");
	buffer.writeUInt32LE(buffer.length, 2);
	buffer.writeUInt32LE(54, 10);
	buffer.writeUInt32LE(40, 14);
	buffer.writeInt32LE(1, 18);
	buffer.writeInt32LE(1, 22);
	buffer.writeUInt16LE(1, 26);
	buffer.writeUInt16LE(24, 28);
	buffer.writeUInt32LE(0, 30);
	buffer.writeUInt32LE(4, 34);
	buffer[56] = 0xff;
	return buffer;
}

function expectPngMagic(base64Data: string): void {
	const buffer = Buffer.from(base64Data, "base64");
	expect(buffer[0]).toBe(0x89);
	expect(buffer[1]).toBe(0x50);
	expect(buffer[2]).toBe(0x4e);
	expect(buffer[3]).toBe(0x47);
}

/** Build a raw RGBA pixel buffer (photon needs (pixels, width, height)). */
function buildRgbPixels(width: number, height: number, noise: boolean): Uint8Array {
	const rgb = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			if (noise) {
				rgb[i] = (x * 255) / width;
				rgb[i + 1] = (y * 255) / height;
				rgb[i + 2] = ((x + y) * 255) / (width + height);
				rgb[i + 3] = 255;
			} else {
				rgb[i] = 200;
				rgb[i + 1] = 40;
				rgb[i + 2] = 40;
				rgb[i + 3] = 255;
			}
		}
	}
	return rgb;
}

/** Generate a noisy JPEG (compresses poorly) at a given width/height/quality. */
async function generateJpegBase64(width: number, height: number, quality: number): Promise<string> {
	const photon = await loadPhoton();
	if (!photon) throw new Error("photon unavailable");
	const image = new photon.PhotonImage(buildRgbPixels(width, height, true), width, height);
	try {
		const bytes = image.get_bytes_jpeg(quality);
		return Buffer.from(bytes).toString("base64");
	} finally {
		image.free();
	}
}

/** Generate a solid-color PNG at a given width/height via photon. */
async function generatePng(width: number, height: number): Promise<string> {
	const photon = await loadPhoton();
	if (!photon) throw new Error("photon unavailable");
	const image = new photon.PhotonImage(buildRgbPixels(width, height, false), width, height);
	try {
		const bytes = image.get_bytes();
		return Buffer.from(bytes).toString("base64");
	} finally {
		image.free();
	}
}

describe("image processing pipeline", () => {
	it("detects BMP files from magic bytes", () => {
		expect(detectSupportedImageMimeType(createTinyBmp1x1Red24bpp())).toBe("image/bmp");
	});

	it("converts BMP files to PNG attachments when auto-resize is disabled", async () => {
		const result = await processImage(createTinyBmp1x1Red24bpp(), "image/bmp", { autoResizeImages: false });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.mimeType).toBe("image/png");
		expect(result.hints).toContain("[Image converted from image/bmp to image/png.]");
		expectPngMagic(result.data);
	});

	it("converts BMP files before auto-resizing", async () => {
		const result = await processImage(createTinyBmp1x1Red24bpp(), "image/bmp");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.mimeType).toBe("image/png");
		expect(result.hints).toContain("[Image converted from image/bmp to image/png.]");
		expectPngMagic(result.data);
	});

	it("returns ok:false unchanged for input that is not a supported image", async () => {
		const garbage = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
		const result = await processImage(garbage, "application/octet-stream");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("could not be converted");
	});
});

describe("processImage scale metadata", () => {
	it("reports on-disk vs attached dimensions and scale factor for a downscaled PNG", async () => {
		// 100x100 PNG downscaled to a 50x50 max dimension.
		const png = await generatePng(100, 100);
		const bytes = Buffer.from(png, "base64");

		const result = await processImage(bytes, "image/png", {
			resizeOptions: { maxWidth: 50, maxHeight: 50, maxBytes: 10 * 1024 * 1024 },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.originalWidth).toBe(100);
		expect(result.originalHeight).toBe(100);
		expect(result.attachedWidth!).toBeLessThanOrEqual(50);
		expect(result.attachedHeight!).toBeLessThanOrEqual(50);
		expect(result.scaleFactor!).toBeCloseTo(100 / result.attachedWidth!, 2);
		expect(result.scaleFactor!).toBeGreaterThan(1);
	});

	it("reports scaleFactor 1 when no downscaling occurs", async () => {
		const png = await generatePng(16, 16);
		const bytes = Buffer.from(png, "base64");

		const result = await processImage(bytes, "image/png", {
			resizeOptions: { maxWidth: 2000, maxHeight: 2000, maxBytes: 10 * 1024 * 1024 },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.originalWidth).toBe(16);
		expect(result.originalHeight).toBe(16);
		expect(result.attachedWidth).toBe(16);
		expect(result.attachedHeight).toBe(16);
		expect(result.scaleFactor).toBe(1);
	});
});

describe("processImage JPEG quality ladder", () => {
	it("degrades to a fitting quality via the ladder without shrinking dimensions", async () => {
		const width = 250;
		const height = 250;
		// High-quality noisy source (large). Feed a 4K-like screenshot that is far
		// too big to attach at its natural quality.
		const q95 = await generateJpegBase64(width, height, 95);
		const inputSize = Buffer.byteLength(q95, "utf-8");

		// Budget that the source cannot fit (its own size), but that a low-quality
		// lace of the ladder comfortably can (~35% of q95 at these qualities).
		const maxBytes = Math.floor(inputSize * 0.5);

		const result = await processImage(Buffer.from(q95, "base64"), "image/jpeg", {
			resizeOptions: { maxWidth: 2000, maxHeight: 2000, maxBytes },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.mimeType).toBe("image/jpeg");

		const resultSize = Buffer.byteLength(result.data, "utf-8");
		// Stepped down from the (too-large) q95 input and fits the budget.
		expect(resultSize).toBeLessThan(inputSize);
		expect(resultSize).toBeLessThanOrEqual(maxBytes);

		// The quality ladder, not the dimension-shrink fallback, produced the fit:
		// the dimensions are unchanged (no downscale needed).
		expect(result.originalWidth).toBe(width);
		expect(result.originalHeight).toBe(height);
		expect(result.attachedWidth).toBe(width);
		expect(result.attachedHeight).toBe(height);
		expect(result.scaleFactor).toBe(1);
	});

	it("keeps a within-budget JPEG byte-for-byte unchanged", async () => {
		const q95 = await generateJpegBase64(64, 64, 95);
		const result = await processImage(Buffer.from(q95, "base64"), "image/jpeg", {
			resizeOptions: { maxWidth: 2000, maxHeight: 2000, maxBytes: 10 * 1024 * 1024 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toBe(q95);
		expect(result.scaleFactor).toBe(1);
	});
});
