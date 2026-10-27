/** Motion expresses state changes, never fabricated work or interpolated measurements. */
export const WORKBENCH_MOTION_STYLES = `
:root { --motion-fast: 120ms; --motion-normal: 200ms; --motion-ease: cubic-bezier(.2,.7,.2,1); --motion-distance: 6px; }
body, .sidebar, .composer-wrap { transition: background-color var(--motion-normal) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease); }
button, select, summary { transition: color var(--motion-fast) var(--motion-ease), background-color var(--motion-fast) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease); }
.message, .visualization-card, .permission { animation: workbench-enter var(--motion-normal) var(--motion-ease) both; }
.chat-backdrop { transition: opacity var(--motion-normal) var(--motion-ease); }
.settings-dialog { opacity: 1; transform: translateY(0); transition: opacity var(--motion-normal) var(--motion-ease), transform var(--motion-normal) var(--motion-ease); }
.settings-heading { position: sticky; top: 0; z-index: 2; background: var(--bg); }
@starting-style { .settings-dialog[open] { opacity: 0; transform: translateY(var(--motion-distance)); } }
@keyframes workbench-enter { from { opacity: 0; transform: translateY(var(--motion-distance)); } to { opacity: 1; transform: translateY(0); } }
.message, .visualization-card, .permission { animation-delay: var(--enter-delay, 0ms); }
@keyframes workbench-breathe { 0%, 100% { opacity: .45; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }
.message.assistant .label { color: var(--quiet); letter-spacing: .02em; }
.brand-symbol path { stroke-dasharray: 80; stroke-dashoffset: 0; animation: workbench-ink 900ms var(--motion-ease) both; }
.brand-symbol path + path { animation-delay: 120ms; transform-origin: 16px 16px; transition: transform 240ms var(--motion-ease); }
.brand:hover .brand-symbol path + path { transform: translateY(-1px); }
.activity-glyph { flex: 0 0 18px; display: inline-grid; place-items: center; color: var(--quiet); }
.activity-glyph svg { width: 18px; height: 18px; overflow: visible; }
.tool-activity[data-state="running"] .activity-glyph { color: var(--accent); }
.tool-activity[data-state="running"] .motion-orbit { transform-origin: 12px 12px; animation: thinking-orbit 2.4s linear infinite; }
.tool-activity[data-state="running"] .motion-core { transform-origin: 12px 12px; animation: thinking-core 1.8s ease-in-out infinite; }
.tool-activity[data-state="running"] .motion-trace { stroke-dasharray: 12 28; animation: thinking-trace 1.8s ease-in-out infinite alternate; }
.tool-activity[data-state="done"] .activity-glyph path { stroke-dasharray: 30; animation: workbench-ink 320ms var(--motion-ease) both; }
.tool-activity[data-state="failed"] .activity-glyph { color: var(--danger); }
.restored .activity-glyph * { animation: none !important; }
@keyframes workbench-ink { from { stroke-dashoffset: 80; opacity: 0; } to { stroke-dashoffset: 0; opacity: 1; } }
.settings-section h3 + p, .settings-note { text-wrap: pretty; }
::selection { background: color-mix(in srgb, var(--accent) 30%, transparent); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;
