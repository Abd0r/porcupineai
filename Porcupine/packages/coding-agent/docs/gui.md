# Local Browser Workbench

`porcupine --serve` serves a local browser workbench at the server root, for example `http://127.0.0.1:4096/`. The existing terminal interface remains available; the workbench is an additional client of the same session API.

Start the server with a token:

```bash
porcupine --serve --port 4096 --token <secret>
```

Open the local address in your browser and enter the token in the connection form. The page keeps it in memory for that tab only. For an explicitly tokenless loopback server, set `PORCUPINE_SERVE_ALLOW_TOKENLESS=1` as documented in [server.md](./server.md).

The workbench supports session selection and creation, live message events, prompt submission, abort, explicit permission decisions, and model-requested visual explanations. Visuals sit alongside the conversation, especially for teaching, conceptual explanations, and scientific communication.

The interface uses an open conversation column, neutral surfaces, compact controls, and a shared adaptive width for text, figures, and the composer. Its semantic tokens and layout patterns are adapted from the MIT-licensed DeepSeek Harness UI, not its branding or plugin runtime. See [source notes and license](./gui-third-party-notices.md).

## Visual explanations

| View | Model tool | Supported content |
| --- | --- | --- |
| 2D diagram | `visualize` with `kind: "diagram"` | Rectangles, circles, arrows, lines, and plain-text labels. Useful for force diagrams, process flows, annotated geometry, and conceptual maps. |
| Chart | `visualize` with `kind: "chart"` | Line, scatter, and grouped bar charts; multiple named series; axis labels and units; optional point annotations and supplied symmetric y uncertainty bars. |
| Interactive 3D scene | `visualize_3d` | Boxes, spheres, and arrows; drag, keyboard, and button rotation controls. |

Each view has a title and optional explanation. Charts expose all supplied values in an accessible data table, retaining full precision even when canvas labels are abbreviated. Diagrams expose object positions and labels as text. The new 2D/chart cards include **Ask about this visual**, which prepares a follow-up prompt without sending it. The model also receives a text fallback from `visualize`, so the explanation remains usable in non-graphical clients.

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
| Thinking disclosure | Inline in the transcript, where the reasoning actually happened: a compact `Thinking…` row while the turn is live, then `Thought for N seconds`. Ten abstract SVG marks cycle at 1.2s while live and stop on settle. Expanding shows the model's own chain of thought in grey, above the answer. The marks are ornament and never claim a specific activity; tool rows report tools separately. | Session events |
| Sub-agent card | Directly below the Goal card, same collapsible header. Lists each sub-agent as it reports, with a running or finished state and its latest line. Empty state says so plainly. | Session sub-agent messages |
| Context ring | Top right of the panel: a circular meter of the live context window. Hover or focus shows used / window, percent, the compaction threshold and the sub-agent concurrency limit. | Live session |
| Session limits | Settings → Session limits writes the real global settings: compaction threshold as a percentage of the active model's window, and `subagent.maxConcurrent` (1-8). | `settings.json` |
| Sub-agent activity | Sub-agent messages and reports render as compact activity lines in the conversation, never as fake progress bars. | Session events |
| Goal tracker | Top-left card showing the agent's tracked goal, its steps and their real status, plus the Plan-fence indicator. Goals are declared by the agent with the `goal` tool; there is no `/goal` command on either surface. | Session entry shared with the terminal |
| Reasoning and Autonomy | Composer selectors read and write the session's real reasoning mode and Ask/Normal/Auto interaction mode. They are disabled while a turn is running. The available reasoning modes come from the active model. | Session |
| Plan | A real fence: while on, mutating tools are blocked for subsequent turns. It is not a saved plan artifact. | Session |
| Appearance | Five themes (Workbench, Pixel, Cyberpunk, Static monochrome, Tokyo Night), dark/light/system colour mode, and a local chat background with opacity. Images stay in this browser (IndexedDB) and are never sent to the model. | Browser only |

### Known limits

- Goals are agent-declared and tracked on both surfaces; there is no `/goal` command. The `/plan` artifact writer still lives in the terminal client, so the browser shows the fence without writing plan files.
- The agent is told which surface is active and receives a `[Surface switch]` notice when a client attaches or detaches. Switching mid-turn informs the next turn, not the turn already running.
- Conversations are not yet attached to Project folders. Project documents are browsable, but a chat is not grouped under its project.
- Edits to `USER.md`, `MEMORY.md` and other context files take effect for future turns after reload; the UI states this instead of implying an active turn changed.
- Background upload sets a decorative image only. It is not a scientific figure and is never referenced in prompts.

## Browser verification

From the inner repository root, run `node_modules/.bin/tsx packages/coding-agent/test/workbench-browser-smoke.ts` with Playwright Chromium installed. This uses an ephemeral loopback server and synthetic fixtures, checks authenticated SSE delivery, five visual cards, full data tables, follow-up prompt preparation, and no page overflow at 1280, 700, and 390 pixels. It also fails on browser console/page errors or failed HTTP requests. Set `WORKBENCH_QA_SCREENSHOTS` to an existing directory to capture screenshots. It does not invoke a model or use real session credentials.

The view shows activity from the time a session is opened; the current HTTP API does not provide prior transcript history. The server serves the static page without exposing session data. All session API calls still require the configured bearer token, and the existing same-origin check applies. Keep the server bound to loopback for browser use. Do not send the bearer token over an untrusted network or expose the plain-HTTP server to the public internet.
