/** Local browser appearance preferences. Never stores the server bearer token. */
export const APPEARANCE_DIALOG = `
<dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
  <header class="settings-heading"><h2 id="settings-title">Settings</h2><form method="dialog"><button class="quiet-button" aria-label="Close settings" title="Close settings">×</button></form></header>
  <nav class="settings-tabs" role="tablist" aria-label="Settings sections"><button class="settings-tab" id="tab-appearance" type="button" role="tab" aria-controls="panel-appearance" aria-selected="true" tabindex="0" data-settings-tab="appearance">Appearance</button><button class="settings-tab" id="tab-models" type="button" role="tab" aria-controls="panel-models" aria-selected="false" tabindex="-1" data-settings-tab="models">Models</button><button class="settings-tab" id="tab-limits" type="button" role="tab" aria-controls="panel-limits" aria-selected="false" tabindex="-1" data-settings-tab="limits">Limits</button><button class="settings-tab" id="tab-context" type="button" role="tab" aria-controls="panel-context" aria-selected="false" tabindex="-1" data-settings-tab="context">Context</button></nav>
  <section class="settings-section" id="panel-appearance" role="tabpanel" aria-labelledby="tab-appearance" data-settings-panel="appearance">
    <h3 id="appearance-title">Appearance</h3><p>Theme and display preferences.</p>
    <div class="settings-grid">
      <label>Theme<select id="appearance-theme"><option value="workbench">Workbench</option><option value="pixel">Pixel</option><option value="cyberpunk">Cyberpunk</option><option value="static">Static · monochrome</option><option value="tokyo-night">Tokyo Night</option></select></label>
      <label>Colour mode<select id="appearance-mode"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
    </div>
    <label class="reasoning-preference" for="appearance-reasoning"><span><strong>Always show reasoning</strong><small>Expand available reasoning in live and saved conversations.</small></span><input id="appearance-reasoning" type="checkbox" role="switch"></label>
    <p id="appearance-error" class="error" role="alert" hidden></p>
  </section>
  <section class="settings-section" id="panel-models" role="tabpanel" aria-labelledby="tab-models" data-settings-panel="models" hidden>
    <h3>Models</h3><p>Default model for new conversations, and the model sub-agents run on. Any conversation can still pick its own model from the composer.</p><p><button id="model-default-open" class="quiet-button" type="button">Choose default model</button> <button id="model-subagent-open" class="quiet-button" type="button">Choose sub-agent model</button></p><p class="settings-note" id="subagent-model-current"></p>
  </section>
  <section class="settings-section" id="panel-limits" role="tabpanel" aria-labelledby="tab-limits" data-settings-panel="limits" hidden>
    <h3 id="limits-title">Session limits</h3>
    <p>Compaction threshold and sub-agent concurrency. Applying writes your global settings and takes effect for later turns.</p>
    <div class="settings-grid">
      <label>Compact at %<input id="limit-compact" type="number" min="50" max="95" step="1"></label>
      <label>Max sub-agents<input id="limit-subagents" type="number" min="1" max="8" step="1"></label>
    </div>
    <p><button id="limits-apply" class="quiet-button" type="button">Apply limits</button></p>
    <p id="limits-status" class="settings-note"></p>
  </section>
  <section class="settings-section" id="panel-context" role="tabpanel" aria-labelledby="tab-context" data-settings-panel="context" hidden><div id="context-settings"><h3 id="context-title">Agent context files</h3><p>Inspect and edit the explicitly listed local Markdown files. Saved changes may require resource reload; they never rewrite an active turn.</p><div id="context-files"><p>Context editing is unavailable on this server.</p></div></div></section>
</dialog>`;

