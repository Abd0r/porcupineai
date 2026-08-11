import { applyExifOrientation } from "./exif-orientation.ts";
import { convertImageBytesToPng } from "./image-convert.ts";
import { formatDimensionNote, type ImageResizeOptions, type ResizedImage, resizeImage } from "./image-resize.ts";
import { loadPhoton } from "./photon.ts";

export interface ProcessImageOptions {
	/** Whether to resize images to inline provider limits. Default: true */
	autoResizeImages?: boolean;
	/** Optional resize overrides. Uses resizeImage defaults when omitted. */
	resizeOptions?: ImageResizeOptions;
}

export type ProcessImageResult =
	| {
			ok: true;
			data: string;
			mimeType: string;
			hints: string[];
			/** Width of the image on disk (before any downscaling), when known. */
			originalWidth?: number;
			/** Height of the image on disk (before any downscaling), when known. */
			originalHeight?: number;
			/** Width of the attached/downscaled image, when known. */
			attachedWidth?: number;
			/** Height of the attached/downscaled image, when known. */
			attachedHeight?: number;
			/**
			 * Multiply displayed/attached coordinates by this factor to map them to the
			 * original on-disk image (originalWidth / attachedWidth). 1 when no downscale.
			 */
			scaleFactor?: number;
	  }
	| {
			ok: false;
			message: string;
	  };

interface NormalizedImage {
	bytes: Uint8Array;
	mimeType: string;
	convertedFrom?: string;
}

/**
 * JPEG attachment quality ladder. When a JPEG screenshot is too large to attach at
 * its natural quality, we step down the quality and attach at the first setting that
 * fits the inline budget, degrading gracefully instead of failing to attach.
 */
const JPEG_QUALITY_LADDER = [95, 80, 60, 40, 20];

// Consistent with image-resize-core: 4.5MB of base64 payload (headroom below 5MB).
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;
// Consistent with image-resize-core default max dimensions.
const DEFAULT_MAX_WIDTH = 2000;
const DEFAULT_MAX_HEIGHT = 2000;

