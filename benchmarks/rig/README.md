# Porcupine Benchmark Rig — Scaffolding (v1)

The top-4 agent benchmarks, Porcupine as harness, DeepSeek V4 Flash via OpenCode Go.
Rig machine: set `RIG_SSH_HOST=user@rig-host` (Ubuntu 24.04, 24 cores, RTX 4050, docker).

## The four benchmarks

| # | Benchmark | Framework | Driver | Set size | Status |
|---|---|---|---|---|---|
| 1 | Aider Polyglot | custom `run_polyglot.py` | Porcupine `--headless` per exercise | 34 py + 49 js | partial runs, being redone |
| 2 | Terminal-Bench 2.1 | Harbor + local registry (`tb21-registry`) + `pi_terminal_bench:PorcupineAgent` | pi protocol `--mode json` in sandbox | 89 tasks | running (target: 82.7%) |
| 3 | SWE-bench Verified | Harbor dataset (same adapter works) | same | 500 | not started |
| 4 | tau-bench | tau-bench framework (NOT on PyPI, needs git) | TBD | ~350 | not started |

## Remote layout

```
~/porcupine/                     rsync'd Porcupine repo (node runtime + dist)
~/opt/node/bin/node              Node 22 (tarball install, in ~/.bashrc PATH)
~/run_polyglot.py                polyglot driver (canonical copy: benchmark-rig/run-polyglot.py)
~/polyglot-benchmark/            Aider polyglot dataset (git clone)
~/polyglot-js-node_modules/      shared jest+babel node_modules for JS runner
~/polyglot-results/              results: results-<lang>.jsonl, runs/, tests-backup/
~/pi-terminal-bench/             harbor adapter (src/pi_terminal_bench/porcupine_agent.py)
~/benchenv/                      python venv: harbor, terminal-bench, swebench
~/tbench-results/                harbor job dirs: YYYY-MM-DD__HH-MM-SS/{trial}/result.json
~/slim/                          slim porcupine tarball + http server (port 8123) for sandbox installs
~/.porcupine/agent/auth.json     opencode-go API key (remote-only key)
```

## How each runs

### Aider Polyglot (`run_polyglot.py <lang> [names...]`, WORKERS=n)
1. Fresh workdir per exercise from `polyglot-benchmark/<lang>/exercises/practice/<name>`
2. Test files stripped (backed up), `.meta`/`.docs` removed
3. `git init` + base commit the workdir (so `diff_stat` shows only agent edits)
4. `node ~/porcupine/packages/coding-agent/dist/cli.js --headless "<instructions>"` (cwd=workdir)
5. Tests restored; run with pytest (python) or jest (javascript) with node PATH in env
6. Row appended to `results-<lang>.jsonl`: `{name, lang, passed, duration_s, headless_rc, headless_tail, test, diff_stat}`

**Javascript runner (Jest, P0-1):** Exercism JS specs are Jest ESM (`import … from './phone-number'`, `describe/xtest`) — plain `node --test` cannot run them (ERR_MODULE_NOT_FOUND on every file → all 49 scores were invalid). The driver now uses the canonical Aider flow (see `~/aider-bench/benchmark/npm-test.sh`):
- A **shared node_modules** is prebuilt once at `~/polyglot-js-node_modules/` (jest `^29.7.0` + `@babel/core` + `@exercism/babel-preset-javascript` + `babel-jest` + types + core-js) and symlinked into each workdir as `node_modules`.
- `xtest(` is converted to `test(` in the restored spec so every test runs (Aider scoring).
- Tests run via `npm test` (= `jest ./*`, exit 0 = all pass).
Build the shared modules once with:
```
cd ~ && mkdir -p polyglot-js-node_modules && cd polyglot-js-node_modules && npm install --no-audit --no-fund \
  jest@^29.7.0 @babel/core@^7.25.2 @exercism/babel-preset-javascript@^0.2.1 babel-jest@^29.6.4 \
  @types/jest@^29.5.12 @types/node@^20.12.12 core-js@~3.37.1
```

Resume semantics: skip names with an existing `passed` row; leftover workdir WITHOUT a row = crashed run → deleted and re-run.

### Terminal-Bench (Harbor)
```
nohup ~/benchenv/bin/harbor run -d terminal-bench@2.0 \
  --agent pi_terminal_bench:PorcupineAgent \
  -m opencode-go/deepseek-v4-flash \
  --n-attempts 1 --jobs-dir ~/tbench-results -n 8 \
  --agent-timeout-multiplier 2.0 > ~/tbench-run.log 2>&1 &
```
`--agent-timeout-multiplier 2.0` (P1-1) doubles Harbor's per-task default agent budget
(900s → 1800s), matching the adapter's own exec `timeout_sec=1800`.
**Known edge (P1-2):** `winning-avg-corewars` exceeds even 1800s (adapter timeout) —
accept the timeout or skip that task; it is a guaranteed max-length burn.
Sandbox install flow (adapter `install()`): node from nodejs.org tarball (file-based check, not `command -v`),
slim Porcupine (`http://rig-host:8123/porcupine-slim.tgz`, 158MB) + auth/settings from the same server.
Run: `pi` shim → `--print --mode json --session … --provider opencode-go --model deepseek-v4-flash "<task>"`,
token accounting parsed from `pi-output.jsonl` (`message_end` usage events).

## Ops lessons (learned the hard way — READ BEFORE TOUCHING)

1. **NEVER `pkill -f harbor` / `pkill -f run_polyglot` in the same SSH command that launches them**
   — the pattern matches the launching shell's own command line and kills it (self-match).
   Use the bracket trick (`pkill -f "harbor ru[n]"`) and/or separate SSH calls.
