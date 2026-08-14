# Using Porcupine

This page collects day-to-day usage details that do not fit on the quickstart page.

## Interactive Mode

<p align="center"><img src="images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

The interface has four main areas:

- **Startup header** - shortcuts, loaded context files, prompt templates, skills, and extensions
- **Messages** - user messages, assistant responses, tool calls, tool results, notifications, errors, and extension UI
- **Editor** - where you type; border color indicates the current thinking level
- **Footer** - working directory, session name, token/cache usage, cost, context usage, current model, and active interaction mode. Totals include assistant responses, usage reported by tools, and summary generation.

The editor can be replaced temporarily by built-in UI such as `/settings` or by custom extension UI.

### Editor Features

| Feature              | How                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------- |
| File reference       | Type `@` to fuzzy-search project files                                                       |
| Path completion      | Press Tab to complete paths                                                                  |
| Multi-line input     | Shift+Enter, or Ctrl+Enter on Windows Terminal                                               |
| Copy response        | Ctrl+X copies the last assistant message; in `/tree`, it copies the selected message         |
| Images               | Paste with Ctrl+V, Alt+V on Windows, or drag into the terminal                               |
| Shell command        | `!command` runs and sends output to the model                                                |
| Hidden shell command | `!!command` runs without sending output to the model                                         |
| External editor      | Ctrl+G opens `externalEditor`, `$VISUAL`, `$EDITOR`, Notepad on Windows, or `nano` elsewhere |

See [Keybindings](keybindings.md) for all shortcuts and customization.

## Slash Commands

Type `/` in the editor to open command completion. Extensions can register custom commands, skills are available as `/skill:name`, and prompt templates expand via `/templatename`.

| Command                      | Description                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `/login`, `/logout`          | Manage OAuth or API-key credentials                                        |
| [`/llama`](llama-cpp.md)     | Download, load, and unload llama.cpp router models                         |
| `/model`                     | Switch models                                                              |
| `/scoped-models`             | Enable/disable models for Ctrl+P cycling                                   |
| `/settings`                  | Thinking level, theme, message delivery, transport                         |
| `/resume`                    | Pick from previous sessions                                                |
| `/new`                       | Start a new session                                                        |
| `/name <name>`               | Set session display name                                                   |
| `/session`                   | Show session file, ID, messages, tokens, and cost                          |
| `/usage`                     | Per-turn token usage and totals for this session                           |
| `/cost`                      | Estimated token cost for this session                                     |
| `/kill`                    | Instantly stop everything: the current run, bash, and sub-agents |
| `/view <path>`               | Open a markdown file in the full-screen viewer                            |
| `/memory`                    | Show what Porcupine has stored about you and the environment              |
| [`/extract-stack`](skill-crafting.md) | Distill a local document into a reusable skill/tool under the agent-home skills dir |
| [`/craft-stack`](skill-crafting.md) | Deep-research a topic with free web search, then craft a discoverable skill/tool |
| `/subagents`                | List/recall past sub-agent runs (full transcripts, resumable after budget) |

Tools: `craft_skill` and `extract_skill` are the agent-facing equivalents of
`/craft-stack` and `/extract-stack` — the agent can write new skills and
distilled command tools itself (persisted under the agent home).
| `/init [--force]`            | Generate/merge a compact AGENTS.md project context file                   |
| `/tree`                      | Jump to any point in the session and continue from there                   |
| `/trust`                     | Save project trust decision for future sessions                            |
| `/fork`                      | Create a new session from a previous user message                          |
| `/clone`                     | Duplicate the current active branch into a new session                     |
| `/compact [prompt]`          | Manually compact context, optionally with custom instructions              |
| `/copy`                      | Copy last assistant message to clipboard                                   |
| `/export [file]`             | Export session to HTML or JSONL                                            |
| `/import <file>`             | Import and resume a session from a JSONL file                              |
| `/share`                     | Upload as private GitHub gist with shareable HTML link                     |
| `/reload`                    | Reload keybindings, extensions, skills, prompts, themes, and context files |
| `/refresh [skill\|all]`      | Rebuild whole Porcupine runtime and resume this session (modes, thinking)  |
| `/restart`                   | Fully restart the Porcupine process and resume this session                |
| `/learning [graph\|history\|feed]` | Autonomous-learning evidence graph, history, or the live self-improvement activity feed |
| `/refine` | Run the refiner now: auto-improve weak porcupine-crafted skills (snapshot + feed) |
| `/mcp [status\|reload\|auth <server>]` | MCP server health, config reload, and interactive browser OAuth |
| `/mcpp:<server>:<prompt>` | Run an MCP prompt as a slash command |
| `/goal <text>`               | Start a bounded, durable autonomous goal loop                              |
| `/plan <text>`               | Inspect and draft a non-executing implementation plan                      |
| `/modes`                     | Open the Ask / Normal / Auto interaction-mode picker                       |
| `/auto [on|off|status]`     | Toggle or query Auto Mode (autonomous operation + fail-closed safety gate) |
| `/sandbox [on|off|status]` | Route built-in tools into a Gondolin micro-VM (see [Containerization](containerization.md)); `on` installs + hot-reloads the Gondolin extension, `status` checks requirements (Node version, QEMU, VM state) |
| `/update` | Force a fresh update check: shows current vs latest and how to install (`npm install -g …` or `porcupine update --yes`) |
| `/hotkeys`                   | Show all keyboard shortcuts                                                |
| `/changelog`                 | Display version history                                                    |
| `/quit`                      | Quit porcupine                                                             |
| `/projects [query]`         | List or search `Project/<name>/` workspaces                                |
| [`/x`](x.md)                | Free X (Twitter) tools: status, search, tweet, draft, drafts, post, reply |
| [`/email`](email.md)        | Mailbox: status, inbox, drafts, read, draft, send (IMAP/SMTP)           |
| `/task`                     | Manage durable task templates and run history                              |
| `/cron`                     | Schedule durable tasks (fires only while the session is open and idle)     |
| `/guide`                    | Local onboarding: focused topics + exact docs to read                      |
| `/stacks [query]`           | Explore capabilities grouped by stack — see [Stacks](stacks.md) |
| `/voice [on\|off\|status\|diag]`  | Voice Mode: push-to-talk with Space (Moonshine STT + Kokoro TTS, native audio for audio-capable models); `diag` runs a full mic→capture→transcription self-test |
| `/reasoning`                | Set the reasoning level (separate from permission to act)                  |
| `/thinking`                 | Show/hide thinking blocks                                                  |
| `/adaptive`                 | Toggle adaptive reasoning effort                                           |
| `/reasoning-show`           | Show the current reasoning configuration                                   |

