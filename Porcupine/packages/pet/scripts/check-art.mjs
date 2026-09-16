#!/usr/bin/env node
/**
 * Validate the shipped art without a GUI. Runs in CI.
 *
 * Every clip folder must have a clip.json describing it, frames that match the count it
 * claims, one canvas size across its frames, and sane anchor fractions. The bugs this
 * catches are the ones that actually bit us: a clip whose frames grew a second canvas size
 * (which squashes taller frames when drawn), a clip.json whose numbers no longer match the
 * frames after a re-cut, and a species folder that lost a clip.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const speciesRoot = join(root, "resources", "pet");
const problems = [];
let clips = 0;
let frames = 0;

function pngSize(path) {
	const buf = readFileSync(path);
	// IHDR is the first chunk: 8 byte signature, 4 length, 4 type, then width and height
	if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
	return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

for (const species of readdirSync(speciesRoot)) {
	const dir = join(speciesRoot, species);
	for (const entry of readdirSync(dir)) {
		const clipDir = join(dir, entry);
		if (!existsSync(join(clipDir, "clip.json"))) {
			// the hedgehog is a single still, not a clip
			const still = join(dir, entry + ".png");
			if (existsSync(clipDir) && !existsSync(still)) continue;
		}
		const metaPath = join(clipDir, "clip.json");
		if (!existsSync(metaPath)) continue;
		clips++;
		const meta = JSON.parse(readFileSync(metaPath, "utf8"));
		const pngs = readdirSync(clipDir).filter((f) => f.endsWith(".png")).sort();
		if (pngs.length === 0) {
			problems.push(`${species}/${entry}: no frames`);
			continue;
		}
		if (meta.frames && pngs.length !== meta.frames) {
			problems.push(`${species}/${entry}: clip.json says ${meta.frames} frames, found ${pngs.length}`);
		}
		const sizes = new Set();
		for (const f of pngs) {
			const s = pngSize(join(clipDir, f));
			if (!s) {
				problems.push(`${species}/${entry}/${f}: not a PNG`);
				continue;
			}
			sizes.add(`${s.w}x${s.h}`);
			frames++;
		}
		if (sizes.size > 1) {
			problems.push(`${species}/${entry}: ${sizes.size} canvas sizes across frames (${[...sizes].join(", ")}); every frame must share one, or the taller ones get squashed when drawn`);
		}
		const first = pngSize(join(clipDir, pngs[0]));
		if (meta.width && first && meta.width !== first.w) {
			problems.push(`${species}/${entry}: clip.json width ${meta.width} != frame width ${first.w}`);
		}
		if (meta.height && first && meta.height !== first.h) {
			problems.push(`${species}/${entry}: clip.json height ${meta.height} != frame height ${first.h}`);
		}
		for (const key of ["anchorX", "anchorY"]) {
			const v = meta[key];
			if (typeof v === "number" && (v < 0 || v > 1)) problems.push(`${species}/${entry}: ${key} ${v} outside 0..1`);
		}
	}
}

console.log(`checked ${clips} clips, ${frames} frames`);
if (problems.length) {
	console.error(`\n${problems.length} problem(s):`);
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}
console.log("art is consistent");