2. **Lid close suspends the laptop** — set (already done):
   `gsettings set org.gnome.settings-daemon.plugins.power lid-close-ac-action nothing` (same for battery).
   A reboot/suspend kills every nohup run. Check `uptime -p` first — if < run start, everything died.
3. **Docker subnet exhaustion**: every trial creates a compose network; killed runs leak them.
   Symptom: `all predefined address pools have been fully subnetted` (RuntimeError on all trials).
   Fix: `docker network prune -f` (frees pools instantly). Consider daemon.json default-address-pools for headroom.
4. **The remote runs are independent of the user's Mac.** Shutting down the Mac only kills SSH.
5. **Harbor has no job resume** — a dead run's trials are lost (artifacts remain in the old dir).
6. **Sandbox images vary**: some lack curl, python3, or node. The adapter's install must be fully
   self-sufficient (python3 → curl → wget → apt-get downloader chain; node file-check install; hardened `pi` shim
   with absolute node path fallback).
7. **Harbor 0.20 API drift**: `ExecInput` is not exported from `harbor.agents.installed.base` (defined locally in
   the adapter); `AgentContext` token fields are `n_input_tokens`/`n_output_tokens`/`n_cache_tokens`/`cost_usd`.
8. **AgentTimeoutError**: Harbor's per-task default budget (900s; one at 1200s) fires *before* the adapter's 1800s
   exec timeout. Mitigate with `--agent-timeout-multiplier 2.0` (P1-1, see run cmd above).
   `RuntimeError` + docker compose = env issue, investigate.
9. **Polyglot driver timeouts — FIXED (P0-2)**: `subprocess.run(..., timeout=1500)` on the headless agent call was
   uncaught and killed the whole ThreadPoolExecutor run. It (and the test runner) are now wrapped in
   `try/except subprocess.TimeoutExpired`; a timed-out agent is recorded as `{"passed": false, "error": "agent-timeout"}
   and the run continues.

## Results & scoring

- Polyglot: `results-<lang>.jsonl` — `passed` boolean per exercise; summary line at run end.
  Dedupe rule: keep rows with `passed` (skip rows shadow them).
- Terminal-Bench: `~/tbench-results/<job>/result.json` (job stats), per-trial
  `result.json` (exception_info / agent_result tokens+cost) + `verifier/ctrf.json` (summary.passed/tests).
- Score = passed/total per benchmark. Cost per task ≈ $0.018 (DSV4F via opencode-go).

## Fixes applied 2026-08-10

- **P0-1 — JS runner**: `LANG_RUNNERS["javascript"]["cmd"]` changed from `node --test` (ERR_MODULE_NOT_FOUND on
  every Jest ESM spec → 49 invalid scores) to Jest via the canonical Aider flow: shared `~/polyglot-js-node_modules`
  symlink + `xtest→test` + `npm test` (= `jest ./*`). Verified on real exercises (pass + fail samples).
- **P0-2 — Uncaught timeout**: headless agent `subprocess.run` (line ~102) and the test runner both wrapped in
  `try/except subprocess.TimeoutExpired`; timeout recorded as `passed:false, error:"agent-timeout"`, run continues.
- **P2-1 — all staged tests**: now runs every staged test file (was `staged_tests[0]`); exercise passes only if all pass.
- **P2-2 — diff_stat**: workdir is `git init`-ed + base-committed before the agent runs, so `diff --stat`
  now reflects only agent edits (was always empty).
- **P2-3 — README counts**: polyglot python = **34** (was 48); javascript = **49** (correct).

## Next actions

- [ ] Polyglot javascript: rerun after the Jest runner fix (P0-1) — all prior 49 scores invalid (`node --test`)
- [ ] Polyglot python: resume remaining ~10 (timeout crash fixed by P0-2)
- [ ] Terminal-Bench: restart with `--agent-timeout-multiplier 2.0` after this run completes;
      `docker network prune -f` first (subnet pools exhausted on the 22:42 run)
- [ ] SWE-bench Verified: `harbor run -d swe-bench@<ver>` with the same adapter — validate dataset name
- [ ] tau-bench: install from git (not on PyPI) + write the driver
- [ ] Monitor loop: check-status.sh every 30 min; restart anything dead; keep the laptop awake

## PENDING ACTION (do NOT apply while runs are active — docker restart kills all containers)

**Docker address-pools fix** — permanent cure for subnet exhaustion. The user's
remote has a broken screen (no local admin possible); the agent must apply this
via SSH when the current swebench + tbench runs COMPLETE, then relaunch tbench
at -n 4. Config: write /etc/docker/daemon.json with a default-address-pools
entry (172.17.0.0/16 base, /24 size) and restart the docker daemon. Elevated
privileges need Normal mode + user approval.

## DISK HYGIENE (monitor routine — the streams fill disk fast)

- Each trial's pi-output.jsonl can reach 0.1-3GB (max-reasoning streams) — a
  full 89-task run needs ~150-250GB.
- EVERY monitor cycle: delete the `agent/` dirs of COMPLETED trials in the
  active run dir (result.json + verifier are the data), archive results first.
- Periodically: `docker ps -aq --filter status=exited | xargs docker rm`,
  `docker image prune -a -f`, `rm -rf ~/.cache/huggingface/xet` (the xet
  download cache re-fills on model pulls).
- The resume-registry trick (tb21-remaining/registry.json) rebuilds a dataset
  of ONLY the not-yet-clean tasks after a death — never re-run completed work.