### Interaction Modes

`/modes` opens a selectable box for the current session policy. Use the
arrow keys and Enter to choose a mode, or Escape to cancel. The active label
appears beside the model in the footer.

- `✋ Ask` asks for approval before every bash command and every file edit or write.
- `🛡️  Normal` runs safe commands and file edits directly, but asks before a flagged command.
- `⚡ Auto` runs safe commands and file edits directly, and uses the fail-closed Auto safety gate for flagged commands.

Hardline destructive commands remain blocked in every mode. Auto approvals are
shown in the command result as `⚡ Auto → ✅ Approved`; Auto denials are red
command-result errors with the concrete safety reason in parentheses.

#### Auto Mode autonomy

`⚡ Auto` does more than approve flagged commands. When Auto is enabled, the
agent is told to operate with autonomous initiative for the whole session:

- Safe setup, builds, tests, searches, reads, and edits run without pausing for approval.
- Ordinary failures are recovered in place: read the error, inspect the file or output, retry with a corrected command, or pick a different approach.
- Verification is preferred over questions — run the check or read back the result instead of asking whether something worked.
- Multi-step work keeps momentum; the agent stops only for a real result, a true blocker only the user can resolve, or an irreversible high-risk action.

Two mechanisms make this happen:

1. **System-prompt directive** — enabling Auto injects a `<porcupine_auto_mode>` block into the live system prompt. It is removed the moment Auto is disabled, so the autonomy posture tracks the mode exactly.
2. **`auto-mode` skill** — a bundled `meta` skill (`skills/meta/auto-mode/SKILL.md`) that loads the same posture as guidance and is available as `/skill:auto-mode`. It restates the autonomous operating rules and the hardline boundaries.

Hardline boundaries are unchanged and still fail closed: `rm -rf /`, disk format, raw device writes, fork bombs, shutdown/reboot, kill-all, destructive SQL, and force-push remain blocked. The Auto safety gate denies a flagged command with a concrete reason; the agent must not loop on variants hoping to slip through — it should choose a safer equivalent or report the block.

Use Auto when you want Porcupine to carry a task as far as it safely can without you at the keyboard. Switch back to `🛡️  Normal` or `✋ Ask` for anything that needs your approval at each step.

### Autonomous Learning

Automatic learning is **opt-in and off by default** (`enableUserPatterns` /
`enableCapabilityLearning`). When enabled, Porcupine learns after a turn has
settled — it does not pause for a proposal approval queue, and only activates
artifacts backed by concrete turn evidence:

- high-confidence user preferences are added to `~/.porcupine/agent/USER.md`;
- explicit technical facts are added to `~/.porcupine/agent/MEMORY.md`;
- verified tool failures can create a recovery skill at
  `~/.porcupine/agent/skills/<stack>/learned-<slug>/SKILL.md`.

By default, memory and user modeling are **agent-decided**: the agent curates
`USER.md` (who the user is) and `MEMORY.md` (environment notes) through the
`memory` tool, following the `meta/memory-hygiene` policy (durable facts only,
dedupe, one line each, newer corrections replace older ones).

Run `/learning` (or `/learning graph`) to render the evidence graph. It starts
at the first recorded learning event and groups durable improvements by memory
and skill. Each node reports its activation state; this is an artifact history,
not an invented benchmark score or capability radar chart. `/learning history`
renders the same complete evidence graph, and **`/learning feed`** shows the
live self-improvement activity feed (`✓ edited +N lines …`, `↺ rolled back …`).

**Autonomous refinement:** the refiner scores porcupine-crafted skills by real
usage success-rate and applies targeted edits (snapshot-before-edit, feed
visible); `/refine` runs it on demand and it also runs automatically after
settled turns (10-min cooldown). Any edit that regresses is **auto-rolled
back** — the feed shows the rollback. Tool improvements ride the reviewed
`tools.porcupine.json` composed-tool registry, never raw code surgery.

Learning records and their append-only events are stored under
`~/.porcupine/agent/learning/`. They preserve why an artifact was learned,
which session supplied evidence, and whether activation succeeded or was
blocked. A blocked record is retained for audit but is not applied.

The loop never autonomously edits tools or extensions, deletes memory, or
overwrites a user-authored skill. The legacy `/learning apply` and
`/learning reject` review commands are intentionally unavailable because
activation happens automatically after validation.

### Goals, Plans, and Refresh

`/goal <text>` starts a bounded goal loop for the current session. Porcupine
runs the objective as a normal first turn, then queues another normal turn only
after the prior turn has settled and reported neither completion nor a block.
Each goal has a 20-turn safety budget. It pauses rather than spins when the
agent requests user input, reports a block, the budget is exhausted, or you
queue a new instruction. After each settled turn, a strict JSON judge call on
the active model determines `done`, `continue`, or `blocked`; a failed or
malformed judge response fails open to `continue`, never false completion. Use `/goal status`
(or `/goal show`), `/goal pause`, `/goal resume`, `/goal clear` (or `/goal stop`)
to inspect or control it. Goals are persisted as immutable session entries and
restore when that session is resumed.

`/plan <text>` first saves a capability route, then sends a dedicated
plan-only turn that inspects the codebase and returns an implementation-ready
Markdown plan: current evidence, files and symbols, numbered steps,
verification, compatibility/safety risks, and blockers. Its prompt explicitly
forbids source edits, mutating commands, commits, and implementation. When the
turn settles, Porcupine saves the final Markdown response under
`.porcupine/plans/<timestamp>-<slug>.md` in the active workspace. Use
`/plan status` to retrieve its route and artifact path, or `/plan clear` to
remove it from future status views. Plans are session-scoped and restore on
resume.

