<p align="center">
  <img src="https://raw.githubusercontent.com/Abd0r/porcupineai/main/Porcupine/packages/coding-agent/assets/porcupine-banner.png" alt="Porcupine" width="720" />
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%E2%89%A522.19.0-339933?logo=node.js&logoColor=white" alt="Node.js 22.19+" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-EA9B34" alt="MIT" /></a>
  <a href="https://www.npmjs.com/package/@porcupineai/porcupineai"><img src="https://img.shields.io/npm/v/@porcupineai/porcupineai" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@porcupineai/porcupineai"><img src="https://img.shields.io/npm/dt/@porcupineai/porcupineai" alt="npm downloads" /></a>
  <a href="https://github.com/Abd0r/porcupineai"><img src="https://img.shields.io/github/stars/Abd0r/porcupineai" alt="GitHub stars" /></a>
</p>

A terminal coding agent. You describe the goal; it reads your repo, runs commands, edits files, and verifies the result — inside a permission mode you control.

Built on top of [Pi](https://github.com/earendil-works/pi) (MIT).

---

## Install

```bash
npm install -g @porcupineai/porcupineai
```

Requires **Node.js 22.19+**.

Or build from source:

```bash
git clone https://github.com/Abd0r/porcupineai.git
cd porcupineai/Porcupine
npm install --ignore-scripts
npm run build
npm link
```

## Quick start

```bash
porcupine
```

Then, in the TUI:

```text
/login                        # connect a provider (or set an API key)
/guide                        # interactive onboarding
```

Try: *"Summarize this repository and tell me how to run its checks."*

## Recommended providers

Two ways to run Porcupine, both set up in under a minute with `/login`. Same models, two routes: free or paid.

### Cline API (free)

Free tier, no OAuth, no billing. One key unlocks DeepSeek V4 Flash and more.

```text
1. Create a free account + API key at app.cline.bot (Settings > API Keys)
2. /login cline
3. Paste your key
4. /model → cline/deepseek/deepseek-v4-flash   (free, reasoning-capable)
```

### OpenCode Go (paid)

Subscription key for the same DeepSeek V4 Flash (plus V4 Pro and the full model catalog), with paid-tier rate limits.

```text
1. Get an API key at opencode.ai/auth
2. /login opencode-go
3. Paste your key
4. /model → opencode-go/deepseek-v4-flash:high
```

You can switch providers any time with `/model`; bring your own key, no lock-in.

## Interaction modes

| Mode | Behavior |
| --- | --- |
| **Ask** | Confirms every command and file change |
| **Normal** | Runs safe operations; asks on flagged ones |
| **Auto** | Runs autonomously with a fail-closed safety gate for dangerous commands |

Reasoning depth is separate from permission: `/reasoning` and `/adaptive` tune thinking effort without changing what the agent is allowed to do.

## Benchmarks

Porcupine as the harness, DeepSeek V4 Flash (latest release) as the model,
official benchmark suites. Same model, same benchmark, different harness.

| Benchmark | DSV4F published | **Porcupine harness** | Status |
|---|---|---|---|
| **Aider Polyglot** (225) | 71.6% · 74.1% (⚠️ unverified refs) | **86.2% (194/225)** | ✅ complete |
| Terminal-Bench 2.1 (89) | 82.7% (official card) | **45/89 · 83.3% clean-pass rate** (35 infra-unscored) | ✅ complete |
| SWE-bench Verified (500) | 79.0% | not started | ⏳ |

**The headline: Porcupine's harness outranks DeepSeek's own harness on their own benchmark — same model.**

Aider Polyglot methodology, per-language scores, citations, and raw logs:
[`benchmarks/polyglot/`](benchmarks/polyglot/).

Terminal-Bench 2.1: 45 of 89 tasks pass clean (83.3% pass rate on the 54
scored runs) vs 82.7% on the official card — 35 tasks never got a fair run
(three cycles lost to sandbox/disk failures on the benchmark rig; every
infra fix is documented in [`benchmarks/rig/`](benchmarks/rig/)). Scoring
script + raw results: [`benchmarks/rig/score-tbench.py`](benchmarks/rig/score-tbench.py).

## What's inside

- **Sub-agents** — up to 3 parallel workers with the whole tool stack (minus
  agent-level tools), 120-step budgets, and their own model. Reports are
  injected instantly; the agent can stop workers with `stop_subagent`; Escape
  cancels all. Live activity animates in the footer beside the thread counter:
  `🤖(📄 Extracting, 🌐 Searching) • 🧵 0/3 • (opencode-go) …`.
- **WoT (Web of Thoughts)** — sub-agents sharing a `peerGroup` message each
  other and you live; `send_to_subagent` steers any running worker.
- **MCP client** — connect MCP servers (stdio + Streamable HTTP); tools, resources (`mcp_resources`) and prompts (`/mcpp:`) become first-class. Fail-closed security gate, browser OAuth, OS-keyring tokens.
- **Autonomous learning** — the agent improves its own skills and memory from real use: evidence-graded proposals, snapshots + auto-rollback, a live feed (`/learning feed`), and a refiner for weak skills.
- **64 skills across 18 stacks** — including a production Web Development stack for frontend, APIs, accessibility, responsive design, browser QA, performance, data migrations, observability, SEO, and deployment; `deep-research` orchestrates parallel research with evidence grading.
- **Dynamic task graph** — the footer tracker animates on every multi-step turn.
- **Voice** — `/voice on`, push-to-talk with Space.
- **Tasks & Cron** — durable task templates with attended schedules (`/task`, `/cron`), task chaining (`next`/`nextOnFail`), event triggers (`file` content-change, `script` exit-code), and completion notifications to your chat bridges (`notifyOnTaskCompletion`).
- **Projects** — `Project/<name>/` workspaces with README + STATUS.
- **Markdown viewer** — the agent presents plans/reports in a full-screen rendered viewer (`show_markdown` tool); `/view <path>` opens any file.
- **Observability** — `/usage` (per-turn tokens) and `/cost` (estimated cost) in the session.
- **Memory** — `/memory` shows what the agent learned about you; `/init` generates a project `AGENTS.md` that never clobbers your edits.
- **Remote bridges** — drive the same session from your phone or chat:
  Telegram (`PORCUPINE_TELEGRAM_TOKEN`), Discord (`PORCUPINE_DISCORD_TOKEN`), or
  iMessage (macOS, `PORCUPINE_IMESSAGE_ALLOW`). Confirmations race the TUI with
  buttons/reactions — first response wins. Owner `!` commands (`!status`,
  `!tasks`, `!run <taskId>`, `!help`) control the session remotely.
- **Email** — read inbox/drafts/sent, save drafts, and send over IMAP/SMTP
  (app password; `/email` + `email_*` tools).
- **X (Twitter), free** — search (web cascade), read tweets (public
  syndication, no key), local drafts, compose-then-paste posting (X has no
  free API tier anymore; `/x` + `x_*` tools).
- **Native browser** — Playwright-powered `browser_*` tools: navigate, semantic
  ARIA snapshot, click/type, wait, extract, resize, diagnostics, screenshot, and
  evaluate (headless by default).
- **`porcupine serve`** — headless HTTP API (sessions, async prompts, SSE
  events, programmatic approval) for IDE plugins, web/mobile clients, scripts.
- **`/sandbox`** — one command routes built-in tools into a Gondolin micro-VM
  (`on` installs + hot-reloads; `status` checks Node/QEMU/VM state).
- **`--headless`** — CI-friendly task mode: run a prompt to completion, print
  the report, exit 0 on success / 1 on error.
- **Updates & sync** — startup check (npm/GitHub, 24h cache) shows
  `🆕 vX.Y.Z available` beside the version; `/update` and `porcupine update
  [--yes]` install it; `porcupine sync [--force]` refreshes the shipped
  agent-home files without clobbering your edits.

## Safety

Porcupine runs with the permissions of the account that launches it. Project trust controls which project-local resources load — it is not a sandbox. For untrusted or unattended work, use a real isolation boundary (container, VM, micro-VM).

Read [Security](Porcupine/packages/coding-agent/docs/security.md) and [Containerization](Porcupine/packages/coding-agent/docs/containerization.md).

## Documentation

- [Full index](Porcupine/packages/coding-agent/docs/index.md)
- [Quickstart](Porcupine/packages/coding-agent/docs/quickstart.md) · [Usage](Porcupine/packages/coding-agent/docs/usage.md) · [Settings](Porcupine/packages/coding-agent/docs/settings.md)
- [Stacks](Porcupine/packages/coding-agent/docs/stacks.md) · [Web Development](Porcupine/packages/coding-agent/docs/web-development.md) · [Sub-agents](Porcupine/packages/coding-agent/docs/subagents.md)
- [MCP](Porcupine/packages/coding-agent/docs/mcp.md) · [Skills](Porcupine/packages/coding-agent/docs/skills.md) · [Extensions](Porcupine/packages/coding-agent/docs/extensions.md)
- [Sessions](Porcupine/packages/coding-agent/docs/sessions.md) · [Server API](Porcupine/packages/coding-agent/docs/server.md)
- [Email](Porcupine/packages/coding-agent/docs/email.md) · [X (Twitter)](Porcupine/packages/coding-agent/docs/x.md) · [Browser use](Porcupine/packages/coding-agent/docs/browser.md)

## License

[MIT](LICENSE).

_If Porcupine helps you get real work done, a <a href="https://github.com/Abd0r/porcupineai">star</a> means a lot._

---

<p align="center">
  <a href="https://github.com/Abd0r/porcupineai">GitHub</a> ·
  <a href="https://www.npmjs.com/package/@porcupineai/porcupineai">npm</a> ·
  <a href="LICENSE">MIT License</a>
</p>
