# TUI ↔ GUI contract

Every TUI capability is a required GUI capability. Both surfaces must operate on the same runtime truth: session identity, branch, context, model, policy, tools, durable tasks, projects and evidence. Presentation and keyboard bindings may differ. A browser control must provide the same semantic action and its cancellation/error behavior; a message saying “use the terminal” is an unfinished feature.

The machine-readable source is [`src/core/surface-contract.ts`](../src/core/surface-contract.ts). GUI command discovery consumes it directly. `/parity` returns its current report as text and structured JSON in the authenticated command API. Hidden TUI presentations remain hidden in ordinary completion. Adding a TUI command without a contract entry fails `npm run check`; the audit inspects both the built-in catalog and actual TUI dispatch using TypeScript's syntax tree. Removed commands cannot leave stale entries behind.

`implemented` describes available behavior, **not certification that every environment was tested**. `partial` means an existing action falls short of its acceptance criteria. `missing` is required work, with no successful GUI dispatch. Missing handlers return HTTP 501, do not call the model, do not append a successful command result, and restore the user's draft. Client-only actions cannot masquerade as successful server execution. Full parity remains incomplete until every requirement is implemented **and** its acceptance evidence passes. Known gaps remain visible; passing the coverage audit does not certify those gaps.

`npm run check:surface-contract` is the coverage/documentation gate included in normal checks. `npm run check:surface-parity` is the strict completeness gate: it deliberately fails while any command or runtime requirement is partial or missing. Once implementation is complete, runtime and visual acceptance evidence is still required; completeness metadata cannot substitute for those tests.

## Acceptance and verification

For each requirement being completed:

1. Add a failing behavioral regression before changing runtime behavior. Exercise shared engines and persisted data rather than an imitation GUI state machine. Use faux providers and disposable files, never paid API calls or real messages/publication.
2. Check the corresponding TUI and authenticated GUI paths: arguments, state transitions, results, cancellation, busy state, errors and reconnection. For handoff, close the outgoing owner, reopen the same saved session in the other surface, and continue using the restored context. Never permit two independent processes to write the same session file concurrently.
3. Check isolation: a response belongs to its original session/branch; a stale response cannot clear another draft, approve a different request or overwrite newer data. Scope providers, settings and tools to the configured agent home.
4. For GUI changes, run the application and inspect the actual interaction. Check all five themes equally, light/dark/system modes, desktop/mobile widths, keyboard access, reduced motion, and side/overlay/hidden panel placements where relevant. Record what was actually exercised; API tests do not prove visual quality, and screenshots do not prove permission or persistence behavior.
5. Run focused regressions and `npm run check`. Update the contract and regenerate this matrix with `node scripts/check-surface-contract.mjs --write`. Do not change a gap to `implemented` merely to make a status report look complete.

The current regression set includes `surface-contract.test.ts` (exhaustive discovery and honest dispatch), `surface-contract-ui.test.ts` (completion labels and failed-draft recovery), `workbench-commands.test.ts` (shared accounting, stack queries, JSONL export, saved subagent recall and tasks), `gui-session-continuity.test.ts` (saved TUI → GUI → TUI context/identity), and the attended task runner's SDK tests (real tools and GUI permission decisions). Additional feature-specific suites remain necessary for the gaps below.

## Required matrix

This section is generated from the contract and checked for drift. Browser preferences are presentation state; shared runtime state must never be duplicated in browser storage.

<!-- surface-contract:start -->

Contract v1: **61 commands**, **18 runtime requirements**. Full implementation parity: **not complete**.