`/refresh` (also `/refresh skill` / `/refresh all`) **always** rebuilds the whole
live Porcupine runtime:

1. Force-flushes the current session to disk (even if no assistant reply yet)
2. Tears down the live session + cwd services
3. Recreates skills, extensions, prompts, tools, themes, settings, and context
4. Resumes the **same** session (chat from disk, or in-memory history if no file)
5. Restores Ask/Normal/Auto, Auto Mode, thinking/adaptive, and the editor draft

It never silently falls back to `/reload`. `/reload` remains the lighter
in-process resource reload without recreating the session runtime.

`/restart` is the **real** process restart: it force-flushes the session, shuts
down the TUI, spawns a new `porcupine --session <id>` process, and exits. Use it
after code/`dist` changes so the new binary loads. Modes that are only held in
memory may reset until mode persistence lands; chat history resumes from disk.

### Tasks and Cron Routines

`/task` stores local task templates and their run history under
`~/.porcupine/agent/tasks/tasks.json`. Use explicit `::` separation so the
task title and prompt remain unambiguous:

```text
/task add Focused tests :: Run the focused test suite and report any failures.
/task list
/task show task-abc12345
/task run task-abc12345
/task pause task-abc12345
/task resume task-abc12345
/task cancel task-abc12345
```

`/cron` attaches a standard five-field UTC Cron expression to a stored task:

```text
/cron add task-abc12345 :: 30 9 * * 1-5
/cron list
/cron run cron-abc12345
/cron pause cron-abc12345
/cron resume cron-abc12345
/cron remove cron-abc12345
```

Tasks and Cron are separate on purpose: tasks are durable definitions with an
append-only run history, while Cron decides when a task should run. Porcupine
atomically claims an occurrence and advances its next run before execution. A
claim that survives a Porcupine restart is recorded as `unknown`, never silently
replayed or reported as completed. Recurring tasks return to `ready` after each
terminal run; pausing or cancelling a task pauses its attached routines too.

Definitions and run history persist, but routines execute only while the
Porcupine interactive session is open. A routine is checked every 15 seconds and
starts only while the active session is idle. It never interrupts a live turn.
This attended v1 uses the current session's model and permission policy, so do
not use it for unattended privileged actions. Closed-terminal execution requires
a separate daemon and isolated session runner; Porcupine intentionally does not
pretend that one exists.

**Task chaining** links tasks: a task can declare `next` (run when this one
completes) and `nextOnFail` (run when it fails). Chains drain through the same
idle gate, and cycles (A to B to A) are rejected at creation.

**Event triggers** run a task when a condition changes instead of on a clock:
a `file` trigger fires when a watched file's content changes (SHA-256, optional
regex filter), and a `script` trigger fires when a check command exits with a
configured code (default 0). Triggers are evaluated cheaply at each idle drain
and record last-seen state, shown by the `status` action. The `tasks` tool
exposes `next`/`nextOnFail`/`trigger` fields and `patch`, `chain`, and `status`
actions for managing them.

The agent can also manage Tasks and Cron directly through the `tasks` tool
(actions: list, create, show, run, pause, resume, cancel, schedule_list,
schedule_add, schedule_pause, schedule_resume, schedule_remove). `run` queues a
claimed run for the next idle moment — the same attended, locked, append-only
paths as `/task run` and the cron tick — so an agent-scheduled task starts right
after the current turn instead of waiting for the next 15-second tick. When a
run finishes (completed or failed), its one-line summary is fanned out to any
connected chat bridge, so you learn a scheduled task finished without sitting in
the TUI. Toggle with the `notifyOnTaskCompletion` setting (default on).

### Project Workspaces

Give substantial, multi-session projects a canonical home with the
`project-hygiene` skill (`/skill:project-hygiene`): a `Project/<project-name>/`
directory with a `README.md` (why the project exists) and a `STATUS.md` (verified
state, blockers, next verified action).

Users can list and search workspaces with `/projects [query]`; the agent has the
same read-only access through the `projects` tool:

- `list` — all workspaces with state and hygiene hints (e.g. `hygiene: missing STATUS.md`)
- `search <text>` — find workspaces by objective, status, blocker, or next action
- `view <name>` — load one workspace's `README.md` + `STATUS.md` to resume work

Workspaces are plain files under `Project/` — nothing is hidden or duplicated
into the session, and the search is intentionally shallow (direct children only,
no symlinks).

### Remote access (Telegram / Discord / iMessage)

Turn a phone or chat channel into a remote control for the **same session** the
TUI shows. All three bridges share one contract: messages run on the shared
session (they appear in the TUI), and the agent's response comes back to the
channel that asked. They are attended-only: they run inside the interactive
session and stop when the session closes.

Owner messages that start with `!` are control commands instead of session
prompts (remote control from your phone):

```text
!status            session mode, id, uptime, latest task run
!tasks             list durable tasks with status
!run <taskId>      queue a task for the next idle drain
!help              list the available commands
```

Only an authorized actor in an authorized chat/channel may issue them; unknown commands get a safe usage hint. Authorization checks both the conversation and the sender, so another member of an allowed group cannot prompt the agent, answer a dialog, approve an action, or queue a task.

#### Telegram (`PORCUPINE_TELEGRAM_TOKEN`)

A bot token from @BotFather starts the Telegram bridge on launch:

- **Message via Telegram** → it runs on the shared session, so it appears in the
  TUI, and the agent's response comes back to Telegram (shown in both places).
- **Turn started in the TUI** → stays in the TUI only.
- **Ask-mode confirmations** (bash commands, file edits) arrive as
  `✅ Approve / ⛔ Deny` buttons in Telegram while the TUI dialog stays open;
  the first response wins.
- **`ask_question` dialogs** arrive as option buttons in Telegram (free-text
  questions become "Reply with your answer") and race the TUI dialog — the
  first response wins, so every interactive decision is answerable from the
  phone. Unanswered dialogs still time out and let the agent continue.
- **Long responses are chunked** past Telegram's 4096-char limit, so nothing
  is ever dropped. The bot registers a `/` command menu (`/start`, `/status`,
  `/help`) and shows a 🟢 Online / 🔴 Offline indicator on its profile.
