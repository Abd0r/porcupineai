/** Keep the composer inside the visible viewport, including virtual-keyboard resizing. */
export const VIEWPORT_STYLES = `
body { height: var(--workbench-height,100dvh); }
.auth { overflow-y: auto; overscroll-behavior: contain; align-items: safe center; }
.feed { overscroll-behavior: contain; }
.feed[data-replaying="true"] > *, .feed[data-replaying="true"] .activity-glyph * { animation: none !important; }
.composer { max-height: calc(var(--workbench-height,100dvh) * .25); }
.composer-wrap { position: relative; }
.session-controls .context-ring { position: static; }
.context-tip { top: auto; bottom: calc(100% + 8px); right: 12px; width: min(260px,calc(100vw - 48px)); max-width: calc(100% - 24px); white-space: normal; }
.feed-stage > .jump-latest { bottom: 12px; }
.collaboration-card > summary::after { transition: transform var(--motion-fast) var(--motion-ease); }
:root[data-theme="pixel"] .composer-wrap:focus-within { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: 2px; }
:root[data-theme="pixel"] .composer:focus-visible { outline: none; }
:root[data-reduced-motion="true"] *, :root[data-reduced-motion="true"] *::before, :root[data-reduced-motion="true"] *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
@media (max-width:700px) {
  :is(#sidebar-toggle,#rail-toggle,#settings-open,#attach-files,#send,#stop,#session-model,#context-ring) { min-width: 44px; min-height: 44px; }
  .session-controls .mode-icon-control { width: 44px; height: 44px; }
  .topbar-actions { flex-shrink: 0; }
  .topbar strong { min-width: 0; }
  .rail-card > summary,.collaboration-card > summary { min-height: 44px; }
  .composer,.settings-grid select,.settings-grid input,.nav-search,.adaptive-body textarea,.adaptive-body input:not([type="checkbox"]):not([type="radio"]):not([type="range"]) { font-size: 16px; }
  .settings-grid select,.settings-grid input { min-height: 44px; }
  .content { padding-bottom: max(8px,env(safe-area-inset-bottom)); }
}
@media (forced-colors:active) { svg[data-kind="reasoning"] { color: CanvasText; } .glyph-star { fill: CanvasText; filter: none; } }
`;

export const VIEWPORT_SCRIPT = `
function resizeWorkbenchViewport(){const height=Math.min(innerHeight,window.visualViewport?window.visualViewport.height:innerHeight);document.documentElement.style.setProperty('--workbench-height',Math.round(height)+'px');resizeComposer();}
window.addEventListener('resize',resizeWorkbenchViewport);
if(window.visualViewport)window.visualViewport.addEventListener('resize',resizeWorkbenchViewport);
resizeWorkbenchViewport();
window.addEventListener('keydown',event=>{if(event.key!=='Tab'||!window.matchMedia('(max-width: 700px)').matches||shell.dataset.sidebar==='collapsed'||document.querySelector('dialog[open]'))return;const sidebar=$('sidebar'),items=[...sidebar.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]'),sidebarToggle].filter(node=>node.getClientRects().length);if(!items.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
`;