export const APPEARANCE_STYLES = `
:root { --icon-size: 18px; --settings-width: 640px; --settings-backdrop: rgb(0 0 0 / 55%); }
:root[data-colour-mode="light"] {
  color-scheme: light;
  --bg: #ffffff; --sidebar: #f5f6f7; --surface: #f1f3f5; --surface-hover: #e9ecf0;
  --canvas: #fafafa; --line: rgb(0 0 0 / 12%); --line-soft: rgb(0 0 0 / 6%);
  --text: #0f1115; --muted: #555b65; --quiet: #666d78; --accent: #315da8; --accent-ink: #ffffff;
  --danger: #ac3333; --plot-text: #202530; --plot-label: #59616e; --plot-grid: #e3e5e9; --plot-axis: #767e8b;
}
:root[data-theme="static"][data-colour-mode="dark"] { --bg: #111111; --sidebar: #191919; --surface: #262626; --surface-hover: #303030; --canvas: #161616; --text: #f5f5f5; --muted: #cccccc; --quiet: #929292; --accent: #ffffff; --plot-text: #eeeeee; --plot-label: #b5b5b5; --plot-grid: #303030; --plot-axis: #808080; }
:root[data-theme="static"][data-colour-mode="light"] { --bg: #ffffff; --sidebar: #f5f5f5; --surface: #ededed; --surface-hover: #dddddd; --canvas: #fafafa; --text: #111111; --muted: #555555; --quiet: #666666; --accent: #111111; --plot-text: #111111; --plot-label: #555555; --plot-grid: #dddddd; --plot-axis: #777777; }
:root[data-theme="tokyo-night"][data-colour-mode="dark"] { --bg: #1a1b26; --sidebar: #16161e; --surface: #24283b; --surface-hover: #303650; --canvas: #1f2335; --text: #c0caf5; --muted: #a9b1d6; --quiet: #929ec6; --accent: #7aa2f7; --accent-ink: #1a1b26; --plot-text: #c0caf5; --plot-label: #a9b1d6; --plot-grid: #343b58; --plot-axis: #7888b1; }
:root[data-theme="tokyo-night"][data-colour-mode="light"] { --bg: #e6e8f0; --sidebar: #dfe2ee; --surface: #d5dbea; --surface-hover: #c7cfe2; --canvas: #edf0f7; --text: #343b58; --muted: #4c577c; --quiet: #596587; --accent: #34548a; --plot-text: #343b58; --plot-label: #4c577c; --plot-grid: #cdd3e2; --plot-axis: #6d7b9d; }
:root[data-theme="cyberpunk"][data-colour-mode="dark"] { --bg: #101018; --sidebar: #16141f; --surface: #242034; --surface-hover: #342b47; --canvas: #15131e; --text: #f0e9ff; --muted: #c6b4d9; --quiet: #a99ac2; --accent: #61e5de; --accent-ink: #101018; --plot-text: #f0e9ff; --plot-label: #c6b4d9; --plot-grid: #3b2d49; --plot-axis: #8b6da7; --r1: 0px; --r2: 2px; --r3: 4px; }
:root[data-theme="cyberpunk"][data-colour-mode="light"] { --bg: #fcf6ff; --sidebar: #f0e7f6; --surface: #e7e0f2; --surface-hover: #ded0eb; --canvas: #fffaff; --text: #2e173f; --muted: #634b75; --quiet: #735c87; --accent: #007973; --plot-text: #2e173f; --plot-label: #634b75; --plot-grid: #e1d1eb; --plot-axis: #8b6da7; --r1: 0px; --r2: 2px; --r3: 4px; }

/* Pixel: a 2D retro level. Hard edges, chunky borders, block shadows, 8-bit palette. */
:root[data-theme="pixel"] {
  --font: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --r1: 0px; --r2: 0px; --r3: 0px;
  --unit: 2px;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px;
  --small: 12px; --body: 14px; --title: 16px; --hero: 24px;
  --pixel-shadow: 4px 4px 0 var(--line-soft);
}
:root[data-theme="pixel"][data-colour-mode="dark"] {
  --bg: #0f1020; --sidebar: #191b32; --surface: #222543; --surface-hover: #2d3157;
  --canvas: #12142a; --line: #4a4f86; --line-soft: #2b2f52;
  --text: #e8ecff; --muted: #b9c1e8; --quiet: #9ba4d0;
  --accent: #7bf1a8; --accent-ink: #0f1020; --danger: #ff8a8a;
  --plot-text: #e8ecff; --plot-label: #b8c0ea; --plot-grid: #2b2f52; --plot-axis: #6d76a8;
}
:root[data-theme="pixel"][data-colour-mode="light"] {
  --bg: #f4f1e8; --sidebar: #e6e1d2; --surface: #ffffff; --surface-hover: #efe9d9;
  --canvas: #fbf8ef; --line: #2a2a2a; --line-soft: #b9b2a0;
  --text: #1a1a1a; --muted: #4a4a4a; --quiet: #666154;
  --accent: #1f7a4d; --accent-ink: #ffffff; --danger: #a32626;
  --plot-text: #1a1a1a; --plot-label: #444; --plot-grid: #cdc6b4; --plot-axis: #6a6455;
}
:root[data-theme="pixel"] body {
  background-image: repeating-linear-gradient(0deg, transparent 0 31px, color-mix(in srgb,var(--line-soft) 20%,transparent) 31px 32px), repeating-linear-gradient(90deg, transparent 0 31px, color-mix(in srgb,var(--line-soft) 20%,transparent) 31px 32px);
  background-size: 32px 32px;
}
:root[data-theme="pixel"] .sidebar { border-right: var(--unit) solid var(--line); }
:root[data-theme="pixel"] .new-session,
:root[data-theme="pixel"] .composer-wrap,
:root[data-theme="pixel"] .settings-dialog,
:root[data-theme="pixel"] .file-picker,
:root[data-theme="pixel"] .send { box-shadow: var(--pixel-shadow); }
:root[data-theme="pixel"] .new-session:active,
:root[data-theme="pixel"] .send:active { box-shadow: none; transform: translate(2px, 2px); }
:root[data-theme="pixel"] .welcome h1 { letter-spacing: 0; text-transform: uppercase; }
:root[data-theme="pixel"] .welcome h1::after { content: " ▮"; color: var(--accent); }
:root[data-theme="pixel"] .message.user { border: var(--unit) solid var(--line); }
/* Pixel: hard edges everywhere, stepped motion, blocky depth. */
:root[data-theme="pixel"] *, :root[data-theme="pixel"] *::before, :root[data-theme="pixel"] *::after {
  border-radius: 0 !important;
  backdrop-filter: none !important;
}
:root[data-theme="pixel"] :is(.dream-thread,.dream-spark,.activity-glyph svg *) { animation-timing-function: steps(8,end); }
:root[data-theme="pixel"] .sidebar { background: var(--sidebar); }
:root[data-theme="pixel"] .session.active { background: rgb(128 128 128 / 18%); border-left: 2px solid var(--quiet); }
:root[data-theme="pixel"] :is(.new-session,.send,.interactive-visual > button,.followup-queue) { border: 2px solid var(--line); box-shadow: 3px 3px 0 var(--line-soft); }
:root[data-theme="pixel"] .interactive-visual > button:active { box-shadow: 1px 1px 0 var(--line-soft); transform: translate(1px,1px); }
:root[data-theme="pixel"] :is(button,input,select,textarea,summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
:root[data-theme="pixel"] .scene-controls { gap: 8px; }
:root[data-theme="pixel"] .scene-controls :is(button,label) { border: 1px solid var(--line); background: var(--surface); }
:root[data-theme="pixel"] .adaptive-body :is(th,td) { border: 1px solid var(--line-soft); }
:root[data-theme="pixel"] .adaptive-body th { background: var(--surface); }
:root[data-theme="pixel"] .adaptive-body :is(label,td) { background: var(--bg); }
:root[data-theme="pixel"] .adaptive-body td:first-child { min-width: 72px; }
:root[data-theme="pixel"] .adaptive-body td label { padding: 4px; white-space: nowrap; }
:root[data-theme="pixel"] .interactive-visual .scene-controls input:not([type="range"]) { background: var(--surface); color: var(--text); border: 1px solid var(--line); padding: 5px; min-width: 0; }
:root[data-theme="pixel"] .adaptive-body form label { border-left: 3px solid var(--line); }
:root[data-theme="pixel"] .followup-queue h3 { color: var(--accent); }
:root[data-theme="pixel"] .rail-card { padding: 14px 8px; margin-bottom: 12px; border: 1px solid var(--line); background: var(--bg); }
:root[data-theme="pixel"] :is(.tool-state,.worker-state,.todos-count) { font-variant-numeric: tabular-nums; letter-spacing: .03em; }
:root[data-theme="pixel"] .message-photo { image-rendering: auto; border: 1px solid var(--line); }
:root[data-theme="pixel"] .rail-card,
:root[data-theme="pixel"] .settings-dialog,
:root[data-theme="pixel"] .composer-wrap { box-shadow: 4px 4px 0 var(--line-soft) !important; }
:root[data-theme="pixel"] .scene-canvas { border-width: 2px; }
:root[data-theme="pixel"] .ring-fill { stroke-linecap: butt; }
:root[data-theme="pixel"] .dot,
:root[data-theme="pixel"] .goal-dot,
:root[data-theme="pixel"] .activity .orb,
:root[data-theme="pixel"] #send { border-radius: 0 !important; }
:root[data-theme="pixel"] .goal-kicker,
:root[data-theme="pixel"] .caption,
:root[data-theme="pixel"] .activity-label { letter-spacing: .14em; text-transform: uppercase; }
:root[data-theme="pixel"] .message.user { box-shadow: 4px 4px 0 var(--line-soft); }

#send { width: var(--s7); height: var(--s7); padding: 0; display: grid; place-items: center; border-radius: 50%; }
#send svg, .settings-trigger svg { width: var(--icon-size); height: var(--icon-size); }
.topbar-actions { display: flex; align-items: center; gap: var(--s4); }
.settings-trigger, .quiet-button { color: var(--muted); background: transparent; border: 0; padding: var(--s1) var(--s2); border-radius: var(--r1); }
.settings-trigger { display: grid; place-items: center; }
.settings-trigger:hover, .quiet-button:hover { color: var(--text); background: var(--surface-hover); }
.feed-stage { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; isolation: isolate; }
.feed { position: relative; }
.settings-dialog { width: min(var(--settings-width),calc(100% - var(--s7))); max-height: calc(100dvh - var(--s7)); margin: auto; padding: 0; color: var(--text); background: var(--bg); border: var(--unit) solid var(--line); border-radius: var(--r2); }
.settings-dialog::backdrop { background: var(--settings-backdrop); }
.settings-heading { display: flex; justify-content: space-between; align-items: center; padding: var(--s5) var(--s6); border-bottom: var(--unit) solid var(--line-soft); }
.settings-heading h2 { font-size: var(--title); font-weight: 500; margin: 0; }
.settings-section { padding: var(--s6); }
.settings-section + .settings-section { border-top: var(--unit) solid var(--line-soft); }
.settings-section h3 { font-size: var(--body); font-weight: 500; margin: 0 0 var(--s2); }
.settings-section p { color: var(--muted); margin: 0 0 var(--s4); font-size: var(--small); }
.settings-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: var(--s4); }
.settings-grid label { display: grid; gap: var(--s2); font-size: var(--small); color: var(--muted); }
.settings-grid input[type="number"] { width: 100%; background: var(--surface); color: var(--text); border: var(--unit) solid var(--line); border-radius: var(--r1); padding: var(--s2); font: inherit; }
.settings-grid select { width: 100%; background: var(--surface); color: var(--text); border: var(--unit) solid var(--line); border-radius: var(--r1); padding: var(--s2); }
.reasoning-preference { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 22px; color: var(--text); cursor: pointer; }
.reasoning-preference span { display: grid; gap: 5px; }
.reasoning-preference strong { font-size: 12px; font-weight: 500; }
.reasoning-preference small { color: var(--muted); font-size: 11px; line-height: 1.5; }
.reasoning-preference input { appearance: none; position: relative; flex: 0 0 auto; width: 34px; height: 20px; margin: 0; border: 1px solid var(--line); border-radius: 20px; background: var(--surface-hover); cursor: pointer; transition: background-color var(--motion-fast) var(--motion-ease); }
.reasoning-preference input::before { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--quiet); transition: transform var(--motion-fast) var(--motion-ease); }
.reasoning-preference input:checked { background: var(--accent); border-color: var(--accent); }
.reasoning-preference input:checked::before { transform: translateX(14px); background: var(--accent-ink); }
.settings-divider { height: var(--unit); background: var(--line-soft); margin: var(--s6) 0; }
.file-picker { display: inline-block; padding: var(--s2) var(--s3); border: var(--unit) solid var(--line); border-radius: var(--r1); cursor: pointer; font-size: var(--small); }
.file-picker input { display: block; max-width: 100%; font-size: var(--small); margin-top: var(--s2); }
.settings-section .settings-note { color: var(--quiet); margin: var(--s4) 0 0; }
@media (max-width: 480px) { .settings-grid { grid-template-columns: minmax(0,1fr); } .settings-section { padding: var(--s4); } }
`;