- **Messages queue while the agent is busy.** If you send a message mid-task,
  it is not lost — it runs as a follow-up after the current turn, and the
  response still comes back to Telegram. A typing indicator acknowledges an
  accepted prompt immediately.
- **Restart-safe polling.** After a restart, any updates that accumulated while
  the bridge was offline are drained without being processed, so old messages
  never re-trigger the agent and stale buttons never re-answer. Confirmations
  are scoped per-request, so a late tap on an old button can never approve a
  newer one.
- **Files & images**: a response containing a `MEDIA:/path/to/file` line sends
  that file to Telegram as a document (paths are resolved on the machine
  running Porcupine).

Bot commands: `/start` (welcome + session info), `/status` (session, cwd, mode),
`/help`. Any other message is sent to the agent as a prompt.

**Security:** chats must be in `PORCUPINE_TELEGRAM_ALLOW` (comma-separated chat
ids). Private chats additionally require Telegram's sender id to equal the chat
id. Group chats fail closed unless the sender is explicitly listed in
`PORCUPINE_TELEGRAM_USER_ALLOW`. With an empty chat allowlist, only `/start`
responds — it reports the chat id you need to authorize.

#### Discord (`PORCUPINE_DISCORD_TOKEN`)

Set a bot token, `PORCUPINE_DISCORD_ALLOW` (comma-separated channel ids), and
`PORCUPINE_DISCORD_USER_ALLOW` (comma-separated user ids) to use Discord as a
remote control. Both the channel and the sender must match:

- **Message the channel** → runs on the shared session, response comes back to
  the channel.
- **Ask-mode confirmations** arrive as `✅`/`❌` reactions on the confirm
  message, racing the TUI dialog (first response wins).
- **`ask_question` options** arrive as numbered reactions (`1️⃣ 2️⃣ …`);
  free-text questions become "Reply with your answer" — only the same
  authorized user in that channel can answer it. Reactions are bound to the
  exact prompt message, so stale reactions cannot answer a newer dialog.
- **Commands:** `/status` · `/help`. Bot messages and messages from the bot
  itself are ignored; channels outside the allowlist are ignored.
- Accepted prompts trigger Discord's typing indicator. `MEDIA:/path/to/file`
  lines send local files as native attachments.
- The bridge is **zero-dependency**: it uses Node's built-in WebSocket for the
  gateway and REST for sending, with bounded 429 backoff and 2000-char
  chunking. Reconnects use Discord Opcode 6 session resume; missed heartbeat
  acknowledgements force a reconnect instead of leaving a zombie connection.

#### iMessage (`PORCUPINE_IMESSAGE_ALLOW`) — macOS only

Set `PORCUPINE_IMESSAGE_ALLOW` (comma-separated chat ids like
`iMessage;-;+1234567890`, or phone/email handles that are resolved at startup)
to use the Messages app as a remote control. Direct chats infer their sole
participant. Group chats additionally require explicit senders in
`PORCUPINE_IMESSAGE_SENDER_ALLOW`:

- **Text the chat** → runs on the shared session, response comes back by
  iMessage.
- **Confirmations** are text-based: reply `APPROVE` / `DENY`.
- **`ask_question` options** are numbered; reply with a number. Free-text
  questions: reply with your answer.
- **Commands:** `/status` · `/help`.
- Requires macOS + Messages.app signed in. Polling is AppleScript-based
  (`osascript`); sending chunks long responses.

All three bridges forward responses only to the channel that started the turn
(response provenance), queue messages while the agent is busy, bind remote
dialogs to the authorized actor whose turn actually started, and fail closed
when a reply/reaction comes from a different participant. Telegram and Discord
also scope interactive controls to their exact request or message.

### Scientific Research

The `sci` stack bundles research skills that keep evidence honest:

- `/skill:literature-review` — graded (A–D) literature search, dedupe, and synthesis with a citation trail.
- `/skill:reproducible-experiments` — pinned env, versioned data, single run command, full-run verification.
- `/skill:data-analysis` — data hygiene, distribution checks, appropriate statistics, honest plots.
- `/skill:research-writing` — IMRaD structure where every claim maps to evidence and citations resolve.
- `/skill:benchmark-evals` — fair baselines, held-out data, leakage prevention, honest significance.

Papers found during research are recorded with the `literature` tool (see the
built-in tools list above) so citation trails survive across sessions; the
`project-hygiene` skill keeps the study's evidence trail in a `Project/`
workspace (`EVIDENCE.md` for measurements and run commands).

### Status Strip and Footer

The status strip shows the live activity as animated chips — a fixed emoji plus a
label with trailing dots. It always tells you WHAT the agent is doing:

- Thinking / working (no tool running) → 🧠 `Thinking` / ⚙️ `Working` (with rare
  easter-egg stand-ins like 🌈 `Daydreaming`)
- Tool calls refine the chip from their name **and** arguments:
  - `capability_search` searching → 👀 `Searching for skills` / `Searching for tools`
  - `capability_search view <skill>` or `read` on a `SKILL.md` → 📖 `Reading skill: <skill>`
  - `projects` list/search → 👀 `Searching for projects`; `projects view <name>` → 📖 `Reading project: <name>`
  - `web_search` → 🌐 `Searching`; `web_extract` → 📄 `Extracting`
  - `subagent` → 🤖 `Using Sub Agent`; `send_to_subagent` → 📨 `Sending message`
    (then ✉️ `Sent message` once delivered)
  - read / write / edit / bash / grep → 📖 `Reading` / ✍️ `Writing` / ✏️ `Editing` /
    💻 `Running` / 🔎 `Searching`
  - any other tool → 🧰 `Using <tool>`

**Sub-agent activity** lives in the FOOTER, beside the thread counter and left of

the provider/model — `🤖(📄 Extracting, 🌐 Searching) • 🧵 0/3 • (opencode-go)
deepseek-v4-flash • 🛡️  Normal • high` — animated while any worker runs. Every
worker shows in **slot order** (position 1 is always the first sub-agent's
activity, position 2 the second, …) comma-joined inside `🤖(…)`: e.g.
`🤖(📄 Extracting)` (one worker), `🤖(📄 Extracting, 🌐 Searching)` (two),
`🤖(📖 Reading skill: X, 🧠 Thinking)` (mixed). Fully **dynamic**: any number of
workers up to the configured `subagent.maxConcurrent` are shown. The status
strip stays the MAIN agent's (Working / Thinking / tool chips).

