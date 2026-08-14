# Porcupine

A terminal AI agent that carries multi-step work end-to-end — with explicit
permission modes and a fail-closed safety gate. Built on [Pi](https://github.com/earendil-works/pi) (MIT).

```bash
porcupine "fix the failing tests and explain what was wrong"
```

## Install

From this monorepo:

```bash
cd packages/coding-agent
npm install --ignore-scripts
npm run build
npm link
```

Then run it in a project: `porcupine`. (CLI: `porcupine` · config: `~/.porcupine/agent/`.)

**Free model:** `/login cline` (free key from app.cline.bot) → `/model` → `cline/deepseek/deepseek-v4-flash`. Or the flagship: `/login opencode-go` → `opencode-go/deepseek-v4-flash:high`. See [Recommended providers](https://github.com/Abd0r/porcupineai#recommended-providers).

## What it is

An agent loop in your terminal. You state the goal; the harness handles the
rest: planning, delegation, verification, and recovery. It reads your repo,
runs commands, edits files, and reports back — under an interaction mode you
control (**Ask** confirms everything, **Normal** asks on flagged commands,
**Auto** runs with a fail-closed LLM gate that denies dangerous ones).

## Features

- **Sub-agents** — up to 3 parallel isolated workers (fresh context, the whole
  tool stack minus agent-level tools, hard 120-step budgets). Reports are
  injected into your context **instantly** (mid-turn or a fresh turn — never
  gated on your next prompt); the agent can stop workers with `stop_subagent`
  (one or all), and **Escape** (empty editor) cancels all of them. Live
  activity animates in the footer beside the thread counter:
  `🤖(📄 Extracting, 🌐 Searching) • 🧵 0/3 • (opencode-go) …`.
- **WoT (Web of Thoughts)** — sub-agents sharing a `peerGroup` message each
  other and you live, main-agent-gated; `send_to_subagent` steers a running
  worker. Live activity animates in the footer beside the thread counter.
- **MCP client** — connect MCP servers (stdio + Streamable HTTP); their tools,
  resources (`mcp_resources`), and prompts (`/mcpp:`) become first-class.
  Fail-closed gate, browser OAuth (DCR+PKCE), OS-keyring tokens. See
  [docs/mcp.md](docs/mcp.md).
- **Autonomous learning** — the agent improves its own skills and memory from
  real usage: evidence-graded proposals, snapshots + auto-rollback, a live
  activity feed (`/learning feed`), a refiner for weak skills, and a reviewed
  `tools.porcupine.json` registry for composed tools.
- **64 skills across all 18 stacks** — research-grounded and agentskills.io
  compliant, including a dedicated Web Development stack for frontend, APIs,
  accessibility, responsive design, browser QA, performance, data migrations,
  observability, SEO, and deployment.
- **Dynamic task graph** — footer tracker + chat graph animate on every
  multi-step turn: `/plan` gets a pre-routed capability graph; ordinary
  model-led turns build one live from actual tool calls.
- **Voice** — `/voice on`, push-to-talk with Space. Audio-capable models get
  native audio; text-only models use on-device Moonshine STT + Kokoro TTS.
- **Tasks & Cron** — durable task templates with attended schedules
  (`/task`, `/cron`; fires while the session is open and idle), task chaining
  (`next`/`nextOnFail`), and event triggers (`file` content-change, `script`
  exit-code) — plus completion notifications to your chat bridges.
- **Markdown viewer** — the agent presents plans/reports in a full-screen
  rendered viewer (`show_markdown` tool), and `/view <path>` opens any file.
- **Observability** — `/usage` (per-turn tokens) and `/cost` (estimated cost)
  right in the session.
- **Every run traceable** — sessions log the assembled system prompt (`system_prompt`
  entries with a prompt hash) and the per-step dispatch envelope (`request_header`),
  so a replay reconstructs exactly what the model saw. Benchmark runs pin the
  prompt to a fixed persona via `PORCUPINE_BENCHMARK=1` (`benchmarks/rig/minimal.py`).
- **Runtime introspection** — `inspect_runtime` reports the live tool/command/
  extension registries so the agent writes correct extension code instead of
  guessing from docs.
- **`/memory` + `/init`** — see what the agent learned about you, and generate
  a project AGENTS.md that never clobbers your edits.
- **`porcupine serve`** — headless HTTP API (sessions, async prompts, SSE
  events, programmatic approval) for IDE plugins, web/mobile clients, scripts.
- **Email** — read inbox/drafts/sent, save drafts, and send via IMAP/SMTP
  (app password, no paid anything). `/email` commands + agent tools.
- **X (Twitter), free** — search (web cascade), read tweets (public
  syndication, no key), local drafts, compose-then-paste posting (X has no
  free API tier anymore).
- **Native browser** — Playwright-powered `browser_*` tools: navigate, semantic
  ARIA snapshot, click/type, wait, extract, resize, diagnostics, screenshot, and
  evaluate (headless by default).
- **Projects** — `Project/<name>/` workspaces with `README.md` + `STATUS.md`.
- **Telegram bridge** — message the same session from your phone
  (`PORCUPINE_TELEGRAM_TOKEN` in `~/.porcupine/agent/.env`); confirmations and
  `ask_question` arrive as buttons. Private chats authenticate their sender;
  groups require an explicit user allowlist.
- **Discord + iMessage bridges** — the same session contract over Discord
  channels (channel + user allowlists) and the macOS Messages app (direct-chat
  identity or explicit group senders). Discord provides real Gateway resume,
  heartbeat recovery, typing indicators, and native `MEDIA:` attachments;
  iMessage uses native AppleScript polling where macOS permits it. All three
  bind confirmations to the authorized actor whose turn started. Owner `!`
  commands (`!status`, `!tasks`, `!run`, `!help`) control the session remotely.
- **`/sandbox`** — one command to route built-in tools into a Gondolin
  micro-VM (`/sandbox on` installs, registers, and hot-reloads the extension;
  `/sandbox status` checks Node/QEMU/VM state).
- **`--headless`** — CI-friendly task mode: run a prompt to completion, print
  the final report, exit 0 on success / 1 on error.
- **Updates & sync** — startup update check (npm/GitHub, cached 24h) shows
  `🆕 vX.Y.Z available` beside the version; `/update` + `porcupine update
  [--yes]` install it; `porcupine sync [--force]` refreshes the shipped
  agent-home prompt files without clobbering your edits.
- **Stacks** — every tool and skill lives in one hierarchical capability tree
  (`stacks/<stack>/<lane>/<name>`) injected into the model's context; see
  [docs/stacks.md](docs/stacks.md).
- **Sub-agents** — parallel isolated workers with WoT peer messaging and
  instant report injection; see [docs/subagents.md](docs/subagents.md).
- **Autonomy, bounded** — `/auto` enables autonomous operation; hardline
  destructive commands stay blocked in every mode. No daemon, no unattended
  execution: everything runs in the interactive session you can see.

## Docs

- [Full guide](docs/index.md) · [Web Development](docs/web-development.md) · [Messaging](docs/messaging.md) · [MCP](docs/mcp.md) ·
  [Settings](docs/settings.md) · [Skills](docs/skills.md) · [Security](docs/security.md) ·
  [Extensions](docs/extensions.md) · [Sessions](docs/sessions.md)

## License

MIT — see [LICENSE](../../LICENSE).
