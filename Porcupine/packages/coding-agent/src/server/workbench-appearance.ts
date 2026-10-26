/** Local browser appearance preferences. Never stores the server bearer token. */
export const APPEARANCE_DIALOG = `
<dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
  <header class="settings-heading"><h2 id="settings-title">Settings</h2><form method="dialog"><button class="quiet-button" aria-label="Close settings" title="Close settings">×</button></form></header>
  <section class="settings-section" aria-labelledby="appearance-title">
    <h3 id="appearance-title">Appearance</h3><p>Keep the workbench quiet, or make it yours.</p>
    <div class="settings-grid">
      <label>Theme<select id="appearance-theme"><option value="workbench">Workbench</option><option value="pixel">Pixel</option><option value="cyberpunk">Cyberpunk</option><option value="static">Static · monochrome</option><option value="tokyo-night">Tokyo Night</option></select></label>
      <label>Colour mode<select id="appearance-mode"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
    </div>
    <div class="settings-divider"></div>
    <h3>Default model</h3><p>Used for new conversations. Any conversation can still pick its own model from the composer.</p><p><button id="model-default-open" class="quiet-button" type="button">Choose default model</button></p>
    <div class="settings-divider"></div>
    <h3>Chat background</h3><p>Upload a PNG, JPEG, or WebP. It stays in this browser, never in the model prompt. Up to 6 MiB and 16 million pixels.</p>
    <label class="file-picker">Choose image<input id="appearance-image" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <button id="appearance-remove" class="quiet-button" type="button">Remove background</button>
    <label class="opacity-label" for="appearance-opacity">Image opacity <output id="appearance-opacity-value">15%</output></label>
    <input id="appearance-opacity" type="range" min="0" max="100" step="1" value="15">
    <p class="settings-note">Themes and image opacity do not change agent permissions or reasoning.</p>
    <p id="appearance-error" class="error" role="alert" hidden></p>
  </section>
  <section class="settings-section" aria-labelledby="limits-title">
    <h3 id="limits-title">Session limits</h3>
    <p>Compaction threshold and sub-agent concurrency. Applying writes your global settings and takes effect for later turns.</p>
    <div class="settings-grid">
      <label>Compact at %<input id="limit-compact" type="number" min="50" max="95" step="1"></label>
      <label>Max sub-agents<input id="limit-subagents" type="number" min="1" max="8" step="1"></label>
    </div>
    <p><button id="limits-apply" class="quiet-button" type="button">Apply limits</button></p>
    <p id="limits-status" class="settings-note"></p>
  </section>
  <section class="settings-section" id="context-settings" hidden aria-labelledby="context-title"><h3 id="context-title">Agent context files</h3><p>Inspect and edit the explicitly listed local Markdown files. Saved changes may require resource reload; they never rewrite an active turn.</p><div id="context-files"></div></section>
</dialog>`;

