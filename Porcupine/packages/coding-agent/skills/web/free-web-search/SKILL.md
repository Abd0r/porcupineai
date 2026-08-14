---
name: free-web-search
description: Free internet search via SearXNG→Websurfx→DDGS→Brave→DDG cascade.
stack: web
---

# Free Web Search Skill

Primary internet path for Porcupine. Built-in tools, free backends only.

## Tools

- `web_search` — cascade search (first success wins)
- `web_extract` — fetch a URL to cleaned text

## Cascade order (`web_search`, backend=auto)

1. **SearXNG** — `SEARXNG_URL` or `PORCUPINE_SEARXNG_URL` (default `http://127.0.0.1:8888`)
2. **Websurfx** — only if `WEBSURFX_URL` or `PORCUPINE_WEBSURFX_URL` is set
3. **DDGS** — only if `DDGS_URL` or `PORCUPINE_DDGS_URL` is set (deedy5/ddgs `/search/text`)
4. **Brave** — only if `BRAVE_API_KEY` set
5. **DuckDuckGo** — Instant Answer + lite HTML (no key)
6. **Wikipedia** — OpenSearch
7. **Mojeek** — HTML results

## When to use

- Current events, docs not in repo, versions, error messages online
- Not for pure local coding / chit-chat

## Procedure

1. `web_search` with a tight query
2. Pick 1–3 URLs
3. `web_extract` those URLs
4. Cite sources when stating facts
