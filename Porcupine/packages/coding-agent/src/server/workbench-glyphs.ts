const glyphs: Record<string, Array<[string, string]>> = {
	terminal: [
		["", "M3 5h18v14H3Z"],
		["", "m6 9 3 3-3 3"],
		["glyph-cursor", "M12 15h5"],
	],
	web: [
		["", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"],
		["glyph-sweep", "M12 3a9 9 0 0 1 9 9"],
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
		["", "M5 12 11 5l8 5-7 9-7-7ZM11 5l1 14M5 12l14-2"],
		["glyph-pulse", "M3 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M17 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0"],
	],
};

export const ACTIVITY_GLYPHS_SCRIPT = `
const activityGlyphPaths=${JSON.stringify(glyphs)};
function activityGlyph(kind){
  if(kind==='dreaming')return thinkingGlyph();
  const svg=document.createElementNS(MATH_NS,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.4');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.dataset.kind=kind;
  for(const [className,d] of activityGlyphPaths[kind]||activityGlyphPaths.reasoning){const path=document.createElementNS(MATH_NS,'path');path.setAttribute('class',className);path.setAttribute('d',d);svg.append(path)}return svg;
}
`;

export const ACTIVITY_GLYPHS_STYLES = `
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-cursor { animation: glyph-blink 1.2s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-sweep { transform-origin: 12px 12px; animation: glyph-orbit 3s linear infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-page { animation: glyph-read 2.2s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-ink { stroke-dasharray: 32; animation: glyph-write 2.4s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-pencil { animation: glyph-edit 2s ease-in-out infinite; }
:is(.tool-activity[data-state="running"],.worker[data-state="running"],.thinking-live) .glyph-pulse { animation: glyph-blink 2.4s ease-in-out infinite; }
.worker[data-state="running"] .dream-thread { stroke-dasharray: 42 58; animation: dreaming-flow 5.6s linear infinite; }
.worker[data-state="running"] .dream-spark { animation: dreaming-light 3.6s ease-in-out infinite; }
@keyframes glyph-blink { 0%,100% { opacity: .3; } 50% { opacity: 1; } }
@keyframes glyph-orbit { to { transform: rotate(360deg); } }
@keyframes glyph-read { 0%,100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(1px); } }
@keyframes glyph-write { 0% { stroke-dashoffset: 32; opacity: .3; } 65%,100% { stroke-dashoffset: 0; opacity: 1; } }
@keyframes glyph-edit { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-1px,1px); } }
`;
