# Porcupine — Aider Polyglot Benchmark

**Score: 194/225 = 86.2%** (DeepSeek V4 Flash through the Porcupine harness)

| | DSV4F (published) | **Porcupine harness** |
|---|---|---|
| Aider Polyglot (225 exercises) | 71.6% (latest release) · 74.1% (preview) | **86.2% (194/225)** |

**Same model, same benchmark, different harness. +14.6 points over the latest published DSV4F score.**

## Per-language breakdown

| Language | Exercises | Passed | Rate |
|---|---|---|---|
| python | 34 | 29 | 85.3% |
| javascript | 49 | 36 | 73.5% |
| cpp | 26 | 24 | 92.3% |
| go | 39 | 33 | 84.6% |
| java | 47 | 45 | 95.7% |
| rust | 30 | 27 | 90.0% |
| **Total** | **225** | **194** | **86.2%** |

## Reference scores cited (⚠️ NOT VERIFIED)

The published DSV4F polyglot baselines below are **third-party compilations,
not officially published by DeepSeek**. DeepSeek's official DeepSeek-V4-Flash-0731
model card does NOT include an Aider Polyglot row. The official Aider leaderboard
(aider.chat/docs/leaderboards/) is the gold standard, but no DSV4F polyglot entry
was reachable at the time of writing. Treat both baselines as unverified.

- **71.6% (latest release) — NOT VERIFIED** — DeepSeek V4-Flash (July 31, 2026
  release), per BridgingNews release coverage, "DeepSeek released V4-Flash on
  July 31" (2026-07-31). News-aggregation post: no run details or methodology.
- **74.1% (April 2026 preview) — NOT VERIFIED** — from DeepSeek V4 technical
  report (Apr 2026) + Aider public benchmarks, as compiled by
  [Local AI Master](https://localaimaster.com/models/deepseek-v4) (2026-05-09).
  Third-party compilation; primary sources named but the run is not reproducible.
- Benchmark definition: Aider's polyglot benchmark — 225 Exercism coding exercises
  across C++, Go, Java, JavaScript, Python, Rust
  ([Aider docs](https://aider.chat/docs/leaderboards/))

## What we did

- **Harness:** Porcupine (this repo) as the coding agent — same model
  (DeepSeek V4 Flash via the opencode-go provider), same 225-exercise set, same
  test suites.
- **Method:** each exercise runs in a fresh workdir with only the stub files
  (tests stripped; the agent cannot see them). Porcupine runs headless with the
  exercise instructions, edits the source, then the official language test suite
  is restored and executed (pytest, jest, cmake/make, go test, gradle, cargo).
  Pass = all tests green.
- **Setup:** 24-core Ubuntu box, Porcupine `--headless` mode, DSV4F via
  opencode-go API, exercises executed serially per language (2 workers each).
- **Cost:** sub-$0.02 per exercise on average; the full 225-exercise run cost
  roughly $2-4 in API usage.

## Raw data

- `results/` — per-exercise JSONL records for all 6 languages
  (pass/fail, duration, headless output tail, token usage, test output)
- `logs/` — the run logs per language (agent output stream)
- Full reproduction scaffolding (driver, adapter, ops lessons):
  `benchmark-rig/` (canonical copy on the rig machine)

## Honest caveats

- **Our score is fully reproducible** (raw logs in this folder, driver in
  benchmark-rig/); the reference baselines are NOT verified (see above).
- The published DSV4F numbers were produced with DeepSeek's own (unreleased)
  harness or Aider; the reference numbers above are third-party compilations.
- Scores measure this exact model + harness combination; they are not a claim
  that Porcupine outperforms any specific commercial agent product.
- The reference scores may use different DSV4F checkpoints (April preview vs
  July 31 release); we compare against both published numbers.
