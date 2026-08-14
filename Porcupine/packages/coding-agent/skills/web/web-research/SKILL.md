---
name: web-research
description: Research a topic on the live web by searching first, extracting only concrete URLs, favoring primary sources, and reporting claims you can cite. Use when answering questions about current events, versions, docs, packages, or anything not in the repo.
stack: web
---

# Web Research

Free, tool-first research method for questions the codebase cannot answer. Complements `free-web-search` (that skill documents the exact cascade and backends); this skill adds the *procedure*: how to turn a vague question into an answered, citable claim without hallucinating URLs, results, or facts.

## When to Use

- Anything needing current or external facts: package versions, breaking changes, library APIs, error messages, docs, pricing, news, configuration syntax.
- Verifying a fact you already half-remember so you do not assert it from memory.
- Cross-checking numbers, dates, or behaviors across at least two independent sources.
- NOT for: pure local coding, chit-chat, or questions already answerable from the repo (grep first — the repo is a primary source too).

## Procedure

1. **Grep first.** If the answer may already live in the repo (docs, a dependency's types, README), use `grep`/`find`/`read` before spending web calls.

2. **Query, don't guess.** Run `web_search` with a tight, keyword-specific query (e.g. `vite 5 requireNode breaking change` not `would vite 5 break us?`). The tool cascades SearXNG → Websurfx → DDGS → Brave → DuckDuckGo → Wikipedia → Mojeek (first success wins, `backend=auto`). If the first query misses, rephrase using terms actually used by the target docs rather than shotgun-searching.

3. **Extract only concrete URLs.** Never invent a URL. `web_extract` on URLs the search actually returned, or URLs you can verify exist. Prefer:
   - **Primary sources**: upstream docs, the project's official README/releases/changelog on GitHub (via a real search hit), language/packaging specs, vendor docs.
   - **Secondary only when primary is unreachable**: filter results, aggregation sites, Stack Overflow.
   - A search snippet is evidence the page exists and the query matched — it is NOT evidence of the claim's content. Extract the page to read actual text.

4. **Evaluate with SIFT** (adapted): **Stop** — don't trust at face value; **Investigate** the source (who publishes it, how current); **Find trusted coverage** — corroborate with a second independent source for anything load-bearing; **Trace claims** back to the origin (a doc site quoting `Config` should match the library's actual source/types). Prefer the newest date when versions conflict.

5. **Answer from what you actually read.** Record the URL(s) you extracted. Cite them next to each factual claim. If you could not verify something, say so explicitly — mark it `unverified` rather than presenting it as established.

6. **Show your confidence.** Differentiate *verified from extracted primary source*, *corroborated by 2+ sources*, and *reasonable inference / unverified assumption*. The downstream reader (or a parent agent verifying you) must be able to reconstruct which is which.

## Pitfalls

- **Never invent URLs, citations, or results** so they "look right." A fabricated citation is worse than an honest "could not confirm."
- **Snippet ≠ proof.** A Google/SearXNG snippet is not the page content; extract to confirm wording.
- **Single-source confidence.** Asserting a version, price, or behavior from one blog post is easy to get wrong; corroborate critical facts.
- **Skimming stale docs.** Unversioned docs may describe a different major version. Check "latest"/date; prefer version-pinned docs for exact APIs.
- **Over-extracting.** Fetch only the few URLs you intend to cite; each page consumes context.
- **Treating inference as fact.** Distinguishing "the docs say X" from "I expect X" is the whole point.

## Verification

- Every factual claim in your answer has a cited URL that **you** actually extracted.
- Each unavoidable guess or unconfirmed fact is explicitly labeled `unverified`.
- Load-bearing facts are backed by a primary source or two independent sources with dates.
- You can re-derive the answer: run `web_search` again and reach the same cited pages.
