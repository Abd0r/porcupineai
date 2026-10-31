import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getPackageDir, isBunBinary } from "../config.ts";
import { PDF_PREVIEW_MODULE, PDF_STANDALONE_MODULE } from "./pdf-preview.ts";
import { WORKBENCH_STYLES } from "./web-ui-styles.ts";
import { APPEARANCE_STYLES } from "./workbench-appearance.ts";
import { ARTIFACT_STYLES } from "./workbench-artifacts-ui.ts";
import { WORKBENCH_COLOUR_STYLES } from "./workbench-colours.ts";

const cache = new Map<string, Buffer>();

/** Public renderer assets only. PDF bytes continue to require session authentication. */
export function servePdfAsset(path: string, res: ServerResponse): boolean {
	if (!path.startsWith("/workbench/pdf/")) return false;
	const name = path.slice("/workbench/pdf/".length);
	if (name === "viewer.html") {
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
			"content-security-policy":
				"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; font-src 'self' blob: data:; worker-src 'self'; connect-src 'self' blob:; img-src blob: data:; base-uri 'none'; frame-ancestors 'none'",
		});
		res.end(
			`<!doctype html><html lang="en" data-theme="pixel" data-colour-mode="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF · Porcupine</title><style>${WORKBENCH_STYLES}${APPEARANCE_STYLES}${WORKBENCH_COLOUR_STYLES}${ARTIFACT_STYLES}body{padding:20px;overflow:auto;height:auto;min-height:100dvh}header{display:flex;justify-content:space-between;align-items:center;gap:16px}h1{font-size:18px;overflow-wrap:anywhere}a{color:var(--accent)}.pdf-stage{max-height:calc(100dvh - 220px)}</style><header><h1 id="pdf-title">PDF</h1><a id="pdf-download" hidden>Download original</a></header><main id="pdf-document">Loading PDF…</main><script type="module" src="/workbench/pdf/standalone.mjs"></script></html>`,
		);
		return true;
	}
	const module = ["viewer.mjs", "standalone.mjs", "pdf.mjs", "pdf.worker.mjs"].includes(name);
	const data =
		/^(?:cmaps\/[A-Za-z0-9_-]+\.bcmap|standard_fonts\/[A-Za-z0-9_.-]+\.(?:pfb|ttf)|wasm\/[A-Za-z0-9_-]+\.(?:wasm|js)|iccs\/[A-Za-z0-9_-]+\.icc)$/.test(
			name,
		);
	if (!module && !data) {
		res.writeHead(404);
		res.end();
		return true;
	}
	let body = cache.get(name);
	if (!body) {
		if (name === "viewer.mjs") body = Buffer.from(PDF_PREVIEW_MODULE);
		else if (name === "standalone.mjs") body = Buffer.from(PDF_STANDALONE_MODULE);
		else {
			const packaged = join(getPackageDir(), isBunBinary ? "pdf" : "dist/server/pdf");
			const directory = existsSync(packaged)
				? packaged
				: dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
			const file = join(directory, !existsSync(packaged) && module ? `legacy/build/${name}` : name);
			if (!existsSync(file)) {
				res.writeHead(404);
				res.end();
				return true;
			}
			body = readFileSync(file);
		}
		cache.set(name, body);
	}
	res.writeHead(200, {
		"content-type":
			module || name.endsWith(".js")
				? "text/javascript"
				: name.endsWith(".wasm")
					? "application/wasm"
					: "application/octet-stream",
		"content-length": body.length,
		"cache-control": "no-cache",
		"x-content-type-options": "nosniff",
	});
	res.end(body);
	return true;
}
