---
name: auto-mode
description: Operate with autonomous initiative when Auto Mode is enabled.
stack: meta
---

# Auto Mode

Use this skill when Porcupine is in Auto Mode. Auto Mode means no human is sitting in the loop to approve ordinary steps. The agent must carry the task as far as it safely can, then report a clear result.

## When to use

- `/auto` or `/modes` has set the interaction mode to Auto.
- The session banner shows `⚡ Auto`.
- A task arrives that would normally need many small approvals.

Do not use this skill to relax safety. Auto is wider autonomy, not a permission to be reckless.

## What changes in Auto Mode

In Normal or Ask mode, the agent may pause for confirmation. In Auto Mode, pausing for confirmation is usually the wrong move because no one is there to answer. Instead:

- Prefer the smallest safe command that accomplishes the goal.
- Run safe setup, builds, tests, searches, and edits without asking.
- Handle ordinary failures yourself: re-read the error, inspect the file, retry with a corrected command, or choose a different approach.
- Keep momentum across a multi-step task. Do not stop after every step to summarize; stop when there is a real result, a hard blocker, or a decision only the user can make.
- Prefer verification over questions. Run the test, the build, or the read-back instead of asking whether something worked.

## Autonomous operating rules

1. **Inspect before acting.** Read the relevant file or command output before editing. Do not guess paths or symbols.
2. **Prefer narrow, verifiable steps.** One concrete change, then one concrete check.
3. **Recover from ordinary failure.** A failed test, a lint error, or a missing import is a signal to fix, not a reason to stop.
4. **Bound your own work.** Stop a task when it is done, when it is clearly blocked by missing input only the user can provide, or when continuing would require an irreversible high-risk action.
5. **Report with evidence.** End with what changed, the verification command and its result, and the next step if any.

## Hardline vs flagged

Hardline actions stay blocked in Auto Mode. If a goal needs one of them, stop and report it as a user decision:

- `rm -rf /` or recursive delete of the filesystem root.
- Disk format, raw device writes, fork bombs, shutdown/reboot, kill-all.

Force-push, `git reset --hard`, and destructive SQL (`DROP TABLE` / `DROP DATABASE`) are **flagged**, not hardline: the fail-closed LLM gate may APPROVE or DENY them. A gate denial is final. Do not treat flagged as automatically blocked, and do not loop on variants of a denied command.

If the Auto safety gate denies a flagged command, do not loop on variants hoping to slip through. Either choose a safer equivalent that achieves the goal, or stop and tell the user exactly what was blocked and why.

## Native write-fence (Auto Mode)

In Auto Mode, approved bash runs under a native OS-level **write fence**, layered *under* the fail-closed gate. It is a write fence, not full isolation: reads, execution, and network are unchanged.

Writable:

- the workspace (session cwd)
- the system temp directory
- standard home state/cache dirs (`~/.npm`, `~/.cache`, `~/.config`, `~/.local`, `~/.ssh`, and on macOS `~/Library/Caches` and `~/Library/Application Support`)

Denied: everything else (other projects, `~/Library`, system directories, arbitrary paths).

How to treat it:

- If a command fails with `Operation not permitted` or `Permission denied` on a write, the fence denied it — that is expected behavior, not a bug. Move the target into the workspace (or a writable cache dir) and retry, or choose an approach that does not write outside the allowed set.
- Do not work around the fence by chaining writes through another tool or an indirect path. The fence and the gate are both fail-closed; a bypass attempt is treated the same as a gate denial.
- On platforms where the native backend (or its required binary) is unavailable, bash runs unsandboxed with a one-time warning. The gate still applies in every case.

## Verification

An Auto Mode turn is complete when:

- the requested result exists and is verified by a command or file read-back; or
- the agent hit a true blocker only the user can resolve, stated explicitly; or
- the only remaining step is a hardline action the agent must not take alone.

The agent should not end an Auto Mode task by asking a question it could have answered by inspecting the workspace.
