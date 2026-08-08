import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { ImageContent } from "@porcupineai/ai";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
} from "../../core/extensions/types.ts";
import { spawnProcessSync } from "../../utils/child-process.ts";

// =============================================================================
// Image Scraper Extension
// =============================================================================
//
// For models WITHOUT native vision support, intercept user-attached images
// before the agent loop runs and extract text/content via IBM Unstructured.
// The extracted text is injected into the prompt with path tags; raw image
// bytes are stripped so the text-only model never sees them.
//
// Example injected prompt:
//   [Image-extracted text from attached images (non-vision model fallback):]
//   [Image: screenshot.png]
//   <extracted text here>
//   [End of image-extracted text. Re-examine any image with vision_analyze if needed.]
//   <original user prompt here>
//
// Requires: `pip install unstructured[all]` in the Python env Porcupine
// calls (the worker script runs via `process.execPath` so use the same
// Python that has `unstructured` installed).
// =============================================================================

const WORKER_SCRIPT = `
import sys, json
from pathlib import Path

try:
    from unstructured.partition.auto import partition
except Exception as e:
    print(json.dumps([{"path": p, "text": f"[unstructured import failed: {e}]"} for p in sys.argv[1:]], ensure_ascii=False))
    sys.exit(0)

results = []
for path_str in sys.argv[1:]:
    p = Path(path_str)
    if not p.exists() or not p.is_file():
        results.append({"path": path_str, "text": f"[Image file not found: {path_str}]"})
        continue
    try:
        elements = partition(str(p), strategy="auto")
        texts = [e.text for e in elements if getattr(e, "text", "").strip()]
        if texts:
            results.append({"path": path_str, "text": "\\n".join(texts)})
        else:
            results.append({"path": path_str, "text": f"[No extractable text in image: {p.name}]"})
    except Exception as e:
        results.append({"path": path_str, "text": f"[Image extraction failed for {p.name}: {e}]"})
print(json.dumps(results, ensure_ascii=False))
`;

const WORKER_CACHE_DIR = join(tmpdir(), "porcupine-image-scraper");
const WORKER_CACHE_PATH = join(WORKER_CACHE_DIR, "worker.py");

function ensureWorkerScript(): string {
	if (!existsSync(WORKER_CACHE_PATH)) {
		mkdirSync(WORKER_CACHE_DIR, { recursive: true });
		writeFileSync(WORKER_CACHE_PATH, WORKER_SCRIPT, "utf-8");
	}
	return WORKER_CACHE_PATH;
}

function writeTempImages(images: ImageContent[]): string[] {
	const tempDir = join(WORKER_CACHE_DIR, "tmp");
	mkdirSync(tempDir, { recursive: true });
	const paths: string[] = [];
	for (let i = 0; i < images.length; i++) {
		const img = images[i];
		if (img.type !== "image" || !img.data) continue;
		const ext = (img.mimeType ?? "image/png").split("/").pop() ?? "bin";
		const filename = `image-${Date.now()}-${i}.${ext}`;
		const path = join(tempDir, filename);
		writeFileSync(path, img.data, "base64");
		paths.push(path);
	}
	return paths;
}

function buildOcrPrompt(_paths: string[], ocrResults: Array<{ path: string; text: string }>): string {
	const lines: string[] = [];
	lines.push("[Image-extracted text from attached images (non-vision model fallback):]");
	for (const { path, text } of ocrResults) {
		const label = path.split(sep).pop() ?? path;
		lines.push(`[Image: ${label}]`);
		lines.push(text.trim());
		lines.push("");
	}
	lines.push("[End of image-extracted text. Re-examine any image with vision_analyze if needed.]");
	lines.push("");
	return lines.join("\n");
}

export default function imageScraperExtension(porcupine: ExtensionAPI): void {
	porcupine.on(
		"before_agent_start",
		async (event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<BeforeAgentStartEventResult | undefined> => {
			const images = event.images ?? [];
			if (images.length === 0) return undefined;

			// Only activate when the active model has no native vision support.
			const model = (porcupine as unknown as { model?: { input?: string | string[] } }).model;
			if (!model) return undefined;
			const input = Array.isArray(model.input) ? model.input : [model.input ?? "text"];
			if (input.includes("image")) return undefined;

			// Write base64 image data to temp files for Unstructured to process.
			const localPaths = writeTempImages(images);

			// Show animated UI indicator while OCR runs.
			ctx.ui?.setStatus?.(
				"image-scraper",
				`[activity: reading-docs] Extracting text from ${localPaths.length} image(s)...`,
			);
			ctx.ui?.setWorkingIndicator?.({
				frames: ["👁  reading", "👁  reading.", "👁  reading..", "👁  reading..."],
				intervalMs: 320,
			});

			try {
				const worker = ensureWorkerScript();
				const result = spawnProcessSync("python3", [worker, ...localPaths], {
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 60_000,
				});

				let ocrResults: Array<{ path: string; text: string }> = [];
				if (result.status === 0 && result.stdout.trim()) {
					try {
						ocrResults = JSON.parse(result.stdout.trim());
					} catch {
						ocrResults = [{ path: localPaths[0], text: result.stdout.trim() }];
					}
				} else if (result.stderr.trim()) {
					ocrResults = localPaths.map((p) => ({
						path: p,
						text: `[Extraction error: ${result.stderr.trim()}]`,
					}));
				} else {
					ocrResults = localPaths.map((p) => ({
						path: p,
						text: `[No output from image extractor for ${p.split(sep).pop() ?? p}]`,
					}));
				}

				const enrichedPrompt = `${buildOcrPrompt(localPaths, ocrResults)}\n\n${event.prompt}`;
				return { prompt: enrichedPrompt };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					prompt: `${event.prompt}\n\n[Image extraction failed: ${message}]`,
				};
			} finally {
				ctx.ui?.setStatus?.("image-scraper", undefined);
				ctx.ui?.setWorkingIndicator?.();
			}
		},
	);
}
