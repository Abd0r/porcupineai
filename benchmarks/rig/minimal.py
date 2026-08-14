#!/usr/bin/env python3
"""minimal.py - dependency-free (stdlib only) headless Porcupine benchmark driver.

Runs Porcupine once, headless, on a single task under a pinned surface and
writes one JSONL result line. Mirrors the dsh jsonrpc-agent 'minimal' contract:
each task gets its own fresh workspace and a distinct session id, so runs are
isolated and replayable without touching a live agent home.

The prompt surface is pinned: PORCUPINE_BENCHMARK=1 forces buildSystemPrompt to
return the fixed persona ("You are a helpful software engineer assistant.")
regardless of machine, agent-home state, memory, skills, or context files. See
README-minimal.md.

CLI:
    python3 benchmarks/rig/minimal.py \
        --task "Refactor the parser" \
        --workspace /tmp/bench-ws-1 \
        --session-root /tmp/bench-sessions \
        --session-id bench-0001 \
        --results /tmp/bench/results.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def resolve_porcupine_bin(override: str | None) -> str:
    """Return the porcupine binary path.

    Priority: --porcupine-bin override, then the PORCUPINE_BIN env var, then the
    `porcupine` executable found on PATH.
    """
    if override:
        return override
    env_bin = os.environ.get("PORCUPINE_BIN")
    if env_bin:
        return env_bin
    found = shutil.which("porcupine")
    if not found:
        raise RuntimeError(
            "porcupine executable not found on PATH; set PORCUPINE_BIN or "
            "pass --porcupine-bin"
        )
    return found


def final_snippet(stdout: str, max_chars: int = 400) -> str:
    """Tight textual summary of the run output for the JSONL line."""
    stripped = stdout.strip()
    if not stripped:
        return ""
    return stripped[-max_chars:]


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="minimal",
        description="Headless Porcupine benchmark driver (single task).",
    )
    parser.add_argument("--task", required=True, help="Task prompt to run.")
    parser.add_argument("--workspace", required=True, help="Fresh workspace dir for this task.")
    parser.add_argument("--session-root", required=True, help="Session storage root dir.")
    parser.add_argument("--session-id", required=True, help="Unique session id for this task.")
    parser.add_argument("--results", required=True, help="Path to the JSONL results file.")
    parser.add_argument("--provider", default=None, help="Provider name (defaults to PORCUPINE_PROVIDER).")
    parser.add_argument("--model", default=None, help="Model pattern (defaults to PORCUPINE_MODEL).")
    parser.add_argument("--porcupine-bin", default=None, help="Explicit path to the porcupine binary.")
    parser.add_argument("--timeout", type=int, default=300, help="Per-run timeout in seconds.")
    parser.add_argument(
        "--mode",
        default="json",
        choices=("json", "text"),
        help="Porcupine output mode for the headless run (defaults to json for machine parsing).",
    )
    args = parser.parse_args()

    provider = args.provider or os.environ.get("PORCUPINE_PROVIDER")
    model = args.model or os.environ.get("PORCUPINE_MODEL")

    workspace = Path(args.workspace)
    session_root = Path(args.session_root)
    results_path = Path(args.results)

    # Fresh, isolated surfaces: recreate the workspace and ensure session root.
    if workspace.exists():
        shutil.rmtree(workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    session_root.mkdir(parents=True, exist_ok=True)

    porcupine_bin = resolve_porcupine_bin(args.porcupine_bin)

    # Pin the output surface: fixed persona + explicit provider/model.
    env = dict(os.environ)
    env["PORCUPINE_BENCHMARK"] = "1"
    if provider:
        env["PORCUPINE_PROVIDER"] = provider
    if model:
        env["PORCUPINE_MODEL"] = model
    env["PORCUPINE_CODING_AGENT_SESSION_DIR"] = str(session_root)

    cmd = [
        porcupine_bin,
        "--headless",
        "--mode",
        args.mode,
        "--session-dir",
        str(session_root),
        "--session-id",
        args.session_id,
    ]
    if provider:
        cmd += ["--provider", provider]
    if model:
        cmd += ["--model", model]
    cmd.append(args.task)

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(workspace),
            env=env,
            capture_output=True,
            text=True,
            timeout=args.timeout,
            check=False,
        )
        exit_code = proc.returncode
        output = proc.stdout or ""
        error = proc.stderr or ""
    except subprocess.TimeoutExpired as exc:  # pragma: no cover - timing dependent
        exit_code = 124
        output = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        error = ""
    except Exception as exc:  # pragma: no cover - unexpected infra failure
        exit_code = 1
        output = ""
        error = str(exc)

    # Best-effort JSON parse for --mode json so we can surface the final answer.
    final_text_snippet = final_snippet(output)
    if args.mode == "json" and output.strip():
        try:
            payload = json.loads(output)
            if isinstance(payload, dict):
                text = payload.get("result") or payload.get("text") or payload.get("output")
                if isinstance(text, str):
                    final_text_snippet = final_snippet(text)
        except json.JSONDecodeError:
            pass

    record = {
        "task": args.task,
        "workspace": str(workspace),
        "session_id": args.session_id,
        "exit_code": exit_code,
        "final_text_snippet": final_text_snippet,
        "timeout_s": args.timeout,
    }

    results_path.parent.mkdir(parents=True, exist_ok=True)
    with open(results_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record))
        fh.write("\n")

    if error:
        sys.stderr.write(error)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