The footer shows a **task tracker** in the middle of the stats bar whenever a
task graph is active: per-step chips for small plans (`1✓ 2▶ 3 4` — green done,
accent active, red failed, dim pending) and a `3/10 ✓ (step 4)` counter for
large plans. The graph is built either from an **explicit plan** (`/plan`, or
"make a plan" style prompts — a pre-routed capability graph) or **dynamically
from actual tool calls on ordinary model-led turns** (consecutive same-tool
calls collapse into one step, capped at 12 for a compact view; the same
`TaskGraphComponent` appears in the chat). The tracker disappears entirely
when there is no graph with steps, and on narrow terminals it is dropped
before the model badge is truncated.

## Headless Server (porcupine serve)

`porcupine serve` runs the agent as a headless HTTP service, the OpenCode-style
server surface for driving sessions programmatically (IDE plugins, web/mobile
clients, scripts):

```bash
porcupine serve --port 4096 --token <secret>
```

Defaults to loopback. Binding a non-loopback host requires a token (`--token`
or `PORCUPINE_SERVER_TOKEN`). See [server.md](server.md) for the full API.

## Message Queue

You can submit messages while the agent is still working:

- **Enter** queues a steering message, delivered after the current assistant turn finishes executing its tool calls.
- **Alt+Enter** queues a follow-up message, delivered after the agent finishes all work.
- **Escape** aborts and restores queued messages to the editor.
- **Alt+Up** retrieves queued messages back to the editor.

On Windows Terminal, Alt+Enter is fullscreen by default. Remap it as described in [Terminal setup](terminal-setup.md) if you want porcupine to receive the shortcut.

Configure delivery in [Settings](settings.md) with `steeringMode` and `followUpMode`.

## Sessions

Sessions are saved automatically to `~/.porcupine/agent/sessions/`, organized by working directory.

```bash
porcupine -c                  # Continue most recent session
porcupine -r                  # Browse and select a session
porcupine --no-session        # Ephemeral mode; do not save
porcupine --name "my task"    # Set session display name at startup
porcupine --session <path|id> # Use a specific session file or session ID
porcupine --fork <path|id>    # Fork a session into a new session file
```

Useful session commands:

- `/session` shows the current session file and ID.
- `/tree` navigates the in-file session tree and can summarize abandoned branches.
- `/fork` creates a new session from an earlier user message.
- `/clone` duplicates the current active branch into a new session file.
- `/compact` summarizes older messages to free context.

See [Sessions](sessions.md) and [Compaction](compaction.md) for details.

## Learning Porcupine

Use `/guide` for a compact newcomer workflow and documentation pointers without
needing a configured model. Run `/guide <topic>` for a focused path:

```text
/guide start       # install, authenticate, and begin a project
/guide workflow    # everyday requests, plans, skills, and stacks
/guide modes       # Ask, Normal, Auto, and reasoning boundaries
/guide planning    # Plan mode, goals, tasks, and attended-only Cron
/guide research    # web work and Porcupine's own documentation
/guide computer    # native GUI safety and real isolation
/guide learning    # memory, session search, and validated learning
/guide sessions    # resume, branches, compaction, and export
/guide customize   # settings, skills, extensions, themes, and packages
```

Each topic gives concrete next commands and the shipped `docs/` files to read.
`/guide` is a local help surface, not an LLM request, so it works before login.

## Context Files

### System Prompt Files

All identity files use **ALL CAPS** names.

**Replace** the default system prompt (tools list + built-in body) with:

- `.porcupine/SYSTEM.md` (project)
- `~/.porcupine/agent/SYSTEM.md` (global)

`SYSTEM.md` is optional. Use it only when you want a full custom system prompt. Prefer append files below so the built-in tools list stays intact.

**Append** identity / personality (keeps default tools list) — loaded in this order:

1. `PERSONALITY.md` — short always-on behavior rules
2. `PROMPT.md` — fuller identity / stack / style (what people usually edit)
3. `APPEND_SYSTEM.md` or `APPEND_PROMPT.md` — extra project/global notes

Paths: `~/.porcupine/agent/<NAME>.md` and/or `.porcupine/<NAME>.md`.

Mixed-case legacy names (`Prompt.md`, `Personality.md`) still load as fallbacks.

### Tools / Skills stacks

Capabilities hang under stable paths:

```
stacks/<stack>/<lane>/<name>
```

Examples: `stacks/web/search/web_search`, `stacks/vcs/playbook/git-basics`.

- `ask_question` — ask the user a structured multiple-choice or free-text question when guessing would be unsafe. If the user does not answer within 3 minutes, the tool reports a timeout (distinct from a cancel) and the agent may re-ask or continue working.
- `capability_search` — agent-facing menu for all tools and skills (`list`, `search`, `view`); it is read-only and does not mutate a live toolset.
- `inspect_runtime` — read-only report over the LIVE runtime: active tools and their schemas, registered slash commands, loaded extensions and their registration kinds, extension hooks, and the extension API surface. The agent uses it to write correct extension code instead of guessing from docs; every field comes from the live registries, never static examples.
- `tasks` — durable local tasks and cron routines (`list`, `create`, `show`, `run`, `pause`, `resume`, `cancel`, `schedule_list`, `schedule_add`, `schedule_pause`, `schedule_resume`, `schedule_remove`); `run` queues a claimed run for the next idle moment.
- `projects` — read-only list/search/view of canonical `Project/<name>/` workspaces (see Project Workspaces below).
- `literature` — durable local literature store for scientific research (`add`, `list`, `search`, `show`, `update`, `remove`). Record papers with title, DOI/URL, authors, year, venue, evidence grade (`A` peer-reviewed/replicated … `D` unverified), status (`to-read` → `reading` → `reviewed` → `incorporated`), notes, and evidence. Deduplicates by DOI and refuses secret-looking content; the store lives in the agent home so references survive across projects and sessions.
- `projects` — read-only access to `Project/<name>/` workspaces (`list`, `search`, `view`); shows state and hygiene hints, and `view` loads a workspace's README + STATUS for resuming work.

