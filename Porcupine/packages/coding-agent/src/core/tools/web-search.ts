/**
 * Free-tier web search tool for Porcupine.
 *
 * Primary Tool Search cascade (first non-empty success wins):
 *  1. SearXNG   — SEARXNG_URL / PORCUPINE_SEARXNG_URL or http://127.0.0.1:8888
 *  2. Websurfx  — WEBSURFX_URL / PORCUPINE_WEBSURFX_URL (skipped if unset)
 *  3. DDGS      — DDGS_URL / PORCUPINE_DDGS_URL (deedy5/ddgs API, skipped if unset)
 *  4. Brave     — BRAVE_API_KEY / BRAVE_SEARCH_API_KEY (skipped if unset)
 *  5. DuckDuckGo Instant Answer + lite HTML (no key)
 *  6. Wikipedia OpenSearch (no key)
 *  7. Mojeek HTML (no key)
 *
 * Override order: PORCUPINE_WEB_SEARCH_ORDER=searxng,websurfx,ddgs,brave,duckduckgo,wikipedia,mojeek
 * No paid-only backends. Never invents results.
 */

import type { AgentTool } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	limit: Type.Optional(Type.Number({ description: "Max results (default 8, max 15)" })),
	backend: Type.Optional(
		Type.String({
			description:
				"Optional backend force: searxng | websurfx | ddgs | brave | duckduckgo | wikipedia | mojeek | auto (default cascade)",
		}),
	),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

export interface WebSearchHit {
	title: string;
	url: string;
	snippet: string;
	backend: string;
}

export interface WebSearchToolDetails {
	backend: string;
	tried: string[];
	skipped: string[];
	count: number;
}

export type BackendName = "searxng" | "websurfx" | "ddgs" | "brave" | "duckduckgo" | "wikipedia" | "mojeek";

/** Default cascade — local/optional hops first, then keyed Brave, then free public fallbacks. */
export const DEFAULT_WEB_SEARCH_ORDER: readonly BackendName[] = [
	"searxng",
	"websurfx",
	"ddgs",
	"brave",
	"duckduckgo",
	"wikipedia",
	"mojeek",
] as const;

function clampLimit(limit: number | undefined): number {
	const n = limit ?? 8;
	if (!Number.isFinite(n)) return 8;
	return Math.max(1, Math.min(15, Math.floor(n)));
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
	return decodeEntities(
		s
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

async function fetchText(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			...init,
			signal: controller.signal,
			headers: {
				"User-Agent": "Porcupine/0.83 (+free-web-search; cascade SearXNG>Websurfx>DDGS>Brave>DDG)",
				Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
				...(init?.headers ?? {}),
			},
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.text();
	} finally {
		clearTimeout(timer);
	}
}

function resolveSearxngBase(): string {
	return (
		process.env.SEARXNG_URL?.replace(/\/$/, "") ||
		process.env.PORCUPINE_SEARXNG_URL?.replace(/\/$/, "") ||
		"http://127.0.0.1:8888"
	);
}

function hasBraveKey(): boolean {
	return Boolean(process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY);
}

function resolveWebsurfxBase(): string | undefined {
	const raw = process.env.WEBSURFX_URL || process.env.PORCUPINE_WEBSURFX_URL;
	const base = raw?.replace(/\/$/, "").trim();
	return base || undefined;
}

function resolveDdgsBase(): string | undefined {
	const raw = process.env.DDGS_URL || process.env.PORCUPINE_DDGS_URL;
	const base = raw?.replace(/\/$/, "").trim();
	return base || undefined;
}

/**
 * Parse PORCUPINE_WEB_SEARCH_ORDER / WEB_SEARCH_ORDER into a validated cascade.
 * Unknown names are dropped. Empty → default order.
 */
export function resolveWebSearchOrder(override?: string): BackendName[] {
	const raw = (override ?? process.env.PORCUPINE_WEB_SEARCH_ORDER ?? process.env.WEB_SEARCH_ORDER ?? "")
		.trim()
		.toLowerCase();
	if (!raw) return [...DEFAULT_WEB_SEARCH_ORDER];
	const names = raw
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean) as BackendName[];
	const valid = names.filter((n): n is BackendName => (DEFAULT_WEB_SEARCH_ORDER as readonly string[]).includes(n));
	return valid.length > 0 ? valid : [...DEFAULT_WEB_SEARCH_ORDER];
}

