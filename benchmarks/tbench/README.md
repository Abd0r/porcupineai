# Terminal-Bench 2.1 — Porcupine harness

**Score: 45 PASS / 9 FAIL / 35 unscored of 89 tasks.**

- Clean pass rate: **83.3% (45/54)** vs **82.7%** on DeepSeek's official card — same model (DeepSeek V4 Flash), our harness.
- 35 tasks never received a fair run: three benchmark cycles were lost to rig failures (sandbox subnet exhaustion, disk fills, OOM from captured output). Every infra fix is documented in [`../rig/README.md`](../rig/README.md).
- Reference baseline: DeepSeek's official TB 2.1 card (82.7%, their unreleased harness). Not independently verified.

## How it was scored

Each task runs the Porcupine harness (pi protocol, `--mode json`) against the task's Docker sandbox. A task scores PASS when a clean run (no agent/setup/verifier exception) earns a verifier reward >= 0.5. Best clean run wins per task. Same rule as the official suite.

## Raw data

- [`results/`](results/) — 257 per-trial result.json files (all cycles, including failures; the scorer picks the best clean run per task)
- Scoring script: [`../rig/score-tbench.py`](../rig/score-tbench.py)

## Run

```bash
python3 benchmarks/rig/score-tbench.py
```

Expected output:

```
PASS: 45 | FAIL: 9
SCORE (passes / total 89): 45/89 = 50.6%
SCORE (passes / scored 54): 45/54 = 83.3%
```