export const APPEARANCE_STYLES = `
:root { --icon-size: 18px; --settings-width: 640px; --settings-backdrop: rgb(0 0 0 / 55%); --chat-image-opacity: .15; }
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
  --text: #e8ecff; --muted: #aab2e0; --quiet: #8089bd;
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
  background-image: repeating-linear-gradient(0deg, transparent 0 31px, var(--line-soft) 31px 32px), repeating-linear-gradient(90deg, transparent 0 31px, var(--line-soft) 31px 32px);
  background-size: 32px 32px;
}
:root[data-theme="pixel"] .sidebar { border-right: var(--unit) solid var(--line); }
:root[data-theme="pixel"] .new-session,
:root[data-theme="pixel"] .composer-wrap,
:root[data-theme="pixel"] .settings-dialog,
:root[data-theme="pixel"] .file-picker,
:root[data-theme="pixel"] .send { box-shadow: var(--pixel-shadow); }
:root[data-theme="pixel"] .new-session:active,
:root[data-theme="pixel"] .send:active,
:root[data-theme="pixel"] .send:active { box-shadow: none; transform: translate(2px, 2px); }
:root[data-theme="pixel"] .welcome h1 { letter-spacing: 0; text-transform: uppercase; }
:root[data-theme="pixel"] .welcome h1::after { content: " ▮"; color: var(--accent); }
:root[data-theme="pixel"] .message.user { border: var(--unit) solid var(--line); }
:root[data-theme="pixel"] .chat-backdrop { image-rendering: pixelated; }
/* Pixel: hard edges everywhere, stepped motion, blocky depth. */
:root[data-theme="pixel"] *, :root[data-theme="pixel"] *::before, :root[data-theme="pixel"] *::after {
  border-radius: 0 !important;
  backdrop-filter: none !important;
  transition-timing-function: steps(3, end) !important;
  animation-timing-function: steps(6, end) !important;
}
:root[data-theme="pixel"] .goal-card,
:root[data-theme="pixel"] .settings-dialog,
:root[data-theme="pixel"] .composer-wrap { box-shadow: 4px 4px 0 var(--line-soft) !important; }
:root[data-theme="pixel"] .scene-canvas,
:root[data-theme="pixel"] .chat-backdrop,
:root[data-theme="pixel"] canvas,
:root[data-theme="pixel"] img { image-rendering: pixelated; }
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
.chat-backdrop { position: absolute; inset: 0; z-index: -1; pointer-events: none; background-size: cover; background-position: center; opacity: var(--chat-image-opacity); }
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
.settings-divider { height: var(--unit); background: var(--line-soft); margin: var(--s6) 0; }
.file-picker { display: inline-block; padding: var(--s2) var(--s3); border: var(--unit) solid var(--line); border-radius: var(--r1); cursor: pointer; font-size: var(--small); }
.file-picker input { display: block; max-width: 100%; font-size: var(--small); margin-top: var(--s2); }
.opacity-label { display: flex; justify-content: space-between; margin: var(--s5) 0 var(--s2); font-size: var(--small); color: var(--muted); }
#appearance-opacity { width: 100%; accent-color: var(--accent); }
.settings-section .settings-note { color: var(--quiet); margin: var(--s4) 0 0; }
@media (max-width: 480px) { .settings-grid { grid-template-columns: minmax(0,1fr); } .settings-section { padding: var(--s4); } }
`;

