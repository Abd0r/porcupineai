# Porcupine Documentation

Porcupine is a minimal terminal AI agent harness. It is designed to stay small at the core while being extended through TypeScript extensions, skills, prompt templates, themes, and porcupine packages.

## Quick start

Install Porcupine with npm:

```bash
npm install -g --ignore-scripts @porcupineai/coding-agent
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Porcupine does not require install scripts for normal npm installs.

On Linux or macOS, you can also install from source — clone, build, and link
as described in the [repository README](https://github.com/Abd0r/porcupine).

To uninstall porcupine itself, use npm for curl and npm installs:

```bash
npm uninstall -g @porcupineai/coding-agent
```

For pnpm, Yarn, or Bun installs, use the matching global remove command: `pnpm remove -g @porcupineai/coding-agent`, `yarn global remove @porcupineai/coding-agent`, or `bun uninstall -g @porcupineai/coding-agent`.

Then run it in a project directory:

```bash
porcupine
```

Authenticate with `/login` for subscription providers, or set an API key such as `ANTHROPIC_API_KEY` before starting porcupine.

For the full first-run flow, see [Quickstart](quickstart.md).

## Start here

- [Quickstart](quickstart.md) - install, authenticate, and run a first session.
- [Using Porcupine](usage.md) - interactive mode, slash commands, context files, and CLI reference.
- [Stacks](stacks.md) - the capability tree: how every tool and skill is organized and discovered.
- [Web Development](web-development.md) - frontend, backend, browser QA, accessibility, performance, and production workflows.
- [Sub-agents](subagents.md) - parallel isolated workers, WoT coordination, and instant report injection.
- [MCP](mcp.md) - Model Context Protocol client: connect MCP servers, tools/resources/prompts, OAuth, security.
- [Providers](providers.md) - subscription and API-key setup for built-in providers.
- [llama.cpp](llama-cpp.md) - run a local router and manage models with `/llama`.
- [Local models](local-models.md) - Ollama, MLX, and llama.cpp on Apple Silicon.
- [Security](security.md) - project trust, sandbox boundaries, and vulnerability reporting.
- [Containerization](containerization.md) - sandbox porcupine with Gondolin, Docker, or OpenShell.
- [Server](server.md) - headless HTTP API: `porcupine serve`, sessions, async prompts, SSE events, programmatic approval.
- [Settings](settings.md) - global and project settings.
- [Keybindings](keybindings.md) - default shortcuts and custom keybindings.
- [Sessions](sessions.md) - session management, branching, and tree navigation.
- [Compaction](compaction.md) - context compaction and branch summarization.
- [X (Twitter)](x.md) - free X integration: search, read tweets, drafts, and compose-then-paste posting.
- [Email (IMAP/SMTP)](email.md) - read inbox/drafts/sent, save drafts, send via app password.
- [Messaging bridges](messaging.md) - secure Telegram, Discord, and iMessage setup, actor allowlists, and troubleshooting.
- [Browser use](browser.md) - Playwright browser control: semantic snapshots, interaction, responsive checks, diagnostics, and screenshots.

## Customization

- [Extensions](extensions.md) - TypeScript modules for tools, commands, events, and custom UI.
- [Skills](skills.md) - Agent Skills for reusable on-demand capabilities.
- [Skill Crafting](skill-crafting.md) - Create discoverable skills/tools from documents or via deep research.
- [Prompt templates](prompt-templates.md) - reusable prompts that expand from slash commands.
- [Themes](themes.md) - built-in and custom terminal themes.
- [Recovering From a Broken Customization](customization-recovery.md) - fix prompts, themes, extensions, or settings that break startup.
- [Porcupine packages](packages.md) - bundle and share extensions, skills, prompts, and themes.
- [Custom models](models.md) - add model entries for supported provider APIs.
- [Custom providers](custom-provider.md) - implement custom APIs and OAuth flows.

## Programmatic usage

- [SDK](sdk.md) - embed porcupine in Node.js applications.
- [RPC mode](rpc.md) - integrate over stdin/stdout JSONL.
- [JSON event stream mode](json.md) - print mode with structured events.
- [TUI components](tui.md) - build custom terminal UI for extensions.

## Reference

- [Environment variables](environment-variables.md) - Porcupine process configuration and session metadata available to bash tools.
- [Session format](session-format.md) - JSONL session file format, entry types, and SessionManager API.

## Platform setup

- [Windows](windows.md)
- [Termux on Android](termux.md)
- [tmux](tmux.md)
- [Terminal setup](terminal-setup.md)
- [Shell aliases](shell-aliases.md)

## Development

- [Development](development.md) - local setup, project structure, and debugging.
