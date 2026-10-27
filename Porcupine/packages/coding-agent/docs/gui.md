# Local Browser Workbench

Run `porcupine -gui` (or `porcupine --gui`) to start a local workbench and open the browser. The launcher selects an available port and creates a token for that run; the browser consumes the launch fragment and removes it from the address bar. Keep the terminal process running. Plain `porcupine` continues to launch the terminal interface. `--port` can select a fixed port. GUI launch is loopback-only; `--serve` remains the explicit server route.

`porcupine --serve` serves a local browser workbench at the server root, for example `http://127.0.0.1:4096/`. The existing terminal interface remains available; the workbench is an additional client of the same session API.

Start the server with a token:

```bash
porcupine --serve --port 4096 --token <secret>
```

Open the local address in your browser and enter the token in the connection form. The page keeps it in memory for that tab only. For an explicitly tokenless loopback server, set `PORCUPINE_SERVE_ALLOW_TOKENLESS=1` as documented in [server.md](./server.md).

The workbench supports session selection and creation, live message events, prompt submission, abort, explicit permission decisions, and model-requested visual explanations. Main-agent activity, approvals, answers and visuals share one chronological conversation flow. Todos appear at the upper right, with sub-agent summaries underneath. On narrow screens, **Tasks** opens this overview.

The Conversations list discovers saved Porcupine sessions using the same session index as the terminal, retaining saved names and first-message titles. Selecting a saved conversation loads its runtime on demand; new conversations get independent runtimes. The initial selection remains the server's active conversation. Conversations and workspace Projects rescan when the browser regains focus. Existing Project folder names retain their spelling and spaces.

The interface uses an open conversation column, neutral surfaces, compact controls, and a shared adaptive width for text, figures, and the composer. Its semantic tokens and layout patterns are adapted from the MIT-licensed DeepSeek Harness UI, not its branding or plugin runtime. See [source notes and license](./gui-third-party-notices.md).

## Visual explanations

### Interactive workspaces

The following `visualize` kinds extend the same component identity and session replay flow. Users can inspect and change a workspace locally, then press **Send to agent** to persist that state in conversation history and ask the agent to continue. Unsubmitted changes are not saved across reloads. Updating a component with changed content starts a new revision.

| Kind | Current controls |
| --- | --- |
| `form` | Text, number, choice and toggle fields; required values and number bounds; submitted values restore |
| `table` | Search, sortable columns, row selection, optional cell editing; original row identities retained through sorting |
| `simulation` | Parameter sliders, formula plot, time scrubbing, play/pause/reset; linear, projectile and oscillator models |
| `graph` | Select nodes, inspect their descriptions and follow labelled connections |
| `timeline` | Previous/next steps and a step scrubber with explanations |
| `comparison` | Adjustable criterion weights, supplied scores and weighted ranking |
| `flashcards` | Reveal, Again/Remembered, review intervals and next-review dates; send progress to retain it across sessions |
| `evidence` | Expand claims and evidence, inspect supplied confidence, open source links and select claims to discuss |
| `progress` | Expand milestones and evidence, select a decision and send it to the agent |
| `code` | Before/after text, editable proposed content, Markdown preview, a line comparison, copy controls and an apply request sent to the agent |
| `motion` | Circle/rectangle/text layers with position, scale, opacity and rotation keyframes; play/pause, reset and time scrubbing |

Example form:

```json
{"kind":"form","componentId":"experiment-setup","title":"Experiment setup","fields":[{"label":"Trial name","type":"text","required":true},{"label":"Samples","type":"number","min":1,"max":100,"required":true},{"label":"Method","type":"choice","options":["Control","Treatment"]}]}
```

Simulation parameter names are fixed: `slope`/`intercept`, `speed`/`angle`/`gravity` (angle in degrees), or `amplitude`/`frequency` (cycles per second). The plotted interval is 0–10 seconds. These are illustrative formula calculators; they do not run a general solver, enforce ground collisions or validate experimental assumptions. Put units and assumptions in parameter labels and the description. Motion uses linear interpolation, normalized 0–100 positions and at most 60 seconds; playback starts only on user action. Video export, arbitrary meshes, executable formulas and document file mutation inside the card are not implemented. Code changes are requested through the agent's normal tool and permission flow. Evidence links and confidence are model-supplied data, not independent source verification. Spaced review runs only while the deck is open; there is no reminder service.