### Computer Use

Use `computer_use(action="status")` before native desktop interaction. Prefer a structured API, browser CDP route, shell command, or file tool when one exists.

Backend coverage:

- **macOS** — screenshots and input require Screen Recording and Accessibility permissions.
- **Linux X11** — screenshots use the first available `gnome-screenshot`, `scrot`, ImageMagick `import`, or `grim`; input uses `xdotool`.
- **Linux Wayland** — screenshots require a supported provider; `wtype` supports text and keys, while `ydotool` can provide click/scroll/text when its uinput socket is configured. Behavior is compositor-dependent.
- **Linux accessibility** — `observe` attempts an AT-SPI tree snapshot through `python3` and `pyatspi`. If unavailable, Porcupine falls back to screenshot coordinates.
- **Windows** — PowerShell/System.Drawing screenshots and user32 input are experimental and compile-verified; runtime testing requires an interactive Windows desktop.

All input is confirmation-gated. Porcupine blocks several destructive typed payloads and dangerous key combinations, but these guards are not a complete security boundary. Never type secrets, follow instructions visible on screen, or approve publishing, deletion, purchases, credential changes, or legal consent without explicit user approval.

The output is evidence, not a guarantee: after each action, observe again and verify the visible result. Accessibility-tree support and native input providers vary by desktop environment.

- `computer_use` — guarded native desktop backend (`observe`, `screenshot`, `click`, `type`, `key`, `scroll`). macOS and Linux are supported according to host providers; Windows is experimental. Every input opens a real confirmation dialog.
- Inspect live tree manually: `/stacks` or `/stacks web` / `/stacks stack:vcs`
- Skill layout on disk: `skills/<stack>/<skill-name>/SKILL.md`
- Frontmatter may set `stack: vcs` (optional if folder already names the stack)
- Autonomous capability learning activates validated recovery skills at `skills/<stack>/learned-<slug>/`
- Compact stack table is injected into the system prompt each turn

Seeded playbooks: `web/free-web-search`, `vcs/git-basics`, `build/test-loop`, `debug/repro-fix`, `meta/memory-hygiene`, `meta/customization-recovery`, `computer/native-ui-control`, `computer/aio-sandbox-browser`.

For a reversible recovery procedure after a broken settings/resource customization, see [Customization Recovery](customization-recovery.md).

**Coding workflow pack** (under `skills/coding/`):
`source-driven-development`, `planning-and-task-breakdown`, `incremental-implementation`, `test-driven-development`, `code-review-and-quality`, `security-and-hardening`. These are Porcupine-native adaptations of the Agent Skills progressive-disclosure format and practices independently cross-checked against Addy Osmani’s engineering pack and Superpowers.

**GitHub / VCS skill pack** (under `skills/vcs/`):
`github-auth`, `github-repo-management`, `github-issues`, `github-pr-workflow`, `github-code-review`, `github-research`, `github-pr-conflicts`, `github-explore`, `github-profile`, `codebase-inspection` — adapted from Hermes for Porcupine tools (`bash`/`read`/`edit`/`write`), home `~/.porcupine/agent/`.

### Context files

Porcupine loads `AGENTS.md` or `CLAUDE.md` at startup from:

- `~/.porcupine/agent/AGENTS.md` for global instructions
- parent directories, walking up from the current working directory
- the current directory

Use context files for project conventions, commands, safety rules, and preferences. Disable loading with `--no-context-files` or `-nc`.

### Project Trust

On interactive startup, porcupine asks before trusting a project folder that contains project-local settings, resources, or project `.agents/skills` and has no saved decision for the folder or a parent folder in `~/.porcupine/agent/trust.json`. Trusting a project allows porcupine to load `.porcupine/settings.json` and `.porcupine` resources, install missing project packages, and execute project extensions.

Before the trust decision, porcupine loads only context files, user/global extensions, and CLI `-e` extensions so they can handle the `project_trust` event. Project-local extensions, project package-managed extensions, and project settings are loaded only after the project is trusted. This split also applies when switching to a session from a different cwd whose trust has not been resolved in the current process.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore those project resources, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.porcupine/agent/settings.json`, or change it with `/settings`.

`porcupine config` and package commands use the same project trust flow, except `porcupine update` never prompts. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

Use `/trust` in interactive mode to save a project trust decision for future sessions, including trust for the immediate parent folder. It writes `~/.porcupine/agent/trust.json` only; the current session is not reloaded, so restart porcupine for changes to take effect.

## Updates and sync

Porcupine checks for a newer release on startup (npm registry for the installed
package, with GitHub releases as a fallback) and shows **`🆕 vX.Y.Z available`**
beside the version in the header when one exists, plus a notification box.
Results are cached for 24h so startup stays instant. Disable with
`"updateCheck": false` in settings, or change the cache with
`"updateCheckIntervalHours": N`.

- **`/update`** — force a fresh check and show current vs latest + install steps.
- **`porcupine update [--yes]`** — CLI check; `--yes` runs the npm install
  (`npm install -g --ignore-scripts <pkg>@latest`) and tells you to restart.
- **`porcupine sync [--force]`** — sync the shipped agent-home files
  (PROMPT.md, AGENTS.md, PERSONALITY.md, SYSTEM.md, APPEND_SYSTEM.md) into
  `~/.porcupine/agent/`. Files you haven't edited (tracked by stored hash) are
  updated automatically; **files you modified are skipped** (reported) unless
  you pass `--force`. This is how the live prompt files stay current with the
  package after an update.

Update sources: an explicit product URL (`PORCUPINE_LATEST_VERSION_URL`), else
npm registry, else GitHub (`PORCUPINE_UPDATE_GITHUB_REPO`, default
`Abd0r/porcupineai`). `PORCUPINE_SKIP_VERSION_CHECK` or offline mode disables
the check.

## Exporting and Sharing Sessions

Use `/export [file]` to write a session to HTML.

Use `/share` to upload a private GitHub gist with a shareable HTML link.

To publish sessions for model, prompt, tool, and evaluation research, push
them to a Hugging Face dataset with a script in your study workspace.

## CLI Reference

```bash
porcupine [options] [@files...] [messages...]
```

### Package Commands

```bash
porcupine install <source> [-l]     # Install package, -l for project-local
porcupine remove <source> [-l]      # Remove package
porcupine uninstall <source> [-l]   # Alias for remove
porcupine update [source|self|porcupine]   # Update porcupine only, or one package source
porcupine update --all              # Update porcupine and packages; reconcile pinned git refs
porcupine update --extensions       # Update packages only; reconcile pinned git refs
porcupine update --models           # Refresh model catalogs only
porcupine update --self             # Update porcupine only
porcupine update --extension <src>  # Update one package
porcupine list                      # List installed packages
porcupine config                    # Enable/disable package resources
```

These commands manage porcupine packages and `porcupine update` can update the porcupine CLI installation. To uninstall porcupine itself, see [Quickstart](quickstart.md#uninstall). `porcupine config` and project package commands accept `--approve`/`--no-approve` to trust or ignore project-local settings for one command. `porcupine update` never prompts for project trust.

See [Porcupine Packages](packages.md) for package sources and security notes.

### Modes

| Flag                  | Description                                               |
| --------------------- | --------------------------------------------------------- |
| default               | Interactive mode                                          |
| `-p`, `--print`       | Print response and exit                                   |
| `--headless`          | Headless task mode: run the prompt to completion, print the final report, and exit `0` on success / `1` on error or abort (CI-friendly; honors saved trust or `--approve`) |
| `--mode json`         | Output all events as JSON lines; see [JSON mode](json.md) |
| `--mode rpc`          | RPC mode over stdin/stdout; see [RPC mode](rpc.md)        |
| `--export <in> [out]` | Export a session to HTML                                  |

In print mode, porcupine also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | porcupine -p "Summarize this text"
```

