# Messaging Bridges

Porcupine can share one attended interactive session with Telegram, Discord, and iMessage. A message accepted by a bridge appears in the terminal transcript, runs under the current model and interaction mode, and sends the final response back to the originating conversation.

The bridges run inside the visible Porcupine process. They stop when that interactive session closes. They are not background services or unattended agents.

## TUI-first architecture

The terminal UI owns the canonical conversation lifecycle and every bridge mirrors it:

`received` → `queued` → `working` → `tool_started` / `tool_updated` → `completed` / `failed` / `cancelled`, with `waiting_for_approval` and `waiting_for_answer` while a dialog is open. A bridge renders only the states its platform supports natively (typing indicators, buttons, reactions, replies) and never invents its own lifecycle.

One logical approval, question, or input races the TUI and every connected channel: the first valid authorized answer wins and all losing dialogs are cancelled, so a stale button or reaction can never act on a later request.

## Security model

Every inbound action passes two gates:

| Surface | Conversation gate | Actor gate |
|---|---|---|
| Telegram private chat | `PORCUPINE_TELEGRAM_ALLOW` | Sender id must equal the private chat id |
| Telegram group | `PORCUPINE_TELEGRAM_ALLOW` | `PORCUPINE_TELEGRAM_USER_ALLOW` |
| Discord | `PORCUPINE_DISCORD_ALLOW` | `PORCUPINE_DISCORD_USER_ALLOW` |
| iMessage direct chat | `PORCUPINE_IMESSAGE_ALLOW` | Inferred direct-chat participant |
| iMessage group | `PORCUPINE_IMESSAGE_ALLOW` | `PORCUPINE_IMESSAGE_SENDER_ALLOW` |

The actor gate applies to normal prompts, `!` control commands, free-text answers, option selections, and approval decisions. A different participant in an allowed group cannot approve work.

Keep bot tokens in `~/.porcupine/agent/.env` with mode `600`. Never commit that file.

## Telegram setup

1. Message `@BotFather` and run `/newbot`.
2. Save the token in `~/.porcupine/agent/.env`.
3. Start Porcupine and send `/start` to the bot. An unauthorized private chat reports its numeric chat id.
4. Add that id to `PORCUPINE_TELEGRAM_ALLOW` and restart Porcupine.

```dotenv
PORCUPINE_TELEGRAM_TOKEN=<bot-token>
PORCUPINE_TELEGRAM_ALLOW=<private-chat-id>
```

For a group, add the negative group chat id to the conversation allowlist and each trusted sender's numeric Telegram user id to the actor allowlist:

```dotenv
PORCUPINE_TELEGRAM_ALLOW=<private-chat-id>,<group-chat-id>
PORCUPINE_TELEGRAM_USER_ALLOW=<trusted-user-id>
```

Telegram groups may require BotFather group privacy to be disabled or the bot to be promoted so Telegram delivers ordinary messages. Porcupine still applies its own conversation and actor gates after delivery.

Accepted prompts display a typing indicator that refreshes until the turn ends. Final messages are chunked below Telegram's limit at line boundaries, never inside fenced code blocks. Voice notes are transcribed on-device and submitted as prompts; photo captions are used as prompt text. Photos, files, videos, or stickers without usable text get a clear reply instead of silence.

A response line such as `MEDIA:/absolute/path/report.pdf` sends the local file as a document. Only files inside the workspace or the OS temp dir (up to 20 MB) are shareable; anything else gets a written refusal, never a silent skip. Telegram buttons handle approvals and option questions. `/reload` re-registers the bot command menu so new skills and extensions appear without a restart.

## Discord setup

1. Create an application and bot in the Discord Developer Portal.
2. Enable the **Message Content Intent**. Porcupine does not need the Server Members Intent because authorization uses immutable numeric user ids.
3. Invite the bot with permission to view the chosen channel, read message history, send messages, add reactions, and attach files.
4. Enable Developer Mode in Discord, then copy the channel id and your user id.
5. Configure both allowlists and restart Porcupine.

```dotenv
PORCUPINE_DISCORD_TOKEN=<bot-token>
PORCUPINE_DISCORD_ALLOW=<channel-id>
PORCUPINE_DISCORD_USER_ALLOW=<trusted-user-id>
```

A channel id alone is intentionally insufficient. Discord channels often contain multiple people, while the bot can operate the local terminal.

Accepted prompts trigger Discord's typing indicator, refreshed until the turn ends. Responses are chunked below Discord's text limit at line boundaries, never inside fenced code blocks. `MEDIA:` lines send native attachments (same workspace/temp-dir and size rules as Telegram). Approvals use reactions bound to the exact confirmation message and authorized user. Numbered question reactions are scoped the same way; questions with more than ten options say so and stay in the terminal. Attachment-only messages get a clear reply instead of silence.

The gateway waits for Discord's `HELLO` before identifying. On reconnect it uses Opcode 6 `RESUME` with the saved session and sequence. A missing heartbeat acknowledgement closes the zombie socket so the bridge can reconnect instead of appearing online while missing events.

## iMessage setup

The native iMessage bridge is macOS-only and uses the signed-in Messages app. Configure a direct chat id or phone/email handle:

```dotenv
PORCUPINE_IMESSAGE_ALLOW=+15551234567
```

For group chats, add explicit trusted senders:

