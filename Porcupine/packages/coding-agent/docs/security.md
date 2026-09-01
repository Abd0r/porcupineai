# Security

Porcupine is a native-first terminal AI agent. It runs with the permissions of the user account that starts it, and it treats files writable by that user as inside the same local trust boundary.

## Project Trust

Project trust controls whether porcupine loads project-local settings, resources, packages, and extensions. It is not a sandbox and it does not restrict what the model can ask tools to do after you start working in a directory.

Porcupine considers a project to have resources that require trust when it finds any of these from the current working directory:

- `.porcupine/settings.json`
- `.porcupine/extensions`, `.porcupine/skills`, `.porcupine/prompts`, or `.porcupine/themes`
- `.porcupine/SYSTEM.md` or `.porcupine/APPEND_SYSTEM.md`
- project `.agents/skills` in the current directory or an ancestor directory

A bare `.porcupine` directory does not count as a project resource that requires trust.

When an interactive session starts in a project with resources that require trust and no saved decision for the current directory or a parent directory, porcupine follows `defaultProjectTrust` from global settings. The default value is `"ask"`, which asks whether to trust the project when UI is available. Saved decisions are stored by canonical directory in `~/.porcupine/agent/trust.json`, and the closest saved decision on the current or parent path applies before the global default.

Trusting a project allows porcupine to load project resources that require trust, including:

- `.porcupine/settings.json`
- `.porcupine` resources such as extensions, skills, prompt templates, themes, and system prompt files
- missing project packages configured through project settings
- project-local extensions and project package-managed extensions

Declining trust skips protected resources. `AGENTS.md` and `CLAUDE.md` context files are loaded regardless of project trust unless context loading is disabled. Before trust is resolved, porcupine only loads context files, user/global extensions, and CLI `-e` extensions. User/global and CLI extensions can handle the `project_trust` event; the first extension that returns a yes/no decision owns the decision.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, `defaultProjectTrust: "ask"` and `"never"` ignore such resources, while `"always"` trusts them. Use `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

## Native Access and Optional Isolation

Porcupine is native-first. Without optional isolation, built-in tools can read files, write files, edit files, and run shell commands with the permissions of the porcupine process. Extensions are TypeScript modules that run with the same permissions. Package installs, shell commands, language servers, test commands, and other developer tools behave as ordinary local processes.

This is intentional. Porcupine is designed to operate on local source trees, invoke project toolchains, and integrate with the user's existing development environment. A partial in-process sandbox would be easy to misunderstand as a security boundary while still depending on the host shell, filesystem, package managers, credentials, and extension code. Real isolation needs to come from the operating system or a virtualization/container boundary.

Project trust is only an input-loading guard. It prevents a repository from silently changing porcupine's settings or extensions before you approve it. It does not make untrusted code, untrusted prompts, or untrusted model output safe. Prompt injection from repository files, comments, documentation, context files, or build output is expected local-agent risk and cannot be reliably prevented by porcupine.

Injected context is hardened against frame-breaking: content loaded from `AGENTS.md`/`CLAUDE.md` has its frame tags escaped (`</project_instructions>`, `</project_context>`, `<project_context`), so repository text cannot close the sanctioned block and inject instructions outside it, and the block states that project instructions do not override system, developer, or direct user instructions.

## Interaction Modes and the Fail-Closed Gate

Interaction modes choose how tool actions are approved, independent of reasoning settings: **Ask** confirms every bash command and file mutation, **Normal** confirms flagged bash (file edits run directly), and **Auto** permits safe operations while routing flagged bash through a fail-closed LLM safety gate. In every mode, hardline destructive actions (`rm -rf /`, disk format, raw-device writes, overwriting protected system or SSH paths, fork bombs, power-off, kill-all) remain blocked. Force-push and destructive SQL are flagged, not hardline. Auto mode is autonomy, not a permission upgrade: it never makes destructive actions unrestricted, and it runs only while an interactive session is open and attended.

Auto classification is time-boxed to eight seconds. Identical, model-scoped flagged commands may reuse the same verdict for up to one minute; three unavailable or invalid classifier responses open a 30-second fail-closed circuit breaker. The breaker denies quickly rather than turning an upstream outage into repeated slow waits.

### Recursive deletes: intent from scope

`rm -rf` is a legitimate part of real work (cleaning `node_modules`, `dist`, build caches) and the gate infers intent from **scope**, not from mind-reading:

- **Inside the workspace** (the session's project directory): recursive deletes are the agent's own domain and run without friction in Auto and Normal.
- **Outside the workspace** (home, other repos, system areas): stays flagged — confirmed in Normal, LLM-gated in Auto.
- **Protected paths**: root, system directories (`/etc`, `/usr`, `/bin`, `/sbin`, `/var`, `/Library`, `/System`, `/Applications`) and anything in the `safety.protectedPaths` setting are hardline-blocked in every mode, even inside the workspace. Deleting the working directory itself (`rm -rf .`) is always blocked.
- Path equivalences (`rm -rf //`, `rm -rf /./`, `rm -rf -- /`, quoted roots) are normalized before matching. Recently written files are content-scanned before execution through shell and common language evaluators, including Python, Node, Bun, Deno, Perl, Ruby, and PHP (no write-then-execute bypass).

### Monotonic hardline policy

