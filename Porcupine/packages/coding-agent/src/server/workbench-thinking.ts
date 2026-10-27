/** Inline disclosure of model-supplied reasoning, with a single state-driven live indicator. */
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

.thinking-live .thinking-glyph svg { overflow: visible; }
.thinking-live .motion-orbit { transform-origin: 12px 12px; animation: thinking-orbit 2.4s linear infinite; }
.thinking-live .motion-core { transform-origin: 12px 12px; animation: thinking-core 1.8s ease-in-out infinite; }
.thinking-live .motion-trace { stroke-dasharray: 12 28; animation: thinking-trace 1.8s ease-in-out infinite alternate; }
@keyframes thinking-orbit { to { transform: rotate(360deg); } }
@keyframes thinking-core { 0%,100% { transform: scale(.82); opacity: .5; } 50% { transform: scale(1); opacity: 1; } }
@keyframes thinking-trace { from { stroke-dashoffset: 12; opacity: .4; } to { stroke-dashoffset: -12; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .thinking-glyph svg,.thinking-glyph svg * { animation: none !important; } }
`;

export const THINKING_SCRIPT = `
const MATH_NS='http://www.w3.org/2000/svg';
function thinkingGlyph(){
  const svg=document.createElementNS(MATH_NS,'svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');
  for(const [className,d] of [['motion-orbit','M12 2a10 10 0 0 1 10 10M12 22A10 10 0 0 1 2 12'],['motion-trace','M6 12a6 6 0 1 1 12 0 6 6 0 1 1-12 0'],['motion-core','m12 8 4 4-4 4-4-4Z']]){const path=document.createElementNS(MATH_NS,'path');path.setAttribute('class',className);path.setAttribute('d',d);svg.append(path)}return svg;
}
function createThinkingRow(){
  const wrap=document.createElement('div');wrap.className='thinking';
  const head=document.createElement('button');head.type='button';head.className='thinking-head';head.setAttribute('aria-expanded','false');
  const glyph=document.createElement('span');glyph.className='thinking-glyph';
  const label=document.createElement('span');label.className='thinking-label';label.textContent='Thinking…';
  const caret=document.createElement('span');caret.className='thinking-caret';caret.setAttribute('aria-hidden','true');caret.textContent='⌄';
  head.append(glyph,label,caret);
  const body=document.createElement('div');body.className='thinking-body';body.hidden=true;
  head.addEventListener('click',()=>{const open=head.getAttribute('aria-expanded')==='true';head.setAttribute('aria-expanded',String(!open));body.hidden=open});
  wrap.append(head,body);
  return {wrap,head,glyph,label,body,caret,startedAt:Date.now()};
}
function startThinking(row){row.startedAt=Date.now();row.glyph.replaceChildren(thinkingGlyph());row.wrap.classList.add('thinking-live');}
function stopThinking(row,seconds){
  row.wrap.classList.remove('thinking-live');
  const elapsed=Math.max(1,Math.round(seconds||((Date.now()-row.startedAt)/1000)));
  const hasReasoning=Boolean(row.body.textContent.trim());row.head.disabled=!hasReasoning;row.caret.hidden=!hasReasoning;
  row.label.textContent=(hasReasoning?'Thought for ':'Worked for ')+elapsed+' '+(elapsed===1?'second':'seconds');
}
`;
