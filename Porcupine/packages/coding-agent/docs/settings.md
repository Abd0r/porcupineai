# Settings

Porcupine uses JSON settings files with project settings overriding global settings.

| Location | Scope |
|----------|-------|
| `~/.porcupine/agent/settings.json` | Global (all projects) |
| `.porcupine/settings.json` | Project (current directory) |

Edit directly or use `/settings` for common options.

## Project Trust

On interactive startup, porcupine asks before trusting a project folder that contains project-local settings, resources, or project `.agents/skills` and has no saved decision for the folder or a parent folder in `~/.porcupine/agent/trust.json`. Trusting a project allows porcupine to load `.porcupine/settings.json` and `.porcupine` resources, install missing project packages, and execute project extensions.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore those project resources, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.porcupine/agent/settings.json`, or change it with `/settings`.

`porcupine config` and package commands use the same project trust flow, except `porcupine update` never prompts. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

Use `/trust` in interactive mode to save a project trust decision for future sessions, including trust for the immediate parent folder. It writes `~/.porcupine/agent/trust.json` only; the current session is not reloaded, so restart porcupine for changes to take effect.

## All Settings

### Model & Thinking

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultProvider` | string | - | Default provider (e.g., `"anthropic"`, `"openai"`) |
| `defaultModel` | string | - | Default model ID |
| `defaultThinkingLevel` | string | - | `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"` |
| `hideThinkingBlock` | boolean | `false` | Hide thinking blocks in output |
| `showCacheMissNotices` | boolean | `false` | Show transcript notices for significant prompt-cache misses |
| `thinkingBudgets` | object | - | Custom token budgets per thinking level |

#### thinkingBudgets

```json
{
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  }
}
```

### UI & Display

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `theme` | string | `"dark"` | Theme name (`"dark"`, `"light"`, or custom) |
| `externalEditor` | string | `$VISUAL`, then `$EDITOR`, then Notepad on Windows or `nano` elsewhere | Command for Ctrl+G external editor; takes precedence over environment variables |
| `quietStartup` | boolean | `false` | Hide startup header |
| `defaultProjectTrust` | string | `"ask"` | Fallback project trust behavior: `"ask"`, `"always"`, or `"never"`. Global setting only |
| `collapseChangelog` | boolean | `false` | Show condensed changelog after updates |
| `enableInstallTelemetry` | boolean | `true` | Send an anonymous install/update version ping after first install or changelog-detected updates. This does not control update checks |
| `updateCheck` | boolean | `true` | Check npm/GitHub for a newer release on startup and show `🆕 update available` beside the version |
| `updateCheckIntervalHours` | number | `24` | How long to cache the update check before re-fetching |
| `notifyOnTaskCompletion` | boolean | `true` | Send a one-line summary to connected chat bridges when a task/cron run completes or fails |
| `email` | object | - | IMAP/SMTP mailbox config: `{ host, port, secure, user, draftsFolder, sentFolder, timeoutMs }`. The app password lives in the credential store, never in settings |
| `safety.protectedPaths` | string[] | system dirs | Paths the agent may never destructively target (hardline), even inside the workspace. Defaults: root, `/etc`, `/usr`, `/bin`, `/sbin`, `/var`, `/Library`, `/System`, `/Applications`, home `Library` |
| `enableAnalytics` | boolean | `false` | Opt-in analytics data sharing. Currently only asked for during the experimental first-time setup (`PORCUPINE_EXPERIMENTAL=1`) |
| `trackingId` | string | - | Analytics tracking identifier, generated when `enableAnalytics` is turned on |
| `doubleEscapeAction` | string | `"tree"` | Action for double-escape: `"tree"`, `"fork"`, or `"none"` |
| `treeFilterMode` | string | `"default"` | Default filter for `/tree`: `"default"`, `"no-tools"`, `"user-only"`, `"labeled-only"`, `"all"` |
| `editorPaddingX` | number | `0` | Horizontal padding for input editor (0-3) |
| `outputPad` | number | `1` | Horizontal padding for user messages, assistant messages, and thinking (0 or 1) |
| `autocompleteMaxVisible` | number | `5` | Max visible items in autocomplete dropdown (3-20) |
| `showHardwareCursor` | boolean | `false` | Show the terminal cursor while TUI positions it for IME support |
| `uiMode` | string | `"regular"` | Interactive UI mode: `"regular"` or experimental `"fullscreen"`. Changes from `/settings` apply after restart; `--ui-mode` overrides this setting for one run |
| `fullscreenScrollbar` | string | `"auto"` | Fullscreen transcript scrollbar: `"auto"` shows it temporarily while scrolling, `"always"` reserves the rightmost column and keeps it visible, and `"hidden"` hides it. Has no effect in regular UI mode |

For VS Code, include `--wait` so porcupine resumes after the editor exits:

```json
{
  "externalEditor": "code --wait"
}
```

### Telemetry and update checks

