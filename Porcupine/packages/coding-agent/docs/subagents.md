# Sub-Agents: Parallel Isolated Workers

Porcupine's sub-agent system delegates self-contained work to isolated workers
that run **in parallel** with the main agent. It is one of Porcupine's most
distinctive capabilities — and one of the best in the class.

## The model

- The main agent (you see it in the TUI, always `@porcupine`) can spawn up to
  `subagent.maxConcurrent` sub-agents (default 3, user-configurable).
- Every running sub-agent holds a **@tag**: `@buck`, `@fudgy`, `@tinker`, `@rivet`, `@gizmo` by
  default, a `name` parameter per spawn, or your own `subagent.names` in
  settings. Tags address workers everywhere ids used to: `send_to_subagent`,
  `stop_subagent`, WoT `send_message`, the footer chip, and `/subagents`.
- Each sub-agent gets a **fresh context window** (128K–256K) and a **hard
  step budget**. It cannot read the main agent's context, and it cannot spawn
  its own sub-agents.
- Sub-agents get the **whole tool stack** minus agent-level tools: no
  `subagent` (no recursion), no `ask_question` (workers can't ask you), no
  `computer_use` (GUI control is attended-only), and no `tasks`/`projects`
  (agent-level durable state). They have `capability_search`, so the full
  skill catalog is reachable too (`capability_search` → `read SKILL.md`) —
  they can match main-agent performance on research, refactors, and audits.
- Sub-agents run on their own model (`subagent.model`), usually a cheaper one,
  so delegation saves both context and cost.
- The tool returns immediately: the main agent keeps working while the
  sub-agent runs in the background.

## Instant report injection

When a sub-agent finishes, its report is injected into the main agent's
context **the moment it completes** — steered into the running turn if the main
agent is mid-task, or a fresh turn if it is idle. It is **never gated on your
next prompt**. The main agent can then fold the result into its own work.

## WoT (Web of Thoughts)

Any running agent can message any other running agent by @tag — a peer worker
or `@porcupine`, the main agent — **live** (audited message bus, injected
into the recipient's context instantly, never gated on reports). The main
agent steers a running worker with `send_to_subagent` — refine the target,
ask for status, redirect mid-task. `peerGroup` is now just an optional status
label. This turns flat fan-out into real coordination: planner/executor/reviewer
patterns, parallel research that merges findings, and agent teams.

Nobody starts blind: a new worker's brief opens with a roster of who else is
active (`@porcupine` plus each peer's @tag and task), and every running peer
gets a one-line notice that the new agent came online.

## Escaping and control

- **Stopping sub-agents**: the MAIN AGENT can stop workers directly with the
  `stop_subagent` tool — one by tag (`stop_subagent { "id": "@buck" }`) or all
  of them (`stop_subagent {}`) — when a worker is stuck, off-track, or no
  longer needed; a stopped run reports `⏹ cancelled` instead of completing.
  The user can also press **Escape** (with an empty editor) to cancel all
  running sub-agents — the session shows `⏹ Sub-agents cancelled`. Session
  abort and teardown also cancel them.
- The footer shows the live sub-agent count to the LEFT of the provider
  (`🧵 2/3 (opencode-go) deepseek-v4-flash • ⚡ Auto • high`). There is no split
  panel — sub-agent state lives entirely in the footer.
- While ANY sub-agent runs, the footer shows their live activity **beside the
  🧵 thread counter**, left of the provider/model: `🤖(📄 Extracting, 🌐 Searching) • 🧵 0/3 • (opencode-go)
  deepseek-v4-flash • 🛡️  Normal • high`, animated, with each worker's tag
  (`🤖(@buck 📄 Extracting, @tinker 🌐 Searching)`). Slot order — position 1 =
  first sub-agent, position 2 = second, … — comma-joined, fully dynamic up to
  `subagent.maxConcurrent`. The status strip stays the main agent's.

## Budgets and verification

- Sub-agents stop at their step/context budget — always check `budgetExhausted`
  in their report.
- Treat sub-agent reports as claims, not facts: verify before trusting (the
  main agent is responsible for the final result).

## Configuration

```json
// ~/.porcupine/agent/settings.json
{
  "subagent": {
    "maxConcurrent": 3,
    "maxSteps": 120,
    "contextWindow": 256000,
    "model": "some-cheaper-model",
    "names": ["buck", "fudgy", "tinker", "rivet", "gizmo"]
  }
}
```

## When to use them

Use a sub-agent for self-contained work that would otherwise pollute the main
context: long research, big refactors, audits, multi-file drafts. Give an exact
task (input paths, deliverable, where to put results) plus notes for
constraints. Workers coordinate live by @tag; tell each worker its peers'
tags in the brief so they can message directly instead of round-tripping
through you.

## Security notes

Sub-agents share your cwd, permission policy, and safety gates — they are not
a sandbox. They cannot ask you questions, and they cannot spawn sub-agents.
Treat their output as untrusted until verified, exactly like any tool output.

## Session persistence: recallable sub-agent runs

Every finished sub-agent run — successful, failed, cancelled, or **budget
exhausted** — is persisted as a **normal session file** in the same store and
JSONL format as main sessions (under `sessions/`). The transcript lives
alongside your own conversation history, tagged with a `type: "subagent"`
header that also carries the sub-agent id, the parent session id, and the task.

### Searchable and recallable

Because sub-agent sessions use the same store and format, they are found by
`session_search` just like main sessions — search by keyword in the transcript,
or open one by id. `session_search` and the `/subagents` slash command
special-case them so they are visible for recall, while **`/resume` and the
session picker deliberately exclude them** (they are for main sessions only).

- `/subagents` — live roster first (how many are working, their @tags, current
  step and activity), then recent sub-agent sessions (id, status, steps,
  started time, task).
- `/subagents <sessionId>` — print a read-only summary of one run (status,
  steps, messages, file path, task).

### Retention and size cap

Each transcript is bounded to ~4MB (earliest messages kept). Only the most
recent 100 sub-agent sessions are retained; older ones are pruned automatically
on a new run. Main sessions are never pruned by this mechanism.

### Recovering a budget-exhausted run

When a sub-agent stops because it hit its step or context budget, its transcript
is still persisted. To pick up where it left off end-to-end:

1. Find the run: `/subagents` (or `session_search` for the transcript content).
2. Note the session id and `file:` path from `/subagents <id>`.
3. Open/replay that transcript in a fresh main session to continue — either
   import the JSONL session file (`/import`) or reconstruct the task from the
   recorded task text, then spawn a new sub-agent with a larger
   `subagent.maxSteps` / `subagent.contextWindow`, or finish the work yourself
   in the main session.

The full transcript is recoverable from the `file:` path even after a crash or
restart, so a drain run is never lost.
