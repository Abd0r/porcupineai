/**
 * Adapted semantic tokens and conversation layout patterns from DeepSeek Harness (MIT).
 * Source revision and required notice: docs/gui-third-party-notices.md.
 * Porcupine owns the session transport, security policy and declarative visual renderers.
 */
export const WORKBENCH_STYLES = `
/*
Adapted from DeepSeek Harness. MIT License. Copyright (c) 2026 DeepSeek.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
:root {
  color-scheme: dark;
  --bg: #151517;
  --sidebar: #1b1b1c;
  --surface: #2c2c2e;
  --surface-hover: #353638;
  --canvas: #1b1b1c;
  --line: rgb(255 255 255 / 12%);
  --line-soft: rgb(255 255 255 / 6%);
  --text: #f9fafb;
  --muted: #cfd3d6;
  --quiet: #9b9fa6;
  --accent: #7aaaff;
  --accent-ink: #0f1115;
  --danger: #e7abab;
  --plot-text: #d6d6db;
  --plot-label: #b4b4bd;
  --plot-grid: #303035;
  --plot-axis: #74747e;
  --unit: 1px;
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 20px;
  --s6: 24px;
  --s7: 32px;
  --s8: 40px;
  --s9: 48px;
  --r1: 4px;
  --r2: 8px;
  --r3: 28px;
  --small: 12px;
  --body: 14px;
  --title: 16px;
  --hero: 26px;
  --sidebar-width: 224px;
  --reading-min: 680px;
  --reading-max: 920px;
  --reading-width: clamp(var(--reading-min),64cqw,var(--reading-max));
  --composer-extra: 32px;
  --figure-height: 340px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font: var(--body)/1.5714286 var(--font);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; height: 100dvh; background: var(--bg); color: var(--text); }
button, input, textarea { font: inherit; }
button { cursor: pointer; }
button:focus-visible, summary:focus-visible, canvas:focus-visible, input:focus-visible { outline: var(--unit) solid var(--accent); outline-offset: var(--s1); }
.shell { height: 100%; display: grid; grid-template-columns: var(--sidebar-width) minmax(0,1fr); grid-template-rows: minmax(0,1fr); }
.sidebar { background: var(--sidebar); padding: var(--s6) var(--s3) var(--s4); display: flex; flex-direction: column; gap: var(--s6); min-height: 0; }
.brand { display: flex; align-items: baseline; justify-content: space-between; padding: 0 var(--s2); font-size: var(--title); font-weight: 500; letter-spacing: -.025em; }
.edition { font-size: var(--small); color: var(--muted); font-weight: 400; letter-spacing: 0; }
.caption { margin: 0 var(--s2) var(--s2); color: var(--muted); font-size: var(--small); }
.sessions { display: grid; gap: var(--s1); overflow: auto; }
.session { min-width: 0; border: 0; border-radius: var(--r1); background: transparent; color: var(--muted); text-align: left; padding: var(--s2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session:hover, .session.active { background: var(--surface-hover); color: var(--text); }
.new-session { color: var(--text); background: transparent; border: var(--unit) solid var(--quiet); border-radius: var(--r1); padding: var(--s2) var(--s3); text-align: left; }
.new-session:hover { background: var(--surface-hover); }
.side-foot { margin-top: auto; padding: var(--s2); color: var(--muted); font-size: var(--small); }
.main { min-width: 0; min-height: 0; display: flex; flex-direction: column; height: 100%; container-type: inline-size; }
.topbar { min-height: var(--s9); flex-shrink: 0; border-bottom: var(--unit) solid var(--line-soft); display: flex; align-items: center; justify-content: space-between; padding: 0 var(--s6); gap: var(--s4); }
.topbar strong { font-size: var(--small); font-weight: 500; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status { font-size: var(--small); color: var(--quiet); display: flex; align-items: center; gap: var(--s2); white-space: nowrap; }
.dot { width: var(--s1); height: var(--s1); background: var(--quiet); border-radius: 50%; }
.dot.busy { background: var(--accent); }
.content { width: min(calc(var(--reading-width) + var(--composer-extra) + var(--s7) * 2),100%); margin: 0 auto; padding: var(--s6) var(--s7) var(--s4); display: flex; flex-direction: column; flex: 1; min-height: 0; }
.welcome { margin: auto; padding: var(--s8) 0; }
.welcome h1 { font-size: var(--hero); font-weight: 500; letter-spacing: -.035em; margin: 0 0 var(--s2); }
.welcome p { color: var(--muted); margin: 0; }
.feed { overflow: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--s7); padding: var(--s4) var(--s4) var(--s7); scrollbar-gutter: stable both-edges; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.feed > * { flex-shrink: 0; }
.message { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%; }
.message.user { align-self: flex-end; max-width: 85%; background: var(--surface); padding: var(--s2) var(--s4); border-radius: var(--r2); }
.message.assistant { align-self: stretch; }
.message.tool { color: var(--quiet); font-size: var(--small); padding: 0; }
.label { color: var(--muted); font-size: var(--small); margin-bottom: var(--s2); }
.message.user .label, .message.tool .label { display: none; }
.composer-wrap { flex-shrink: 0; border: var(--unit) solid var(--line); background: var(--surface); border-radius: var(--r3); padding: var(--s3); }
.composer-wrap:focus-within { border-color: var(--quiet); }
.composer { display: block; width: 100%; resize: vertical; min-height: var(--s9); max-height: 25dvh; background: transparent; border: 0; color: var(--text); outline: none; padding: var(--s1); }
.composer::placeholder { color: var(--quiet); }
.compose-row { display: flex; justify-content: space-between; align-items: center; gap: var(--s2); padding-top: var(--s2); }
.hint { font-size: var(--small); color: var(--quiet); }
.actions { display: flex; gap: var(--s2); }
.send, .allow { background: var(--text); color: var(--accent-ink); border: 0; border-radius: var(--r1); padding: var(--s1) var(--s3); font-size: var(--small); font-weight: 500; }
.send:disabled { opacity: .4; cursor: not-allowed; }
.stop, .deny { border: var(--unit) solid var(--line); background: transparent; color: var(--muted); border-radius: var(--r1); padding: var(--s1) var(--s3); font-size: var(--small); }
.stop:hover, .deny:hover { color: var(--text); border-color: var(--quiet); }
.permission { border-left: var(--unit) solid var(--accent); padding: var(--s4); background: var(--surface); }
.permission p { color: var(--muted); margin: var(--s2) 0 var(--s4); white-space: pre-wrap; }
.error { flex-shrink: 0; color: var(--danger); font-size: var(--small); padding: var(--s2) 0; }
.notice { flex-shrink: 0; font-size: var(--small); color: var(--quiet); margin-top: var(--s2); }
.auth { position: fixed; inset: 0; background: var(--bg); display: grid; place-items: center; padding: var(--s6); }
.auth-card { width: min(420px,100%); }
.auth-card h2 { font-size: var(--hero); font-weight: 500; letter-spacing: -.03em; margin: 0 0 var(--s3); }
.auth-card p { color: var(--muted); margin-bottom: var(--s6); }
.auth-card label { font-size: var(--small); color: var(--muted); }
.auth-card input { width: 100%; padding: var(--s3); border: var(--unit) solid var(--line); border-radius: var(--r1); background: var(--surface); color: var(--text); margin: var(--s2) 0 var(--s4); }
.auth-card button { float: right; padding: var(--s2) var(--s4); }
.visualization-card { width: 100%; align-self: stretch; background: transparent; border: 0; padding: 0; box-shadow: none; overflow-wrap: anywhere; }
.visualization-card h2 { font-size: var(--title); font-weight: 500; letter-spacing: -.015em; margin: 0; }
.visualization-card p { color: var(--muted); font-size: var(--small); margin: var(--s1) 0 var(--s4); }
.scene-canvas { display: block; width: 100%; height: clamp(220px,34vw,var(--figure-height)); border: var(--unit) solid var(--line-soft); border-radius: var(--r1); background: var(--canvas); touch-action: none; }
.scene-controls { display: flex; flex-wrap: wrap; gap: var(--s1); margin-top: var(--s2); }
.scene-controls button { color: var(--muted); background: transparent; border: 0; border-radius: var(--r1); padding: var(--s1) var(--s2); font-size: var(--small); }
.scene-controls button:hover { background: var(--surface); color: var(--text); }
.visualization-hint { color: var(--quiet); font-size: var(--small); margin-top: var(--s1); }
.scene-contents { overflow: auto; max-width: 100%; max-height: var(--figure-height); color: var(--muted); font-size: var(--small); margin: var(--s3) 0; }
.scene-contents summary { cursor: pointer; }
.scene-contents ul { padding-left: var(--s5); }
.scene-contents table { border-collapse: collapse; min-width: 100%; white-space: nowrap; font-variant-numeric: tabular-nums; }
.scene-contents th, .scene-contents td { padding: var(--s2) var(--s3); text-align: left; border-bottom: var(--unit) solid var(--line-soft); font-weight: 400; }
.scene-contents th { color: var(--text); }
.scene-contents caption { text-align: left; white-space: normal; padding: var(--s3) 0; color: var(--quiet); }
.chart-legend { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s5); padding: 0; list-style: none; color: var(--muted); font-size: var(--small); margin: var(--s2) 0; }
@media (max-width: 700px) {
  .shell { grid-template-columns: minmax(0,1fr); }
  .sidebar { display: none; }
  .topbar { padding: 0 var(--s4); }
  .content { padding: var(--s4) var(--s4) var(--s3); }
  .feed { gap: var(--s6); }
  .hint { max-width: 60%; }
}
`;