### Model Options

| Option                   | Description                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| `--provider <name>`      | Provider, such as `anthropic`, `openai`, or `google`                   |
| `--model <pattern>`      | Model pattern or ID; supports `provider/id` and optional `:<thinking>` |
| `--api-key <key>`        | API key, overriding environment variables                              |
| `--thinking <level>`     | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`              |
| `--models <patterns>`    | Comma-separated patterns for Ctrl+P cycling                            |
| `--list-models [search]` | List available models                                                  |

### Session Options

| Option                       | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| `-c`, `--continue`           | Continue the most recent session                       |
| `-r`, `--resume`             | Browse and select a session                            |
| `--session <path\|id>`       | Use a specific session file or partial UUID            |
| `--fork <path\|id>`          | Fork a session file or partial UUID into a new session |
| `--session-dir <dir>`        | Custom session storage directory                       |
| `--no-session`               | Ephemeral mode; do not save                            |
| `--name <name>`, `-n <name>` | Set session display name at startup                    |

### Tool Options

| Option                                 | Description                                                    |
| -------------------------------------- | -------------------------------------------------------------- |
| `--tools <list>`, `-t <list>`          | Allowlist specific built-in, extension, and custom tools       |
| `--exclude-tools <list>`, `-xt <list>` | Disable specific built-in, extension, and custom tools         |
| `--no-builtin-tools`, `-nbt`           | Disable built-in tools but keep extension/custom tools enabled |
| `--no-tools`, `-nt`                    | Disable all tools                                              |

Built-in tools: `ask_question`, `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `web_search`, `web_extract`, `computer_use`, `capability_search`, `inspect_runtime`, `memory`, `session_search`, `tasks`, `projects`, `literature`, `subagent`.

### Resource Options

| Option                       | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `-e`, `--extension <source>` | Load an extension from path, npm, or git; repeatable |
| `--no-extensions`            | Disable extension discovery                          |
| `--skill <path>`             | Load a skill; repeatable                             |
| `--no-skills`                | Disable skill discovery                              |
| `--prompt-template <path>`   | Load a prompt template; repeatable                   |
| `--no-prompt-templates`      | Disable prompt template discovery                    |
| `--theme <path>`             | Load a theme; repeatable                             |
| `--no-themes`                | Disable theme discovery                              |
| `--no-context-files`, `-nc`  | Disable `AGENTS.md` and `CLAUDE.md` discovery        |

Combine `--no-*` with explicit flags to load exactly what you need, ignoring settings. Example:

```bash
porcupine --no-extensions -e ./my-extension.ts
```

### Other Options

| Option                          | Description                                                         |
| ------------------------------- | ------------------------------------------------------------------- |
| `--system-prompt <text>`        | Replace default prompt; context files and skills are still appended |
| `--append-system-prompt <text>` | Append to system prompt                                             |
| `--ui-mode <mode>`              | UI mode: `regular` (default) or experimental `fullscreen`           |
| `--verbose`                     | Force verbose startup                                               |
| `-a`, `--approve`               | Trust project-local files for this run                              |
| `-na`, `--no-approve`           | Ignore project-local files for this run                             |
| `-h`, `--help`                  | Show help                                                           |
| `-v`, `--version`               | Show version                                                        |

In `fullscreen` mode, the transcript scrolls inside the terminal viewport while queued messages, working status, extension widgets, editor, and footer remain fixed at the bottom. Mouse/trackpad input scrolls the region under the pointer; keyboard viewport actions always remain available. Inline images work in terminals that support the Kitty graphics protocol, including Kitty and Ghostty. In iTerm2 they render as text placeholders because its inline-image protocol cannot delete or crop placements during application-owned scrolling. In `regular` mode, porcupine uses the main screen and terminal-owned scrollback, and iTerm2 inline images continue to render normally.

To use fullscreen mode by default, set **UI mode** to `fullscreen` in `/settings`. The change applies after restarting porcupine.

### File Arguments

Prefix files with `@` to include them in the message:

```bash
porcupine @prompt.md "Answer this"
porcupine -p @screenshot.png "What's in this image?"
porcupine @code.ts @test.ts "Review these files"
```

### Examples