async function searchSearxng(query: string, limit: number): Promise<WebSearchHit[]> {
	const base = resolveSearxngBase();
	const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
	const body = await fetchText(url, undefined, 6_000);
	const data = JSON.parse(body) as { results?: Array<{ title?: string; url?: string; content?: string }> };
	return (data.results ?? [])
		.filter((r) => r.url && r.title)
		.slice(0, limit)
		.map((r) => ({
			title: r.title || r.url || "",
			url: r.url || "",
			snippet: (r.content || "").slice(0, 400),
			backend: "searxng",
		}));
}

async function searchWebsurfx(query: string, limit: number): Promise<WebSearchHit[]> {
	const base = resolveWebsurfxBase();
	if (!base) throw new Error("no WEBSURFX_URL");
	// Websurfx JSON is NOT SearXNG-shaped (issue neon-mmd/websurfx#797 closed).
	// Contract: GET /search?q=&json=true → { results: [{ title, url, description }] }
	const url = `${base}/search?q=${encodeURIComponent(query)}&json=true`;
	const body = await fetchText(url, undefined, 6_000);
	const data = JSON.parse(body) as {
		results?: Array<{ title?: string; url?: string; description?: string; content?: string }>;
	};
	return (data.results ?? [])
		.filter((r) => r.url && r.title)
		.slice(0, limit)
		.map((r) => ({
			title: r.title || r.url || "",
			url: r.url || "",
			snippet: (r.description || r.content || "").slice(0, 400),
			backend: "websurfx",
		}));
}

async function searchDdgs(query: string, limit: number): Promise<WebSearchHit[]> {
	const base = resolveDdgsBase();
	if (!base) throw new Error("no DDGS_URL");
	// deedy5/ddgs FastAPI: GET /search/text?query=&max_results=
	// results are { title, href, body } (Python text() dicts wrapped in { results }).
	const url = `${base}/search/text?query=${encodeURIComponent(query)}&max_results=${limit}`;
	const body = await fetchText(url, undefined, 8_000);
	const data = JSON.parse(body) as {
		results?: Array<{ title?: string; href?: string; url?: string; body?: string; content?: string }>;
	};
	const rows = Array.isArray(data) ? data : (data.results ?? []);
	return rows
		.filter((r) => (r.href || r.url) && r.title)
		.slice(0, limit)
		.map((r) => ({
			title: r.title || r.href || r.url || "",
			url: r.href || r.url || "",
			snippet: (r.body || r.content || "").slice(0, 400),
			backend: "ddgs",
		}));
}

async function searchBrave(query: string, limit: number): Promise<WebSearchHit[]> {
	const key = process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
	if (!key) throw new Error("no Brave API key");
	const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
	const body = await fetchText(
		url,
		{
			headers: {
				Accept: "application/json",
				"X-Subscription-Token": key,
			},
		},
		10_000,
	);
	const data = JSON.parse(body) as {
		web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
	};
	return (data.web?.results ?? [])
		.filter((r) => r.url && r.title)
		.slice(0, limit)
		.map((r) => ({
			title: r.title || "",
			url: r.url || "",
			snippet: (r.description || "").slice(0, 400),
			backend: "brave",
		}));
}

