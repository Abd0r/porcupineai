---
name: reddit-search
description: Read a subreddit's pulse via the public RSS feed (no key), extract real-world reports vs hype, and fall back to web_search site:reddit.com when Reddit rate-limits.
stack: web
---

# Reddit Search

Read community signal: what people actually report, not what the demos claim.

## When to Use

- Real-world evidence: "has anyone run X?", "what do people report about Y?".
- Community consensus or sentiment around a model, tool, paper, or hardware.
- The user names a subreddit or asks "what does r/X think?".

## Procedure

1. **Call the tool if installed**: the `reddit-search` user tool (see `packages/coding-agent/scripts/reddit-search.mjs`). Otherwise the RSS one-liner: `curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36" "https://www.reddit.com/r/SUB/.rss?limit=8"` and parse the Atom entries (title, link, author, updated, summary). Pace requests (~1 per 10s) — Reddit rate-limits hard.
2. **Search fallback ladder** (in order):
   - If a query is needed, try the subreddit search RSS (`/r/SUB/search.rss?q=...&restrict_sr=1&sort=top&t=month`) — often 429.
   - When rate-limited: run `web_search` with `site:reddit.com/r/SUB TERMS`, pick real post URLs, and `web_extract` the top 1-2 threads. If extraction fails on Reddit's shell, summarize from the search snippets + feed summary only, and say what you could not read.
3. **Extract signal**: separate FACT (numbers, configs, measured results) from OPINION. Note scores/recency when available.
4. **Answer the user**: 2-5 posts max — title, subreddit, date, the factual takeaway, and the link. State clearly when you only have the feed summary, not the full thread.

## Pitfalls

- Reddit's anonymous JSON API is dead (403 since May 2026) — the RSS is the reliable no-key path; search is rate-limited. Do not retry the tool endlessly; use the fallback ladder.
- A high-score post is not necessarily true — it is consensus. Keep measured claims distinct from vibes.
- Do not invent comment content you did not read. Say "feed summary only" when that is all you have.
- Respect rate limits: one tool call, then the fallback; never hammer Reddit.
