# minimal.py — headless Porcupine benchmark driver

`benchmarks/rig/minimal.py` is a dependency-free (Python stdlib only) driver that
runs Porcupine once, headless, on a single task under a pinned surface, and
appends one JSONL result line per run.

It mirrors the dsh jsonrpc-agent `minimal` contract: every task runs in its own
**fresh workspace** and gets a **distinct session id**, so runs are isolated,
cancellable, and replayable without touching a live agent home.

## Why it is reproducible

The prompt surface is pinned by setting `PORCUPINE_BENCHMARK=1` in the child
environment. That env forces `buildSystemPrompt` to return the fixed persona
**"You are a helpful software engineer assistant."** — no memory, personality,
stacks, project context, skills, or datetime ride along. Runs are therefore
byte-stable in the assembled system prompt across machines and agent-home state.

Provider/model are pinned explicitly via `PORCUPINE_PROVIDER` / `PORCUPINE_MODEL`
(the driver sets them from CLI args or the existing environment) and passed as
`--provider` / `--model` to the binary.

## Usage

```bash
python3 benchmarks/rig/minimal.py \
    --task "Refactor the tokenizer to not allocate per char" \
    --workspace /tmp/bench-ws-01 \
    --session-root /tmp/bench-sessions \
    --session-id bench-0001 \
    --results /tmp/bench/results.jsonl
```

Required flags (copied to each task):

| Flag | Meaning |
| --- | --- |
| `--task` | The prompt to run (passed as the positional task). |
| `--workspace` | Directory the run's `cwd` is set to. Recreated fresh (wiped) each run. |
| `--session-root` | Directory where sessions are stored. |
| `--session-id` | Unique session id for this task (isolated from other tasks). |
| `--results` | Path to the JSONL results file (created/appended). |

Optional flags:

| Flag | Meaning |
| --- | --- |
| `--provider` | Provider name; defaults to `PORCUPINE_PROVIDER`. |
| `--model` | Model pattern; defaults to `PORCUPINE_MODEL`. |
| `--porcupine-bin` | Explicit path to the binary instead of PATH lookup. |
| `--timeout` | Per-run timeout in seconds (default 300). |
| `--mode` | Output mode: `json` (default) or `text`. |

The `porcupine` binary is resolved from `PATH` by default (the `porcupine`
entry point ships in the package `bin`). Override with `--porcupine-bin` or the
`PORCUPINE_BIN` env var; no install path argument is required.

## Result line (JSONL)

One object per run, appended to `--results`:

```json
{
  "task": "Refactor the tokenizer...",
  "workspace": "/tmp/bench-ws-01",
  "session_id": "bench-0001",
  "exit_code": 0,
  "final_text_snippet": "…last 400 chars of the model answer…",
  "timeout_s": 300
}
```

`exit_code` is the child's exit code (124 on timeout). `final_text_snippet` is a
tight trailing slice of the model answer; in `--mode json` the driver tries to
parse the JSON payload and extract the `result`/`text`/`output` field first.

## Notes

- This is a **minimal** single-task rig. Batch harnesses should call it once per
  task with rotated `--workspace` and `--session-id` values.
- No API keys are needed to import/compile the driver; keys are only consulted by
  the Porcupine process when it actually selects a provider for a run.