async function searchDuckDuckGo(query: string, limit: number): Promise<WebSearchHit[]> {
	const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
	const iaBody = await fetchText(iaUrl, undefined, 10_000);
	const ia = JSON.parse(iaBody) as {
		Heading?: string;
		AbstractURL?: string;
		AbstractText?: string;
		RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
	};

	const hits: WebSearchHit[] = [];
	if (ia.AbstractURL && (ia.Heading || ia.AbstractText)) {
		hits.push({
			title: ia.Heading || ia.AbstractURL,
			url: ia.AbstractURL,
			snippet: (ia.AbstractText || "").slice(0, 400),
			backend: "duckduckgo",
		});
	}

	const flatten = (
		topics:
			| Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>
			| undefined,
	) => {
		for (const t of topics ?? []) {
			if (t.FirstURL && t.Text) {
				hits.push({
					title: t.Text.split(" - ")[0] || t.Text,
					url: t.FirstURL,
					snippet: t.Text.slice(0, 400),
					backend: "duckduckgo",
				});
			}
			if (t.Topics) flatten(t.Topics);
		}
	};
	flatten(ia.RelatedTopics);

	if (hits.length >= Math.min(3, limit)) {
		return hits.slice(0, limit);
	}

	const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
	const html = await fetchText(liteUrl, undefined, 12_000);
	const linkRe = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	let m: RegExpExecArray | null;
	while (hits.length < limit) {
		m = linkRe.exec(html);
		if (m === null) break;
		const url = m[1];
		const title = stripTags(m[2] || "");
		if (!url || !title || url.startsWith("/") || url.includes("duckduckgo.com")) continue;
		if (hits.some((h) => h.url === url)) continue;
		hits.push({ title, url, snippet: "", backend: "duckduckgo" });
	}
	if (hits.length === 0) throw new Error("duckduckgo empty");
	return hits.slice(0, limit);
}

async function searchWikipedia(query: string, limit: number): Promise<WebSearchHit[]> {
	const url =
		`https://en.wikipedia.org/w/api.php?action=opensearch&origin=*&format=json&limit=${limit}` +
		`&search=${encodeURIComponent(query)}`;
	const body = await fetchText(url, undefined, 10_000);
	const data = JSON.parse(body) as [string, string[], string[], string[]];
	const titles = data[1] ?? [];
	const snippets = data[2] ?? [];
	const urls = data[3] ?? [];
	const hits: WebSearchHit[] = [];
	for (let i = 0; i < titles.length && hits.length < limit; i++) {
		hits.push({
			title: titles[i] || urls[i] || "",
			url: urls[i] || "",
			snippet: snippets[i] || "",
			backend: "wikipedia",
		});
	}
	if (hits.length === 0) throw new Error("wikipedia empty");
	return hits;
}

async function searchMojeek(query: string, limit: number): Promise<WebSearchHit[]> {
	const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
	const html = await fetchText(url, undefined, 12_000);
	const hits: WebSearchHit[] = [];
	const re = /<a[^>]+class="[^"]*title[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	let m: RegExpExecArray | null;
	while (hits.length < limit) {
		m = re.exec(html);
		if (m === null) break;
		const href = m[1];
		const title = stripTags(m[2] || "");
		if (!href || !title) continue;
		hits.push({ title, url: href, snippet: "", backend: "mojeek" });
	}
	if (hits.length === 0) throw new Error("mojeek empty");
	return hits;
}

const BACKEND_FNS: Record<BackendName, (q: string, n: number) => Promise<WebSearchHit[]>> = {
	searxng: searchSearxng,
	websurfx: searchWebsurfx,
	ddgs: searchDdgs,
	brave: searchBrave,
	duckduckgo: searchDuckDuckGo,
	wikipedia: searchWikipedia,
	mojeek: searchMojeek,
};

function shouldSkipBackend(name: BackendName): string | undefined {
	if (name === "websurfx" && !resolveWebsurfxBase()) return "no WEBSURFX_URL";
	if (name === "ddgs" && !resolveDdgsBase()) return "no DDGS_URL";
	if (name === "brave" && !hasBraveKey()) return "no BRAVE_API_KEY";
	return undefined;
}

