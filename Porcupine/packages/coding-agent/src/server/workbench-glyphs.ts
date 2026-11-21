const glyphs: Record<string, Array<[string, string]>> = {
	spawn: [
		["", "M4 8h9v12H4ZM8 4h9v5M12 16H7"],
		["glyph-spawn", "M19 9v6m-3-3h6"],
	],
	sending: [
		["", "M2 6h14v12H2Zm0 0 7 6 7-6"],
		["glyph-packet", "M15 12h7m-3-3 3 3-3 3"],
	],
	receiving: [
		["", "M8 6h14v12H8Zm0 0 7 6 7-6"],
		["glyph-packet glyph-incoming", "M2 12h7m-3-3 3 3-3 3"],
	],
	report: [
		["", "M5 2h10l4 4v16H5ZM15 2v5h4"],
		["glyph-report", "m8 11 2 2 5-4M8 17h8M8 19h5"],
	],
	stopping: [
		["", "M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0Z"],
		["glyph-stop", "M8 8h8v8H8Z"],
	],
	coding: [
		["", "M4 4h16v13H4ZM2 20h20l-2-3H4Z"],
		["glyph-code", "m8 8-2 2 2 2m8-4 2 2-2 2M11 13l2-6"],
		["glyph-cursor", "M14 14h3"],
	],
	skill: [
		["", "M5 2h10l4 4v16H5ZM15 2v5h4"],
		["glyph-skill", "m12 8 1.2 2.3 2.6.4-1.9 1.8.5 2.6-2.4-1.2-2.4 1.2.5-2.6-1.9-1.8 2.6-.4Z"],
		["glyph-page", "M8 17h8M8 19h5"],
	],
	searching: [
		["", "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6"],
		["glyph-scan", "M6 8h8M6 11h6"],
	],
	planning: [
		["", "M5 3h14v19H5ZM9 2v3h6V2"],
		["glyph-plan", "m8 10 1 1 2-2M13 10h3m-8 5 1 1 2-2M13 15h3"],
	],
	delegation: [
		["", "M9 2h6v5H9ZM2 17h6v5H2Zm14 0h6v5h-6"],
		["glyph-link", "M12 7v5H5v5m7-5h7v5"],
	],
	tool: [
		["", "m5 3 4 4-2 2-4-4v5l4 2 3-1 9 10 3-3-10-9 1-3-2-4H6Z"],
		["glyph-tool", "m15 4 2-2 5 5-2 2M17 7 5 19m-1-1-2 4 4-2"],
	],
	terminal: [
		["", "M3 5h18v14H3Z"],
		["", "m6 9 3 3-3 3"],
		["glyph-cursor", "M12 15h5"],
	],
	web: [
		["", "M2 3h20v18H2ZM2 7h20M5 5h.1M8 5h.1"],
		["glyph-search", "M11 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm3 7 4 3"],
	],
	reading: [
		["", "M12 6C8 3 4 4 2 5v14c3-2 7-1 10 1 3-2 7-3 10-1V5c-3-1-7-2-10 1v14"],
		["glyph-page", "M5 8h4M5 11h4M15 8h4M15 11h4"],
	],
	writing: [
		["", "M14 3H4v18h16V9M14 3v6h6"],
		["glyph-ink", "M7 12h8M7 15h10M7 18h6"],
	],
	editing: [
		["", "m6 6-4 6 4 6M18 6l4 6-4 6"],
		["glyph-pencil", "m9 16 1-4 6-6 2 2-6 6-3 2Z"],
	],
	reasoning: [
		["glyph-halo", "M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0Z"],
		["glyph-beam", "M12 2 13 9 20 12 13 15 12 22 11 15 4 12 11 9Z"],
		["glyph-star", "M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0Z"],
	],
};

export const ACTIVITY_GLYPHS_SCRIPT = `
const activityGlyphPaths=${JSON.stringify(glyphs)};
function activityGlyph(kind){
  if(!activityGlyphPaths[kind])kind='reasoning';
  const svg=document.createElementNS(MATH_NS,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.4');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.dataset.kind=kind;
  for(const [className,d] of activityGlyphPaths[kind]||activityGlyphPaths.reasoning){const path=document.createElementNS(MATH_NS,'path');path.setAttribute('class',className);path.setAttribute('d',d);svg.append(path)}return svg;
}
`;

export const ACTIVITY_GLYPHS_STYLES = `
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-cursor { animation: glyph-blink 1.2s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-code { stroke-dasharray: 36; animation: glyph-write 2.8s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-search { animation: glyph-search 3s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-page { animation: glyph-read 2.2s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-ink { stroke-dasharray: 32; animation: glyph-write 2.4s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-pencil { animation: glyph-edit 2s ease-in-out infinite; }
svg[data-kind="reasoning"] { color: #79aaff; }
:root[data-colour-mode="light"] svg[data-kind="reasoning"] { color: #356ac3; }
.glyph-halo { opacity: .2; stroke-width: .8; }
.glyph-beam { opacity: .65; fill: currentColor; stroke: none; transform-origin: 12px 12px; }
.glyph-star { fill: #e0edff; stroke-width: .7; filter: drop-shadow(0 0 1.5px #79aaff); }
:root[data-colour-mode="light"] .glyph-star { fill: currentColor; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-beam { animation: glyph-orbit 9s linear infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-star { transform-origin: 12px 12px; animation: glyph-star 3s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) :is(.glyph-skill,.glyph-plan) { animation: glyph-blink 3s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-link { stroke-dasharray: 4 3; animation: glyph-connect 2s linear infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-scan { animation: glyph-read 2.2s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-tool { transform-origin: 12px 12px; animation: glyph-turn 2.4s ease-in-out infinite; }
:is(.collaboration-card,.worker)[data-state="running"] .glyph-packet { animation: glyph-send 1.8s ease-in-out infinite; }
:is(.collaboration-card,.worker)[data-state="running"] :is(.glyph-spawn,.glyph-stop) { transform-origin: 19px 12px; animation: glyph-blink 2s ease-in-out infinite; }
@keyframes glyph-send { 0% { transform: translateX(-2px); opacity: .3; } 70%,100% { transform: translateX(0); opacity: 1; } }
@keyframes glyph-blink { 0%,100% { opacity: .3; } 50% { opacity: 1; } }
@keyframes glyph-search { 0%,100% { transform: translateX(-1px); } 50% { transform: translateX(1px); } }
@keyframes glyph-orbit { to { transform: rotate(360deg); } }
@keyframes glyph-star { 0%,100% { transform: scale(.85); opacity: .75; } 50% { transform: scale(1.15); opacity: 1; } }
@keyframes glyph-connect { to { stroke-dashoffset: -14; } }
@keyframes glyph-turn { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
@keyframes glyph-read { 0%,100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(1px); } }
@keyframes glyph-write { 0% { stroke-dashoffset: 32; opacity: .3; } 65%,100% { stroke-dashoffset: 0; opacity: 1; } }
@keyframes glyph-edit { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-1px,1px); } }
@media (prefers-reduced-motion: reduce) { :is(.activity-glyph,.worker-icon,.thinking-glyph) svg * { animation: none !important; } }
`;
