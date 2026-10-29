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

Diagram preparation accepts both canonical primitives and compact node notation. A compact box uses `id`, `type: "box"`, centre coordinates `x`/`y`, dimensions `w`/`h`, `label` and `fill`. Arrows can reference existing node IDs with `from`/`to`; preparation converts these to boundary coordinates and supplies a neutral line colour when omitted. A missing diagram title is derived from the description or defaults to "2D diagram". Duplicate IDs, unresolved connections, unknown fields and invalid bounds are rejected. Validation reports the selected visual kind, rather than errors for unrelated workspaces. Multiline labels render on separate lines; smaller screens can scroll the readable diagram viewport.

### Interactive workspaces

The following `visualize` kinds extend the same component identity and session replay flow. Users can inspect and change a workspace locally, then press **Send to agent** to persist that state in conversation history and ask the agent to continue. Unsubmitted changes are not saved across reloads. Updating a component with changed content starts a new revision.

| Kind | Current controls |
| --- | --- |
| `form` | Text, number, choice and toggle fields; required values and number bounds; submitted values restore |
| `table` | Search, sortable columns, row selection, optional cell editing; original row identities retained through sorting |
| `simulation` | Parameter sliders, formula plot, time scrubbing, play/pause/reset; linear, projectile, oscillator, expression and numerical quantum1d models |
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

Built-in simulation parameter names are fixed: `slope`/`intercept`, `speed`/`angle`/`gravity` (angle in degrees), or `amplitude`/`frequency` (cycles per second). For those three presets the plotted interval is 0–10 seconds. These are illustrative formula calculators; they do not run a general solver, enforce ground collisions or validate experimental assumptions. Put units and assumptions in parameter labels and the description. Motion uses linear interpolation, normalized 0–100 positions and at most 60 seconds; playback starts only on user action. Video export, arbitrary meshes, JavaScript formulas and document file mutation inside the card are not implemented. Code changes are requested through the agent's normal tool and permission flow. Evidence links and confidence are model-supplied data, not independent source verification. Spaced review runs only while the deck is open; there is no reminder service.

For a scored quiz, call `visualize` with `kind: "quiz"`, a title and 1–100 questions, displayed five per page. Each question supplies `question`, 2–6 `options`, zero-based `correctAnswers`, an `explanation`, and an optional `hint`. More than one correct answer enables multiple selection. Submission reveals an exact-match score and review for every question; answers and review restore from session history. The score checks the supplied answer key, so the agent must verify that key. Written answers continue through the question card for agent evaluation.

The visualization tools prepare JSON-encoded array arguments before runtime validation, including nested coordinates, chart points and series, and 3D objects. Invalid JSON, wrong shapes and bounds still fail validation.

`visualize` also supports `kind: "question"`: supply a title, question and options. Users can select one answer, select several with `multiple: true`, or write an answer when options is empty. Submission sends a structured response in a normal session message for the agent to evaluate. The card locks after a successful send; failures allow retry. Answers and selected controls restore from conversation history. A changed question revision starts unanswered. This is an initial question component, not automatic scoring or a complete quiz engine. Questions and visual descriptions support the same math rendering as chat.

Supply `componentId` to give a 2D visual, chart or question a stable identity. Later tool calls with the same ID replace that component at its existing position. Without an explicit ID, the browser uses the tool-call ID, which still supports replay and saved question answers. These identities are scoped to the selected session branch; no browser storage is required for answers.

| View | Model tool | Supported content |
| --- | --- | --- |
| 2D diagram | `visualize` with `kind: "diagram"` | Rectangles, circles, arrows, lines, and plain-text labels. Useful for force diagrams, process flows, annotated geometry, and conceptual maps. |
| Chart | `visualize` with `kind: "chart"` | Line, scatter, and grouped bar charts; multiple named series; axis labels and units; optional point annotations and supplied symmetric y uncertainty bars. |
| Interactive 3D scene | `visualize_3d` | Boxes, spheres, arrows and molecular bonds; drag, keyboard, and button rotation controls. |

Each view has a title and optional explanation. Charts expose all supplied values in an accessible data table, retaining full precision even when canvas labels are abbreviated. Diagrams expose object positions and labels as text. The new 2D/chart cards include **Ask about this visual**, which prepares a follow-up prompt without sending it. The model also receives a text fallback from `visualize`, so the explanation remains usable in non-graphical clients.