| Command | GUI status | Delivery | Acceptance criteria | Remaining work |
| --- | --- | --- | --- | --- |
| /guide | implemented | engine | Render the same workflow guide and topic selection without a model call. |  |
| /settings | partial | client | Read and persist every applicable runtime setting; browser appearance may differ. | Appearance, models, limits and context exist; the remaining TUI settings need GUI controls. |
| /model | implemented | engine | Select the same provider/model and preserve the conversation; use a browser picker when no argument is supplied. |  |
| /scoped-models | missing | missing | Edit and persist the model cycling scope with the same model validation. | The GUI model picker does not expose the TUI's scoped-model selection. |
| /export | partial | engine | Export real HTML or JSONL, preserve session entries and support quoted paths. | Host HTML/JSONL export works; direct browser export downloads still need a dedicated action. |
| /import | missing | missing | Import JSONL into a resumable session with validated cwd, collision handling and lifecycle hooks. | GUI upload/import and runtime replacement are not wired. |
| /share | missing | missing | Preview and explicitly approve the same secret-gist session sharing action. | The GUI has no session-sharing preview or publishing action. |
| /copy | implemented | client | Copy the last completed assistant answer; preserve the draft and report clipboard failures. |  |
| /name | implemented | engine | Persist the selected conversation's display name without changing its identity or history. |  |
| /session | implemented | engine | Read the real session identity, cwd, message counts, model context and policy. |  |
| /trace | implemented | engine | Resolve the same step or all-steps trajectory from persisted session entries. |  |
| /usage | implemented | engine | Render shared per-turn token usage and session totals from persisted and live accounting. |  |
| /cost | implemented | engine | Render shared model-attributed costs and token fallback when pricing is unavailable. |  |
| /changelog | implemented | engine | Read packaged release notes without invoking the agent or fetching unrelated content. |  |
| /kill | implemented | engine | Abort the current run, bash and subagents; report actual terminal states and preserve completed history. |  |
| /view | missing | missing | Open a user-selected Markdown resource with safe rendering, math, scrolling and a close action. | Resource previews exist, but /view is not connected to the browser viewer. |
| /hotkeys | implemented | client | Show the browser's equivalent keyboard actions without advertising terminal-only key sequences. |  |
| /fork | missing | missing | Fork before a selected user message, retain ancestry, run lifecycle hooks and restore the selected text as a draft. | GUI message selection and runtime fork/navigation are missing. |
| /clone | missing | missing | Clone the selected leaf into an independent conversation without modifying the original. | GUI cloning is not connected to the shared session runtime. |
| /tree | missing | missing | Inspect branches and switch the active leaf without losing saved history, tools or context. | The GUI does not expose session tree navigation. |
| /trust | missing | missing | Persist a deliberate project trust decision and reload resources through the shared trust policy. | There is no GUI project trust selector or matching runtime replacement flow. |
| /login | missing | missing | Configure provider API-key, subscription or OAuth authentication without secrets entering chat, logs or replay. | Secure provider authentication forms and OAuth progress are not wired into the GUI. |
| /logout | missing | missing | Remove the selected provider's stored authentication and refresh model availability without exposing credentials. | Provider logout and credential-state refresh are not available in the GUI. |
| /new | implemented | client | Create a new conversation while keeping the original saved and its unsent draft isolated. |  |
| /compact | implemented | engine | Use the session's compaction engine and preserve the full saved transcript for replay. |  |
| /resume | implemented | client | Discover and resume the same saved session, model context and identity; retain another chat's draft. |  |
| /reload | partial | engine | Reload applicable resources for future turns without changing schemas already resolved for a running turn. | Session resource reload works; browser catalog refresh and extension UI rebinding need acceptance coverage. |
| /refresh | missing | missing | Rebuild services and resume the same saved session, honouring cancellation and extension lifecycle hooks. | The server adapter cannot yet rebind itself after a full runtime refresh. |
| /restart | missing | missing | Restart the host and reconnect to the same saved session without replaying unfinished tasks. | GUI host restart, launch-token rotation and reconnection are not implemented. |
| /reasoning | implemented | engine | Use the same supported reasoning levels and adaptive policy; reject unsupported model levels. |  |
| /thinking | implemented | engine | Alias reasoning through the same shared model-level validation and state. |  |
| /reasoning-show | implemented | client | Remember reasoning disclosure without changing model effort or permission policy. |  |
| /auto | implemented | engine | Change the same Ask/Normal/Auto policy; Auto retains the fail-closed safety gate. |  |
| /sandbox | missing | missing | Enable, disable and inspect the same Gondolin isolation lifecycle with truthful platform support. | The GUI does not host Gondolin sandbox lifecycle controls. |
| /update | missing | missing | Check the shared version source and show truthful update instructions without silently installing software. | The GUI has no explicit version-check command handler. |
| /modes | implemented | engine | Read or change the same Ask/Normal/Auto policy and require idle state for changes. |  |
| /adaptive | implemented | engine | Change adaptive reasoning independently of autonomy and persist through session state. |  |
| /stacks | implemented | engine | Search the shared hierarchical capability tree including stack:id queries and availability explanations. |  |
| /subagents | partial | engine | Inspect live workers, recall saved run metadata and transcripts, and continue a saved run when requested. | Live workers and saved metadata recall work; complete transcript/continuation controls are missing. |
| /voice | missing | missing | Record speech, transcribe, submit and play speech through explicit accessible controls and the same voice settings. | Browser recording, local STT/TTS endpoints and voice lifecycle are not wired. |
| /projects | implemented | engine | Discover and search the same canonical project workspaces without duplicating their storage. |  |
| /learning | partial | engine | Inspect the same learning graph, history and governed proposals without activating unverified changes. | GUI status/history/feed exist, but graph selection and refinement actions are not equivalent. |
| /memory | implemented | engine | Read the shared durable user/environment memory report without rewriting memory or emitting secrets. |  |
| /init | implemented | engine | Use the shared compact context-file writer and preserve its overwrite/merge semantics. |  |
| /plan | missing | missing | Route capabilities, enforce the inspection-only fence, and save a verified plan artifact with status and clear actions. | Goal/plan display exists, but the /plan artifact workflow is not wired in the GUI. |
| /remind | missing | missing | Persist reminders with the session and deliver due reminders once while the attached session is idle. | The GUI task drain does not restore or deliver session reminders. |
| /task | implemented | engine | Use one durable task store and append-only run history, including pause, cancel and explicit queued execution. |  |
| /cron | implemented | engine | Claim occurrences atomically, use UTC schedules and the attended session's model/permissions, and never replay unknown runs. |  |
| /email | missing | missing | Use shared mailbox/draft operations and require an explicit send action with visible recipient and content. | GUI email command dispatch and a reviewable send flow are not implemented. |
| /extract-stack | missing | missing | Extract a local document through the shared capability-authoring and validation flow, preserving provenance. | The GUI does not dispatch document-to-capability extraction. |
| /craft-stack | missing | missing | Research and draft a capability through the same governed creation/validation flow and refresh future discovery. | The GUI does not dispatch research-to-capability authoring. |
| /quit | missing | missing | Stop the host cleanly, settle pending approvals, retain saved state and show a disconnected client. | Stopping from the host terminal works; the GUI has no host shutdown command. |
| /x | missing | missing | Use shared search/drafts and explicitly review recipient/content before posting or replying. | GUI X command dispatch and reviewable publishing controls are not implemented. |
| /refine | missing | missing | Review and refine learned capability proposals through the governed learning path. | The TUI refinement dispatch has no equivalent GUI command. |
| /mcpp | missing | missing | Discover and invoke namespaced MCP prompts with validated arguments through the same manager. | The /mcpp: namespace and argument collection are not exposed in GUI discovery. |
| /debug | missing | missing | Inspect real runtime diagnostics without including credentials or changing conversation state. | The terminal debug view has no GUI diagnostics adapter. |
| /arminsayshi | missing | missing | Provide the explicit hidden command's equivalent optional presentation without changing runtime state. | This hidden TUI presentation has no browser adapter. |
| /dementedelves | missing | missing | Provide the explicit hidden command's equivalent optional presentation without changing runtime state. | This hidden TUI presentation has no browser adapter. |
| /commands | implemented | engine | Discover commands with implementation status and never present an unwired action as successful. |  |
| /help | implemented | engine | Alias command discovery and show honest GUI availability and partial behavior. |  |
| /parity | implemented | engine | Inspect the versioned TUI/GUI contract and every remaining implementation gap without a model call. |  |

