# Terminal-Bench 2.1 — Porcupine harness

**Score (reproducible from committed data): 42 PASS / 10 FAIL / 37 unscored of 89 tasks.**

- Clean pass rate: **80.8% (42/52)** vs **82.7%** on DeepSeek's official card — same model (DeepSeek V4 Flash), our harness.
- 37 tasks never received a fair run: three benchmark cycles were lost to rig failures (sandbox subnet exhaustion, disk fills, OOM from captured output). Every infra fix is documented in [`../rig/README.md`](../rig/README.md).
- Reference baseline: DeepSeek's official TB 2.1 card (82.7%, their unreleased harness). Not independently verified.

## Reproducibility note

Earlier revisions of this page reported 45 PASS / 45-of-54 = 83.3% from a larger
run collection that was never fully committed. Re-scoring the data actually in
this repo (`results/`, 257 trial files) with the committed scorer gives the
numbers above: **42 PASS / 10 FAIL / 37 unscored = 42/52 = 80.8%**. The scorer
now defaults to the committed results directory, so `python3
benchmarks/rig/score-tbench.py` reproduces this page from a fresh clone.
The 45/54 figure is retained only as history; do not cite it as the current
committed result. When a new full rig run is completed, commit its complete
archive under `results/` and update this page from the scorer output.

## How it was scored

Each task runs the Porcupine harness (pi protocol, `--mode json`) against the task's Docker sandbox. A task scores PASS when a clean run (no agent/setup/verifier exception) earns a verifier reward >= 0.5. Best clean run wins per task. Same rule as the official suite.

## Raw data

- [`results/`](results/) — 257 per-trial result.json files (all cycles, including failures; the scorer picks the best clean run per task)
- Scoring script: [`../rig/score-tbench.py`](../rig/score-tbench.py)

## Run

```bash
python3 benchmarks/rig/score-tbench.py
# optional: score a different collection
python3 benchmarks/rig/score-tbench.py --results-dir /path/to/archive
```

Expected output (from the committed results):

```
tasks with any result: 89/89
scored (clean+verdict): 52 | unscored: 37
PASS: 42 | FAIL: 10
SCORE (passes / total 89): 42/89 = 47.2%
SCORE (passes / scored 52): 42/52 = 80.8%
```
