import { accessSync, constants } from "node:fs";
import { access } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { normalizePath, resolvePath } from "../../utils/paths.ts";

const NARROW_NO_BREAK_SPACE = "\u202F";

function tryMacOSScreenshotPath(filePath: string): string {
	return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
	// macOS stores filenames in NFD (decomposed) form, try converting user input to NFD
	return filePath.normalize("NFD");
}

function tryCurlyQuoteVariant(filePath: string): string {
	// macOS uses U+2019 (right single quotation mark) in screenshot names like "Capture d'écran"
	// Users typically type U+0027 (straight apostrophe)
	return filePath.replace(/'/g, "\u2019");
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export function expandPath(filePath: string): string {
	return normalizePath(filePath, { normalizeUnicodeSpaces: true, stripAtPrefix: true });
}

/**
 * Resolve a path relative to the given cwd.
 * Handles ~ expansion and absolute paths.
 */
export function resolveToCwd(filePath: string, cwd: string): string {
	return resolvePath(filePath, cwd, { normalizeUnicodeSpaces: true, stripAtPrefix: true });
}

export function resolveReadPath(filePath: string, cwd: string): string {
	const resolved = resolveToCwd(filePath, cwd);

	if (fileExists(resolved)) {
		return resolved;
	}

	// Try macOS AM/PM variant (narrow no-break space before AM/PM)
	const amPmVariant = tryMacOSScreenshotPath(resolved);
	if (amPmVariant !== resolved && fileExists(amPmVariant)) {
		return amPmVariant;
	}

	// Try NFD variant (macOS stores filenames in NFD form)
	const nfdVariant = tryNFDVariant(resolved);
	if (nfdVariant !== resolved && fileExists(nfdVariant)) {
		return nfdVariant;
	}

	// Try curly quote variant (macOS uses U+2019 in screenshot names)
	const curlyVariant = tryCurlyQuoteVariant(resolved);
	if (curlyVariant !== resolved && fileExists(curlyVariant)) {
		return curlyVariant;
	}

	// Try combined NFD + curly quote (for French macOS screenshots like "Capture d'écran")
	const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
	if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) {
		return nfdCurlyVariant;
	}

	return resolved;
}

export async function resolveReadPathAsync(filePath: string, cwd: string): Promise<string> {
	const resolved = resolveToCwd(filePath, cwd);

	if (await pathExists(resolved)) {
		return resolved;
	}

	// Try macOS AM/PM variant (narrow no-break space before AM/PM)
	const amPmVariant = tryMacOSScreenshotPath(resolved);
	if (amPmVariant !== resolved && (await pathExists(amPmVariant))) {
		return amPmVariant;
	}

	// Try NFD variant (macOS stores filenames in NFD form)
	const nfdVariant = tryNFDVariant(resolved);
	if (nfdVariant !== resolved && (await pathExists(nfdVariant))) {
		return nfdVariant;
	}

	// Try curly quote variant (macOS uses U+2019 in screenshot names)
	const curlyVariant = tryCurlyQuoteVariant(resolved);
	if (curlyVariant !== resolved && (await pathExists(curlyVariant))) {
		return curlyVariant;
	}

	// Try combined NFD + curly quote (for French macOS screenshots like "Capture d'écran")
	const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
	if (nfdCurlyVariant !== resolved && (await pathExists(nfdCurlyVariant))) {
		return nfdCurlyVariant;
	}

	return resolved;
}

/**
 * Unicode code points involved in the filename normalization variants:
 * - NFD/NFC normalization applies to the whole name.
 * - Narrow no-break space (U+202F) and no-break space (U+00A0) vs regular space.
 * - Straight apostrophe (U+0027), right curly quote (U+2019), left curly quote
 *   (U+2018) and backtick (U+0060) are treated as interchangeable for macOS
 *   screenshot names ("Capture d'écran").
 */
const NBSP = "\u00A0";
const NARROW_NBSP = "\u202F";
const RIGHT_QUOTE = "\u2019";
const LEFT_QUOTE = "\u2018";
const STRAIGHT_QUOTE = "'";
const BACKTICK = "`";

const SPACE_CHARS = [" ", NBSP, NARROW_NBSP];
const QUOTE_CHARS = [STRAIGHT_QUOTE, RIGHT_QUOTE, LEFT_QUOTE, BACKTICK];

export function normalizeFilenameCandidates(fileName: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const push = (s: string) => {
		if (s && !seen.has(s)) {
			seen.add(s);
			out.push(s);
		}
	};

	if (!fileName) return [fileName];

	// Original spelling is always the first candidate.
	push(fileName);

	const chars = Array.from(fileName); // iterate by code point

	// Space-char mutations: for each occurrence of a space char, try swapping
	// just that one position to each other space char. This matches macOS
	// screenshot names that mix regular spaces with a single U+202F before
	// AM/PM (all-replace would flip every space and never match).
	for (let i = 0; i < chars.length; i++) {
		const c = chars[i];
		if (!SPACE_CHARS.includes(c)) continue;
		for (const to of SPACE_CHARS) {
			if (to === c) continue;
			const copy = [...chars];
			copy[i] = to;
			push(copy.join(""));
		}
	}

	// Quote-char mutations: per occurrence.
	for (let i = 0; i < chars.length; i++) {
		const c = chars[i];
		if (!QUOTE_CHARS.includes(c)) continue;
		for (const to of QUOTE_CHARS) {
			if (to === c) continue;
			const copy = [...chars];
			copy[i] = to;
			push(copy.join(""));
		}
	}

	// Whole-name normalization (NFD and NFC).
	const nfd = fileName.normalize("NFD");
	if (nfd !== fileName) push(nfd);
	const nfc = fileName.normalize("NFC");
	if (nfc !== fileName && nfc !== nfd) push(nfc);

	// Combined: apply the common straight->curly quote swap once on the
	// normalized bases (covers macOS "Capture d'écran" where the file is NFD
	// with a curly apostrophe).
	for (const base of [nfd, nfc]) {
		if (base === fileName) continue;
		const idx = base.indexOf(STRAIGHT_QUOTE);
		if (idx >= 0) {
			const bb = Array.from(base);
			bb[idx] = RIGHT_QUOTE;
			push(bb.join(""));
		}
	}

	// Keep output bounded (~10).
	return out.slice(0, 10);
}

/**
 * Resolve a raw path (relative to cwd). On the primary resolution failing,
 * retry each candidate spelling of the FILENAME ONLY (keeping the directory
 * part), re-checking the workspace boundary for every candidate through the
 * provided `resolve` callback (which already enforces the boundary).
 *
 * Returns the first successful resolution; throws the ORIGINAL error otherwise.
 */
export async function resolveWithFilenameNormalization(
	_cwd: string,
	rawPath: string,
	resolve: (p: string) => Promise<string>,
): Promise<string> {
	let primaryError: unknown;
	try {
		return await resolve(rawPath);
	} catch (e) {
		primaryError = e;
	}

	const err = primaryError as NodeJS.ErrnoException;
	if (err?.code !== "ENOENT") {
		throw primaryError;
	}

	// Split into directory + filename.
	const dir = dirname(rawPath);
	const base = basename(rawPath);

	for (const candidate of normalizeFilenameCandidates(base)) {
		if (candidate === base) continue;
		const candidatePath = join(dir, candidate);
		try {
			return await resolve(candidatePath);
		} catch {
			// Keep trying.
		}
	}

	throw primaryError;
}

/**
 * A small, bounded Levenshtein distance. maxLength guard keeps allocation
 * bounded (strings longer than maxLength return the max distance immediately).
 */
function levenshtein(a: string, b: string, maxDistance: number): number {
	if (a.length + b.length > 64) return Math.max(a.length, b.length); // cheap guard
	if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
	if (a === b) return 0;

	let prev = new Array<number>(b.length + 1);
	let curr = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}
	return prev[b.length];
}

