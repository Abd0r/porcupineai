---
name: hf-papers
description: >
  Read, search, and publish Hugging Face papers. Fetch a paper page as
  markdown, query the papers API for structured metadata (authors, linked
  models/datasets/spaces, GitHub repo), and submit or claim papers on the
  Daily Papers feed. Use for HF paper URLs, arXiv IDs, or analyzing a paper
  via hf.co/papers.
stack: sci
---

# Hugging Face Papers

hf.co/papers is a paper platform built on arXiv. Papers can be read as
markdown, queried for structured metadata, and submitted to the Daily Papers
feed for upvotes and visibility.

## Parse the paper ID

Whatever the user gives, reduce it to the arXiv ID:

| Input | Paper ID |
|---|---|
| `https://huggingface.co/papers/2602.08025` | `2602.08025` |
| `https://arxiv.org/abs/2602.08025` | `2602.08025` |
| `2602.08025v1` | `2602.08025v1` |

## Read a paper as markdown

```bash
curl -s "https://huggingface.co/papers/{PAPER_ID}.md"
# or
curl -s -H "Accept: text/markdown" "https://huggingface.co/papers/{PAPER_ID}"
```

- Renders from the arXiv HTML version; falls back to the HF page HTML if no
  HTML version exists.
- A 404 means the paper is not yet indexed on hf.co/papers (use arXiv directly).

## Structured metadata (papers API)

```bash
curl -s "https://huggingface.co/api/papers/{PAPER_ID}"
```

Returns authors, linked models/datasets/spaces, GitHub repo, project page, and
the HF org. Use it when you need structured facts (not prose).

## Publish / claim

- Submit a paper: `https://huggingface.co/papers/submit` (only within 14 days
  of its arXiv publication).
- Claim authorship: click your name in the `authors` field on the paper page.
  This shows the paper on your HF profile.
- Link assets: mention the HF paper or arXiv URL in a model card, dataset card,
  or Space README to auto-index the paper and surface the linkage.

## When to use

HF paper URL, arXiv URL/ID, or a request to summarize/analyze a research paper
when you want the HF-side metadata, links, or publishing.

## Pitfalls

- If the user just needs a search + evidence-graded review, use `sci/arxiv-search`
  + `sci/literature-review` instead — this skill is for the HF platform layer.
- Papers are only submittable to Daily Papers within 14 days of arXiv posting.

---
*Adapted from huggingface/skills (Apache-2.0).*