```bash
# Interactive with initial prompt
porcupine "List all .ts files in src/"

# Non-interactive
porcupine -p "Summarize this codebase"

# Non-interactive with piped stdin
cat README.md | porcupine -p "Summarize this text"

# Named one-shot session
porcupine --name "release audit" -p "Audit this repository"

# Different model
porcupine --provider openai --model gpt-4o "Help me refactor"

# Model with provider prefix
porcupine --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
porcupine --model sonnet:high "Solve this complex problem"

# Limit model cycling
porcupine --models "claude-*,gpt-4o"

# Read-only mode
porcupine --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
porcupine --exclude-tools ask_question
```

## Sub-agents

Porcupine can spawn an **isolated sub-agent** to offload focused, self-contained work so the main conversation stays clean.

- The main agent calls the `subagent` tool with an exact task (plus optional notes). Sub-agents are **agent-managed**: you never talk to them directly. The tool returns immediately — the main agent **keeps working while the sub-agent runs in the background**, and the report is injected into the session **instantly** when it finishes: steered into the running turn if the main agent is mid-task, or a fresh turn is started if it is idle. It never waits for the next user prompt.
- Each sub-agent gets a **fresh context window** (128K–256K tokens, default 256K), the **whole tool stack** minus agent-level tools (no `subagent` recursion, no `ask_question`, no `computer_use`, no `tasks`/`projects` — but with `capability_search`, so the full skill catalog is reachable via `read SKILL.md`), and a **hard step budget** (default 120 tool calls, see [Sub-agents](subagents.md)).
- Sub-agents run on their **own model** — cheap/small by default (unset = the parent model; recommended: `opencode-go/deepseek-v4-flash`). Configure via `subagent.model` in settings.
- Sub-agents share your **cwd, permission policy, and safety gates** — Ask mode still confirms their flagged commands. They cannot spawn sub-agents and cannot ask the user questions.
- **UI**: sub-agent activity lives in the footer — the animated chip beside the
  thread counter (`🤖(📄 Extracting, 🌐 Searching) • 🧵 0/3 • (opencode-go) …`); no
  split panel. Up to **3** sub-agents run at a time by default
  (`subagent.maxConcurrent`, user-configurable — edit `subagent.maxConcurrent`
  in settings.json or ask the agent).
- **WoT (Web of Thoughts) — live peer messaging**: assign the same `peerGroup` to sub-agents that should coordinate, and they can message each other **and you, instantly** (injected into the recipient's live context — not gated on reports):
  - Sub→Sub: `send_message` / `check_messages` tools, only within the same group (the main agent decides the group at spawn; default = fully isolated)
  - Sub→Main: `send_message` to `@main` — lands in the main agent's context immediately (steered mid-turn, or a fresh turn when idle)
  - Main→Sub: the **`send_to_subagent`** tool steers any running sub-agent — the message lands in its context before its next step
  - Every routed message is audited on the bus (`session.subagentMessageBus`)
- **Stopping sub-agents**: the main agent can stop workers directly with the
  `stop_subagent` tool — one by id or all at once (`stop_subagent {}`) — when a
  worker is stuck, off-track, or no longer needed; a stopped run reports
  `⏹ cancelled` instead of completing. The user can also press **Escape** (with
  an empty editor) to cancel all running sub-agents — the session shows
  `⏹ Sub-agents cancelled`. Session abort and teardown also cancel them.
- When the sub-agent finishes, the parent receives a structured report (summary, steps, context used) and folds it into its work immediately — the report lands in the transcript and model context the moment it completes, without a user prompt.

## Voice Mode

Turn your microphone into an input device. Run `/voice on`, then press **Space** (with an empty editor) to record, and **Space again** to send — the transcription lands in the editor ready to edit or send. Press `/voice status` to see the current state.

Voice follows the **native-modality pattern used for images**:

- **Audio-capable models** (Gemini 2.5+/3.x, Thinking Machines' Inkling via Together, and any model whose catalog entry declares `audio` input) receive the recorded audio **directly** — no speech-to-text round-trip. The prompt renders in the TUI like any other turn.
- **Text-only models** transcribe your speech with **Moonshine** (on-device, MIT) and respond as text. When `voice.autoSpeak` is on, the reply is spoken aloud with **Kokoro** (82M-param on-device TTS) through your system audio.

**Microphone selection is automatic and quiet-room-safe.** On macOS the recorder enumerates the audio devices, skips virtual loopbacks (BlackHole, Soundflower, …), and verifies the chosen device actually opens (never judged by loudness) — the device appears in the status line: `🎤 Using MacBook Air Microphone…`. A capture that comes back silent produces an actionable error (macOS Microphone permission hint, mute/busy check) instead of garbage transcription. `voice.inputDevice` overrides the selection with an explicit device index.

**Model downloads happen automatically on first use** — nothing ships in the package:

- Moonshine `tiny` ships inside its dependency; `base` downloads from the Hugging Face Hub.
- Kokoro (~300 MB q8) and its voice files download from the Hugging Face Hub with progress shown in the status strip.
- Status strip indicators: `🎤 Recording…`, `🎙️ Transcribing…`, `🔉 Speaking…`, `📥 Downloading…`.

**`/voice diag`** records 2 seconds, measures the capture, and transcribes it — printing every step so failures (device, permission, silence, STT) are visible.

**Notes:** terminals send no key-release events, so Space is a toggle (not hold-to-talk). Space only triggers when the editor is empty — typing is never hijacked. Recording needs `ffmpeg` on PATH; playback uses `afplay` (macOS), `paplay` (Linux), or PowerShell (Windows). Configure voices and models via `voice.*` in [settings.md](settings.md).

## Design Principles

Porcupine keeps the core small and pushes workflow-specific behavior into
extensions, skills, prompt templates, and packages. Its core now includes
capability-aware planning, explicit Ask/Normal/Auto interaction policies,
adaptive reasoning, governed post-turn learning, bounded goal loops,
inspection-only plans, durable local tasks, attended Cron routines, and guarded
native computer use.

Those capabilities have deliberately narrow boundaries: there is no built-in
process sandbox, no unrestricted Auto mode, no unbounded autonomous daemon, and
no promise that an attended Cron routine will fire after Porcupine exits. Use a
container, VM, Gondolin, or another external isolation boundary for untrusted or
unmonitored work.

For the full rationale, read the [repository README](https://github.com/Abd0r/porcupine).