export async function runFreeWebSearch(
	query: string,
	limit = 8,
	backend: string = "auto",
): Promise<{ hits: WebSearchHit[]; backend: string; tried: string[]; skipped: string[] }> {
	const n = clampLimit(limit);
	const q = query.trim();
	if (!q) throw new Error("query is required");

	const forced = (backend || "auto").toLowerCase();
	const order: BackendName[] =
		forced !== "auto" && (DEFAULT_WEB_SEARCH_ORDER as readonly string[]).includes(forced)
			? [forced as BackendName]
			: resolveWebSearchOrder();

	const tried: string[] = [];
	const skipped: string[] = [];
	const errors: string[] = [];

	for (const name of order) {
		const skipReason = forced === "auto" ? shouldSkipBackend(name) : undefined;
		if (skipReason) {
			skipped.push(`${name}(${skipReason})`);
			continue;
		}
		tried.push(name);
		try {
			const hits = await BACKEND_FNS[name](q, n);
			if (hits.length > 0) {
				return { hits, backend: name, tried, skipped };
			}
			errors.push(`${name}: empty`);
		} catch (err) {
			errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	const skipNote = skipped.length ? ` Skipped: ${skipped.join(", ")}.` : "";
	throw new Error(`All free search backends failed.${skipNote} Tried: ${errors.join(" | ")}`);
}

function formatHits(hits: WebSearchHit[], backend: string, tried: string[], skipped: string[]): string {
	const lines = [
		`web_search via ${backend} (${hits.length} hits)`,
		`cascade tried: ${tried.join(" → ") || "(none)"}${skipped.length ? ` | skipped: ${skipped.join(", ")}` : ""}`,
		"",
	];
	for (const [i, hit] of hits.entries()) {
		lines.push(`${i + 1}. ${hit.title}`);
		lines.push(`   ${hit.url}`);
		if (hit.snippet) lines.push(`   ${hit.snippet}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

export function createWebSearchToolDefinition(): ToolDefinition<
	typeof webSearchSchema,
	WebSearchToolDetails | undefined
> {
	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the public web via free cascade: SearXNG → Websurfx (if WEBSURFX_URL) → DDGS (if DDGS_URL) → Brave (if BRAVE_API_KEY) → DuckDuckGo Instant Answer → Wikipedia → Mojeek. First success wins. Prefer this over inventing facts. Returns titles, URLs, snippets.",
		promptSnippet: "Free web search cascade (SearXNG → Websurfx → DDGS → Brave → DDG → Wikipedia → Mojeek)",
		promptGuidelines: [
			"Use web_search when you need current or external information — this is the primary internet tool.",
			"Cascade order is automatic; do not pick a backend unless the user asks or one is broken.",
			"Do not call web_search for pure coding tasks that only need local files.",
			"Do not invent search results — call the tool.",
			"After search, use web_extract on concrete URLs when you need full page text.",
		],
		parameters: webSearchSchema,
		async execute(_toolCallId, { query, limit, backend }) {
			const result = await runFreeWebSearch(query, limit, backend ?? "auto");
			return {
				content: [
					{
						type: "text",
						text: formatHits(result.hits, result.backend, result.tried, result.skipped),
					},
				],
				details: {
					backend: result.backend,
					tried: result.tried,
					skipped: result.skipped,
					count: result.hits.length,
				},
			};
		},
		renderCall(args) {
			const q = String(args?.query ?? "...");
			return new Text(`${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("toolOutput", q)}`, 0, 0);
		},
		renderResult(result, options) {
			const text = (result.content ?? [])
				.map((c) => (c.type === "text" ? c.text : ""))
				.join("")
				.trim();
			const preview = options.expanded ? text : text.split("\n").slice(0, 10).join("\n");
			return new Text(`\n${theme.fg("toolOutput", preview || "(no results)")}`, 0, 0);
		},
	};
}

export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
	return wrapToolDefinition(createWebSearchToolDefinition());
}
