---
name: hf-datasets
description: >
  Explore, fetch, and create Hugging Face datasets. Use the Dataset Viewer API
  (splits, rows, search, filter, parquet, size, statistics) to inspect data
  without downloading, and create or upload datasets to the Hub. Use for
  building or inspecting training data.
stack: ml
---

# Hugging Face Datasets

Two surfaces: the **Dataset Viewer API** (read-only inspection, no download)
and the **Hub** (create/upload). The `hf datasets` CLI and `datasets` Python
library sit on top.

## Dataset Viewer API (read-only)

Base URL: `https://datasets-server.huggingface.co`. `GET`, URL-encoded params.
Gated/private datasets need `Authorization: Bearer <HF_TOKEN>`.

| Purpose | Endpoint |
|---|---|
| Validate availability | `/is-valid?dataset=<ns/repo>` |
| List configs + splits | `/splits?dataset=<ns/repo>` |
| Preview rows | `/first-rows?dataset=...&config=...&split=...` |
| Paginate rows (max 100) | `/rows?dataset=...&config=...&split=...&offset=0&length=100` |
| Full-text search | `/search?dataset=...&split=...&query=<text>` |
| Row predicates | `/filter?dataset=...&split=...&where=<pred>&orderby=<col>` |
| Parquet shard URLs | `/parquet?dataset=<ns/repo>` |
| Size totals | `/size?dataset=<ns/repo>` |
| Column statistics | `/statistics?dataset=...&config=...&split=...` |

Pagination: read `num_rows_total` / `num_rows_per_page` / `partial` from the
response to drive the next `offset`.

```bash
curl "https://datasets-server.huggingface.co/rows?dataset=stanfordnlp/imdb&config=plain_text&split=train&offset=0&length=100"
```

## CLI (faster for some tasks)

```bash
hf datasets info <id>          # metadata
hf datasets parquet <id>       # parquet URLs
hf datasets sql "<duckdb>"     # SQL over parquet
```

## Create / upload a dataset

1. Structure data as parquet/CSV/jsonl, or use the `datasets` library to build
   an Arrow dataset.
2. `hf upload <ns>/<dataset-name> <data-dir> --type dataset --commit-message "..."`.
3. Write a dataset card (`README.md`) with task, columns, license, and a
   `datasets` tag so it's discoverable.

## When to use

Inspecting a dataset without downloading it, or creating/uploading a dataset
to the Hub (e.g. NANOG1 multimodal oncology data).

## Pitfalls

- The Viewer API is read-only; it never downloads. Use `hf download` for the
  actual files.
- For data *quality* judgment (missing/duplicate/sensitive values), pair with
  `data/data-hygiene`.

---
*Adapted from huggingface/skills (Apache-2.0).*
