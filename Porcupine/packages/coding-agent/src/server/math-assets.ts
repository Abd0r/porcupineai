import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getPackageDir, isBunBinary } from "../config.ts";

const assets = new Map<string, Buffer>();

/** Serve only the bundled math renderer and fonts; no model data or remote CDN. */
export function serveMathAsset(path: string, res: ServerResponse): boolean {
	if (!path.startsWith("/workbench/math/")) return false;
	const name = path.slice("/workbench/math/".length);
	const type =
		name === "katex.min.js" || name === "mhchem.min.js"
			? "text/javascript"
			: name === "katex.min.css"
				? "text/css"
				: /^fonts\/KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(name)
					? name.endsWith(".woff2")
						? "font/woff2"
						: name.endsWith(".woff")
							? "font/woff"
							: "font/ttf"
					: undefined;
	if (!type) {
		res.writeHead(404);
		res.end();
		return true;
	}
	let body = assets.get(name);
	if (!body) {
		const packaged = join(getPackageDir(), isBunBinary ? "math" : "dist/server/math");
		const directory = existsSync(packaged) ? packaged : dirname(createRequire(import.meta.url).resolve("katex"));
		body = readFileSync(
			join(directory, name === "mhchem.min.js" && !existsSync(packaged) ? "contrib/mhchem.min.js" : name),
		);
		assets.set(name, body);
	}
	res.writeHead(200, {
		"content-type": type,
		"content-length": body.length,
		"cache-control": "no-cache",
		"x-content-type-options": "nosniff",
	});
	res.end(body);
	return true;
}