Attaching the browser activates the configured `visualize` and `visualize_3d` tools for future turns. Explicitly excluded tools remain unavailable. The agent is instructed to choose diagrams for relationships, charts for supplied data, and 3D for spatial structure when useful, without requiring a separate visualization request.

Chat replies and reasoning use locally served KaTeX and fonts for math: `\(...\)` and `$...$` inline, `\[...\]` and `$$...$$` for display equations. Fractions, integrals, aligned equations, cases and matrices use standard KaTeX syntax. Table cells support math, including vertical bars inside expressions. Code fences remain literal. Incomplete or unsupported expressions remain visible; HTML and external-resource commands are untrusted. Canvas labels use positioned math overlays when they contain supported notation.

For example, ask: "Teach me Newton's second law with a labelled 2D force diagram" or "Plot these measurements against time with units and the uncertainty I supplied." Diagrams use positive y pointing upwards. Chart x values are numeric; use point labels for discrete category names. Line segments connect samples in the supplied order.

### Scientific integrity and bounds

- Chart supplied data only. Clearly identify illustrative or synthetic examples in the title or description. Do not present model-generated examples as measurements.
- Put units in `xLabel` and `yLabel`. Optional `error` is an absolute symmetric y uncertainty (`y ± error`), not a percentage. Omitted uncertainty is shown as **Not supplied**, not silently treated as a measured zero.
- 2D diagrams allow at most 1000 objects and 3D scenes at most 2000 objects with coordinates in `[-20, 20]`. Charts allow at most 16 series, 10000 points per series and 40000 total points, with finite coordinates in `[-1e12, 1e12]`. Uncertainty must be finite and in `[0, 1e12]`.
- Backend validation and independent browser validation reject unsupported types, extra properties, and out-of-bounds data. The model supplies data, not executable code, HTML, meshes, URLs, or external assets. Formula labels use the shared math renderer. Mathematical chart series may supply `expression`, `domain:[min,max]`, and `samples` instead of points; a bounded arithmetic parser samples them without evaluating JavaScript. It supports explicit multiplication, powers, constants pi/e and standard math functions. Nonfinite or out-of-range samples are rejected. Full data is available in paginated tables and CSV export.
- Heatmaps, surface plots, chart animation and user-authored drawing are not implemented. The separate motion component supports bounded keyframe animation.

Expression simulations accept `model: "expression"`, `expression: {x:"t",y:"exp(-a*t^2)*cos(t)",duration:20,samples:1000}` and up to 12 named slider parameters. Up to 2000 samples and 3600 seconds are supported. This extends analytical models; it is not an arbitrary PDE solver. Quizzes accept 100 questions, paginated five at a time; flashcards accept 500 cards. 3D molecular geometry uses verified atom spheres and rounded `bond` objects with `from`, `to`, `radius`, and `color`. Geometry and measurements are supplied by the agent, not inferred or chemically validated by the renderer.

### 1D quantum simulation

Use `model: "quantum1d"` with `quantum: {domain:[-8,8],grid:128,timeStep:0.01,duration:4,potential:"x^2/2"}` and slider parameters `mass`, `hbar`, `center`, `width`, `momentum`. The Gaussian packet evolves under the time-independent real potential using Crank–Nicolson, with zero endpoint boundaries. `mass`, `hbar` and `width` must remain positive. Use consistent scaled units and explain them. The view plots probability density and reports its integral; sliders rebuild the initial state, and scrubbing backward recomputes it. Grid size is 64–256, duration at most 10, time step 0.0001–0.02, with at most 4000 steps. Check convergence by refining grid and time step before scientific use. This is a one-dimensional finite-domain solver, not a general PDE or molecular dynamics engine. See the quantum example in the bundled Adaptive GUI examples.

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
| Sub-agent activity | Shows only active workers with task, semantic activity and animated SVG. Completed workers disappear from the panel. Peer messages and expandable reports appear separately in chat, without execution accounting headers. | Live active-worker snapshots; chat messages and reports replay |
| Todos | Compact objective and pending/active/verifying/done steps at the upper right. Uses structured `plan` snapshots when present, otherwise tracked `goal` steps. Completion reflects verification-gated runtime state. | Plan tool results replay; goal uses session state |
| Reasoning and Autonomy | Compact SVG controls (hand for Ask, shield for Normal, lightning for Auto; level bars or adaptive sparkle for reasoning) read and write the session's real reasoning mode and Ask/Normal/Auto interaction mode. They are disabled while a turn is running. The available reasoning modes come from the active model. | Session |
| Appearance | Five themes (Workbench, Pixel, Cyberpunk, Static monochrome, Tokyo Night), defaulting to Pixel with system colour mode, and **Always show reasoning**. Decorative background uploads have been removed. | Browser only |

