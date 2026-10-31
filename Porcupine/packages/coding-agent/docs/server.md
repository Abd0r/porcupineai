# Headless Server (`porcupine serve`)

`porcupine serve` runs the agent as a headless HTTP service so other clients can
drive a session programmatically: IDE plugins, web or mobile apps, CI scripts,
and automation. It is the server surface behind the interactive TUI (the TUI is
just one client), mirroring the OpenCode-style server architecture.

## Starting the server

```bash
porcupine serve --port 4096 --token <secret>
```

| Flag | Default | Description |
| ---- | ------- | ----------- |
| `--port` | `4096` | Port to listen on. `0` picks a free port. |
| `--host` | `127.0.0.1` | Host to bind. Only loopback is allowed without a token. |
| `--token` | env `PORCUPINE_SERVER_TOKEN` | Optional bearer token. **Required** when binding a non-loopback host. |

The server shares the exact runtime bootstrap of the CLI: project trust,
providers, settings, extensions, and the current session's model + permission
policy. It runs in-process with the interactive session machinery and shuts
down cleanly on SIGINT/SIGTERM.

## Authentication

When a token is configured, every request must carry it:

```
Authorization: Bearer <token>
```

Requests without it get `401`.

## Endpoints

All bodies are JSON. `:id` is the session id returned by `POST /session`.

### GET /health

```json
{ "healthy": true, "version": "0.1.45" }
```

### GET /session

Lists every session on the server. Backward compatible with single-session
mode (still returns one entry).

```json
{ "sessions": [{"id": "session-id"}, {"id": "another-id"}] }
```

### POST /session

Creates (or returns) a session. In multi-session mode you may request a
specific id; an id that already exists is returned (`200`) instead of
created. Without an id, the server mints a new session via its session
provider. Single-session (legacy) mode returns the one session (`201`).

```json
{ "id": "optional-requested-id" }
```

Responds `201` (new) or `200` (existing):

```json
{ "sessionId": "session-id" }
```

## Multi-session

`porcupine serve` can run multiple independent sessions concurrently. Each
session carries its own message stream, status, and confirmation surface; the
per-`/session/:id/...` routes already scope each request to one session, so
concurrent sessions never share prompts, approvals, or events.

- `GET /session` lists all sessions.
- `POST /session` creates (or returns) a session; pass `{"id": "..."}` to
  request a specific id.
- Every existing per-session route (`/session/:id/message`, `/status`,
  `/abort`, `/permissions/:id/response`, `/events`) keeps working unchanged and
  now resolves against any session id.
- `?session=<id>` on a per-session route is an optional alternative selector.
- SSE is per-session: `/session/:id/events` delivers only that session's
  events. A global lifecycle stream on `GET /events` emits `session_created`
  and `session_closed` for every session on the server.
- Approval responses route only to the session that surfaced them.

Existing single-session clients are unaffected: when the server was started
with one legacy session, `POST /session` returns it and the per-session routes
resolve against it exactly as before.

### POST /session/:id/message

Send a prompt to the session. The session runs asynchronously; respond `202`
immediately.

```json
{ "text": "investigate the failing test" }
```

Optional `attachments` contains up to eight `{ "name": "notes.txt", "data": "<base64>" }` objects, with 12 MiB decoded bytes total. Text may be empty when files are attached (text itself is limited to 1 MiB). Files receive unique local paths under the agent directory; supported photos also become native vision input. Normal authentication, same-origin checks and tool permissions apply.

Errors: `400` for invalid text or attachments, `413` for size limits, `404` for a wrong session id. Attachment submissions while the real session is busy return `409`.

### POST /session/:id/abort

Aborts a running turn. Responds `200 { "ok": true }`.

### GET /session/:id/status

```json
{ "id": "session-id", "streaming": false }
```

### GET /session/:id/events

Server-Sent Events stream of the session: message starts/ends, thinking, tool
calls, and permission requests. Each event is a JSON `data:` line:

```
data: {"type":"message_start","...":...}
data: {"type":"permission_request","permissionId":"perm-...","title":"...","message":"..."}
```

A heartbeat comment (`: ping`) is sent every 15 seconds to keep the connection
alive.

### POST /session/:id/permissions/:permissionId/response