The hardline and flagged command lists are **frozen at load** (`HARDLINE_RULES` / `DANGEROUS_RULES` in `src/porcupine/auto-mode.ts`). Extensions, listeners, and config cannot add, remove, or weaken them: a denial can only be tightened, never loosened by a later registration. A hardline decision is returned before any human confirm or LLM gate is consulted, so a confirming user or an approved Auto verdict can never override it.

### Loop hygiene (advisory, never a veto)

Two guardrails keep runaway loops from burning the window without ever blocking legitimate work:

- **Repeat-tool guard**: identical consecutive tool calls with the same arguments trigger escalating advisory context at 3, 5, and 8 repetitions (steered into the model's next step as a hidden reminder, `src/porcupine/repeat-tool-guard.ts`). Bookkeeping tools such as `todo_write` are excluded. It observes and advises; it never cancels or rewrites a call.
- **Tool-result pruning**: oversized tool results are deterministically cut to a head, a marker, and a tail before they enter context (see [Compaction](compaction.md#tool-result-pruning-before-context)).

### Native per-command write-fence (Auto Mode)

In Auto Mode, in addition to the fail-closed LLM gate, approved bash runs under a native OS-level **write fence**. It is a write fence, not full isolation: the command keeps read, execute, and network access, but the operating system denies file writes outside the allowed set.

Allowed writable locations:

- the workspace (the session's cwd)
- the system temp directory
- standard home state/cache dirs (`~/.npm`, `~/.cache`, `~/.config`, `~/.local`, `~/.ssh`, and on macOS `~/Library/Caches` and `~/Library/Application Support`)

Everything else — other projects, `~/Library`, system directories, arbitrary paths — is denied.

Backends: macOS **Seatbelt** (`sandbox-exec`), Linux **bwrap** (bubblewrap), Windows **restricted token** (via an optional `porcupine-sandbox.exe` helper). Where the native backend or its required binary is unavailable, bash falls back to the native shell with a one-time warning; the LLM gate still applies in every case.

This fence is defense-in-depth under the gate, not a replacement for it, and not a substitute for real isolation (see [Running Untrusted or Unmonitored Work](#running-untrusted-or-unmonitored-work)). It confines writes only — not reads, process execution, or network.

## MCP (Model Context Protocol) Servers

MCP servers are external tools — treat them as untrusted. Porcupine's MCP client is **fail-closed**: a tool runs only when allowlisted or explicitly approved, hard-line destructive calls are denied in every mode, approvals are bound to a server content-hash (not its name — CVE-2025-54136), and project `mcp.json` servers do not auto-start without project trust. See [MCP](mcp.md) for the full security model.

## Remote Bridges (Telegram / Discord / iMessage)

Porcupine can be controlled from a phone or chat channel via the remote
bridges. Treat any bridge as remote access to a local agent session:

- **Conversation and actor gated**: Telegram requires an allowed chat and, for
  groups, a sender in `PORCUPINE_TELEGRAM_USER_ALLOW`. Discord requires both an
  allowed channel (`PORCUPINE_DISCORD_ALLOW`) and an allowed user
  (`PORCUPINE_DISCORD_USER_ALLOW`). iMessage direct chats infer their participant;
  group chats require `PORCUPINE_IMESSAGE_SENDER_ALLOW`. A member of an allowed
  group who is not an authorized actor cannot prompt, run control commands,
  answer questions, or approve actions.
- **Attended-only**: every bridge runs inside the interactive TUI session.
  None of them start headless and none are daemons.
- **Same approval surface**: Ask-mode confirmations (bash commands, file
  mutations) race the TUI dialog with remote buttons/reactions/replies; the
  first valid response wins. Dialogs are bound to the actor whose turn actually
  started, and replies or reactions from other participants are ignored.
- **Tokens are credentials**: keep `PORCUPINE_TELEGRAM_TOKEN` and
  `PORCUPINE_DISCORD_TOKEN` in `~/.porcupine/agent/.env` (chmod 600) or your
  environment; never commit them. iMessage needs no token (it uses the signed-in
  Messages.app on the local machine).

See [usage.md](usage.md) for the full bridge feature list.

## Running Untrusted or Unmonitored Work

For untrusted repositories, generated code you do not intend to monitor closely, or unattended automation, run porcupine in a contained environment. Use a container, VM, micro-VM, remote sandbox, or policy-controlled sandbox with only the files and credentials required for the task.

Common patterns are documented in [Containerization](containerization.md):

- run the the whole `porcupine` process inside a container/sandbox
- run host porcupine while routing built-in tool execution into a Gondolin micro-VM
- mount only the workspace paths the agent should access
- avoid mounting host `~/.porcupine/agent` unless the container should access host sessions, settings, and credentials
- pass the minimum required API keys or use short-lived credentials
- restrict network access when the task does not need it
- review diffs and outputs before copying results back to trusted systems

If you bind-mount a host workspace read/write, writes from inside the container or VM can still modify host files. Use read-only mounts or copy files into and out of the sandbox when you need stronger protection from unintended writes.

## Reporting Security Issues

To report a security issue, follow the repository [Security Policy](https://github.com/Abd0r/porcupineai/security/policy) and use [private vulnerability reporting](https://github.com/Abd0r/porcupineai/security/advisories/new). Do not open a public issue for security-sensitive reports.

Expected native local-agent behavior, use without optional isolation, prompt injection from untrusted content, and behavior of user-installed extensions or skills are generally outside the security boundary unless the report demonstrates a real privilege-boundary bypass or shows how porcupine grants access that the local user did not already have.
