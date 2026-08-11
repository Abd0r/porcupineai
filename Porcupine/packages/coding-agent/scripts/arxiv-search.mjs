#!/usr/bin/env node
// arxiv-search: structured arXiv API search (no key needed).
// Usage: arxiv-search.mjs --query "transformer attention" [--max 8] [--sort relevance|submittedDate] [--from 2026-01-01]
const USAGE = "arxiv-search.mjs --query Q [--max N] [--sort relevance|submittedDate] [--from YYYY-MM-DD]";
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
};
const query = get("--query");
const max = Math.min(Number(get("--max") ?? 8) || 8, 25);
const sort = get("--sort") === "submittedDate" ? "submittedDate" : "relevance";
const from = get("--from");
if (!query) {
  console.error("usage: " + USAGE);
  process.exit(1);
}
const url = new URL("https://export.arxiv.org/api/query");
url.searchParams.set("search_query", `all:${query}`);
url.searchParams.set("start", "0");
url.searchParams.set("max_results", String(max));
url.searchParams.set("sortBy", sort);
url.searchParams.set("sortOrder", "descending");
const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
if (!res.ok) throw new Error(`arXiv API ${res.status}`);
const xml = await res.text();
const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, max);
if (entries.length === 0) {
  console.log(JSON.stringify({ query, results: [] }));
  process.exit(0);
}
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").trim();
const results = [];
for (const [, body] of entries) {
  const title = strip((body.match(/<title>([\s\S]*?)<\/title>/) ?? ["", "?"])[1]);
  const published = (body.match(/<published>([^<]+)/) ?? ["", ""])[1];
  const updated = (body.match(/<updated>([^<]+)/) ?? ["", ""])[1];
  const link = (body.match(/<id>([^<]+)/) ?? ["", ""])[1];
  const summary = strip((body.match(/<summary>([\s\S]*?)<\/summary>/) ?? ["", ""])[1]);
  const authors = [...body.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).slice(0, 6);
  const category = [...body.matchAll(/<category term="([^"]+)"/g)].map((m) => m[1]).slice(0, 3);
  const arxivId = link.split("/abs/")[1] ?? link;
  if (from && published.slice(0, 10) < from) continue;
  results.push({ arxivId, title, authors, published: published.slice(0, 10), categories: category, url: link, abstract: summary.length > 500 ? summary.slice(0, 500) + "..." : summary });
}
console.log(JSON.stringify({ query, sort, count: results.length, results }, null, 1));