export const APPEARANCE_SCRIPT = `
const appearance={dialog:$('settings-dialog'),open:$('settings-open'),theme:$('appearance-theme'),mode:$('appearance-mode'),reasoning:$('appearance-reasoning'),error:$('appearance-error')};
const appearanceKey='porcupine.workbench.appearance.v1',appearanceThemes=['workbench','pixel','cyberpunk','static','tokyo-night'];
let appearancePreferences={theme:'workbench',mode:'dark',showReasoning:false};
try{const saved=JSON.parse(window.localStorage.getItem(appearanceKey)||'null');if(saved&&appearanceThemes.includes(saved.theme)&&['dark','light','system'].includes(saved.mode))appearancePreferences={theme:saved.theme,mode:saved.mode,showReasoning:saved.showReasoning===true}}catch{}
function appearanceError(message){appearance.error.textContent=message;appearance.error.hidden=!message}
function applyAppearance(save=false){const preference=appearancePreferences,mode=preference.mode==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference.mode;document.documentElement.setAttribute('data-theme',preference.theme);document.documentElement.setAttribute('data-colour-mode',mode);appearance.theme.value=preference.theme;appearance.mode.value=preference.mode;appearance.reasoning.checked=preference.showReasoning;window.dispatchEvent(new Event('porcupine-theme-change'));if(save)try{window.localStorage.setItem(appearanceKey,JSON.stringify(preference))}catch{appearanceError('Preferences work for this tab, but browser storage is unavailable.')}}
let settingsTab='appearance';
function selectSettingsTab(key){settingsTab=key;for(const tab of document.querySelectorAll('[data-settings-tab]')){const active=tab.dataset.settingsTab===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}for(const panel of document.querySelectorAll('[data-settings-panel]'))panel.hidden=panel.dataset.settingsPanel!==key;}
const settingsTabs=[...document.querySelectorAll('[data-settings-tab]')];
for(const tab of settingsTabs){tab.addEventListener('click',()=>selectSettingsTab(tab.dataset.settingsTab));tab.addEventListener('keydown',event=>{let index=settingsTabs.indexOf(tab);if(event.key==='ArrowRight')index=(index+1)%settingsTabs.length;else if(event.key==='ArrowLeft')index=(index+settingsTabs.length-1)%settingsTabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=settingsTabs.length-1;else return;event.preventDefault();selectSettingsTab(settingsTabs[index].dataset.settingsTab);settingsTabs[index].focus();});}
appearance.open.addEventListener('click',()=>{selectSettingsTab(settingsTab);appearance.dialog.showModal();void loadWorkbenchSettings()});
appearance.theme.addEventListener('change',()=>{appearancePreferences.theme=appearance.theme.value;applyAppearance(true)});
appearance.mode.addEventListener('change',()=>{appearancePreferences.mode=appearance.mode.value;applyAppearance(true)});
appearance.reasoning.addEventListener('change',()=>{appearancePreferences.showReasoning=appearance.reasoning.checked;applyAppearance(true);for(const row of ui.feed.querySelectorAll('.thinking')){const head=row.querySelector('.thinking-head'),body=row.querySelector('.thinking-body');if(!head||!body||head.disabled)continue;head.setAttribute('aria-expanded',String(appearancePreferences.showReasoning));body.hidden=!appearancePreferences.showReasoning;}});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(appearancePreferences.mode==='system')applyAppearance()});
applyAppearance();
`;