### Known limits

- Goals are agent-declared and tracked on both surfaces; there is no `/goal` command. The `/plan` artifact writer remains in the terminal client; this browser does not expose a Plan control.
- The agent is told which surface is active and receives a `[Surface switch]` notice when a client attaches or detaches. Switching mid-turn informs the next turn, not the turn already running.
- Conversations can be assigned to canonical Project folders by drag-and-drop or through their actions menu. Assignments persist as session metadata; moving does not change the session ID, history, working directory, trust or permissions. Before later turns, the agent receives the assigned workspace path and its current README.md / STATUS.md.
- Edits to `USER.md`, `MEMORY.md` and other context files take effect for future turns after reload; the UI states this instead of implying an active turn changed.
- The plan tool’s active record remains runtime-local. Saved snapshots restore the displayed checklist; they do not reconstruct the tool’s active store after a runtime restart.

## Interaction and recovery

Each theme has coordinated backgrounds, raised surfaces, message bubbles, selection and
focus colours. Workbench uses slate/blue, Pixel uses paper/forest or indigo/mint, Tokyo
Night uses ink/periwinkle, Cyberpunk uses plum/teal, and Static stays monochrome. Small
activity accents distinguish coding, reading skills, search and peer communication;
status labels and icon shapes remain present so colour is never the only cue.

Appearance settings place Todos and Subagents independently in the side rail, as a floating overlay on chat, or hide them entirely. Hidden panels do not reserve a side column. Active worker summaries disappear on completion. Starting/stopping workers and sending/checking messages use compact collaboration rows; failed actions remain visibly failed on replay. Short messages open immediately. Reports start collapsed and expand to Markdown and math, without the step/token accounting header.

Floating panels stay in the outer conversation’s upper-right corner, outside the centred transcript anchor. They remain clear of the header, composer and any open side rail, and scroll independently in short layouts. The Tasks open/closed state persists across reloads. Appearance, colour mode, independent panel placements, and panel disclosure choices retain the user’s last selection in this browser; Pixel/System is only the fallback when no valid preference exists. **Escape** dismisses an open task overlay and returns focus to **Tasks**; an open settings dialog keeps its own Escape behavior. Goal/Plan steps remain above Subagents when both share a panel location. On mobile, the navigation drawer contains keyboard focus and returns it to the navigation toggle when closed.

Chemistry notation uses the locally bundled mhchem extension (`\ce`, `\pu`). Physics macros include `\bra`, `\ket`, two-argument `\braket`, `\ketbra`, `\dv`, `\pdv`, `\abs` and `\norm`. These do not implement a general TeX compiler or arbitrary LaTeX packages; generate and share a PDF for those documents.

Math uses the shared KaTeX path in workspace content and labels, including DOM overlays for canvas diagrams/charts, 3D labels and motion text. Timelines and flashcards recognize a limited set of standalone ASCII formulas such as difference quotients and derivative operators. Explicit LaTeX delimiters remain preferred; prose and code are preserved, and unsupported syntax stays visible. Text inputs, native dropdown values and source editors retain editable source; math-bearing form selections and table text cells also show a rendered preview.

Clipboard file items and clipboard file lists can be pasted into the composer, with image previews and removable attachments. Mixed file/text pastes retain the text at the cursor. Plain text paste keeps native editor behavior. Native file clipboard availability depends on the browser and OS; the file picker and drag/drop use the same attachment pipeline.

Repeated math expressions reuse a bounded render cache, and unchanged reasoning text skips redundant rendering. The Pixel theme uses sharper controls, neutral selection, stronger focus indicators and improved text contrast; photos retain normal image rendering.