/**
 * Suggest the closest directory entry to `fileName`. Substring match wins
 * first; otherwise the entry within `maxDistance` (default 2) by
 * Levenshtein edit distance. Returns undefined if no candidate is close enough.
 */
export function didYouMean(fileName: string, dirEntries: string[], maxDistance = 2): string | undefined {
	if (!fileName) return undefined;

	// Substring match first (exact substring anywhere in the name).
	const lower = fileName.toLowerCase();
	for (const entry of dirEntries) {
		if (entry.includes(fileName) || entry.toLowerCase().includes(lower)) {
			return entry;
		}
	}

	let best: string | undefined;
	let bestDist = maxDistance;
	for (const entry of dirEntries) {
		const dist = levenshtein(fileName, entry, maxDistance);
		if (dist <= bestDist) {
			bestDist = dist;
			best = entry;
		}
	}
	return best;
}

/**
 * Device/special paths that must never be opened (e.g. /dev/zero never reaches
 * EOF and would hang a read forever). Refuse by exact name or by pattern.
 * This is the canonical copy — callers should import from here.
 */
const BLOCKED_DEVICE_PATHS = new Set([
	"/dev/zero",
	"/dev/urandom",
	"/dev/random",
	"/dev/stdin",
	"/dev/stdout",
	"/dev/stderr",
	"/dev/full",
]);

export function isBlockedDevicePath(absolutePath: string): boolean {
	if (BLOCKED_DEVICE_PATHS.has(absolutePath)) return true;
	// /proc/<pid>/fd/* are live file-descriptor links — refuse by pattern.
	if (/^\/proc\/\d+\/fd(\/|$)/.test(absolutePath)) return true;
	return false;
}