For a scored quiz, call `visualize` with `kind: "quiz"`, a title and 1–6 questions. Each question supplies `question`, 2–6 `options`, zero-based `correctAnswers`, an `explanation`, and an optional `hint`. More than one correct answer enables multiple selection. Submission reveals an exact-match score and review for every question; answers and review restore from session history. The score checks the supplied answer key, so the agent must verify that key. Written answers continue through the question card for agent evaluation.

The visualization tools prepare JSON-encoded array arguments before runtime validation, including nested coordinates, chart points and series, and 3D objects. Invalid JSON, wrong shapes and bounds still fail validation.

`visualize` also supports `kind: "question"`: supply a title, question and options. Users can select one answer, select several with `multiple: true`, or write an answer when options is empty. Submission sends a structured response in a normal session message for the agent to evaluate. The card locks after a successful send; failures allow retry. Answers and selected controls restore from conversation history. A changed question revision starts unanswered. This is an initial question component, not automatic scoring or a complete quiz engine. Questions and visual descriptions support the same math rendering as chat.

Supply `componentId` to give a 2D visual, chart or question a stable identity. Later tool calls with the same ID replace that component at its existing position. Without an explicit ID, the browser uses the tool-call ID, which still supports replay and saved question answers. These identities are scoped to the selected session branch; no browser storage is required for answers.

| View | Model tool | Supported content |
| --- | --- | --- |
| 2D diagram | `visualize` with `kind: "diagram"` | Rectangles, circles, arrows, lines, and plain-text labels. Useful for force diagrams, process flows, annotated geometry, and conceptual maps. |
| Chart | `visualize` with `kind: "chart"` | Line, scatter, and grouped bar charts; multiple named series; axis labels and units; optional point annotations and supplied symmetric y uncertainty bars. |
| Interactive 3D scene | `visualize_3d` | Boxes, spheres, and arrows; drag, keyboard, and button rotation controls. |

Each view has a title and optional explanation. Charts expose all supplied values in an accessible data table, retaining full precision even when canvas labels are abbreviated. Diagrams expose object positions and labels as text. The new 2D/chart cards include **Ask about this visual**, which prepares a follow-up prompt without sending it. The model also receives a text fallback from `visualize`, so the explanation remains usable in non-graphical clients.

Attaching the browser activates the configured `visualize` and `visualize_3d` tools for future turns. Explicitly excluded tools remain unavailable. The agent is instructed to choose diagrams for relationships, charts for supplied data, and 3D for spatial structure when useful, without requiring a separate visualization request.

Chat replies and reasoning use locally served KaTeX and fonts for math: `\(...\)` and `$...$` inline, `\[...\]` and `$$...$$` for display equations. Fractions, integrals, aligned equations, cases and matrices use standard KaTeX syntax. Table cells support math, including vertical bars inside expressions. Code fences remain literal. Incomplete or unsupported expressions remain visible; HTML and external-resource commands are untrusted. Canvas figure labels remain plain text.

For example, ask: "Teach me Newton's second law with a labelled 2D force diagram" or "Plot these measurements against time with units and the uncertainty I supplied." Diagrams use positive y pointing upwards. Chart x values are numeric; use point labels for discrete category names. Line segments connect samples in the supplied order.

### Scientific integrity and bounds

- Chart supplied data only. Clearly identify illustrative or synthetic examples in the title or description. Do not present model-generated examples as measurements.
- Put units in `xLabel` and `yLabel`. Optional `error` is an absolute symmetric y uncertainty (`y ± error`), not a percentage. Omitted uncertainty is shown as **Not supplied**, not silently treated as a measured zero.
- 2D/3D diagrams allow at most 80 objects with coordinates in `[-20, 20]`. Charts allow at most 8 series and 200 points per series, with finite coordinates in `[-1e12, 1e12]`. Uncertainty must be finite and in `[0, 1e12]`.
- Backend validation and independent browser validation reject unsupported types, extra properties, and out-of-bounds data. The model supplies data, not executable code, HTML, meshes, URLs, or external assets. Formula labels are plain text, not executed expressions or typeset LaTeX.
- Heatmaps, surface plots, chart animation and user-authored drawing are not implemented. The separate motion component supports bounded keyframe animation.

## Workspace surfaces

