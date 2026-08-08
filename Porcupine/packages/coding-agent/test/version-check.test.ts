import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewPorcupineVersion,
	comparePackageVersions,
	getLatestPorcupineRelease,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";
import { allowNetwork } from "./test-network-env.ts";

const originalSkipVersionCheck = process.env.PORCUPINE_SKIP_VERSION_CHECK;
const originalLegacySkipVersionCheck = process.env.PI_SKIP_VERSION_CHECK;
const originalVersionCheckUrl = process.env.PORCUPINE_LATEST_VERSION_URL;
const originalUpdateCachePath = process.env.PORCUPINE_UPDATE_CACHE_PATH;

function clearVersionCache() {
	const cachePath =
		process.env.PORCUPINE_UPDATE_CACHE_PATH ?? join(homedir(), ".porcupine", "agent", "version-cache.json");
	try {
		rmSync(cachePath);
	} catch {
		// ignore missing cache
	}
}

beforeEach(() => {
	allowNetwork();
	process.env.PORCUPINE_LATEST_VERSION_URL = "https://releases.example.test/api/latest-version";
	// Isolate the update cache so tests never read each other's cached results.
	process.env.PORCUPINE_UPDATE_CACHE_PATH = join(
		mkdtempSync(join(tmpdir(), "porcupine-version-cache-")),
		"version-cache.json",
	);
	clearVersionCache();
	delete process.env.PORCUPINE_SKIP_VERSION_CHECK;
	delete process.env.PI_SKIP_VERSION_CHECK;
});

afterEach(() => {
	vi.unstubAllGlobals();
	clearVersionCache();
	if (originalSkipVersionCheck === undefined) {
		delete process.env.PORCUPINE_SKIP_VERSION_CHECK;
	} else {
		process.env.PORCUPINE_SKIP_VERSION_CHECK = originalSkipVersionCheck;
	}
	if (originalLegacySkipVersionCheck === undefined) {
		delete process.env.PI_SKIP_VERSION_CHECK;
	} else {
		process.env.PI_SKIP_VERSION_CHECK = originalLegacySkipVersionCheck;
	}
	if (originalVersionCheckUrl === undefined) {
		delete process.env.PORCUPINE_LATEST_VERSION_URL;
	} else {
		process.env.PORCUPINE_LATEST_VERSION_URL = originalVersionCheckUrl;
	}
	if (originalUpdateCachePath === undefined) {
		delete process.env.PORCUPINE_UPDATE_CACHE_PATH;
	} else {
		process.env.PORCUPINE_UPDATE_CACHE_PATH = originalUpdateCachePath;
	}
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("returns only newer versions", async () => {
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.3" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewPorcupineVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewPorcupineVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" });
	});

	it("uses the configured version check api with a Porcupine user agent", async () => {
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPorcupineRelease("1.2.3")).resolves.toMatchObject({ version: "1.2.4" });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://releases.example.test/api/latest-version",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^porcupine\/1\.2\.3 /),
					accept: "application/json",
				}),
			}),
		);
	});

	it("falls back to the npm registry when no version check URL is configured", async () => {
		delete process.env.PORCUPINE_LATEST_VERSION_URL;
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPorcupineRelease("1.2.3")).resolves.toMatchObject({ version: "1.2.4" });
		// Without a URL, the installed package name is looked up on the npm registry.
		expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("registry.npmjs.org"), expect.anything());
	});

	it("returns the active package metadata from the version check api", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				packageName: "@new-scope/porcupine",
				version: "1.2.4",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPorcupineRelease("1.2.3")).resolves.toEqual({
			packageName: "@new-scope/porcupine",
			version: "1.2.4",
		});
	});

	it("returns update notes from the version check api", async () => {
		const fetchMock = vi.fn(async () => Response.json({ note: " **Read this** ", version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPorcupineRelease("1.2.3")).resolves.toEqual({ note: "**Read this**", version: "1.2.4" });
	});

	it("skips automatic api calls when version checks are disabled", async () => {
		process.env.PORCUPINE_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewPorcupineVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("allows direct api calls when automatic version checks are disabled", async () => {
		process.env.PORCUPINE_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPorcupineRelease("1.2.3")).resolves.toMatchObject({ version: "1.2.4" });
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
