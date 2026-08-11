---
name: arxiv-search
description: Search arXiv with structured results (id, title, authors, date, categories, abstract), grade relevance, and record kept papers in the literature store.
stack: sci
---

# arXiv Search

Turn a research question into a short list of graded, stored papers.

## When to Use

- The user asks about a paper, technique, or research area ("is there work on X?", "what's the state of Y?").
- A literature review, related-work section, or verification that a claim matches published work.
- You need authors, dates, or the abstract of a specific arXiv paper.

## Procedure

1. **Call the tool if installed**: the `arxiv-search` user tool (see `packages/coding-agent/scripts/arxiv-search.mjs` to install it). Otherwise use the one-liner fallback:
   `curl -s "https://export.arxiv.org/api/query?search_query=all:QUERY&start=0&max_results=8&sortBy=relevance" | grep -o "<title>[^<]*\|<summary>[^<]*"` — or run the script directly: `node packages/coding-agent/scripts/arxiv-search.mjs --query "QUERY" [--max 8] [--sort submittedDate] [--from YYYY-MM-DD]`.
2. **Read the results**: skim titles + abstracts. Keep 1-5 that answer the question; drop the rest.
3. **Grade + record**: for each kept paper, add it to the literature store (action=add) with the arXiv url, a one-line takeaway in `notes`, `status: to-read` (or `reviewed` if you read the abstract carefully), and a grade: A peer-reviewed/replicated, B single study, C preprint, D unverified. arXiv papers default to C unless you have stronger evidence.
4. **Answer the user** with the kept papers: title, authors, date, one-line finding, and the link. Cite only what the tool actually returned — never invent a paper.

## Pitfalls

- Do not dump all results; the user wants 1-5 relevant ones.
- Relevance sort != recency. For "what's new" use submittedDate.
- An abstract is not the paper. Grading stays C (preprint) until you verify beyond the abstract.
- Do not fabricate arxivIds or URLs — copy them from the tool output.