`enableInstallTelemetry` controls an anonymous install/update ping. Porcupine
does not phone home by default: the ping and the version-update check only
fire when a product endpoint is explicitly configured (env vars such as
`PORCUPINE_INSTALL_TELEMETRY_URL` / `PORCUPINE_LATEST_VERSION_URL`), and both
are disabled by `PORCUPINE_OFFLINE=1`.

Set `PORCUPINE_SKIP_VERSION_CHECK=1` to disable the Porcupine version update check. Use `--offline` or `PORCUPINE_OFFLINE=1` (legacy `PI_OFFLINE=1`) to disable all startup network operations described here, including update checks, package update checks, and install/update telemetry.

### Network

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `httpProxy` | string | - | HTTP proxy URL applied as `HTTP_PROXY` and `HTTPS_PROXY`. Global setting only. |

```json
{
  "httpProxy": "http://127.0.0.1:7890"
}
```

### Warnings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `warnings.anthropicExtraUsage` | boolean | `true` | Show a warning when Anthropic subscription auth may use paid extra usage |

```json
{
  "warnings": {
    "anthropicExtraUsage": false
  }
}
```

### Compaction

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `compaction.enabled` | boolean | `true` | Enable auto-compaction |
| `compaction.reserveTokens` | number | unset (`20%` of context window) | Fixed headroom override. Unset uses the 80/20 rule |
| `compaction.keepRecentTokens` | number | unset (`20%` of context window, clamped 8k–80k) | Recent tokens to keep (not summarized). Unset scales with the model |

```json
{
  "compaction": {
    "enabled": true
  }
}
```

Omit `reserveTokens` and `keepRecentTokens` to use the 80/20 rule (compact at 80% of the model context window, keep the most recent ~20%). Set them only for fixed overrides.

### Branch Summary

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `branchSummary.reserveTokens` | number | `16384` | Tokens reserved for branch summarization |
| `branchSummary.skipPrompt` | boolean | `false` | Skip "Summarize branch?" prompt on `/tree` navigation (defaults to no summary) |

### Sub-agents

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `subagent.model` | string | unset (parent model) | Provider/model spec for sub-agents, e.g. `opencode-go/deepseek-v4-flash` (cheap/small model recommended) |
| `subagent.maxSteps` | number | `120` | Maximum tool-call steps per sub-agent run |
| `subagent.contextWindow` | number | `256000` | Sub-agent context window in tokens (clamped 128K–256K) |
| `subagent.maxConcurrent` | number | `3` | Maximum concurrent sub-agents (default 3) |
| `subagent.names` | string[] | `buck, fudgy, tinker` | Custom sub-agent names (addressed as `@name`); invalid entries fall back to defaults |

### Voice

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `voice.pushToTalk` | boolean | `true` | Space bar (empty editor) toggles recording when Voice Mode is on |
| `voice.sttModel` | string | `tiny` | Moonshine speech-to-text model (`tiny` or `base`) — used only for text-only models |
| `voice.ttsVoice` | string | `af_heart` | Kokoro voice (e.g. `af_heart`, `am_michael`, `af_sky`) |
| `voice.autoSpeak` | boolean | `true` | Speak the agent's reply aloud after each turn |
| `voice.inputDevice` | number | *auto* | Explicit macOS microphone device index (avfoundation); unset = auto-select a real mic (skips BlackHole/virtual loopbacks) |

### Retry

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `retry.enabled` | boolean | `true` | Enable automatic agent-level retry on transient errors |
| `retry.maxRetries` | number | `3` | Maximum agent-level retry attempts |
| `retry.baseDelayMs` | number | `2000` | Base delay for agent-level exponential backoff (2s, 4s, 8s) |
| `retry.provider.timeoutMs` | number | SDK default | Provider/SDK request timeout in milliseconds |
| `retry.provider.maxRetries` | number | `0` | Provider/SDK retry attempts |
| `retry.provider.maxRetryDelayMs` | number | `60000` | Max server-requested delay before failing (60s) |

When a provider requests a retry delay longer than `retry.provider.maxRetryDelayMs`, the request fails immediately with an informative error instead of waiting silently. Set it to `0` to disable the limit.