function baseMimeType(mimeType: string): string {
	return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function normalizeSupportedImageMimeType(mimeType: string): string | null {
	switch (baseMimeType(mimeType)) {
		case "image/png":
			return "image/png";
		case "image/jpeg":
		case "image/jpg":
			return "image/jpeg";
		case "image/gif":
			return "image/gif";
		case "image/webp":
			return "image/webp";
		default:
			return null;
	}
}

async function normalizeImage(bytes: Uint8Array, mimeType: string): Promise<NormalizedImage | null> {
	const normalizedMimeType = normalizeSupportedImageMimeType(mimeType);
	if (normalizedMimeType) {
		return { bytes, mimeType: normalizedMimeType };
	}

	const pngBytes = await convertImageBytesToPng(bytes);
	if (!pngBytes) {
		return null;
	}

	return {
		bytes: pngBytes,
		mimeType: "image/png",
		convertedFrom: baseMimeType(mimeType),
	};
}

function conversionHint(from: string | undefined, to: string): string | undefined {
	if (!from || from === to) return undefined;
	return `[Image converted from ${from} to ${to}.]`;
}

/**
 * Resolve a JPEG image to an attachable result via the quality ladder.
 *
 * If the JPEG already fits within the dimension and byte limits, it is returned
 * unchanged (preserving the default output for existing callers). Otherwise it is
 * downscaled to the max dimensions and encoded down the quality ladder
 * (95 -> 80 -> 60 -> 40 -> 20), claiming the first quality that fits. If even
 * quality 20 does not fit, returns null so callers can fall back to resizeImage,
 * which shrinks dimensions further.
 */
async function resolveJpegLadder(bytes: Uint8Array, options?: ImageResizeOptions): Promise<ResizedImage | null> {
	const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
	const maxHeight = options?.maxHeight ?? DEFAULT_MAX_HEIGHT;
	const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

	const photon = await loadPhoton();
	if (!photon) {
		return null;
	}

	let image: ReturnType<typeof photon.PhotonImage.new_from_byteslice> | undefined;
	try {
		const rawImage = photon.PhotonImage.new_from_byteslice(bytes);
		image = applyExifOrientation(photon, rawImage, bytes);
		if (image !== rawImage) rawImage.free();

		const originalWidth = image.get_width();
		const originalHeight = image.get_height();
		const inputBase64Size = Math.ceil(bytes.byteLength / 3) * 4;

		// Already within all limits: return unchanged so the default output is preserved.
		if (originalWidth <= maxWidth && originalHeight <= maxHeight && inputBase64Size < maxBytes) {
			return {
				data: Buffer.from(bytes).toString("base64"),
				mimeType: "image/jpeg",
				originalWidth,
				originalHeight,
				width: originalWidth,
				height: originalHeight,
				wasResized: false,
			};
		}

		// Downscale to fit the max dimensions (mirrors image-resize-core sizing).
		let targetWidth = originalWidth;
		let targetHeight = originalHeight;
		if (targetWidth > maxWidth) {
			targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
			targetWidth = maxWidth;
		}
		if (targetHeight > maxHeight) {
			targetWidth = Math.round((targetWidth * maxHeight) / targetHeight);
			targetHeight = maxHeight;
		}

		const resized = photon.resize(image, targetWidth, targetHeight, photon.SamplingFilter.Lanczos3);
		try {
			for (const quality of JPEG_QUALITY_LADDER) {
				const jpegBytes = resized.get_bytes_jpeg(quality);
				const data = Buffer.from(jpegBytes).toString("base64");
				if (Buffer.byteLength(data, "utf-8") < maxBytes) {
					return {
						data,
						mimeType: "image/jpeg",
						originalWidth,
						originalHeight,
						width: targetWidth,
						height: targetHeight,
						wasResized: originalWidth !== targetWidth || originalHeight !== targetHeight,
					};
				}
			}
		} finally {
			resized.free();
		}

		// Even quality 20 is too big at these dimensions; let the caller shrink further.
		return null;
	} catch {
		return null;
	} finally {
		if (image) {
			image.free();
		}
	}
}

export async function processImage(
	bytes: Uint8Array,
	mimeType: string,
	options?: ProcessImageOptions,
): Promise<ProcessImageResult> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const normalized = await normalizeImage(bytes, mimeType);
	if (!normalized) {
		return {
			ok: false,
			message: "[Image omitted: could not be converted to a supported inline image format.]",
		};
	}

	if (autoResizeImages) {
		const resizeOptions = options?.resizeOptions;
		let resized: ResizedImage | null;
		if (normalized.mimeType === "image/jpeg") {
			// JPEG: prefer the quality ladder so large screenshots degrade (lower quality)
			// rather than fail to attach. Fall back to the general resizer (which shrinks
			// dimensions further) only if even quality 20 cannot fit.
			resized = await resolveJpegLadder(normalized.bytes, resizeOptions);
			if (!resized) {
				resized = await resizeImage(normalized.bytes, normalized.mimeType, resizeOptions);
			}
		} else {
			resized = await resizeImage(normalized.bytes, normalized.mimeType, resizeOptions);
		}

		if (!resized) {
			return {
				ok: false,
				message: "[Image omitted: could not be resized below the inline image size limit.]",
			};
		}

		const hints: string[] = [];
		const convertedHint = conversionHint(normalized.convertedFrom, resized.mimeType);
		if (convertedHint) hints.push(convertedHint);
		const dimensionNote = formatDimensionNote(resized);
		if (dimensionNote) hints.push(dimensionNote);

		const scaleFactor = resized.originalWidth > 0 ? resized.originalWidth / resized.width : 1;

		return {
			ok: true,
			data: resized.data,
			mimeType: resized.mimeType,
			hints,
			originalWidth: resized.originalWidth,
			originalHeight: resized.originalHeight,
			attachedWidth: resized.width,
			attachedHeight: resized.height,
			scaleFactor,
		};
	}

	const hints: string[] = [];
	const convertedHint = conversionHint(normalized.convertedFrom, normalized.mimeType);
	if (convertedHint) hints.push(convertedHint);

	return {
		ok: true,
		data: Buffer.from(normalized.bytes).toString("base64"),
		mimeType: normalized.mimeType,
		hints,
		scaleFactor: 1,
	};
}
