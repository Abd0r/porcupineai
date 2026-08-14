---
name: evals-and-models
description: Run and understand LLM evals honestly, choose a model by cost/latency/quality tradeoffs, read model cards, and budget tokens. Use when measuring a model, comparing options, or planning an eval run for an AI agent.
stack: ml
---

# Evals & Models

A score you cannot reproduce is a claim, not a result. Honest evals report *how* a number was produced — harness, dataset, prompt, seed, sample — so someone else (or your future self) can re-run it and get the same thing. The three traps that wreck ML reporting are **contamination** (training data leaked into the eval set), **cherry-picking** (reporting the best split/run), and **saturation** (a benchmark so easy every model is near 100%, so it discriminates nothing).

## When to Use

- Running or interpreting a benchmark/pass-rate for a model or agent.
- Comparing model candidates (which to buy/serve/route to).
- Choosing eval datasets or reading a model card.
- Planning token spend or context budget for an agent task.

## Procedure

1. **Fix provenance before running.** Record: harness + version, dataset + split, exact prompt, max tokens, temperature/seed, sample size. Store it next to the result (a JSON manifest or `run.*.json`). A number without its run spec is worthless for comparison.
2. **Run the reference harness first** (`web_search`/`web_extract` for the official eval repo, then reproduce the README command, e.g. `lm-eval --model ... --tasks mmlu --num_fewshot 5`). Sanity-check a small sample (e.g. 10-50 cases) before a full amortising run so a config error does not waste budget.
3. **Report pass-rate honestly.** State the numerator/denominator and the sample size, not just the percentage. If you measured only a subset, say so — never scale a small sample up to a headline. Do **not** cherry-pick the best seed or best split; report all runs or the aggregate.
4. **Check contamination & saturation.** Grep the eval dataset for examples that look like training text (exact boilerplate, memorised strings). Flag a benchmark where every candidate is near-ceiling. Both invalidate a clean headline.
5. **Read the model card deliberately:** intended use, what the training data covers, the eval numbers *and* how they were produced, known biases/limitations. Read past the marketing sentence; the limitations section is where the disqualifying detail lives. (Model-card framing per HF Model Card Guidebook, cite it in your report.)
6. **Choose a model on the tradeoff, not the leaderboard.** Cost = price/token × tokens per call; latency = practical for interactive vs. batch; quality = its score on *your* task shape. A 2× cheaper model with acc-1% worse on a task you run 50k×/day usually wins. Favor a cheaper/smaller model for bulk, a bigger one for the hard 5–10%.
7. **Budget tokens explicitly.** Count a representative call for the task, multiply by expected calls/task (agent loops re-send accumulated context each turn — recall a 10-step agent can balloon an N-token prompt into 10×N transmitted). Set a per-run cap. Prefer `grep`/`read`/`ls` over dumping whole files into context; use `subagent` with a small model and a step cap for heavy, repetitive evals so the main context stays clean.

## Pitfalls

- Reporting a percentage you cannot reproduce or with no sample size attached.
- Cherry-picking the best split/seed/run and hiding the variance.
- Benchmarking a model on a task wholly unlike the deployment (foundation model eval ≠ your agent's real behavior).
- Ignoring the model card's limitations section.
- Pushing the whole corpus through a big model when routing the easy 90% to a small one is cheaper and fully adequate.
- Trusting a leaderboard number you did not reproduce on the dataset/split that matters.

## Verification

- A run manifest exists with harness+version, dataset+split, prompt, seed, and sample size.
- Pass-rate reported with numerator/denominator and sample size; subset runs labelled as subsets.
- Model card read end-to-end; limitations section quoted in the report.
- Token budget computed from a real representative call × expected calls, with a per-run cap set.
- Model choice justified by cost/latency/quality numbers, not vibes.
