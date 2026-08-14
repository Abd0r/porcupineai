---
name: hf-hub
description: >
  Operate the Hugging Face Hub with the `hf` CLI: auth, browse/search
  models, datasets, spaces and papers, download and upload files, query
  datasets, run training jobs, and deploy inference endpoints. Use when the
  user mentions hf, huggingface, or wants to use, search, or publish models,
  datasets, or demos on the Hub.
stack: ml
---

# Hugging Face Hub (hf CLI)

The `hf` CLI is the universal entry point for the Hub: models, datasets,
spaces, buckets, papers, jobs, and endpoints. It replaced the deprecated
`huggingface-cli`.

## Install + auth

```bash
curl -LsSf https://hf.co/cli/install.sh | bash -s
hf auth whoami          # who am I logged in as
hf auth login           # browser OAuth or token from hf.co/settings/tokens
```

## The rule: query help, don't memorize flags

The `hf` CLI changes between releases. For exact flags, always ask the CLI
first instead of guessing:

```bash
hf --help          # top-level commands
hf models --help   # flags for one subcommand
hf datasets --help
hf spaces --help
hf jobs --help
```

## Common workflows

- **Search/browse**: `hf models list --search "<query>"`, `hf datasets list --search "<query>"`, `hf spaces search "<query>"`, `hf papers search "<query>"`.
- **Download**: `hf download <repo_id>` (models/datasets/spaces).
- **Upload**: `hf upload <repo_id> <local_path> --commit-message "..."` (single-commit uploads).
- **Datasets**: `hf datasets info <id>`, `hf datasets parquet <id>`, `hf datasets sql "<duckdb query>"`.
- **Papers**: `hf papers search "<query>"`, `hf papers <arxiv-id>`.
- **Jobs (cloud GPU training/inference)**: `hf jobs run <image> <command> --flavor <t4-medium|l4x1|a100-large|...>`, `hf jobs logs <job-id>`, `hf jobs hardware`.
- **Inference endpoints**: `hf endpoints deploy`, `hf endpoints list`.
- **Cache**: `hf cache list`, `hf cache prune`.

## When to use

The user mentions hf / huggingface / a model or dataset repo id, or wants to
download a model, push a checkpoint, run a training job, or inspect a dataset.

## Pitfalls

- Don't memorize the flag list; run `hf <sub> --help` at execution time.
- Auth is now `hf auth ...`, not the old `huggingface-cli login`.
- Gated/private repos need `hf auth login` first, then use `--token` or a
  logged-in session.

---
*Adapted from huggingface/skills (Apache-2.0).*
