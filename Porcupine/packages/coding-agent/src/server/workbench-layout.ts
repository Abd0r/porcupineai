/** Focused desktop workspace. Secondary activity never floats over the transcript. */
export const WORKBENCH_LAYOUT_STYLES = `
:root { --sidebar-width: 248px; --reading-min: 560px; --reading-max: 820px; --hero: 36px; --r1: 8px; --r2: 14px; --r3: 24px; }
body { overflow: hidden; -webkit-font-smoothing: antialiased; }
button, select, input, textarea { -webkit-tap-highlight-color: transparent; }
button:disabled { cursor: not-allowed; opacity: .45; }
:is(button,select,input,textarea,summary,a):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.shell { position: relative; }
.sidebar { padding: 22px 14px 12px; gap: 22px; border-right: 1px solid var(--line-soft); }
.brand { padding: 0 8px; flex-wrap: wrap; gap: 4px; }
.brand-name { display: flex; align-items: center; gap: 9px; font-weight: 650; letter-spacing: -.04em; font-size: 17px; }
.brand-name svg { color: var(--text); }
.brand .edition { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.new-session { display: flex; align-items: center; min-height: 42px; border-color: var(--line); background: var(--surface); font-size: 13px; font-weight: 500; }
.session-section { flex: 1; min-height: 100px; display: flex; flex-direction: column; }
.session-section .nav-search { background: transparent; border-color: var(--line-soft); margin: 0 0 10px; min-height: 34px; }
.session { flex-shrink: 0; min-height: 38px; padding-inline: 10px; font-size: 13px; }
.session.active { box-shadow: none; background: color-mix(in srgb,var(--text) 9%,var(--sidebar)); color: var(--text); }
.caption { color: var(--quiet); font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.side-foot { font-size: 10px; padding-top: 14px; border-top: 1px solid var(--line-soft); color: var(--quiet); }
.main { display: grid; grid-template-columns: minmax(0,1fr); grid-template-rows: 58px minmax(0,1fr); }
.topbar { grid-column: 1/-1; grid-row: 1; min-height: 58px; padding: 0 22px; }
.topbar strong { color: var(--text); font-size: 13px; }
.topbar-actions { gap: 8px; }
.topbar-actions .quiet-button { min-height: 32px; font-size: 12px; }
.status { gap: 6px; font-size: 11px; }
.status::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--quiet); }
.status:has([data-state="ready"])::before { background: #7ca992; }
.status:has([data-state="working"])::before { background: var(--accent); animation: workbench-breathe 1.6s ease-in-out infinite; }
.content { position: relative; grid-column: 1; grid-row: 2; padding: 0 28px 12px; width: min(100%,900px); height: 100%; }
.welcome { flex: none; width: min(100%,640px); text-align: center; margin: auto; padding: 34px 8px 24px; animation: workbench-enter 360ms var(--motion-ease) both; }
.welcome-mark { display: inline-flex; align-items: baseline; justify-content: center; font-size: 32px; font-weight: 700; letter-spacing: -.09em; width: 64px; height: 64px; line-height: 64px; margin-bottom: 18px; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 20px; }
.welcome-mark span { color: var(--accent); }
.welcome .eyebrow { font-size: 10px; text-transform: uppercase; letter-spacing: .14em; color: var(--quiet); margin-bottom: 12px; }
.welcome h1 { font-weight: 550; font-size: clamp(28px,3vw,40px); line-height: 1.15; letter-spacing: -.045em; margin-bottom: 14px; }
.welcome > p:not(.eyebrow) { font-size: 14px; color: var(--quiet); }
.starters { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 28px; }
.starters button { padding: 9px 13px; color: var(--muted); background: transparent; border: 1px solid var(--line-soft); border-radius: 10px; text-align: left; transition: background-color 180ms var(--motion-ease),border-color 180ms var(--motion-ease); }
.starters span { font-size: 12px; font-weight: 550; }
.starters small { color: var(--quiet); font-size: 11px; line-height: 1.5; }
.starters button:hover { color: var(--text); background: var(--surface); border-color: var(--line); }
.content:has(.welcome:not([hidden])) .feed-stage { flex: 0; }
.feed { padding: 32px 8px 28px; gap: 28px; scroll-behavior: auto; }
.message { line-height: 1.8; font-size: 15px; }
.message .label { font-size: 11px; font-weight: 550; letter-spacing: .02em; margin-bottom: 10px; }
.message.user { padding: 10px 18px; border-radius: 20px 20px 5px 20px; font-size: 14px; background: color-mix(in srgb,var(--surface) 75%,var(--bg)); }
.message.tool { font-size: 12px; line-height: 1.6; padding-left: 12px; border-left: 2px solid var(--line); }
.message.assistant .message-body.rich { white-space: normal; }
.rich p { line-height: 1.8; margin-bottom: 16px; }
.rich h3.md-heading { font-size: 18px; letter-spacing: -.025em; margin: 26px 0 12px; }
.code-block { border-radius: 12px; background: var(--canvas); border-color: var(--line); }
.code-banner { padding: 9px 14px; }
.code-block pre { padding: 16px; }
.table-scroll { border: 1px solid var(--line); border-radius: 10px; }
.table-scroll th { background: var(--surface); font-weight: 550; }
.composer-wrap { padding: 14px 16px 10px; border-radius: var(--r3); border-color: var(--line); background: color-mix(in srgb,var(--surface) 78%,var(--bg)); box-shadow: 0 8px 28px -18px rgb(0 0 0 / 40%); transition: border-color 180ms var(--motion-ease),box-shadow 180ms var(--motion-ease); }
.composer-wrap:focus-within { border-color: color-mix(in srgb,var(--accent) 45%,var(--line)); box-shadow: 0 0 0 3px color-mix(in srgb,var(--accent) 6%,transparent); }
.composer { resize: none; min-height: 40px; font-size: 15px; line-height: 1.6; padding: 0; }
.composer:focus-visible { outline: none; }
.restored { animation: none !important; }
.message .label { display: flex; justify-content: space-between; align-items: center; }
.message-copy { padding: 2px 7px; border: 0; border-radius: 5px; background: transparent; color: var(--quiet); font-size: 11px; opacity: 0; }
.message:hover .message-copy,.message:focus-within .message-copy { opacity: 1; }
.message-copy:hover { background: var(--surface); color: var(--text); }
.tool-activity { border: 1px solid var(--line-soft); border-radius: 10px; color: var(--muted); font-size: 12px; }
.tool-activity summary { display: flex; align-items: center; gap: 8px; list-style: none; cursor: pointer; padding: 10px 12px; }
.tool-activity summary::before { content: '›'; color: var(--quiet); transition: transform 160ms var(--motion-ease); }
.tool-activity[open] summary::before { transform: rotate(90deg); }
.tool-state { margin-left: auto; color: var(--quiet); font-size: 10px; }
.tool-activity[data-state="running"] .tool-state { color: var(--accent); }
.tool-activity[data-state="failed"] .tool-state { color: var(--danger); }
.tool-activity pre { padding: 12px; margin: 0; border-top: 1px solid var(--line-soft); overflow: auto; max-height: 320px; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.7 ui-monospace,monospace; }
@media (hover: none) { .message-copy { opacity: 1; } }
.compose-row { align-items: flex-end; padding-top: 8px; }
.session-controls { gap: 6px 12px; font-size: 11px; }
.session-controls label { gap: 3px; }
.session-controls select { font-size: 11px; max-width: 100px; padding: 5px 2px; }
.model-label { font: inherit; color: var(--text); background: transparent; border: 0; padding: 5px 7px; border-radius: 6px; max-width: 150px; text-align: left; }
.model-label:hover { background: var(--surface-hover); }
.model-label::after { content: ' ⌄'; color: var(--quiet); }
.hint { font-size: 10px; }
.compose-options > .hint { display: none; }
#send { width: 34px; height: 34px; transition: transform 160ms var(--motion-ease),opacity 160ms var(--motion-ease); }
#send:not(:disabled):hover { transform: translateY(-2px); }
#send:not(:disabled):active { transform: scale(.92); }
.notice { text-align: center; font-size: 10px; margin-top: 9px; }
.error { border-radius: 8px; padding: 8px 10px; margin-top: 8px; background: color-mix(in srgb,var(--danger) 7%,transparent); }
.permission[data-resolved="true"] { background: transparent; border-color: var(--line); color: var(--muted); }
.permission-decision { color: var(--quiet); font-size: 11px; }
.jump-latest { position: absolute; z-index: 3; bottom: 144px; left: 50%; transform: translateX(-50%); padding: 7px 14px; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 20px; font-size: 11px; box-shadow: 0 4px 16px rgb(0 0 0 / 15%); }
/* Agent evidence is part of the conversation, in event order. */
.goal-activity,.subagent-activity { border-left: 2px solid var(--line); padding: 0 0 0 12px; font-size: 12px; color: var(--muted); }
.goal-activity summary,.subagent-activity summary { display: flex; gap: 12px; align-items: baseline; padding: 8px 0; cursor: pointer; list-style: none; }
.goal-activity summary > span:first-child,.subagent-activity summary > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.goal-activity summary::before,.subagent-activity summary::before { content: '›'; color: var(--quiet); }
.goal-activity[open] summary::before,.subagent-activity[open] summary::before { transform: rotate(90deg); }
.goal-activity[data-state="active"],.subagent-activity[data-state="running"] { border-color: var(--accent); }
.goal-steps { display: grid; gap: 8px; list-style: none; margin: 8px 0; padding: 0; }
.goal-step { line-height: 1.65; }
.activity-detail { padding: 8px 0; color: var(--quiet); white-space: pre-wrap; overflow-wrap: anywhere; }
.activity-detail pre { white-space: pre-wrap; font: 11px/1.7 ui-monospace,monospace; }
.goal-activity,.subagent-activity,.tool-activity { animation: workbench-enter 200ms var(--motion-ease) both; }
@supports (interpolate-size: allow-keywords) {
  .goal-activity,.subagent-activity,.tool-activity { interpolate-size: allow-keywords; }
  :is(.goal-activity,.subagent-activity,.tool-activity)::details-content { height: 0; opacity: 0; overflow: clip; transition: height 200ms var(--motion-ease),opacity 160ms var(--motion-ease),content-visibility 200ms allow-discrete; }
  :is(.goal-activity,.subagent-activity,.tool-activity)[open]::details-content { height: auto; opacity: 1; }
}
.model-list { display: grid; gap: 5px; max-height: 48dvh; overflow: auto; margin-top: 14px; }
.model-row { display: grid; gap: 4px; width: 100%; text-align: left; padding: 12px; background: transparent; color: var(--text); border: 1px solid transparent; border-radius: 10px; }
.model-row:hover { background: var(--surface); }
.model-row[aria-selected="true"] { border-color: var(--accent); background: color-mix(in srgb,var(--accent) 7%,transparent); }
.model-name { font-size: 13px; font-weight: 550; }
.model-meta { font-size: 11px; color: var(--quiet); }
.settings-dialog { border-radius: 18px; box-shadow: 0 24px 100px rgb(0 0 0 / 30%); }
.settings-heading { padding: 20px 24px; }
.settings-heading h2 { font-size: 17px; font-weight: 600; }
.settings-tabs { display: flex; gap: 4px; padding: 12px 18px; border-bottom: 1px solid var(--line-soft); }
.settings-tab { flex: 1; padding: 9px 8px; border: 0; background: transparent; color: var(--quiet); font-size: 12px; border-radius: 8px; }
.settings-tab[aria-selected="true"] { background: var(--surface); color: var(--text); }
.settings-section { padding: 24px; }
.settings-section h3 { font-size: 14px; font-weight: 600; }
.settings-section p { font-size: 12px; line-height: 1.7; }
.file-picker { position: relative; }
.file-picker input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; padding: 0; overflow: hidden; }
.file-picker:focus-within { outline: 2px solid var(--accent); outline-offset: 3px; }
.settings-grid select,.settings-grid input[type="number"] { min-height: 40px; border-radius: 8px; }
.quiet-button { min-height: 30px; }
.auth { z-index: 30; background: var(--bg); }
.auth-card { padding: 30px; width: min(480px,100%); border: 1px solid var(--line); border-radius: 20px; background: var(--sidebar); box-shadow: 0 24px 100px -40px rgb(0 0 0 / 30%); }
.auth-card h2 { font-size: 27px; }
.auth-card input { border-radius: 10px; }
.auth-card button { border-radius: 8px; }
.sidebar-dismiss { display: none; }
@media (max-width: 1100px) {
  .content { padding-inline: 22px; }
}
@media (max-width: 700px) {
  .shell,.shell[data-sidebar="collapsed"] { grid-template-columns: minmax(0,1fr); }
  .sidebar { display: flex; position: absolute; z-index: 12; inset: 0 auto 0 0; width: min(285px,85vw); transform: translateX(0); transition: transform 220ms var(--motion-ease),opacity 180ms var(--motion-ease); }
  .shell[data-sidebar="collapsed"] .sidebar { transform: translateX(-100%); padding: 22px 14px 12px; opacity: 0; }
  .sidebar-dismiss:not([hidden]) { display: block; position: absolute; z-index: 11; inset: 0; border: 0; background: rgb(0 0 0 / 45%); }
  .topbar { padding: 0 12px; gap: 8px; }
  .topbar-actions { gap: 2px; }
  .topbar .status { display: none; }
  .content { padding: 0 12px max(10px,env(safe-area-inset-bottom)); }
  .welcome { padding: 24px 8px; }
  .welcome-mark { margin-bottom: 12px; width: 48px; height: 48px; line-height: 48px; border-radius: 15px; font-size: 26px; }
  .welcome h1 { font-size: 30px; }
  .starters { grid-template-columns: 1fr; margin-top: 22px; gap: 7px; }
  .starters button { padding: 12px 14px; gap: 4px; }
  .starters small { display: none; }
  .feed { padding: 22px 4px; gap: 24px; }
  .message { font-size: 14px; }
  .composer-wrap { padding: 12px; border-radius: 20px; }
  .session-controls { gap: 3px 8px; }
  .session-controls label { font-size: 10px; }
  .session-controls select { max-width: 72px; }
  .model-label { display: block; max-width: 130px; order: -1; }
  .session-controls .context-ring { width: 24px; height: 24px; }
  .notice { font-size: 9px; }
}
@media (max-height: 680px) { .welcome-mark,.welcome .eyebrow { display: none; } .welcome { padding-block: 16px; } .starters { margin-top: 16px; } }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
`;
