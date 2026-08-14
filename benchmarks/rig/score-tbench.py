#!/usr/bin/env python3
"""Compute the Terminal-Bench 2.1 score from all collected trial results.

Data sources: archive-tbench/*.json (all completed trials ever) + any live
run dirs under ~/tbench-results/. For each of the 89 tasks, the BEST trial
wins: a clean run (no exception) with the highest reward; ties -> latest.
Score = tasks with reward >= 0.5 / 89.
"""
import json
import glob
import os
import sys
from collections import Counter

TB21_COMMIT = "2fd12b88aafdd04a52c298e3940bcb189f9766d6"
TOTAL = 89

def collect(paths):
    results = {}
    for pat in paths:
        for f in glob.glob(os.path.expanduser(pat)):
            try:
                d = json.load(open(f))
            except Exception:
                continue
            tid = d.get("task_id", {})
            if tid.get("git_commit_id", "") != TB21_COMMIT:
                continue
            p = tid.get("path")
            if not p:
                continue
            ex = d.get("exception_info")
            reward = (d.get("verifier_result") or {}).get("rewards", {}).get("reward")
            fin = d.get("finished_at", "") or ""
            cur = results.get(p)
            key = (ex is None, reward if reward is not None else -1, fin)
            if cur is None or key > cur[0]:
                results[p] = (key, d)
    return results

def main():
    import argparse
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser = argparse.ArgumentParser(description="Score Terminal-Bench 2.1 results")
    parser.add_argument(
        "--results-dir",
        default=os.path.join(repo_root, "benchmarks", "tbench", "results"),
        help="Directory of result.json files (default: committed benchmarks/tbench/results)",
    )
    args = parser.parse_args()
    results = collect([os.path.join(args.results_dir, "*.json")])
    kinds = Counter()
    passes = 0
    fails = 0
    for p, (key, d) in sorted(results.items()):
        ex = d.get("exception_info")
        reward = (d.get("verifier_result") or {}).get("rewards", {}).get("reward")
        if ex is None and reward is not None:
            if reward >= 0.5:
                passes += 1
            else:
                fails += 1
            kinds["scored"] += 1
        else:
            kinds["unscored"] += 1
    print(f"tasks with any result: {len(results)}/{TOTAL}")
    print(f"scored (clean+verdict): {kinds.get('scored', 0)} | unscored: {kinds.get('unscored', 0)}")
    print(f"PASS: {passes} | FAIL: {fails}")
    if kinds.get("scored"):
        print(f"SCORE (passes / total 89): {passes}/{TOTAL} = {passes / TOTAL * 100:.1f}%")
        print(f"SCORE (passes / scored {kinds['scored']}): {passes}/{kinds['scored']} = {passes / kinds['scored'] * 100:.1f}%")

if __name__ == "__main__":
    main()
