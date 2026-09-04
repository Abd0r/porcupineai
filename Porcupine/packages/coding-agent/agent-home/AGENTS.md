# AGENTS (global context)

Project and user conventions. Loaded into every session as project context.

## Preferences

- Prefer concrete file paths and verified command output.
- Do not invent benchmark numbers, file contents, or URLs.
- Keep changes scoped; no drive-by refactors unless asked.

## Stacks

On real work, `capability_search` first, then pick. Knowing `web_search` or
`bash` is not a skip. If the match is not obvious, `action=list`. Prefer
`web_search` before `web_extract` only after the catalog says that is the route.

## Environment

- Session state lives under `~/.porcupine/agent/` (settings, sessions, memory,
  learning).
- The product is a native-first terminal agent. Isolation (`/sandbox` Gondolin
  micro-VM, Docker, OpenShell) is opt-in, never the default. Full behavior is
  in PROMPT.md and `docs/` (usage, server, subagents, stacks, security,
  containerization).
- Surfaces: Telegram / Discord / iMessage bridges (attended, allowlist-gated;
  owner `!status` / `!tasks` / `!run <taskId>` / `!help`), `--headless` CI
  mode, `porcupine serve` (HTTP API), stacks, and sub-agents.
- Integrations (see the matching `docs/*.md`): email over IMAP/SMTP, free X
  compose-then-paste, Playwright browser. Providers: BYOK catalogs plus a free
  DeepSeek V4 Flash path via Cline (`cline/deepseek/deepseek-v4-flash`, key
  from app.cline.bot).
- Self-authored skills/tools: `/extract-stack` + `/craft-stack` (and
  `craft_skill`/`extract_skill`). Auto-author when a document has a repeatable
  procedure, a tool failure has a clear recovery, or research produced reusable
  steps. See the `skill-crafting` skill. Sub-agent runs are recallable
  (`/subagents`, `session_search`).
- Lifecycle: `/kill` stops the run, bash, sub-agents, and tracked children.
  `/refresh` reloads resources. Session UI: `show_markdown`, `/view`, `/usage`,
  `/cost`, `/memory`, `/init`.

## Stopping / interrupting

- The MAIN AGENT can stop sub-agents with `stop_subagent` (one id, or all)
  when a worker is stuck, off-track, or no longer needed. A stopped run reports
  `⏹ cancelled` instead of completing.
- The user can abort any turn with Escape (`app.interrupt`; the strip shows
  "(esc to interrupt)") and cancel ALL running sub-agents with Escape on an
  empty editor (`⏹ Sub-agents cancelled`). Double-Escape on an empty editor
  opens the session tree (`doubleEscapeAction`, default `tree`). `/quit` exits
  the session.
- The agent never kills its own process; it stops work by ending the turn or
  stopping its sub-agents. Run abort always stops a runaway sub-agent at its
  budget.

## Autonomous Operation

- Act on clear, retrievable work. Verify the requested artifact before calling
  it done.
- Use `ask_question` only for a genuine user-owned choice or missing
  requirement that cannot be retrieved safely. Do not use it to avoid routine
  next steps.
- `/plan` is inspection-only and returns an implementation-ready artifact;
  `/goal` is a bounded session loop; `/task` and `/cron` are durable local
  state. Cron fires only while Porcupine is open and idle. Never present it as
  a daemon.
- Delegate with `subagent`: fresh context (128K-256K), the whole tool stack
  minus agent-level tools, product default `subagent.maxSteps` 120, up to
  `subagent.maxConcurrent` (product default 3). Verify reports. WoT: @tags
  plus `send_to_subagent`. See the `subagent` skill.

## Safety Boundaries

- Modes (Ask / Normal / Auto) govern approvals; reasoning effort does not.
- Native-first: no built-in process sandbox. Isolation is opt-in (container,
  Gondolin, VM).
- Project trust controls resource loading, not shell or file permissions.
  Trusted is not the same as safe against injection.
- Hardline destructive actions stay blocked in every mode. Never weaken a
  guard or work around a denial.
