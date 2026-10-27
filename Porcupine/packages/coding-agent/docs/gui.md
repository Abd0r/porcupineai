# Local Browser Workbench

`porcupine --serve` serves a local browser workbench at the server root, for example `http://127.0.0.1:4096/`. The existing terminal interface remains available; the workbench is an additional client of the same session API.

Start the server with a token:

```bash
porcupine --serve --port 4096 --token <secret>
```

Open the local address in your browser and enter the token in the connection form. The page keeps it in memory for that tab only. For an explicitly tokenless loopback server, set `PORCUPINE_SERVE_ALLOW_TOKENLESS=1` as documented in [server.md](./server.md).

The workbench supports session selection and creation, live message events, prompt submission, abort, explicit permission decisions, and model-requested visual explanations. Tool calls, results, goal changes, sub-agent activity, approvals, answers and visuals share one chronological conversation flow.

The Conversations list discovers saved Porcupine sessions using the same session index as the terminal, retaining saved names and first-message titles. Selecting a saved conversation loads its runtime on demand; new conversations get independent runtimes. The initial selection remains the server's active conversation. Conversations and workspace Projects rescan when the browser regains focus. Existing Project folder names retain their spelling and spaces.

The interface uses an open conversation column, neutral surfaces, compact controls, and a shared adaptive width for text, figures, and the composer. Its semantic tokens and layout patterns are adapted from the MIT-licensed DeepSeek Harness UI, not its branding or plugin runtime. See [source notes and license](./gui-third-party-notices.md).

## Visual explanations

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
- This is a first visual communication layer, not a general plotting package or scientific solver. Heatmaps, surface plots, animation, and user-authored drawing are not implemented.

## Workspace surfaces

