#!/usr/bin/env node
// reddit-search: Reddit feeds via the public RSS (no key — the only anonymous
// path that still works after Reddit blocked .json in May 2026). Search falls
// back gracefully (search.rss is rate-limited).
// Usage: reddit-search.mjs --subreddit NAME [--limit 8] [--query Q]
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
};
const subreddit = get("--subreddit");
const query = get("--query");
const limit = Math.min(Number(get("--limit") ?? 8) || 8, 25);
if (!subreddit) {
  console.error("usage: reddit-search.mjs --subreddit NAME [--limit N] [--query Q]");
  process.exit(1);
}
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
async function fetchText(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Reddit ${res.status}`);
    return res.text();
  }
  throw new Error("Reddit rate-limited (429) after retries");
}
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();
async function parseFeed(url) {
  const xml = await fetchText(url);
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, limit);
  return entries.map(([, body]) => ({
    title: strip((body.match(/<title>([\s\S]*?)<\/title>/) ?? ["", "?"])[1]),
    url: (body.match(/<link href="([^"]+)"/) ?? ["", ""])[1],
    author: strip((body.match(/<author>[\s\S]*?<name>([^<]+)/) ?? ["", ""])[1]),
    updated: (body.match(/<updated>([^<]+)/) ?? ["", ""])[1]?.slice(0, 10),
    summary: strip((body.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) ?? ["", ""])[1]).slice(0, 400) || undefined,
  }));
}
const base = `https://www.reddit.com/r/${subreddit}`;
if (query) {
  try {
    const results = await parseFeed(`${base}/search.rss?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=month&limit=${limit}`);
    console.log(JSON.stringify({ query, subreddit, via: "search.rss", count: results.length, results }, null, 1));
  } catch (error) {
    // Anonymous search is rate-limited (429) — degrade with the named recovery.
    console.log(JSON.stringify({
      query, subreddit, via: "search.rss",
      note: `Reddit anonymous search is rate-limited (${error instanceof Error ? error.message : String(error)}). Use the latest ${subreddit} feed below, or web_search "site:reddit.com/r/${subreddit} ${query}".`,
      results: [],
    }, null, 1));
  }
} else {
  const results = await parseFeed(`${base}/.rss?limit=${limit}`);
  console.log(JSON.stringify({ subreddit, via: ".rss", count: results.length, results }, null, 1));
}
