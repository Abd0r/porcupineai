const paths = {
	ask: "M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v7c0 4-3 6-6 6h-1c-2 0-4-1-5-3l-4-5a1.6 1.6 0 0 1 2-2l3 2",
	normal: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6",
	auto: "m14 2-9 12h6l-1 8 9-12h-6l1-8Z",
	adaptive: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM19 3v4m-2-2h4",
};
export const MODE_CONTROLS = `<label class="mode-icon-control" id="reasoning-control" title="Reasoning mode"><span id="reasoning-icon" aria-hidden="true"></span><select id="reasoning-mode" aria-label="Reasoning mode"></select></label><label class="mode-icon-control" id="autonomy-control" title="Autonomy mode"><span id="autonomy-icon" aria-hidden="true"></span><select id="autonomy-mode" aria-label="Autonomy mode"><option value="ask">Ask</option><option value="normal">Normal</option><option value="auto">Auto</option></select></label>`;
export const MODE_ICON_STYLES = `
.session-controls .mode-icon-control { position: relative; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; color: var(--muted); flex: 0 0 auto; cursor: pointer; }
.mode-icon-control:hover,.mode-icon-control:focus-within { background: var(--surface-hover); color: var(--text); }
.mode-icon-control:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.mode-icon-control > span { width: 19px; height: 19px; display: grid; place-items: center; pointer-events: none; }
.mode-icon-control svg { width: 19px; height: 19px; overflow: visible; }
.session-controls .mode-icon-control select { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; margin: 0; opacity: 0; cursor: pointer; }
.mode-icon-control:has(select:disabled) { opacity: .45; cursor: not-allowed; }
.mode-icon-control svg { animation: mode-settle 220ms var(--motion-ease); }
@keyframes mode-settle { from { opacity: .35; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
`;
export const MODE_ICON_SCRIPT = `
const modeIconPaths=${JSON.stringify(paths)};
function modeIcon(path){const svg=document.createElementNS(MATH_NS,'svg'),shape=document.createElementNS(MATH_NS,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');shape.setAttribute('d',path);svg.append(shape);return svg;}
function renderModeIcons(snapshot){const autonomy=$('autonomy-control'),reasoning=$('reasoning-control'),level=snapshot.reasoningMode,mode=snapshot.interactionMode;if(autonomy.dataset.mode!==mode){$('autonomy-icon').replaceChildren(modeIcon(modeIconPaths[mode]||modeIconPaths.normal));autonomy.dataset.mode=mode;}autonomy.title='Autonomy: '+mode.charAt(0).toUpperCase()+mode.slice(1)+' · '+surfaceUi.autonomy.title;if(reasoning.dataset.mode!==level){let path=modeIconPaths.adaptive;if(level!=='adaptive'){const bars=({off:0,minimal:1,low:2,medium:3,high:4,xhigh:5,max:6})[level]||0;path=bars?Array.from({length:bars},(_,i)=>'M'+(3+i*3.5)+' 19v-'+(4+i*2)).join(' '):'M4 12h16';}const svg=modeIcon(path);svg.dataset.level=level;$('reasoning-icon').replaceChildren(svg);reasoning.dataset.mode=level;}reasoning.title='Reasoning: '+(({xhigh:'Extra high',max:'Maximum'})[level]||level.charAt(0).toUpperCase()+level.slice(1));}
`;