| Runtime capability | GUI status | Acceptance criteria | Remaining work |
| --- | --- | --- | --- |
| session-handoff | partial | Preserve session ID, branch, history, model context and policy in both directions across a saved-session handoff. | Saved history/context/identity round-trip is verified; conversation-local interaction policy and adaptive state still need durable handoff and acceptance coverage. |
| streaming | implemented | Render structured reasoning, text, tools, failures and completion in chronological order; replay retains supplied evidence. |  |
| steering | implemented | Inject queued prompts at the next safe model/tool boundary, retain FIFO and attachment data, and reject stale cancellation. |  |
| permissions | implemented | Share Ask/Normal/Auto guards, scope decisions to their session and nonce, and deny pending approvals on shutdown. |  |
| tool-execution | implemented | Use identical registered tools and policy guards, with actual arguments, results and failure state visible on both surfaces. |  |
| extension-ui | partial | Adapt extension confirm, select, input, editor, notifications and custom presentations with cancellation semantics. | Agent confirmations are wired; arbitrary extension dialogs, editors and TUI components need browser adapters. |
| dynamic-commands | partial | Discover and execute extension commands, templates, skills and MCP prompts with source metadata and exact arguments. | Templates, skills and extension command discovery exist; extension UI requirements and MCP prompt dispatch remain incomplete. |
| manual-shell | missing | Run ! commands through shared shell guards and stream output; !! excludes results from model context, and Stop cancels execution. | GUI input currently treats ! and !! as ordinary agent prompts instead of explicit user shell commands. |
| event-triggered-tasks | missing | Evaluate supported file/script triggers through an attended policy-controlled path and atomically adopt each run once. | GUI drains Cron/manual/chained runs, but file/script event-trigger checks remain TUI-only. |
| task-cron | implemented | Share definitions, schedules, atomic claims and terminal history; preserve live owners and mark dead unfinished owners unknown. |  |
| mcp-lifecycle | partial | Start, authenticate, list, reconnect and refresh MCP tools/resources/prompts under the same trust and permission rules. | A complete serve-host MCP lifecycle and GUI authentication/reconnection acceptance suite is missing. |
| configuration | partial | Persist all shared runtime settings through the same stores; keep browser-only appearance separate from model and permission state. | The GUI settings tabs expose a subset of the terminal settings catalog. |
| custom-agent-home | partial | Use the configured agent home consistently for auth, settings, task tools, schedules, resources and saved sessions. | Serve commands use the configured home; all tool factories and surface handoffs need isolated-home regression coverage. |
| context-and-learning | partial | Share governed memory/learning evidence, reload future context intentionally, and never silently activate unvalidated proposals. | Basic context and memory surfaces exist; full learning/refinement UI and refresh lifecycle remain incomplete. |
| files-and-visuals | implemented | Share attachments, paths and saved visual payloads; GUI previews and TUI text fallbacks retain the same data and bounds. |  |
| keyboard-and-editor | partial | Provide accessible equivalents for history, multiline editing, draft recovery, queue editing, cancellation and external-editor workflows. | GUI draft/IME/queue support exists; full TUI editor/history and external-editor equivalents need coverage. |
| reconnect | implemented | Reconnect without duplicate turns, stale drafts, lost approvals or cross-session events; disconnected controls fail visibly. |  |
| appearance | implemented | Preserve Pixel/System defaults and saved preferences; verify equivalent features in all five themes, dark/light and reduced-motion layouts. |  |

<!-- surface-contract:end -->
