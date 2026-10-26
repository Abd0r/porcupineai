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
.dot.busy { animation: workbench-breathe 1.4s ease-in-out infinite; }
.message.assistant .label { color: var(--quiet); letter-spacing: .02em; }
.feed { scroll-behavior: smooth; }
.settings-section h3 + p, .settings-note { text-wrap: pretty; }
@media (hover: hover) {
  .message.user:hover, .visualization-card:hover, .permission:hover { }
}
::selection { background: color-mix(in srgb, var(--accent) 30%, transparent); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;