| Surface | Behaviour | Persistence |
| --- | --- | --- |
| Stacks | Sidebar tree above Projects. `Skills` and `Tools` load the live runtime registries with search and pagination; selecting an entry shows its instructions or JSON parameter schema. Read-only: no execution, installation or credential access. | Read from the running session |
| Projects | Canonical `Project/<name>/` workspaces from the [project-hygiene](../../skills/meta/project-hygiene/SKILL.md) layout. Browse supported documents, create a project, nest conversations, and start a conversation in a project. Uses the same discovery index as the agent’s projects tool. Delete moves the folder to local trash; conversations remain available without a project. | Local files and session metadata |
| Project uploads | PNG, JPEG, WebP, GIF, PDF, ZIP and text formats up to 12 MiB, written to `Project/<name>/uploads/` with `-2`, `-3` suffixes instead of overwriting. Filenames cannot contain directories. | Local files |
| Settings · context files | Inspect and edit the allowlisted Markdown documents only: global `AGENTS.md`, `CLAUDE.md`, `USER.md`, `MEMORY.md`, `PERSONALITY.md`, `PROMPT.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, `APPEND_PROMPT.md`, plus workspace `AGENTS.md` and `CLAUDE.md`. Edits use a revision hash and are rejected if the agent changed the file in between. Symlinks are refused. | `~/.porcupine/agent/` and the workspace |
| Thinking disclosure | Inline runtime activity with an SVG motion graphic while live. Completed activity with supplied reasoning can expand; activity without reasoning says `Worked for N seconds` and has no empty disclosure. Durations measure observed activity, not provider computation time. Tool rows report actual arguments, output and completion state. | Session events |
| Tool activity | Inline expandable rows at the execution point, with real arguments, streaming output, and running/done/failed state. | Session events; tool calls and results replay on reconnect |
| Context ring | Composer meter of the live context window. Hover or focus shows used / window, percent, the compaction threshold and the sub-agent concurrency limit. | Live session |
| Session limits | Settings → Session limits writes the real global settings: compaction threshold as a percentage of the active model's window, and `subagent.maxConcurrent` (1-8). | `settings.json` |
| Sub-agent activity | A panel beneath Todos shows each worker’s task, semantic activity, animated SVG, status and concise result. No expandable tool trace, raw arguments or logs. | Live snapshots and saved reports |
| Todos | Compact objective and pending/active/verifying/done steps at the upper right. Uses structured `plan` snapshots when present, otherwise tracked `goal` steps. Completion reflects verification-gated runtime state. | Plan tool results replay; goal uses session state |
| Reasoning and Autonomy | Compact SVG controls (hand for Ask, shield for Normal, lightning for Auto; level bars or adaptive sparkle for reasoning) read and write the session's real reasoning mode and Ask/Normal/Auto interaction mode. They are disabled while a turn is running. The available reasoning modes come from the active model. | Session |
| Appearance | Five themes (Workbench, Pixel, Cyberpunk, Static monochrome, Tokyo Night), dark/light/system colour mode, and **Always show reasoning**. Decorative background uploads have been removed. | Browser only |

### Known limits

- Goals are agent-declared and tracked on both surfaces; there is no `/goal` command. The `/plan` artifact writer remains in the terminal client; this browser does not expose a Plan control.
- The agent is told which surface is active and receives a `[Surface switch]` notice when a client attaches or detaches. Switching mid-turn informs the next turn, not the turn already running.
- Conversations can be assigned to canonical Project folders by drag-and-drop or through their actions menu. Assignments persist as session metadata; moving does not change the session ID, history, working directory, trust or permissions. Before later turns, the agent receives the assigned workspace path and its current README.md / STATUS.md.
- Edits to `USER.md`, `MEMORY.md` and other context files take effect for future turns after reload; the UI states this instead of implying an active turn changed.
- The plan tool’s active record remains runtime-local. Saved snapshots restore the displayed checklist; they do not reconstruct the tool’s active store after a runtime restart.

## Interaction and recovery

Settings is divided into Appearance, Models, Limits and Context tabs. The composer grows with the draft, preserves it on a failed send, and rejects duplicate submission while busy. Enter respects IME composition. Each conversation retains its draft for this tab. Token and draft text are not persisted to browser storage.

**Settings → Appearance → Always show reasoning** remembers whether available reasoning should expand automatically. It applies to live and restored blocks; manually collapsing a block is respected during streaming. This is a display preference, separate from the model's reasoning effort. Providers that do not return reasoning text cannot supply a disclosure.

Saved reasoning, code, tool arguments, tool output and edit diffs replay from the selected session branch, including work preceding model-context compaction. Provider signatures and redacted payloads are excluded. Large tool output initially shows a preview with **Show full output**. Historical reasoning has no invented elapsed time. Waiting uses flowing dreaming threads; supplied reasoning uses a pulsing network. Motion stops when activity settles and respects reduced motion.

The active agent session replays its messages, tool calls/results, visuals and sub-agent reports on connection. Pending approvals are restored and settled decisions remain inline. The Todos and sub-agent panels update from structured runtime state; the browser never invents a phase from prose. Main-agent activity stays at its execution point with semantic summaries and distinct terminal, web search, reading, writing, editing, dreaming and reasoning SVGs. Expanding a main-agent activity reveals its actual arguments and output. Replayed content does not replay entrance animations. Scrolling upward suspends automatic following until **Latest message** is selected. Reconnecting and switching conversations preserve the reading position. A disconnected stream disables sending and session controls and exposes **Reconnect**. Delayed model-picker and limit responses cannot overwrite another conversation's controls.

## Browser verification

From the inner repository root, run `node --import tsx packages/coding-agent/test/workbench-browser-smoke.ts` with Playwright Chromium installed. This uses an ephemeral loopback server and synthetic fixtures, checks authenticated SSE delivery, five visual cards, full data tables, follow-up prompt preparation, and no page overflow at 1280, 700, and 390 pixels. It also fails on browser console/page errors or failed HTTP requests. Set `WORKBENCH_QA_SCREENSHOTS` to an existing directory to capture screenshots. It does not invoke a model or use real session credentials.

Custom API sessions without replay support show an explicit live-only notice. The server serves the static page without exposing session data. All session API calls still require the configured bearer token, and the existing same-origin check applies. Keep the server bound to loopback for browser use. Do not send the bearer token over an untrusted network or expose the plain-HTTP server to the public internet.

Run `node --import tsx packages/coding-agent/test/workbench-interaction-smoke.ts` for draft recovery, busy-state handling, chronological inline activity, session switching, transcript restoration, pending approval recovery, settings tabs and responsive navigation. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an installed Chromium binary. These tests use synthetic local fixtures.

Run `node --import tsx packages/coding-agent/test/workbench-replay-smoke.ts` for disk-backed replay, full output and diffs, reasoning preferences, prompt ordering, live and reduced motion, chart/3D redraws, and desktop/mobile layout across all five themes in light, dark and system modes (both system preferences).

## Chat files and photos

Use **＋** beside the composer, paste a photo, or drop files onto the composer. Review previews and removable filename chips before sending. Attach up to eight files, 12 MiB total, with or without text. Failed sends restore both text and attachments. Draft attachments stay in tab memory per conversation and disappear on page reload.

Original files are saved under the agent directory’s `attachments/<session-hash>/` with unique filenames. The agent receives their local paths for ordinary file tools. Supported photos are processed through Porcupine’s image pipeline and sent as real image blocks; photo thumbnails also survive saved conversation replay. Vision interpretation depends on the selected model. Other documents require appropriate agent tools; uploading a PDF does not promise automatic extraction. Files are untrusted input and do not change permissions.

Run `node --import tsx packages/coding-agent/test/workbench-attachments-smoke.ts` for previews, removal, attachment-only sending, failure recovery, isolated session drafts, actual photo input, file readability and photo replay.

## Conversation organization and commands

Drag a conversation onto a Project folder, or use its **⋯ → Project** selector. Choose **No project** to ungroup it. The same menu can delete any idle conversation. Busy sessions and their workers must stop before a move or deletion. Deleted session JSONL files move to their session directory’s `.trash/`; project folders move to `.porcupine-trash/projects/` beneath the workspace. Files remain recoverable, but the GUI has no restore button yet.

Type `/` for a searchable command menu, use arrows to select, Tab to complete, Enter to execute, and Escape to dismiss. `/commands` or `/help` lists the live registry, including extension commands, prompt templates and explicit skills. Browser controls handle `/new`, `/settings`, `/resume`, `/model`, `/modes`, `/reasoning`, `/copy` and `/reasoning-show`. Runtime engines handle naming, usage/cost, resource reload, compaction, project/capability search, memory, learning, trace, guide, context generation and HTML export. Command results are saved without adding command-output noise to model context. Commands that still depend on terminal UI or lifecycle services are marked **terminal only** and return an explanation; they are never forwarded as ordinary model prompts.

Run `node --import tsx packages/coding-agent/test/workbench-organization-smoke.ts` for real project metadata persistence, drag/drop, accessible moves, deletion, slash command completion, session setting changes and command replay.
