/**
 * Inline thinking disclosure for the browser workbench.
 *
 * The transcript shows the same shape a reader expects from a reasoning model: a
 * compact "Thinking…" row that becomes "Thought for Ns", a collapsed grey body
 * with the model's own chain of thought, and the answer below in normal text.
 *
 * Ten abstract marks cycle while the turn is live. They are ornament, not claims:
 * the row never says "coding" or "searching", and the label only reports elapsed
 * time. Tool activity is reported separately by the tool rows.
 */

export const THINKING_STYLES = `
.thinking { margin: 0 0 var(--s3); }
.thinking-head { display: inline-flex; align-items: center; gap: var(--s2); padding: var(--s1) var(--s2) var(--s1) 0; border: 0; background: transparent; color: var(--muted); font-size: var(--small); cursor: pointer; border-radius: var(--r1); }
.thinking-head:hover { color: var(--text); }
.thinking-glyph { display: inline-grid; place-items: center; width: var(--s5); height: var(--s5); color: var(--accent); }
.thinking-glyph svg { width: 16px; height: 16px; }
.thinking-label { font-variant-numeric: tabular-nums; }
.thinking-caret { color: var(--quiet); transition: transform var(--motion-fast) var(--motion-ease); }
.thinking-head[aria-expanded="true"] .thinking-caret { transform: rotate(180deg); }
.thinking-body { margin: var(--s2) 0 var(--s3) calc(var(--s5) + var(--s2)); padding-left: var(--s3); border-left: var(--unit) solid var(--line-soft); color: var(--quiet); font-size: var(--small); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-subject { margin: 0; color: var(--quiet); font-size: var(--small); }

.tg { transform-origin: 12px 12px; }
.tg.g1 { animation: tg-spin 2.4s linear infinite; }
.tg.g2 { animation: tg-ripple 1.8s ease-out infinite; }
.tg.g3 { animation: tg-dots 1.2s ease-in-out infinite; }
.tg.g4 { animation: tg-dash 2.2s linear infinite; }
.tg.g5 { animation: tg-pulse 1.6s ease-in-out infinite; }
.tg.g6 { animation: tg-drift 2.6s ease-in-out infinite; }
.tg.g7 { animation: tg-rock 2s ease-in-out infinite; }
.tg.g8 { animation: tg-slide 2.4s ease-in-out infinite; }
.tg.g9 { animation: tg-spin 3.4s linear infinite reverse; }
.tg.g10 { animation: tg-breathe 1.5s ease-in-out infinite; }
@keyframes tg-spin { to { transform: rotate(360deg); } }
@keyframes tg-ripple { 0% { transform: scale(.72); opacity: .45; } 70% { transform: scale(1.05); opacity: 1; } 100% { transform: scale(.72); opacity: .45; } }
@keyframes tg-dots { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
@keyframes tg-dash { to { stroke-dashoffset: -24; } }
@keyframes tg-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
@keyframes tg-drift { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(1px, -1px); } }
@keyframes tg-rock { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg); } }
@keyframes tg-slide { 0%, 100% { transform: translateX(-1.5px); } 50% { transform: translateX(1.5px); } }
@keyframes tg-breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .tg { animation: none !important; } }
`;

export const THINKING_SCRIPT = `
const MATH_NS='http://www.w3.org/2000/svg';
const THINK_GLYPHS=[
  {anim:'g1',paths:['M4 12a8 8 0 1 1 8 8']},
  {anim:'g2',paths:['M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0','M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0','M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0']},
  {anim:'g3',paths:['M7 12h.01','M12 12h.01','M17 12h.01']},
  {anim:'g4',paths:['M4 16c3-8 6 0 8-4s4 4 8-2']},
  {anim:'g5',paths:['M4 6h16','M4 12h16','M4 18h16']},
  {anim:'g6',paths:['M6 14a6 6 0 1 1 12 0a6 6 0 0 1-12 0','M18 6l3-2']},
  {anim:'g7',paths:['M12 4l7 14H5z']},
  {anim:'g8',paths:['M4 12c2-4 4-4 6 0s4 4 6 0 2-2 4 0']},
  {anim:'g9',paths:['M6 4c6 4 6 12 0 16','M18 4c-6 4-6 12 0 16']},
  {anim:'g10',paths:['M12 3v4','M12 17v4','M3 12h4','M17 12h4','M6 6l2.5 2.5','M15.5 15.5L18 18','M18 6l-2.5 2.5','M8.5 15.5L6 18']},
];
const THINK_CYCLE_MS=1200;
function thinkingGlyph(index){
  const glyph=THINK_GLYPHS[index%THINK_GLYPHS.length];
  const svg=document.createElementNS(MATH_NS,'svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');
  svg.classList.add('tg',glyph.anim);
  if(glyph.anim==='g4'||glyph.anim==='g9')svg.setAttribute('stroke-dasharray','6 3');
  glyph.paths.forEach((d,index)=>{const path=document.createElementNS(MATH_NS,'path');path.setAttribute('d',d);if(glyph.anim==='g3')path.setAttribute('stroke-width','2.6');svg.append(path)});
  return svg;
}
function createThinkingRow(){
  const wrap=document.createElement('div');wrap.className='thinking';
  const head=document.createElement('button');head.type='button';head.className='thinking-head';head.setAttribute('aria-expanded','false');
  const glyph=document.createElement('span');glyph.className='thinking-glyph';
  const label=document.createElement('span');label.className='thinking-label';label.textContent='Thinking…';
  const caret=document.createElement('span');caret.className='thinking-caret';caret.setAttribute('aria-hidden','true');caret.textContent='\\u2304';
  head.append(glyph,label,caret);
  const body=document.createElement('div');body.className='thinking-body';body.hidden=true;
  head.addEventListener('click',()=>{const open=head.getAttribute('aria-expanded')==='true';head.setAttribute('aria-expanded',String(!open));body.hidden=open});
  wrap.append(head,body);
  return {wrap,head,glyph,label,body,index:0,timer:null,startedAt:Date.now()};
}
function startThinking(row){
  if(row.timer)return;row.startedAt=Date.now();
  const paint=()=>{row.glyph.replaceChildren(thinkingGlyph(row.index++))};
  paint();row.timer=setInterval(paint,THINK_CYCLE_MS);
}
function stopThinking(row,seconds){
  if(row.timer){clearInterval(row.timer);row.timer=null}
  const elapsed=Math.max(1,Math.round(seconds||((Date.now()-row.startedAt)/1000)));
  row.label.textContent='Thought for '+elapsed+' '+(elapsed===1?'second':'seconds');
}
`;