```dotenv
PORCUPINE_IMESSAGE_ALLOW=<group-chat-id>
PORCUPINE_IMESSAGE_SENDER_ALLOW=+15551234567,trusted@example.com
```

Confirmations use `APPROVE` or `DENY`; option questions use numbered replies. Sender checks apply before either response can resolve a dialog. The bridge's own sent texts are filtered from the poll (macOS no longer exposes a reliable sent-by-me flag), so replies are never re-ingested as new prompts. `MEDIA:` results arrive as `📎 File ready: <path>` lines. `/help` also lists the `!status`, `!tasks`, `!run <taskId>`, and `!help` owner controls.

Apple has removed or restricted parts of Messages AppleScript access on some macOS versions. Porcupine probes readability once and fails with a clear warning instead of repeatedly polling a bridge that cannot work. Use Telegram or Discord on affected systems.

## Remote slash commands

Every bridge mirrors the TUI's slash-command catalog. Send `/commands` from an
authorized chat to see the full list (`/commands <query>` filters, `/commands
<N>` pages). The list is generated from the same sources as the TUI autocomplete
(built-in commands, prompt templates, skills, and extension commands), so it
never drifts from the terminal.

- **Telegram** registers the catalog in the bot menu via `setMyCommands`
  (deterministic Telegram-safe aliases: `scoped-models` → `scoped_models`,
  `skill:web-search` → `skill_web_search`). Both the alias and the canonical
  name are accepted.
- **Discord and iMessage** recognize the same `/command` lines as text; use
  `/commands` for discovery.

What can run remotely (all behind the same actor + conversation gates):

| Category | Commands |
|---|---|
| Session info | `/session` `/usage` `/cost` `/changelog` `/memory` `/stacks` `/projects` `/subagents` `/guide` `/update` |
| State toggles | `/reasoning [level]` `/thinking` `/adaptive` `/auto` `/model <provider/model>` `/name <name>` |
| Task/cron | `/task list` `/task show <id>` `/task add <title> :: <prompt>` `/task run <id>` `/task pause|resume|cancel <id>` `/cron list` |
| Goal/plan status | `/goal status` `/plan status` |
| X / email reads | `/x ...` `/email status|drafts|inbox|read <id>` |

`/task run` and `/cron run` queue the run and post the result back to the
originating chat when it finishes.

Declined remotely (with a terminal pointer in the reply): TUI-only selectors
(`/settings`, `/tree`, `/trust`, `/resume`, `/modes`, `/view`, `/hotkeys`,
`/fork`, `/logout`, `/export`, `/import`), lifecycle commands (`/refresh`,
`/restart`, `/reload`, `/new`, `/quit`, `/kill`, `/clone`, `/extract-stack`,
`/craft-stack`), and turn-starting builtins that need a live agent turn
(`/goal <text>`, `/plan <text>`, `/compact`, `/email send`). These are listed
so you know they exist, but run them in the terminal. Replies are redacted so
engine output can never leak tokens, keys, or passwords.

## Shared behavior

- Remote prompts queue as follow-ups while the agent is busy.
- A turn-start event binds interactive dialogs to the authorized actor whose queued prompt actually began. A later queued message cannot steal the current turn's confirmation target.
- Final responses use prompt provenance so terminal-originated turns stay in the terminal.
- `!status`, `!tasks`, `!run <taskId>`, and `!help` are handled locally as owner controls.
- Task completion notifications use the most recently active authorized bridge destination, only when that channel heard from its user within the notify window (30 minutes by default, `PORCUPINE_BRIDGE_NOTIFY_MAX_AGE_MS`, `0` disables expiry).
- Ask, Normal, and Auto retain the same safety semantics on every surface.

## Channel capabilities

| Capability | Telegram | Discord | iMessage |
|---|---|---|---|
| Text prompts | Yes | Yes | Yes |
| Voice-note prompts | Yes (on-device transcription) | No (clear reply) | No |
| Photo captions as prompts | Yes | No (clear reply) | No |
| Typing progress during turns | Yes (refreshed) | Yes (refreshed) | No |
| Code-fence-aware chunking | Yes | Yes | Yes |
| Approval surface | Inline buttons | ✅/❌ reactions | `APPROVE` / `DENY` text |
| Question surface | Option buttons | Numbered reactions (≤10) | Numbered replies |
| `MEDIA:` file delivery | Document upload | Native attachment | `📎 File ready` path |
| Command menu registration | Yes (refreshed on `/reload`) | On-demand `/commands` | On-demand `/commands` |
| `!status` / `!tasks` / `!run` / `!help` | Yes | Yes | Yes |

## Troubleshooting

| Symptom | Check |
|---|---|
| Telegram `/start` reports unauthorized | Add the reported private chat id to `PORCUPINE_TELEGRAM_ALLOW` |
| Telegram group is silent | Check BotFather privacy/admin delivery, group chat id, and `PORCUPINE_TELEGRAM_USER_ALLOW` |
| Discord connects but ignores text | Enable Message Content Intent and verify both channel and user ids |
| Discord reactions do nothing | Confirm the reacting user is allowlisted and reacted to the current dialog message |
| iMessage fails at startup | Messages must be signed in and script-readable on that macOS version |
| Remote confirmation is unavailable | Send an authorized prompt first so Porcupine has a verified actor and destination |

See [Using Porcupine](usage.md#remote-access-telegram--discord--imessage), [Environment Variables](environment-variables.md), and [Security](security.md#remote-bridges-telegram--discord--imessage).
