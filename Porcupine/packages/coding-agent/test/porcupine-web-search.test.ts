import { afterEach, describe, expect, it } from "vitest";
import { createWebExtractToolDefinition, createWebSearchToolDefinition } from "../src/core/tools/index.ts";
import { DEFAULT_WEB_SEARCH_ORDER, resolveWebSearchOrder, runFreeWebSearch } from "../src/core/tools/web-search.ts";
import { resolveActivityFromToolName } from "../src/porcupine/activity-status.ts";

describe("free web tools", () => {
	const prevOrder = process.env.PORCUPINE_WEB_SEARCH_ORDER;
	const prevBrave = process.env.BRAVE_API_KEY;
	const prevDdgs = process.env.PORCUPINE_DDGS_URL;

	afterEach(() => {
		if (prevOrder === undefined) delete process.env.PORCUPINE_WEB_SEARCH_ORDER;
		else process.env.PORCUPINE_WEB_SEARCH_ORDER = prevOrder;
		if (prevBrave === undefined) delete process.env.BRAVE_API_KEY;
		else process.env.BRAVE_API_KEY = prevBrave;
		if (prevDdgs === undefined) delete process.env.PORCUPINE_DDGS_URL;
		else process.env.PORCUPINE_DDGS_URL = prevDdgs;
		delete process.env.DDGS_URL;
	});

	it("registers web_search and web_extract definitions", () => {
		const search = createWebSearchToolDefinition();
		const extract = createWebExtractToolDefinition();
		expect(search.name).toBe("web_search");
		expect(extract.name).toBe("web_extract");
		expect(search.description.toLowerCase()).toContain("searxng");
		expect(search.description.toLowerCase()).toContain("brave");
		expect((search.promptSnippet ?? "").toLowerCase()).toContain("cascade");
	});

	it("default cascade is SearXNG → Websurfx → DDGS → Brave → DDG → Wikipedia → Mojeek", () => {
		expect([...DEFAULT_WEB_SEARCH_ORDER]).toEqual([
			"searxng",
			"websurfx",
			"ddgs",
			"brave",
			"duckduckgo",
			"wikipedia",
			"mojeek",
		]);
		delete process.env.PORCUPINE_WEB_SEARCH_ORDER;
		expect(resolveWebSearchOrder()).toEqual([...DEFAULT_WEB_SEARCH_ORDER]);
	});

	it("honors PORCUPINE_WEB_SEARCH_ORDER", () => {
		process.env.PORCUPINE_WEB_SEARCH_ORDER = "duckduckgo,wikipedia";
		expect(resolveWebSearchOrder()).toEqual(["duckduckgo", "wikipedia"]);
	});

	it("maps web tools to web-search activity", () => {
		expect(resolveActivityFromToolName("web_search")).toBe("web-search");
		expect(resolveActivityFromToolName("web_extract")).toBe("web-extract");
	});

	it("live cascade returns real hits (SearXNG if up, else free public backends)", async () => {
		delete process.env.BRAVE_API_KEY;
		delete process.env.BRAVE_SEARCH_API_KEY;
		process.env.PORCUPINE_WEB_SEARCH_ORDER = "searxng,websurfx,ddgs,brave,duckduckgo,wikipedia,mojeek";
		const result = await runFreeWebSearch("OpenAI", 5, "auto");
		expect(result.hits.length).toBeGreaterThan(0);
		expect(result.hits[0]!.url).toMatch(/^https?:\/\//);
		expect(["searxng", "websurfx", "ddgs", "brave", "duckduckgo", "wikipedia", "mojeek"]).toContain(result.backend);
		// Optional hops without config must skip, not fail the cascade.
		if (result.tried.includes("duckduckgo") || result.tried.includes("wikipedia")) {
			expect(result.skipped.some((s) => s.startsWith("brave"))).toBe(true);
			expect(result.tried).not.toContain("brave");
			expect(result.skipped.some((s) => s.startsWith("ddgs"))).toBe(true);
			expect(result.tried).not.toContain("ddgs");
		}
	}, 20_000);
});