| Surface | Behaviour | Persistence |
| --- | --- | --- |
| Stacks | Sidebar tree above Projects. `Skills` and `Tools` load the live runtime registries with search and pagination; selecting an entry shows its instructions or JSON parameter schema. Read-only: no execution, installation or credential access. | Read from the running session |
| Projects | Canonical `Project/<name>/` workspaces from the [project-hygiene](../../skills/meta/project-hygiene/SKILL.md) layout. Browse supported documents, preview text, and create a new project with README.md plus STATUS.md. | Local files; nothing is deleted |
| Project uploads | PNG, JPEG, WebP, GIF, PDF, ZIP and text formats up to 12 MiB, written to `Project/<name>/uploads/` with `-2`, `-3` suffixes instead of overwriting. Filenames cannot contain directories. | Local files |
| Settings · context files | Inspect and edit the allowlisted Markdown documents only: global `AGENTS.md`, `CLAUDE.md`, `USER.md`, `MEMORY.md`, `PERSONALITY.md`, `PROMPT.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, `APPEND_PROMPT.md`, plus workspace `AGENTS.md` and `CLAUDE.md`. Edits use a revision hash and are rejected if the agent changed the file in between. Symlinks are refused. | `~/.porcupine/agent/` and the workspace |
| Thinking disclosure | Inline runtime activity with an SVG motion graphic while live. Completed activity with supplied reasoning can expand; activity without reasoning says `Worked for N seconds` and has no empty disclosure. Durations measure observed activity, not provider computation time. Tool rows report actual arguments, output and completion state. | Session events |
| Tool activity | Inline expandable rows at the execution point, with real arguments, streaming output, and running/done/failed state. | Session events; tool calls and results replay on reconnect |
| Context ring | Composer meter of the live context window. Hover or focus shows used / window, percent, the compaction threshold and the sub-agent concurrency limit. | Live session |
| Session limits | Settings → Session limits writes the real global settings: compaction threshold as a percentage of the active model's window, and `subagent.maxConcurrent` (1-8). | `settings.json` |
| Sub-agent activity | One compact row per delegated task shows its status, with final reports in the conversation. Internal tool names, arguments, logs and step chatter are not exposed in the GUI. | Session events |
| Goal tracker | Inline goal updates at their event position, with collapsible steps and real statuses. Goals are declared by the agent with the `goal` tool; there is no `/goal` command on either surface. | Session entry shared with the terminal |
| Reasoning and Autonomy | Composer selectors read and write the session's real reasoning mode and Ask/Normal/Auto interaction mode. They are disabled while a turn is running. The available reasoning modes come from the active model. | Session |
| Appearance | Five themes (Workbench, Pixel, Cyberpunk, Static monochrome, Tokyo Night), dark/light/system colour mode, and a local chat background with opacity. Images stay in this browser (IndexedDB) and are never sent to the model. | Browser only |

### Known limits

- Goals are agent-declared and tracked on both surfaces; there is no `/goal` command. The `/plan` artifact writer remains in the terminal client; this browser does not expose a Plan control.
- The agent is told which surface is active and receives a `[Surface switch]` notice when a client attaches or detaches. Switching mid-turn informs the next turn, not the turn already running.
- Conversations are not yet attached to Project folders. Project documents are browsable, but a chat is not grouped under its project.
- Edits to `USER.md`, `MEMORY.md` and other context files take effect for future turns after reload; the UI states this instead of implying an active turn changed.
- Background upload sets a decorative image only. It is not a scientific figure and is never referenced in prompts.

## Interaction and recovery

Settings is divided into Appearance, Models, Limits and Context tabs. The composer grows with the draft, preserves it on a failed send, and rejects duplicate submission while busy. Enter respects IME composition. Each conversation retains its draft for this tab. Token and draft text are not persisted to browser storage.

**Settings → Appearance → Always show reasoning** remembers whether available reasoning should expand automatically. It applies to live and restored blocks; manually collapsing a block is respected during streaming. This is a display preference, separate from the model's reasoning effort. Providers that do not return reasoning text cannot supply a disclosure.

Saved reasoning, code, tool arguments, tool output and edit diffs replay from the selected session branch, including work preceding model-context compaction. Provider signatures and redacted payloads are excluded. Large tool output initially shows a preview with **Show full output**. Historical reasoning has no invented elapsed time. Its SVG animation uses flowing threads only during live activity and respects reduced motion.

The active agent session replays its messages, tool calls/results, visuals and sub-agent reports on connection. Pending approvals are restored and settled decisions remain inline. Goals and live sub-agent progress append at their event positions; the browser never invents a phase from prose. Older goal/progress snapshots are not a separate durable event log. Replayed content does not replay entrance animations. Scrolling upward suspends automatic following until **Latest message** is selected. Reconnecting and switching conversations preserve the reading position. A disconnected stream disables sending and session controls and exposes **Reconnect**. Delayed model-picker and limit responses cannot overwrite another conversation's controls.

## Browser verification

From the inner repository root, run `node --import tsx packages/coding-agent/test/workbench-browser-smoke.ts` with Playwright Chromium installed. This uses an ephemeral loopback server and synthetic fixtures, checks authenticated SSE delivery, five visual cards, full data tables, follow-up prompt preparation, and no page overflow at 1280, 700, and 390 pixels. It also fails on browser console/page errors or failed HTTP requests. Set `WORKBENCH_QA_SCREENSHOTS` to an existing directory to capture screenshots. It does not invoke a model or use real session credentials.

Custom API sessions without replay support show an explicit live-only notice. The server serves the static page without exposing session data. All session API calls still require the configured bearer token, and the existing same-origin check applies. Keep the server bound to loopback for browser use. Do not send the bearer token over an untrusted network or expose the plain-HTTP server to the public internet.

Run `node --import tsx packages/coding-agent/test/workbench-interaction-smoke.ts` for draft recovery, busy-state handling, chronological inline activity, session switching, transcript restoration, pending approval recovery, settings tabs and responsive navigation. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an installed Chromium binary. These tests use synthetic local fixtures.

Run `node --import tsx packages/coding-agent/test/workbench-replay-smoke.ts` for disk-backed replay, full output and diffs, reasoning preferences, prompt ordering, live and reduced motion, chart/3D redraws, and desktop/mobile layout across all five themes in light, dark and system modes (both system preferences).
