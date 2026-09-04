---
name: subagent
description: Delegate focused, self-contained work to an isolated sub-agent with its own context, budget, and tools.
stack: meta
---

# Sub-agents

Use this skill when a task is self-contained and large enough that doing it inline would pollute the main conversation: long research, multi-file refactors, big drafts, debugging sessions, audits. The `subagent` tool spawns an isolated worker with its own context window (128K–256K), a curated tool set, and hard step/context budgets, then returns a structured report.

> **For the full orchestration loop** (decompose a goal into parallel tracks → targeted briefs → verify → integrate), load `/skill:autonomous-delegation` (stack: orchestration). This skill covers a single spawn; that one covers the whole cycle.

## When to use

- **Delegate**: research, refactors, audits, drafts, debugging — anything where a focused worker with fresh context beats dragging the work through the main transcript.
- **Keep the main context clean**: the sub-agent's tool calls and intermediate results never enter the main conversation; only its report does.
- **Background, non-blocking**: `subagent` returns immediately with an id — the main agent keeps working while the sub-agent runs, and the report is injected **instantly** when it finishes (steered into the running turn if the parent is mid-task, or a fresh turn is started if idle). It never waits for the next user prompt. Up to `subagent.maxConcurrent` sub-agents run concurrently (default 3).

## When NOT to use

- Trivial tasks (a grep, a single read) — call the tool directly; spawning is overhead.
- Work that needs your live context or the user's approval mid-flight (sub-agents cannot ask the user questions).
- Anything requiring interactive tools (ask_question, computer_use) — the sub-agent's curated tool set excludes them.

## How to write a sub-agent task

Be exact. The sub-agent has ONLY what you give it:

1. **Input**: file paths, URLs, repo locations — absolute paths preferred.
2. **Deliverable**: what to produce and exactly where to put it (e.g. "write the report to /tmp/report.md").
3. **Constraints**: do-not-touch paths, budget awareness, format requirements, known gotchas.

Bad: `"investigate the TUI"`. Good: `"Audit interactive-mode.ts for event leaks. Evidence must be file:line quotes. Write findings to /tmp/report.md as your final action — do not end your turn without writing the file."`

## WoT — Web of Thoughts (live peer messaging)

Every sub-agent carries messaging tools and any running agent may message any
other by @tag (`peerGroup` is an optional status label, not a gate):
- **Sub→Sub**: `send_message` (to `@buck` or id) / `check_messages` (drain inbox) — open addressing.
- **Sub→Main**: `send_message` to `@porcupine` (`@main` still works) — injected into the main agent's context **instantly** (steered mid-turn, or a fresh turn when idle), never gated on the report.
- **Main→Sub**: the main agent uses the **`send_to_subagent`** tool to steer any running sub-agent by tag; the message lands in its context before its next step.
- Messages deliver live when the recipient has a running loop (steer); otherwise they queue for `check_messages`. Every routed message is audited on the bus (`session.subagentMessageBus`).

Give peers each other's @tags in the task/notes so they know whom to address.

## Working with the result

- The tool returns immediately with `{ id, name, tag, started, background }` (e.g. tag `@buck`). The report is injected into the conversation **the moment** the sub-agent finishes: mid-turn it is steered into the running agent loop; if the session is idle, a fresh turn starts automatically so the parent processes it without a user prompt — `⚙️ Sub-agent @buck ✓ done after N step(s)` followed by the summary. Use the result to continue your work.
- `budgetExhausted: true` means the sub-agent stopped at its step or context cap — read `summary` for partial progress and re-run with a narrower scope or ask the user to raise `subagent.maxSteps`.
- Verify the sub-agent's claims before trusting them (files may not exist as reported).

## Configuration

- `subagent.model` — cheap/small model (recommended `opencode-go/deepseek-v4-flash`); unset = the parent model.
- `subagent.maxSteps` — default 30; raise (e.g. 120) for heavy audits.
- `subagent.contextWindow` — 128K–256K, default 256K.
- `subagent.maxConcurrent` — default 3; raise or lower via `subagent.maxConcurrent` in `~/.porcupine/agent/settings.json` or by asking the agent.

## Safety

Sub-agents share your cwd, permission policy, and safety gates — Ask mode still confirms their flagged commands. They cannot spawn sub-agents and cannot ask the user questions. Budgets are enforced by run abort, so a runaway sub-agent always stops gracefully. They can also be **stopped manually**: press Escape with an empty editor to cancel all running sub-agents (`⏹ Sub-agents cancelled`); a cancelled run reports `⏹ cancelled` in its injection instead of completing.
