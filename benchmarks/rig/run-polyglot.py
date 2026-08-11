#!/usr/bin/env python3
"""Porcupine-as-harness runner for the Aider Polyglot benchmark.

Each exercise: fresh workdir (stub files only, NO tests) -> porcupine
--headless with the exercise instructions -> tests copied back -> run ->
pass/fail recorded. Results are JSONL in the results dir.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HOME = Path.home()
BENCH = HOME / "polyglot-benchmark"
PORCUPINE = HOME / "porcupine/packages/coding-agent/dist/cli.js"
RESULTS = HOME / "polyglot-results"

# Shared pre-built node_modules for Exercism JS (jest 29.7.0 + @babel/core +
# @exercism/babel-preset-javascript + babel-jest). Mirrors the canonical
# Aider npm-test.sh which symlinks a shared /npm-install/node_modules into
# the workdir before running `npm test` (= jest ./*).
# Build once with:
#   mkdir -p ~/polyglot-js-node_modules && cd ~/polyglot-js-node_modules
#   npm install --no-audit --no-fund jest@^29.7.0 @babel/core@^7.25.2 \
#     @exercism/babel-preset-javascript@^0.2.1 babel-jest@^29.6.4 \
#     @types/jest@^29.5.12 @types/node@^20.12.12 core-js@~3.37.1
JS_NODE_MODULES = HOME / "polyglot-js-node_modules" / "node_modules"

LANG_RUNNERS = {
    "python": {
        "test_globs": ["*_test.py", "test_*.py"],
        "cmd": lambda d, ts: ["python3", "-m", "pytest", "-q", *[str(t) for t in ts]],
        "exclude_dirs": [".meta", ".docs"],
    },
    "javascript": {
        "test_globs": ["*.test.js", "*.spec.js"],
        "cmd": lambda d, ts: ["npm", "test"],  # = "jest ./*", runs ALL specs
        "exclude_dirs": [".meta", ".docs"],
        "runner": "jest",
    },
}


def load_instructions(exercise_dir: Path) -> str:
    parts = []
    docs = exercise_dir / ".docs"
    for name in ["instructions.md", "instructions.append.md"]:
        f = docs / name
        if f.exists():
            parts.append(f.read_text())
    if not parts:
        readme = exercise_dir / "README.md"
        if readme.exists():
            parts.append(readme.read_text())
    return "\n\n".join(parts).strip()


def find_tests(exercise_dir: Path, globs):
    tests = []
    for g in globs:
        tests.extend(exercise_dir.glob(g))
    return [t for t in tests if t.is_file()]


def prepare_jest_workdir(workdir: Path):
    """Make the JS workdir runnable by jest, mirroring Aider's npm-test.sh:
    - symlink a shared node_modules (jest + babel + exercism preset)
    - strip stale package-lock/.npmrc so `npm test` uses the shared modules."""
    for name in ["node_modules", "package-lock.json", ".npmrc"]:
        p = workdir / name
        if p.exists() or p.is_symlink():
            p.unlink(missing_ok=True)
    (workdir / "node_modules").symlink_to(JS_NODE_MODULES, target_is_directory=True)


def enable_all_js_tests(workdir: Path):
    """Exercism specs start with only the first test active and the rest as
    `xtest(...)` (skipped). The canonical Aider npm-test.sh converts
    `xtest(` -> `test(` so every test runs and the exercise is fully scored.
    Runs AFTER tests are restored to the workdir."""
    for spec in workdir.glob("*.spec.js"):
        try:
            text = spec.read_text()
        except OSError:
            continue
        if "xtest(" in text:
            spec.write_text(text.replace("xtest(", "test("))


def git_init(workdir: Path):
    """Track the base (test-stripped, stub) state so diff_stat is meaningful:
    only agent edits show in `git diff --stat`. Never fatal on failure."""
    try:
        subprocess.run(["git", "-C", str(workdir), "init", "-q"],
                       capture_output=True, text=True, timeout=30)
        subprocess.run(["git", "-C", str(workdir), "add", "-A"],
                       capture_output=True, text=True, timeout=30)
        subprocess.run(
            ["git", "-C", str(workdir), "-c", "user.email=rig@benchmark",
             "-c", "user.name=bench", "commit", "-qm", "base"],
            capture_output=True, text=True, timeout=30)
    except Exception:
        pass


def run_one(lang: str, name: str, timeout_s: int = 1500):
    src = BENCH / lang / "exercises" / "practice" / name
    if not src.is_dir():
        return {"name": name, "lang": lang, "error": "no exercise dir"}
    cfg = LANG_RUNNERS[lang]
    workdir = RESULTS / "runs" / lang / name
    out_path = RESULTS / f"results-{lang}.jsonl"
    if out_path.exists():
        for line in out_path.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                if row.get("name") == name and "passed" in row:
                    return {"name": name, "lang": lang, "skipped": "already-recorded"}
    # A leftover workdir WITHOUT a recorded row is a crashed run: re-run it.
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)
    shutil.copytree(src, workdir)

    tests = find_tests(src, cfg["test_globs"])
    staged_tests = []
    for t in tests:
        rel = t.relative_to(src)
        dest = workdir / rel
        backup = RESULTS / "tests-backup" / lang / name / rel
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dest, backup)
        dest.unlink()
        staged_tests.append(rel)
    for d in cfg["exclude_dirs"]:
        shutil.rmtree(workdir / d, ignore_errors=True)

    if cfg.get("runner") == "jest":
        prepare_jest_workdir(workdir)

    # Track base (stub + no-tests) state so diff_stat shows only agent edits.
    git_init(workdir)

    instructions = load_instructions(src)
    if not instructions:
        return {"name": name, "lang": lang, "error": "no instructions"}

    prompt = (
        "You are working in a coding repository. Complete the task described below "
        "by modifying the source files in this repository. Do not create or modify "
        "test files. Do not modify package metadata.\n\n"
        + instructions
    )

    env = dict(os.environ)
    env["PATH"] = f"{HOME}/opt/node/bin:" + env.get("PATH", "")
    started = time.time()

    # P0-2: guard the headless agent call so a TimeoutExpired doesn't kill the
    # whole ThreadPoolExecutor run (previously uncaught -> lost all in-flight).
    headless_tail = ""
    headless_rc = None
    timed_out = False
    try:
        proc = subprocess.run(
            ["node", str(PORCUPINE), "--headless", prompt],
            cwd=workdir,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        headless_rc = proc.returncode
        headless_tail = (proc.stdout + proc.stderr)[-400:]
    except subprocess.TimeoutExpired as e:
        timed_out = True
        headless_tail = (getattr(e, "stdout", b"") or b"").decode(errors="replace")[-400:]
        if isinstance(headless_tail, str) and e.stderr:
            headless_tail = (str(headless_tail) + (e.stderr.decode(errors="replace") if isinstance(e.stderr, bytes) else str(e.stderr)))[-400:]

    duration = round(time.time() - started, 1)

    for rel in staged_tests:
        backup = RESULTS / "tests-backup" / lang / name / rel
        dest = workdir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup, dest)

    # P0-1: after restoring specs, enable every Exercism test (xtest -> test)
    # so jest fully scores the exercise (canonical Aider behavior).
    if cfg.get("runner") == "jest":
        enable_all_js_tests(workdir)

    # P0-2: guard the test runner with try/except TimeoutExpired.
    # P2-1: run ALL staged tests (union); passed only if every one passes.
    test_results = []
    if timed_out:
        # Agent never finished -> record timeout even though the (stub) tests
        # would never be meaningful; do not waste a test run.
        test_results = [{"rc": -1, "tail": "skipped (agent-timeout)"}]
    elif staged_tests:
        try:
            tproc = subprocess.run(
                cfg["cmd"](workdir, [workdir / rel for rel in staged_tests]),
                cwd=workdir,
                env=env,
                capture_output=True,
                text=True,
                timeout=180,
            )
            rc = tproc.returncode
            test_results = [{
                "rc": rc,
                "tail": (tproc.stdout + tproc.stderr)[-600:],
            }]
        except subprocess.TimeoutExpired:
            test_results = [{"rc": -1, "tail": "test run timed out"}]

    # passed only if the agent did NOT time out and every staged test run rc==0
    passed = bool(not timed_out and test_results and all(
        tr["rc"] == 0 for tr in test_results))

    diff = ""
    try:
        diff = subprocess.run(
            ["git", "-C", str(workdir), "diff", "--stat"],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout.strip()
    except Exception:
        pass

    record = {
        "name": name,
        "lang": lang,
        "passed": passed,
        "duration_s": duration,
        "headless_rc": headless_rc,
        "headless_tail": headless_tail,
        "test": test_results,
        "diff_stat": diff,
    }
    return record


def main():
    lang = sys.argv[1] if len(sys.argv) > 1 else "python"
    names = sys.argv[2:] or sorted(
        d.name
        for d in (BENCH / lang / "exercises" / "practice").iterdir()
        if d.is_dir()
    )
    workers = int(os.environ.get("WORKERS", "4"))
    RESULTS.mkdir(parents=True, exist_ok=True)
    out_path = RESULTS / f"results-{lang}.jsonl"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_one, lang, n) for n in names]
        for fut in futures:
            rec = fut.result()
            with open(out_path, "a") as f:
                f.write(json.dumps(rec) + "\n")
            print(
                f"[{rec.get('name')}] {'PASS' if rec.get('passed') else 'FAIL/SKIP'} "
                f"{rec.get('duration_s', '?')}s {rec.get('error', rec.get('skipped', ''))}",
                flush=True,
            )

    rows = [json.loads(l) for l in out_path.read_text().splitlines() if l.strip()]
    last_by_name = {}
    for r in rows:
        if "name" in r and ("passed" in r or r["name"] not in last_by_name):
            last_by_name[r["name"]] = r
    rows = list(last_by_name.values())
    done = [r for r in rows if "passed" in r]
    passed = sum(1 for r in done if r["passed"])
    print(f"\nSUMMARY {lang}: {passed}/{len(done)} passed ({len(rows)} unique exercises)", flush=True)


if __name__ == "__main__":
    main()