export const APPEARANCE_SCRIPT = `
const appearance={dialog:$('settings-dialog'),open:$('settings-open'),theme:$('appearance-theme'),mode:$('appearance-mode'),image:$('appearance-image'),remove:$('appearance-remove'),opacity:$('appearance-opacity'),value:$('appearance-opacity-value'),error:$('appearance-error'),backdrop:$('chat-backdrop')};
const appearanceKey='porcupine.workbench.appearance.v1',appearanceThemes=['workbench','pixel','cyberpunk','static','tokyo-night'];
let appearancePreferences={theme:'workbench',mode:'dark',opacity:15},backgroundUrl=null,backgroundRevision=0,backgroundWrites=Promise.resolve();
try{const saved=JSON.parse(window.localStorage.getItem(appearanceKey)||'null');if(saved&&appearanceThemes.includes(saved.theme)&&['dark','light','system'].includes(saved.mode)&&Number.isFinite(saved.opacity)&&saved.opacity>=0&&saved.opacity<=100)appearancePreferences={theme:saved.theme,mode:saved.mode,opacity:saved.opacity}}catch{}
function appearanceError(message){appearance.error.textContent=message;appearance.error.hidden=!message}
function applyAppearance(save=false){const preference=appearancePreferences,mode=preference.mode==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference.mode;document.documentElement.setAttribute('data-theme',preference.theme);document.documentElement.setAttribute('data-colour-mode',mode);document.documentElement.style.setProperty('--chat-image-opacity',String(preference.opacity/100));appearance.theme.value=preference.theme;appearance.mode.value=preference.mode;appearance.opacity.value=String(preference.opacity);appearance.value.textContent=preference.opacity+'%';window.dispatchEvent(new Event('porcupine-theme-change'));if(save)try{window.localStorage.setItem(appearanceKey,JSON.stringify(preference))}catch{appearanceError('Preferences work for this tab, but browser storage is unavailable.')}}
function backgroundDatabase(){return new Promise((resolve,reject)=>{if(!window.indexedDB){reject(new Error('Image persistence is unavailable in this browser.'));return}const request=window.indexedDB.open('porcupine-workbench',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('appearance'))request.result.createObjectStore('appearance')};request.onerror=()=>reject(new Error('Could not open local background storage.'));request.onsuccess=()=>resolve(request.result)})}
async function backgroundStorage(action,value){const db=await backgroundDatabase();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('appearance',action==='get'?'readonly':'readwrite'),store=tx.objectStore('appearance');let request;if(action==='get')request=store.get('background');else if(action==='set')request=store.put(value,'background');else request=store.delete('background');let result=null;request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('Could not save the local chat background.'));tx.onabort=()=>reject(new Error('Local background transaction was cancelled.'))})}finally{db.close()}}
function queueBackgroundWrite(action,value){const write=backgroundWrites.catch(()=>{}).then(()=>backgroundStorage(action,value));backgroundWrites=write;return write}
async function prepareBackground(file){if(!(file instanceof Blob)||file.size===0||file.size>6*1024*1024)throw new Error('Choose an image smaller than 6 MiB.');const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());let type='';if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)type='image/png';else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)type='image/jpeg';else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')type='image/webp';if(!type)throw new Error('Only PNG, JPEG, and WebP image data is supported.');const blob=new Blob([file],{type}),url=URL.createObjectURL(blob);try{const image=new Image();image.src=url;await image.decode();if(image.naturalWidth*image.naturalHeight>16000000)throw new Error('Choose an image with no more than 16 million pixels.');return{blob,url}}catch(error){URL.revokeObjectURL(url);throw error}}
function showBackground(url){if(backgroundUrl)URL.revokeObjectURL(backgroundUrl);backgroundUrl=url;appearance.backdrop.style.backgroundImage=url?'url('+JSON.stringify(url)+')':''}
appearance.open.addEventListener('click',()=>{appearance.dialog.showModal();void loadWorkbenchSettings()});
appearance.theme.addEventListener('change',()=>{appearancePreferences.theme=appearance.theme.value;applyAppearance(true)});
appearance.mode.addEventListener('change',()=>{appearancePreferences.mode=appearance.mode.value;applyAppearance(true)});
appearance.opacity.addEventListener('input',()=>{appearancePreferences.opacity=Number(appearance.opacity.value);applyAppearance(true)});
appearance.image.addEventListener('change',async()=>{const revision=++backgroundRevision,file=appearance.image.files&&appearance.image.files[0];if(!file)return;appearanceError('');try{const prepared=await prepareBackground(file);if(revision!==backgroundRevision){URL.revokeObjectURL(prepared.url);return}showBackground(prepared.url);try{await queueBackgroundWrite('set',prepared.blob)}catch(error){appearanceError(error.message+' The image is active for this tab only.')}}catch(error){appearanceError(error.message)}finally{appearance.image.value=''}});
appearance.remove.addEventListener('click',async()=>{++backgroundRevision;showBackground(null);try{await queueBackgroundWrite('delete');appearanceError('')}catch(error){appearanceError(error.message)}});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(appearancePreferences.mode==='system')applyAppearance()});
applyAppearance();
void(async()=>{const revision=backgroundRevision;try{const stored=await backgroundStorage('get');if(stored){const prepared=await prepareBackground(stored);if(revision===backgroundRevision)showBackground(prepared.url);else URL.revokeObjectURL(prepared.url)}}catch{}})();
`;