While the agent works, the composer changes **Send** to **Queue follow-up**. Text and file/photo prompts use the runtime's steering queue: they enter context at the next model step after the current tool batch or model generation finishes, without waiting for the whole task or final answer. Already-issued tool calls finish safely; queueing does not kill a running command or splice text into an in-flight provider request. Slash commands retain their command behavior. **Queued · sends at next step** shows pending prompts and lets users remove an item before delivery. Queue order and images are preserved, and reconnecting reads the live runtime queue. A stale removal is rejected rather than deleting another prompt; peer reports and separate runtime follow-ups remain intact. Up to 20 prompts may wait. Pending prompts are held in runtime memory, so restarting the server does not restore unsent queued work; delivered prompts enter normal session history.

Settings is divided into Appearance, Models, Limits and Context tabs. The composer grows with the draft, preserves it on a failed send, and rejects duplicate submission while busy. Enter respects IME composition. Each conversation retains its draft for this tab. Token and draft text are not persisted to browser storage.

**Settings → Appearance → Always show reasoning** remembers whether available reasoning should expand automatically. It applies to live and restored blocks; manually collapsing a block is respected during streaming. This is a display preference, separate from the model's reasoning effort. Providers that do not return reasoning text cannot supply a disclosure.

Collapsed reasoning retains its latest text without repeatedly typesetting hidden content. Opening it renders the latest version; expanded streaming updates are batched per frame. Long histories restore in ordered batches, yield to the interface, preserve the reading position and cancel stale restoration when another conversation is selected. Live events wait for restoration to finish. The conversation log can receive keyboard focus and is marked busy while streaming or restoring.

**Settings → Appearance → Reduce motion** saves a preference for still activity icons and instant transitions. The operating system's reduced-motion setting is also honored. Pixel highlights the complete composer while it contains focus; individual action buttons retain keyboard focus indicators. On small screens, primary controls have larger touch targets, input text avoids automatic mobile zoom, and the composer follows visible-viewport height changes. The model list supports Arrow Up/Down, Home and End; Enter/Space activates a focused option.

Saved reasoning, code, tool arguments, tool output and edit diffs replay from the selected session branch, including work preceding model-context compaction. Provider signatures and redacted payloads are excluded. Large tool output initially shows a preview with **Show full output**. Historical reasoning has no invented elapsed time. Live reasoning uses a compact blue neutron star with a rotating beam and pulsing core. Coding uses a laptop with typing code; skill reading, file reading, web search, tool use, planning, spawning, messaging and reports have distinct SVG scenes. Pixel uses stepped motion. Motion stops when activity settles and respects reduced motion.

The active agent session replays its messages, tool calls/results, visuals on connection, with current active-worker snapshots. Pending approvals are restored and settled decisions remain inline. The Todos and sub-agent panels update from structured runtime state; the browser never invents a phase from prose. Main-agent activity stays at its execution point with semantic summaries and distinct terminal, web search, reading, writing, editing, dreaming and reasoning SVGs. Expanding a main-agent activity reveals its actual arguments and output. Replayed content does not replay entrance animations. Scrolling upward suspends automatic following until **Latest message** is selected. Reconnecting and switching conversations preserve the reading position. A disconnected stream disables sending and session controls and exposes **Reconnect**. Delayed model-picker and limit responses cannot overwrite another conversation's controls.

## Browser verification

From the inner repository root, run `node --import tsx packages/coding-agent/test/workbench-browser-smoke.ts` with Playwright Chromium installed. This uses an ephemeral loopback server and synthetic fixtures, checks authenticated SSE delivery, five visual cards, full data tables, follow-up prompt preparation, and no page overflow at 1280, 700, and 390 pixels. It also fails on browser console/page errors or failed HTTP requests. Set `WORKBENCH_QA_SCREENSHOTS` to an existing directory to capture screenshots. It does not invoke a model or use real session credentials.

Custom API sessions without replay support show an explicit live-only notice. The server serves the static page without exposing session data. All session API calls still require the configured bearer token, and the existing same-origin check applies. Keep the server bound to loopback for browser use. Do not send the bearer token over an untrusted network or expose the plain-HTTP server to the public internet.

Run `node --import tsx packages/coding-agent/test/workbench-interaction-smoke.ts` for draft recovery, busy-state handling, chronological inline activity, session switching, transcript restoration, pending approval recovery, settings tabs and responsive navigation. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an installed Chromium binary. These tests use synthetic local fixtures.

Run `node --import tsx packages/coding-agent/test/workbench-replay-smoke.ts` for disk-backed replay, full output and diffs, reasoning preferences, prompt ordering, live and reduced motion, chart/3D redraws, and desktop/mobile layout across all five themes in light, dark and system modes (both system preferences).