Programmatically answer a pending permission request surfaced over SSE (the
session's confirm callback, the same gate Ask/Normal/Auto use):

```json
{ "allow": true }
```

Responds `200 { "ok": true }`; `404` when no request with that id is pending.
Unanswered requests time out as denied after 60 seconds.

## Example (curl)

```bash
BASE=http://127.0.0.1:4096
AUTH="Authorization: Bearer $TOKEN"

curl -s $BASE/health -H "$AUTH"
SID=$(curl -s -X POST $BASE/session -H "$AUTH" | jq -r .sessionId)
curl -s -X POST $BASE/session/$SID/message -H "$AUTH" -H 'content-type: application/json' \
  -d '{"text":"run the focused tests"}'
curl -sN $BASE/session/$SID/events -H "$AUTH"
```

## Safety

- The server is attended: it runs inside the interactive session process and
  stops when the session closes. It does not add unattended execution.
- Loopback-only by default; a token is mandatory for any non-loopback bind.
- Permission requests still require an explicit `allow` — nothing is
  auto-approved through the API.

## Attended reminders and goal nudges

The interactive session ships session-local, attended reminders. They are
honest about scope: a reminder (`/remind <duration> <text>`, the model-facing
`remind_me` tool) fires only while the
interactive session is open and idle, and is delivered through the same
chat-bridge notification fan-out as completed task runs. It is not a daemon
and does not run on a closed terminal. Firing is gated on the exact idle
drain eligibility the task scheduler uses; while the session is busy or
closed, a due reminder simply waits to be delivered on a later idle tick.

Reminders persist as session custom entries, so they survive `/resume`.

## Browser organization and commands

The authenticated workbench also exposes `GET /session/:id/commands` for the live command catalog, and `POST /session/:id/command` with `{ "text": "/usage" }` for execution. Results appear over SSE as `command_result` and replay from the session log. Terminal-only commands return an explicit explanation.

`PUT /session/:id/project` with `{ "name": "project-name" }` associates a conversation with an existing canonical workspace; use `null` to ungroup. `DELETE /session/:id` removes an idle session from discovery and moves its JSONL to local trash. `DELETE /workbench/projects/:name` moves project files to local trash and leaves conversations available. These optional capabilities are advertised by `/workbench`. IDs are resolved against discovered or live sessions, never arbitrary client paths.


## Project resources and sticky notes

The sidebar uses one search for chats and projects, single-line names with full-name tooltips, and small initial lists with Show more. Project folders remember whether you expanded them. The project page lists chats and resources beside a compact sticky-note area. Resource clicks open a preview dialog: formatted Markdown (including tables, code and math), raster images and PDFs render locally; other supported files can be downloaded. Markdown resource links resolve relative to that document inside the project. Browser PDF support varies; Open in new tab and Download remain available.

Each project supports up to **20 persistent sticky notes**. Use **＋** beside Sticky notes to add one, or **Open / edit** on a note to read it in full, then Edit note, Save note or Delete note. Choose amber, blue, sage or rose paper. Attach file uploads a resource and inserts an image or file link; deleting the note keeps its attached resources. Note titles allow 120 characters and bodies 8000. Notes support the same safe Markdown renderer as chat; HTML and scripts remain literal text. Notes refresh while the project is visible, without replacing an open editor. Conflicting edits keep the draft and require reopening the latest note.

The agent uses the existing `projects` tool with `query` set to the project directory name:

| Action | Fields |
| --- | --- |
| `notes` | `query` — returns notes with IDs and revisions |
| `add_note` | `query`, `title`, `text`, optional `color` |
| `update_note` | `query`, `id`, `revision`, changed `title`, `text` or `color` |
| `delete_note` | `query`, `id`, `revision` |

For images, use `![Caption](uploads/plot.png)`; for PDFs, `[Paper](uploads/paper.pdf)`. The file must already exist inside the project. External HTTP(S) links open separately. Normal file-mutation approval policy applies to agent changes; inspection-only plan turns and read-only tool sets cannot mutate notes.

Authenticated HTTP clients use `GET/POST /workbench/projects/:name/notes` and `PUT/DELETE /workbench/projects/:name/notes/:id`. POST bodies contain `title`, `text` and `color`; PUT includes these plus `revision`, and DELETE needs `revision`. The shared store uses an atomic file replacement and a mutation lock; stale revisions and the 21st note return `409`. Notes stay in the project directory and move with it to project trash.

The active-surface system context includes a compact GUI operating guide only while a browser client is attached. It directs the agent to load `adaptive-gui` through `capability_search` before substantive GUI presentation, and `adaptive-learning` for lessons or practice; already-loaded instructions are reused. It names the visual tools and project-note actions without repeating their complete schemas. TUI-only and detached contexts retain their own guidance.