Keep `retry.provider.maxRetries` at `0` unless provider-level retries are explicitly needed. Setting it above `0` can make SDK/provider retries handle out-of-usage-limit errors before Porcupine sees them, which may block the agent until the provider quota resets in some circumstances.

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "provider": {
      "timeoutMs": 3600000,
      "maxRetries": 0,
      "maxRetryDelayMs": 60000
    }
  }
}
```

### Message Delivery

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `steeringMode` | string | `"one-at-a-time"` | How steering messages are sent: `"all"` or `"one-at-a-time"` |
| `followUpMode` | string | `"one-at-a-time"` | How follow-up messages are sent: `"all"` or `"one-at-a-time"` |
| `transport` | string | `"auto"` | Preferred transport for providers that support multiple transports: `"sse"`, `"websocket"`, `"websocket-cached"`, or `"auto"` |
| `httpIdleTimeoutMs` | number | `300000` | HTTP header/body idle timeout in milliseconds, also used by providers with explicit stream idle timeouts. Set to `0` to disable. |
| `websocketConnectTimeoutMs` | number | `15000` | WebSocket connect/open handshake timeout in milliseconds for providers that support WebSocket transports. Set to `0` to disable. |

### Terminal & Images

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `terminal.showImages` | boolean | `true` | Show images in terminal (if supported) |
| `terminal.imageWidthCells` | number | `60` | Preferred inline image width in terminal cells |
| `terminal.clearOnShrink` | boolean | `false` | Clear empty rows when content shrinks (can cause flicker) |
| `images.autoResize` | boolean | `true` | Resize images to 2000x2000 max |
| `images.blockImages` | boolean | `false` | Block all images from being sent to LLM |

### Shell

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shellPath` | string | - | Custom shell path (e.g., for Cygwin on Windows); supports a leading `~` for the home directory |
| `shellCommandPrefix` | string | - | Prefix for every bash command (e.g., `"shopt -s expand_aliases"`) |
| `npmCommand` | string[] | - | Command argv used for npm package lookup/install operations (e.g., `["mise", "exec", "node@20", "--", "npm"]`) |

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

`npmCommand` is used for all npm package-manager operations, including installs, uninstalls, and dependency installs inside git packages. User-scoped npm packages install under `~/.porcupine/agent/npm/`; project-scoped npm packages install under `.porcupine/npm/`. Use argv-style entries exactly as the process should be launched. When `npmCommand` is configured, git package dependency installs use plain `install` to avoid npm-specific flags in wrappers or alternate package managers.

### Sessions

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `sessionDir` | string | - | Directory where session files are stored. Accepts absolute or relative paths, plus `~`. |

```json
{ "sessionDir": ".porcupine/sessions" }
```

When multiple sources specify a session directory, precedence is `--session-dir`, `PORCUPINE_CODING_AGENT_SESSION_DIR`, then `sessionDir` in settings.json.

### Model Cycling

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabledModels` | string[] | - | Model patterns for Ctrl+P cycling (same format as `--models` CLI flag) |

```json
{
  "enabledModels": ["claude-*", "gpt-4o", "gemini-2*"]
}
```

### Markdown

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `markdown.codeBlockIndent` | string | `"  "` | Indentation for code blocks |

### Resources

These settings define where to load extensions, skills, prompts, and themes from.

Paths in `~/.porcupine/agent/settings.json` resolve relative to `~/.porcupine/agent`. Paths in `.porcupine/settings.json` resolve relative to `.porcupine`. Absolute paths and `~` are supported.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `packages` | array | `[]` | npm/git packages to load resources from |
| `extensions` | string[] | `[]` | Local extension file paths or directories |
| `skills` | string[] | `[]` | Local skill file paths or directories |
| `prompts` | string[] | `[]` | Local prompt template paths or directories |
| `themes` | string[] | `[]` | Local theme file paths or directories |
| `enableSkillCommands` | boolean | `true` | Register skills as `/skill:name` commands |

Arrays support glob patterns and exclusions. Use `!pattern` to exclude. Use `+path` to force-include an exact path and `-path` to force-exclude an exact path.

#### packages

String form loads all resources from a package:

```json
{
  "packages": ["porcupine-skills", "@org/my-extension"]
}
```

Object form filters which resources to load:

```json
{
  "packages": [
    {
      "source": "porcupine-skills",
      "skills": ["brave-search", "transcribe"],
      "extensions": []
    }
  ]
}
```

See [packages.md](packages.md) for package management details.

## Example

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "compaction": {
    "enabled": true,
    "keepRecentTokens": 20000
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3
  },
  "enabledModels": ["claude-*", "gpt-4o"],
  "warnings": {
    "anthropicExtraUsage": true
  },
  "packages": ["porcupine-skills"]
}
```

## Project Overrides

Project settings (`.porcupine/settings.json`) override global settings. Nested objects are merged:

```json
// ~/.porcupine/agent/settings.json (global)
{
  "theme": "dark",
  "compaction": { "enabled": true }
}

// .porcupine/settings.json (project)
{
  "compaction": { "reserveTokens": 8192 }
}

// Result (project override pins a fixed reserve; global alone uses 80/20)
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 8192 }
}
```

### Security note: `$`-prefixed values execute shell commands

Configuration values (e.g. in the credential/`env` fields and model settings)
can be a literal, an environment variable reference, or — when the value
starts with `$` — a **shell command whose output becomes the value** (10s
timeout, output trimmed). This is a trust boundary: any process able to
write your settings or auth files can execute commands as your user. Keep
those files user-owned (`~/.porcupine/agent/` permissions) and only put
commands there that you author yourself.