## Chat files and photos

Agents can share workspace files in replies using ordinary Markdown: `[Report](reports/report.pdf)`
creates a compact file card; `![Plot](images/plot.png)` adds an inline raster-image preview.
Absolute paths inside the conversation workspace and `sandbox:/` destinations also work.
Percent-encode spaces in destinations. **Preview / download** opens a viewer with image,
PDF or literal text content, **Open in new tab**, and **Download**. Other formats, including
Office documents, archives, HTML and SVG, remain downloadable files. PDF display depends
on the browser's built-in viewer; open/download remain available if embedding is unsupported.

Shared files must be regular files inside the conversation's original working directory,
at most 25 MiB each. Hidden paths, symlinks and outside-workspace paths are refused.
Project assignment does not change this directory. File requests use the session's bearer
authentication; credentials are never embedded in a download URL. Inline images load as
they enter view. Text previews show up to 256 KiB. Replayed links read the current file;
they are not versioned copies, and missing files show an error with a retry path.

Use **＋** beside the composer, paste a photo, or drop files onto the composer. Review previews and removable filename chips before sending. Attach up to eight files, 12 MiB total, with or without text. Failed sends restore both text and attachments. Draft attachments stay in tab memory per conversation and disappear on page reload.

Original files are saved under the agent directory’s `attachments/<session-hash>/` with unique filenames. The agent receives their local paths for ordinary file tools. Supported photos are processed through Porcupine’s image pipeline and sent as real image blocks; photo thumbnails also survive saved conversation replay. Vision interpretation depends on the selected model. Other documents require appropriate agent tools; uploading a PDF does not promise automatic extraction. Files are untrusted input and do not change permissions.

Run `node --import tsx packages/coding-agent/test/workbench-attachments-smoke.ts` for previews, removal, attachment-only sending, failure recovery, isolated session drafts, actual photo input, file readability and photo replay.

## Conversation organization and commands

Click a project title to open its page: a title, a description of up to three lines, its chats and its resources. **New project** accepts an optional short description, stored as the README objective; existing projects use their README objective or introductory paragraph. **Add resources** accepts multiple supported files and retains the existing upload limits. Select a resource for authenticated PDF, image or text preview, opening or download. **Back to chat** restores the current conversation without discarding its draft or stopping its work.

Use **Pin project** on the project page to keep it at the top of Projects. Unpin from the same button. Pins persist atomically in the project’s hidden `.workbench-pin` file across browser and server restarts; they do not change chat pins or project assignments. Project management actions stay in a collapsed disclosure.

Use **⋯ → Pin conversation** to keep a chat in the sidebar’s **Pinned** section. Unpin it from the same menu. Pins persist with session metadata across server restarts, keep the existing project association, and can be changed while the agent works. Pinned chats appear once, and search includes them.

Drag a conversation onto a Project folder, or use its **⋯ → Project** selector. Choose **No project** to ungroup it. The same menu can delete any idle conversation. Busy sessions and their workers must stop before a move or deletion. Deleted session JSONL files move to their session directory’s `.trash/`; project folders move to `.porcupine-trash/projects/` beneath the workspace. Files remain recoverable, but the GUI has no restore button yet.

Type `/` for a searchable command menu, use arrows to select, Tab to complete, Enter to execute, and Escape to dismiss. `/commands` or `/help` lists the live registry, including extension commands, prompt templates and explicit skills. Browser controls handle `/new`, `/settings`, `/resume`, `/model`, `/modes`, `/reasoning`, `/copy` and `/reasoning-show`. Runtime engines handle naming, usage/cost, resource reload, compaction, project/capability search, memory, learning, trace, guide, context generation and HTML export. Command results are saved without adding command-output noise to model context. Commands that still depend on terminal UI or lifecycle services are marked **terminal only** and return an explanation; they are never forwarded as ordinary model prompts.

Commands consume their submitted text immediately and preserve anything typed while the command runs. Failed commands restore their text alongside the newer draft. Delayed message/card responses cannot clear another chat’s working state or copy an answer into its component cache, and older queue-removal responses cannot resurrect prompts already delivered by live events.

Run `node --import tsx packages/coding-agent/test/workbench-organization-smoke.ts` for real project metadata persistence, drag/drop, accessible moves, deletion, slash command completion, session setting changes and command replay.
