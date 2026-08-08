import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { compare, valid } from "semver";
import { getPackageDir } from "../config.ts";
import { getProductEnvironment } from "../product-environment.ts";
import { getPorcupineUserAgent } from "./porcupine-user-agent.ts";

const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_GITHUB_REPO = "Abd0r/porcupineai";

export interface LatestPorcupineRelease {
	version: string;
	packageName?: string;
	note?: string;
}

export type LatestProductRelease = LatestPorcupineRelease;

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

// ---------------------------------------------------------------------------
// Cache: one check per TTL (default 24h) so startup stays instant and the
// "update available" badge persists across sessions without hammering npm.
// ---------------------------------------------------------------------------

interface VersionCacheEntry {
	checkedAt: number;
	version?: string;
	packageName?: string;
	note?: string;
}

function cachePath(): string {
	// Overridable so tests (and power users) can isolate or disable the cache.
	const override = process.env.PORCUPINE_UPDATE_CACHE_PATH;
	if (override) return override;
	return join(homedir(), ".porcupine", "agent", "version-cache.json");
}

function readCache(): VersionCacheEntry | undefined {
	try {
		if (!existsSync(cachePath())) return undefined;
		return JSON.parse(readFileSync(cachePath(), "utf8")) as VersionCacheEntry;
	} catch {
		return undefined;
	}
}

function writeCache(entry: VersionCacheEntry): void {
	try {
		writeFileSync(cachePath(), JSON.stringify(entry), "utf8");
	} catch {
		// never break startup on a cache write failure
	}
}

/** Name of the currently installed package (read from the package manifest). */
export function getInstalledPackageName(): string | undefined {
	try {
		const pkg = JSON.parse(readFileSync(join(getPackageDir(), "package.json"), "utf8")) as { name?: unknown };
		return typeof pkg.name === "string" && pkg.name ? pkg.name : undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Sources: explicit product URL → npm registry (installed package) → GitHub
// ---------------------------------------------------------------------------

async function fetchLatestFromUrl(
	url: string,
	currentVersion: string,
	timeoutMs: number,
): Promise<LatestPorcupineRelease | undefined> {
	const response = await fetch(url, {
		headers: { "User-Agent": getPorcupineUserAgent(currentVersion), accept: "application/json" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) return undefined;
	const data = (await response.json()) as { packageName?: unknown; version?: unknown; note?: unknown };
	if (typeof data.version !== "string" || !data.version.trim()) return undefined;
	return {
		version: data.version.trim(),
		...(typeof data.packageName === "string" && data.packageName.trim()
			? { packageName: data.packageName.trim() }
			: {}),
		...(typeof data.note === "string" && data.note.trim() ? { note: data.note.trim() } : {}),
	};
}

async function fetchLatestFromNpm(
	packageName: string,
	currentVersion: string,
	timeoutMs: number,
): Promise<LatestPorcupineRelease | undefined> {
	const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
		headers: { "User-Agent": getPorcupineUserAgent(currentVersion), accept: "application/json" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) return undefined;
	const data = (await response.json()) as { version?: unknown };
	if (typeof data.version !== "string" || !data.version.trim()) return undefined;
	return { version: data.version.trim(), packageName };
}

async function fetchLatestFromGithub(
	repo: string,
	currentVersion: string,
	timeoutMs: number,
): Promise<LatestPorcupineRelease | undefined> {
	const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
		headers: { "User-Agent": getPorcupineUserAgent(currentVersion), accept: "application/json" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) return undefined;
	const data = (await response.json()) as { tag_name?: unknown; body?: unknown };
	if (typeof data.tag_name !== "string") return undefined;
	const version = data.tag_name.replace(/^v/i, "").trim();
	if (!version) return undefined;
	return {
		version,
		...(typeof data.body === "string" && data.body.trim() ? { note: data.body.trim().slice(0, 500) } : {}),
	};
}

export async function getLatestPorcupineRelease(
	currentVersion: string,
	options: { timeoutMs?: number; cacheTtlMs?: number } = {},
): Promise<LatestPorcupineRelease | undefined> {
	if (getProductEnvironment("OFFLINE")) return undefined;

	const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS;

	// Serve from cache first (badge persists across sessions, no refetch).
	const cache = readCache();
	if (cache?.version && Date.now() - cache.checkedAt < cacheTtlMs) {
		return {
			version: cache.version,
			...(cache.packageName ? { packageName: cache.packageName } : {}),
			...(cache.note ? { note: cache.note } : {}),
		};
	}

	let release: LatestPorcupineRelease | undefined;
	try {
		const latestVersionUrl = getProductEnvironment("LATEST_VERSION_URL");
		if (latestVersionUrl) {
			release = await fetchLatestFromUrl(latestVersionUrl, currentVersion, timeoutMs);
		} else {
			// npm registry is canonical for installs; GitHub releases is the fallback.
			const packageName = getInstalledPackageName();
			if (packageName) {
				release = await fetchLatestFromNpm(packageName, currentVersion, timeoutMs);
			}
			if (!release) {
				const repo = getProductEnvironment("UPDATE_GITHUB_REPO") ?? DEFAULT_GITHUB_REPO;
				release = await fetchLatestFromGithub(repo, currentVersion, timeoutMs);
			}
		}
	} catch {
		// any network/parse failure is a silent "no update info"
	}

	if (release?.version) {
		writeCache({
			checkedAt: Date.now(),
			version: release.version,
			packageName: release.packageName,
			note: release.note,
		});
	}
	return release;
}

export async function checkForNewPorcupineVersion(
	currentVersion: string,
	options: { timeoutMs?: number; cacheTtlMs?: number } = {},
): Promise<LatestPorcupineRelease | undefined> {
	if (getProductEnvironment("SKIP_VERSION_CHECK")) return undefined;

	try {
		const latestRelease = await getLatestPorcupineRelease(currentVersion, options);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
