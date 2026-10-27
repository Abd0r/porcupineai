/** Inline disclosure of model-supplied reasoning, with a single state-driven live indicator. */
export const THINKING_STYLES = `
.thinking { margin: 0 0 var(--s3); }
.thinking-head { display: inline-flex; align-items: center; gap: var(--s2); padding: var(--s1) var(--s2) var(--s1) 0; border: 0; background: transparent; color: var(--muted); font-size: var(--small); cursor: pointer; border-radius: var(--r1); }
.thinking-head:hover { color: var(--text); }
.thinking-head:disabled { opacity: 1; cursor: default; }
.thinking-glyph { display: inline-grid; place-items: center; width: 28px; height: 24px; color: var(--accent); }
.thinking-glyph svg { width: 28px; height: 24px; overflow: visible; }
.thinking-label { font-variant-numeric: tabular-nums; }
.thinking-caret { color: var(--quiet); transition: transform var(--motion-fast) var(--motion-ease); }
.thinking-head[aria-expanded="true"] .thinking-caret { transform: rotate(180deg); }
.thinking-body { margin: var(--s2) 0 var(--s3) calc(var(--s5) + var(--s2)); padding-left: var(--s3); border-left: var(--unit) solid var(--line-soft); color: var(--quiet); font-size: var(--small); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-body.rich { white-space: normal; }
.thinking-subject { margin: 0; color: var(--quiet); font-size: var(--small); }

.dream-thread { opacity: .55; }
.dream-spark { opacity: .45; }
:is(.thinking-live,.tool-activity[data-state="running"]) .dream-thread { stroke-dasharray: 42 58; animation: dreaming-flow 5.6s linear infinite; }
:is(.thinking-live,.tool-activity[data-state="running"]) .dream-thread:nth-child(2) { animation-duration: 7s; animation-direction: reverse; opacity: .4; }
:is(.thinking-live,.tool-activity[data-state="running"]) .dream-thread:nth-child(3) { animation-delay: -2.8s; animation-duration: 6.4s; }
:is(.thinking-live,.tool-activity[data-state="running"]) .dream-spark { animation: dreaming-light 3.6s ease-in-out infinite; }
:is(.thinking-live,.tool-activity[data-state="running"]) .dream-spark:last-child { animation-delay: -1.8s; }
@keyframes dreaming-flow { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes dreaming-light { 0%,100% { opacity: .15; transform: translateY(1px); } 50% { opacity: .85; transform: translateY(-1px); } }
@media (prefers-reduced-motion: reduce) { .thinking-glyph svg,.thinking-glyph svg * { animation: none !important; } }
`;

export const THINKING_SCRIPT = `
const MATH_NS='http://www.w3.org/2000/svg';
function thinkingGlyph(){
  const svg=document.createElementNS(MATH_NS,'svg');
  svg.setAttribute('viewBox','0 0 32 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.35');svg.setAttribute('stroke-linecap','round');
  for(const d of ['M2 14C6 3 11 4 16 12S25 21 30 9','M2 10C8 21 13 20 17 12S24 3 30 14','M4 16C10 18 9 6 16 7S22 21 28 8']){const path=document.createElementNS(MATH_NS,'path');path.setAttribute('class','dream-thread');path.setAttribute('pathLength','100');path.setAttribute('d',d);svg.append(path)}
  for(const [cx,cy] of [[9,6],[24,18]]){const point=document.createElementNS(MATH_NS,'circle');point.setAttribute('class','dream-spark');point.setAttribute('cx',String(cx));point.setAttribute('cy',String(cy));point.setAttribute('r','1');point.setAttribute('fill','currentColor');point.setAttribute('stroke','none');svg.append(point)}return svg;
}
function createThinkingRow(){
  const wrap=document.createElement('div');wrap.className='thinking';
  const head=document.createElement('button');head.type='button';head.className='thinking-head';head.disabled=true;head.setAttribute('aria-expanded','false');
  const glyph=document.createElement('span');glyph.className='thinking-glyph';
  const label=document.createElement('span');label.className='thinking-label';label.textContent='Working…';
  const caret=document.createElement('span');caret.className='thinking-caret';caret.hidden=true;caret.setAttribute('aria-hidden','true');caret.textContent='⌄';
  head.append(glyph,label,caret);
  const body=document.createElement('div');body.className='thinking-body';body.hidden=true;
  head.addEventListener('click',()=>{const open=head.getAttribute('aria-expanded')==='true';head.setAttribute('aria-expanded',String(!open));body.hidden=open});
  wrap.append(head,body);
  return {wrap,head,glyph,label,body,caret,startedAt:Date.now()};
}
function startThinking(row){row.startedAt=Date.now();row.glyph.replaceChildren(thinkingGlyph());row.wrap.classList.add('thinking-live');}
function setReasoningText(row,text){const first=!row.hasReasoning;row.hasReasoning=Boolean(text.trim());row.reasoningText=text;renderRichText(row.body,text);row.head.disabled=!row.hasReasoning;row.caret.hidden=row.head.disabled;if(first&&row.hasReasoning){row.glyph.replaceChildren(activityGlyph('reasoning'));if(appearancePreferences.showReasoning){row.head.setAttribute('aria-expanded','true');row.body.hidden=false;}}scrollFeed();}
function stopThinking(row,seconds){
  row.wrap.classList.remove('thinking-live');
  const elapsed=Math.max(1,Math.round(seconds||((Date.now()-row.startedAt)/1000)));
  const hasReasoning=Boolean(row.body.textContent.trim());row.head.disabled=!hasReasoning;row.caret.hidden=!hasReasoning;
  row.label.textContent=(hasReasoning?'Thought for ':'Worked for ')+elapsed+' '+(elapsed===1?'second':'seconds');
}
`;
