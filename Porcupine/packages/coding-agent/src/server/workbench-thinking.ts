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

@media (prefers-reduced-motion: reduce) { .thinking-glyph svg,.thinking-glyph svg * { animation: none !important; } }
`;

export const THINKING_SCRIPT = `
const MATH_NS='http://www.w3.org/2000/svg';
const thinkingRows=new WeakMap();let thinkingSerial=0;
function renderThinkingBody(row){if(row.renderFrame){cancelAnimationFrame(row.renderFrame);row.renderFrame=0;}if(row.renderedText===row.reasoningText)return;renderRichText(row.body,row.reasoningText||'');row.renderedText=row.reasoningText;scrollFeed();}
function thinkingGlyph(){
  return activityGlyph('reasoning');
}
function createThinkingRow(){
  const wrap=document.createElement('div');wrap.className='thinking';
  const head=document.createElement('button');head.type='button';head.className='thinking-head';head.disabled=true;head.setAttribute('aria-expanded','false');
  const glyph=document.createElement('span');glyph.className='thinking-glyph';
  const label=document.createElement('span');label.className='thinking-label';label.textContent='Working…';
  const caret=document.createElement('span');caret.className='thinking-caret';caret.hidden=true;caret.setAttribute('aria-hidden','true');caret.textContent='⌄';
  head.append(glyph,label,caret);
  const body=document.createElement('div');body.className='thinking-body';body.hidden=true;
  body.id='thinking-body-'+(++thinkingSerial);head.setAttribute('aria-controls',body.id);
  head.addEventListener('click',()=>{const open=head.getAttribute('aria-expanded')==='true';head.setAttribute('aria-expanded',String(!open));body.hidden=open;if(!open)renderThinkingBody(row)});
  wrap.append(head,body);
  const row={wrap,head,glyph,label,body,caret,startedAt:Date.now(),renderFrame:0};thinkingRows.set(wrap,row);return row;
}
function startThinking(row){row.startedAt=Date.now();row.glyph.replaceChildren(thinkingGlyph());row.wrap.classList.add('thinking-live');}
function setReasoningText(row,text){if(row.reasoningText===text)return;const first=!row.hasReasoning;row.hasReasoning=Boolean(text.trim());row.reasoningText=text;row.head.disabled=!row.hasReasoning;row.caret.hidden=row.head.disabled;if(first&&row.hasReasoning&&appearancePreferences.showReasoning){row.head.setAttribute('aria-expanded','true');row.body.hidden=false;}if(!row.body.hidden&&!row.renderFrame)row.renderFrame=requestAnimationFrame(()=>{row.renderFrame=0;if(!row.body.hidden)renderThinkingBody(row)});}
function stopThinking(row,seconds){
  row.wrap.classList.remove('thinking-live');
  const elapsed=Math.max(1,Math.round(seconds||((Date.now()-row.startedAt)/1000)));
  if(row.renderFrame){cancelAnimationFrame(row.renderFrame);row.renderFrame=0;}if(!row.body.hidden)renderThinkingBody(row);
  const hasReasoning=Boolean((row.reasoningText||'').trim());row.head.disabled=!hasReasoning;row.caret.hidden=!hasReasoning;
  row.label.textContent=(hasReasoning?'Thought for ':'Worked for ')+elapsed+' '+(elapsed===1?'second':'seconds');
}
`;
