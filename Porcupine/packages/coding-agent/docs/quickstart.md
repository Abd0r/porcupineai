# Quickstart

This page gets you from install to a useful first porcupine session.

## Install

Porcupine is distributed as an npm package:

```bash
npm install -g --ignore-scripts @porcupineai/coding-agent
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Porcupine does not require install scripts for normal npm installs.

### Uninstall

Use the package manager that installed porcupine. The curl installer uses npm globally, so curl and npm installs are removed with npm:

```bash
# curl installer or npm install -g
npm uninstall -g @porcupineai/coding-agent

# pnpm
pnpm remove -g @porcupineai/coding-agent

# Yarn
yarn global remove @porcupineai/coding-agent

# Bun
bun uninstall -g @porcupineai/coding-agent
```

Uninstalling porcupine leaves settings, credentials, sessions, and installed porcupine packages in `~/.porcupine/agent/`.

Then start porcupine in the project directory you want it to work on:

```bash
cd /path/to/project
porcupine
```

## Authenticate

Porcupine can use subscription providers through `/login`, or API-key providers through environment variables or the auth file.

### Option 1: subscription login

Start porcupine and run:

```text
/login
```

Then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT Plus/Pro (Codex), and GitHub Copilot.

### Option 2: API key

Set an API key before launching porcupine:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
porcupine
```

You can also run `/login` and select an API-key provider to store the key in `~/.porcupine/agent/auth.json`.

See [Providers](providers.md) for all supported providers, environment variables, and cloud-provider setup.

## First session

Once porcupine starts, type a request and press Enter:

```text
Summarize this repository and tell me how to run its checks.
```

By default, porcupine enables these built-in tools:

- `read` - read files
- `bash` - run shell commands
- `edit` - patch files
- `write` - create or overwrite files
- `capability_search` - discover tools and skills
- `web_search` / `web_extract` - research the web
- `memory` - durable preferences
- `session_search` - find past work
- `tasks` / `projects` - durable tasks and workspaces
- `literature` - paper tracking
- `subagent` - delegate to an isolated worker

`grep`, `find`, and `ls` are also available through tool options. Porcupine runs in your current working directory and can modify files there. Use git or another checkpointing workflow if you want easy rollback.

## Give porcupine project instructions

Porcupine loads context files at startup. Add an `AGENTS.md` file to tell it how to work in a project:

```markdown
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

Porcupine loads:

- `~/.porcupine/agent/AGENTS.md` for global instructions
- `AGENTS.md` or `CLAUDE.md` from parent directories and the current directory

Restart porcupine, or run `/reload`, after changing context files.

## Common things to try

### Reference files

Type `@` in the editor to fuzzy-search files, or pass files on the command line:

```bash
porcupine @README.md "Summarize this"
porcupine @src/app.ts @src/app.test.ts "Review these together"
```

Images or text can be pasted with Ctrl+V (Alt+V on Windows); images can also be dragged into supported terminals.

### Run shell commands

In interactive mode:

```text
!npm run lint
```

The command output is sent to the model. Use `!!command` to run a command without adding its output to the model context.

### Switch models

Use `/model` or Ctrl+L to choose a model. Use Shift+Tab to cycle thinking level. Use Ctrl+P / Shift+Ctrl+P to cycle through scoped models.

### Continue later

Sessions are saved automatically:

```bash
porcupine -c                  # Continue most recent session
porcupine -r                  # Browse previous sessions
porcupine --name "my task"    # Set session display name at startup
porcupine --session <path|id> # Open a specific session
```

Inside porcupine, use `/resume`, `/new`, `/tree`, `/fork`, and `/clone` to manage sessions.

### Non-interactive mode

For one-shot prompts:

```bash
porcupine -p "Summarize this codebase"
cat README.md | porcupine -p "Summarize this text"
porcupine -p @screenshot.png "What's in this image?"
```

Use `--mode json` for JSON event output or `--mode rpc` for process integration.

## Next steps

- [Using Porcupine](usage.md) - interactive mode, slash commands, sessions, context files, and CLI reference.
- [Providers](providers.md) - authentication and model setup.
- [Settings](settings.md) - global and project configuration.
- [Keybindings](keybindings.md) - shortcuts and customization.
- [Porcupine Packages](packages.md) - install shared extensions, skills, prompts, and themes.

Platform notes: [Windows](windows.md), [Termux](termux.md), [tmux](tmux.md), [Terminal setup](terminal-setup.md), [Shell aliases](shell-aliases.md).
