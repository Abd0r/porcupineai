/** Theme-owned colour roles. Keep colour on controls and small cues, leaving the transcript calm. */
export const WORKBENCH_COLOUR_STYLES = `
:root[data-theme="workbench"][data-colour-mode="dark"] {
  --bg: #12161d; --sidebar: #171d26; --surface: #202936; --surface-hover: #293448; --canvas: #161d27;
  --text: #edf2fa; --muted: #c3cede; --quiet: #a7b6cc; --accent: #9bbcff; --accent-ink: #101b30;
  --line: #3d4c62; --line-soft: #293446; --elevated: #202936; --user-bg: #202e43; --selected-bg: #26374e; --selection-bg: #354c70; --code-bg: #161d27;
  --success: #92d8b6; --warning: #e9c589; --danger: #f2a8b5; --reasoning: #9bbcff;
  --activity-code: #8bd6c3; --activity-skill: #c7b4f4; --activity-web: #92d4ec; --activity-peer: #c5b5ee;
}
:root[data-theme="workbench"][data-colour-mode="light"] {
  --bg: #fbfcff; --sidebar: #f0f3f9; --surface: #f0f4fb; --surface-hover: #e5ebf5; --canvas: #f4f7fc;
  --text: #182439; --muted: #41536d; --quiet: #52617a; --accent: #305da1; --accent-ink: #ffffff;
  --line: #bbc8dc; --line-soft: #dce3ef; --elevated: #ffffff; --user-bg: #eaf0fa; --selected-bg: #e2ebf9; --selection-bg: #cbdcf6; --code-bg: #f0f4fb;
  --success: #216747; --warning: #795515; --danger: #a13148; --reasoning: #305da1;
  --activity-code: #216653; --activity-skill: #6a469b; --activity-web: #225e7e; --activity-peer: #704b91;
}
:root[data-theme="pixel"][data-colour-mode="dark"] {
  --bg: #101225; --sidebar: #191c34; --surface: #222742; --surface-hover: #2b3050; --canvas: #15182e;
  --text: #edf0ff; --muted: #c5cef0; --quiet: #aab7df; --accent: #9ae6b1; --accent-ink: #10271a;
  --line: #64729c; --line-soft: #323b60; --elevated: #222742; --user-bg: #252e48; --selected-bg: #273c42; --selection-bg: #345456; --code-bg: #181d34;
  --success: #9ae6b1; --warning: #f1d08b; --danger: #ffa6ae; --reasoning: #a5c7ff;
  --activity-code: #9ae6b1; --activity-skill: #d1b8ff; --activity-web: #a1daed; --activity-peer: #edb5d9;
}
:root[data-theme="pixel"][data-colour-mode="light"] {
  --bg: #f7f3e8; --sidebar: #ece5d4; --surface: #fcfaf3; --surface-hover: #eee5d3; --canvas: #fcfaf3;
  --text: #282a25; --muted: #484b40; --quiet: #5d5c4c; --accent: #1c663f; --accent-ink: #ffffff;
  --line: #656953; --line-soft: #c6bea7; --elevated: #fcfaf3; --user-bg: #eee8d8; --selected-bg: #dfe9d9; --selection-bg: #ccdec5; --code-bg: #eee8d8;
  --success: #1c663f; --warning: #76511d; --danger: #9c3042; --reasoning: #315c9a;
  --activity-code: #1c663f; --activity-skill: #67468c; --activity-web: #285e75; --activity-peer: #864268;
}
:root[data-theme="tokyo-night"][data-colour-mode="dark"] {
  --bg: #1a1b26; --sidebar: #16161f; --surface: #24283b; --surface-hover: #2b3047; --canvas: #1c2032;
  --text: #d2dcff; --muted: #b8c3e7; --quiet: #a6b1d4; --accent: #9dbbff; --accent-ink: #18213b;
  --line: #465273; --line-soft: #30364e; --elevated: #24283b; --user-bg: #252e48; --selected-bg: #2a3651; --selection-bg: #3b4e78; --code-bg: #1c2032;
  --success: #aed58e; --warning: #edcd93; --danger: #f5a3bc; --reasoning: #9dbbff;
  --activity-code: #92dac6; --activity-skill: #cbb4fc; --activity-web: #91d5f5; --activity-peer: #d7b5f6;
}
:root[data-theme="tokyo-night"][data-colour-mode="light"] {
  --bg: #edf0f7; --sidebar: #e1e6f1; --surface: #e7ecf6; --surface-hover: #d4deef; --canvas: #f3f5fb;
  --text: #303c59; --muted: #435474; --quiet: #4c5b78; --accent: #31548d; --accent-ink: #ffffff;
  --line: #a4b3cd; --line-soft: #cad3e5; --elevated: #f3f5fb; --user-bg: #dfe7f5; --selected-bg: #d6e1f4; --selection-bg: #bfcfeb; --code-bg: #e1e7f2;
  --success: #315d29; --warning: #71501d; --danger: #99364f; --reasoning: #31548d;
  --activity-code: #245d50; --activity-skill: #60438d; --activity-web: #255775; --activity-peer: #694582;
}
:root[data-theme="cyberpunk"][data-colour-mode="dark"] {
  --bg: #13101d; --sidebar: #191423; --surface: #251e35; --surface-hover: #30263f; --canvas: #1b1528;
  --text: #f4eaff; --muted: #d4c2e6; --quiet: #bba8d0; --accent: #87e4dc; --accent-ink: #102625;
  --line: #644c7d; --line-soft: #3b2d4b; --elevated: #251e35; --user-bg: #2d2340; --selected-bg: #243b40; --selection-bg: #345359; --code-bg: #1b1528;
  --success: #a7dfa1; --warning: #f2cb89; --danger: #ffabc4; --reasoning: #a9c4ff;
  --activity-code: #87e4dc; --activity-skill: #dbb6fa; --activity-web: #9ed8f5; --activity-peer: #f0b1dd;
}
:root[data-theme="cyberpunk"][data-colour-mode="light"] {
  --bg: #fcf7ff; --sidebar: #f1e9f7; --surface: #f5eefb; --surface-hover: #e7dced; --canvas: #fffaff;
  --text: #352340; --muted: #604570; --quiet: #674879; --accent: #176059; --accent-ink: #ffffff;
  --line: #bba1c8; --line-soft: #e1d3e9; --elevated: #fffaff; --user-bg: #eee2f6; --selected-bg: #d9e9e5; --selection-bg: #bddbd4; --code-bg: #eee5f5;
  --success: #315d2b; --warning: #77501e; --danger: #a02e55; --reasoning: #3e5598;
  --activity-code: #176059; --activity-skill: #75408c; --activity-web: #2a587d; --activity-peer: #8d386e;
}
:root[data-theme="static"][data-colour-mode="dark"] {
  --bg: #141414; --sidebar: #1b1b1b; --surface: #242424; --surface-hover: #2d2d2d; --canvas: #191919;
  --text: #f2f2f2; --muted: #cdcdcd; --quiet: #aeaeae; --accent: #ededed; --accent-ink: #171717;
  --line: #585858; --line-soft: #343434; --elevated: #242424; --user-bg: #292929; --selected-bg: #333333; --selection-bg: #4a4a4a; --code-bg: #191919;
  --success: #cccccc; --warning: #dddddd; --danger: #eeeeee; --reasoning: #d6d6d6;
  --activity-code: #cccccc; --activity-skill: #dddddd; --activity-web: #cccccc; --activity-peer: #dddddd;
}
:root[data-theme="static"][data-colour-mode="light"] {
  --bg: #fcfcfc; --sidebar: #f1f1f1; --surface: #f5f5f5; --surface-hover: #e6e6e6; --canvas: #f7f7f7;
  --text: #202020; --muted: #484848; --quiet: #595959; --accent: #292929; --accent-ink: #ffffff;
  --line: #9a9a9a; --line-soft: #d7d7d7; --elevated: #ffffff; --user-bg: #eeeeee; --selected-bg: #e3e3e3; --selection-bg: #c9c9c9; --code-bg: #eeeeee;
  --success: #484848; --warning: #393939; --danger: #292929; --reasoning: #484848;
  --activity-code: #484848; --activity-skill: #393939; --activity-web: #484848; --activity-peer: #393939;
}
/* Use solid, theme-owned surfaces so foreground contrast stays predictable. */
::selection { background: var(--selection-bg); color: var(--text); }
:root { accent-color: var(--accent); }
.composer-wrap { background: var(--surface); }
.message.user { background: var(--user-bg); }
.session.active, :root[data-theme="pixel"] .session.active { background: var(--selected-bg); color: var(--text); border-left-color: var(--accent); }
.model-row[aria-selected="true"],.settings-tab[aria-selected="true"],.rail-toggle[aria-expanded="true"] { background: var(--selected-bg); color: var(--text); }
.settings-dialog,.work-rail-overlay,.jump-latest,.command-menu { background: var(--elevated); }
.send,.allow { background: var(--accent); color: var(--accent-ink); }
.send:not(:disabled):hover,.allow:not(:disabled):hover { filter: brightness(1.08); }
.session:hover:not(.active),.model-row:hover:not([aria-selected="true"]) { background: var(--surface-hover); }
.settings-trigger:hover,.quiet-button:hover,.model-label:hover,.scene-controls button:hover,.starters button:hover { background: var(--surface-hover); color: var(--text); }
.composer-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent); }
.rich a { color: var(--accent); text-decoration-color: color-mix(in srgb,var(--accent) 65%,transparent); }
.rich a:hover { text-decoration-color: var(--accent); }
.rich blockquote { border-left: 2px solid var(--accent); }
.rich code,.code-block { background: var(--code-bg); }
.code-block code { background: transparent; }
.code-banner { background: var(--surface); }
.interactive-visual input { accent-color: var(--accent); }
.interactive-visual label:has(input:checked),.adaptive-body button[aria-pressed="true"] { background: var(--selected-bg); border-color: var(--accent); }
.status:has([data-state="ready"])::before { background: var(--success); }
.status:has([data-state="offline"])::before { background: var(--warning); }
.todo-item[data-state="done"] .todo-symbol { color: var(--success); }
.todo-item[data-state="blocked"] .todo-symbol { color: var(--warning); }
.todo-item[data-state="failed"] .todo-symbol { color: var(--danger); }
svg[data-kind="reasoning"],:root[data-colour-mode="light"] svg[data-kind="reasoning"] { color: var(--reasoning); }
.glyph-star { fill: currentColor; filter: drop-shadow(0 0 1.5px var(--reasoning)); }
svg:is([data-kind="coding"],[data-kind="editing"],[data-kind="terminal"]) { color: var(--activity-code); }
svg:is([data-kind="skill"],[data-kind="reading"]) { color: var(--activity-skill); }
svg:is([data-kind="web"],[data-kind="searching"]) { color: var(--activity-web); }
svg:is([data-kind="delegation"],[data-kind="spawn"],[data-kind="sending"],[data-kind="receiving"]) { color: var(--activity-peer); }
svg:is([data-kind="tool"],[data-kind="planning"],[data-kind="writing"]) { color: var(--warning); }
svg[data-kind="report"] { color: var(--success); }
svg[data-kind="stopping"],.collaboration-card[data-state="failed"] svg,.tool-activity[data-state="failed"] svg { color: var(--danger); }
/* High-contrast mode owns its colours; retain state labels and icon shapes. */
@media (forced-colors: active) {
  .send,.allow { background: ButtonFace; color: ButtonText; border: 1px solid ButtonText; }
  svg[data-kind],:root[data-colour-mode="light"] svg[data-kind="reasoning"] { color: CanvasText; }
  .glyph-star { filter: none; }
  .composer-wrap:focus-within { border-color: Highlight; box-shadow: none; }
  .session.active,.model-row[aria-selected="true"],.settings-tab[aria-selected="true"] { outline: 1px solid Highlight; }
}
`;
