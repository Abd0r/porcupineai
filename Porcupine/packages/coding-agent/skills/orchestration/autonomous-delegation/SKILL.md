---
name: autonomous-delegation
description: Decompose a large goal into targeted parallel sub-agent missions and integrate verified results — the harness carries the orchestration, the user states the goal.
stack: orchestration
---

# Autonomous Delegation

The user states a goal; **the harness owns decomposition, delegation, verification, and integration**. Never make the user be a "prompt king" — if a task is bigger than one focused pass, break it down yourself and run the loop below.

This skill encodes the orchestration pattern: goal → recon → partition → targeted briefs → parallel spawn → verify → integrate → re-target.

## When to decompose

Trigger decomposition when the goal is:
- **Multi-track**: two or more independent areas (e.g. audit UI + features + tools, fix several subsystems, research several topics).
- **Heavy**: more than a handful of steps that would pollute the main context if done inline (long research, big refactors, audits, multi-file drafts).
- **Budget-hungry**: needs many tool calls that a fresh 128K–256K context would absorb better than the main transcript.

Do NOT decompose: trivial tasks (a grep, a single edit), tasks needing live user approval mid-flight, or work that requires interactive tools (sub-agents cannot ask questions).

## The loop

### 1. Recon — before writing any brief
Read enough of the task/input to know the real tracks. Grep the repo, list the files, understand the dependencies. A brief written from ignorance produces a wrong partition.

### 2. Partition — disjoint, exhaustive tracks
Split the goal into tracks that **do not overlap in files** (workers share the working tree; overlapping edits clobber each other). For each track declare file ownership in its brief ("you MAY touch X, you MUST NOT touch Y"). Cover everything: the union of tracks = the goal. 3 tracks max by default (`subagent.maxConcurrent`), main agent takes a track too.

### 3. Write targeted briefs — the recipe
Every brief must contain:
- **Input**: absolute paths, URLs, repo locations.
- **Deliverable**: exactly what to produce and where ("write the report to /abs/path.md as your final action — do not end your turn without writing the file").
- **Constraints**: do-not-touch paths, severity rubric, evidence format ("file:line quotes only — never invent findings"), verification requirements (run tests, typecheck), budget awareness.
- **Ownership**: "touch ONLY these files" + "do not run npm run build" (parallel dist writes race).
- **Fail behavior**: what to do on budget exhaustion (prioritize, note leftovers in the report).

Bad brief: `"investigate the TUI"`. Good brief: `"Bug audit of modes/interactive/. For each bug: file:line evidence quoted (3-8 lines), severity, why it's a bug, one-line fix. Write to /abs/path.md. Do not edit any files."`

### 4. Spawn in parallel, keep working
Spawn up to `subagent.maxConcurrent` (default 3) in one pass. While they run, do your own track (usually the core/highest-risk one). Reports are injected the moment each finishes — steer mid-turn or fresh turn — never wait for the user.

**WoT coordination (Web of Thoughts):** when tracks must share findings or hand off work, workers message each other and the main agent **live** by @tag (injected into context instantly, open addressing). Tell each worker the peers' @tags in the brief so they can coordinate directly instead of round-tripping through you. Use `send_to_subagent` to steer a worker mid-flight ("drop X, focus on Y").

### 5. Verify every report — never trust blindly
A report is a claim, not a fact. Spot-check the highest-impact claims against source (`grep`/`read` the file:line the worker cited). Cross-check against your own recon. This is non-negotiable: sub-agents can hallucinate, misread, or stop early.

### 6. Integrate + re-target
Fold verified results into the deliverable. On failure:
- `budgetExhausted: true` → re-spawn with a narrower scope or raise `subagent.maxSteps` — the summary holds partial progress.
- Rejected/broken report → re-target that track with the failure as new input ("the previous attempt failed because X; here's what to fix").
- Conflicting or wrong work → revert the bad file changes and re-run that track alone.

## Verification protocol for briefs

Every brief must make verification possible:
- Code changes: name the test/typecheck command the worker must run and pass.
- Research/reports: demand cited sources the parent can spot-check ("cite the URL you actually read; mark unverified claims").
- Fix batches: demand the same evidence format (file:line, severity) so integration is mechanical.

## Heavy lifting principles

- The user gives the goal, not the plan. Decompose without asking "how should I split this?" — that is your job.
- Prefer spawning over re-reading: a fresh context absorbs the detail; the main context stays clean for orchestration and judgment.
- Guardrails travel with the workers: they share cwd, permission policy, and safety gates; Ask mode still confirms their flagged commands. They cannot spawn sub-agents and cannot ask the user — so never brief them with open questions; brief them with decisions made.
- Stopping a runaway: Escape with an empty editor cancels all running sub-agents (`⏹ Sub-agents cancelled`).
