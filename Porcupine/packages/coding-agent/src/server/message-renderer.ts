import { CANVAS_MATH_SCRIPT } from "./canvas-math.ts";
import { formatLearningMath } from "./learning-math.ts";
/**
 * Message rendering for the browser workbench.
 *
 * Model text is parsed into DOM nodes, never into HTML strings. Supported blocks:
 * fenced code with a language label and copy control, tables, headings, lists,
 * blockquotes, paragraphs, and inline code, bold, italic and links.
 * Math uses a bundled KaTeX renderer with local fonts. Unsupported or incomplete
 * expressions stay visible as literal text; model input is never trusted HTML.
 */

export const RICH_TEXT_STYLES = `
.canvas-label-host { position: relative; min-width: 0; }
.diagram-viewport .canvas-label-host { min-width: 640px; }
.canvas-math-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.canvas-math-label { position: absolute; font: 12px system-ui; color: var(--plot-text); line-height: 1.3; }
.diagram-viewport { max-width: 100%; overflow: auto; border-radius: var(--r1); }
.diagram-canvas { min-width: 640px; height: 480px !important; }
.diagram-hint { color: var(--quiet); font-size: var(--small); }
.interactive-visual > button, .interactive-visual form > button, .adaptive-body button { font: inherit; font-size: var(--small); border: 1px solid var(--line); border-radius: var(--r1); padding: var(--s2) var(--s3); background: var(--surface); color: var(--text); cursor: pointer; transition: background .15s ease; }
.interactive-visual button:hover { background: var(--line-soft); }
.interactive-visual button:disabled { opacity: .5; cursor: default; }
.interactive-visual button:focus-visible, .interactive-visual input:focus-visible, .interactive-visual select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.interactive-visual > div:nth-child(2) { color: var(--muted); font-size: var(--small); margin-block: var(--s2); }
.adaptive-body { margin: var(--s3) 0; min-width: 0; }
.adaptive-body form { display: grid; gap: var(--s2); }
.adaptive-body form label { flex-wrap: wrap; justify-content: space-between; }
.adaptive-body form input:not([type="checkbox"]), .adaptive-body select { min-width: 0; width: min(100%,240px); padding: var(--s2); border: 1px solid var(--line); border-radius: var(--r1); background: var(--surface); color: var(--text); }
.adaptive-body .table-scroll input:not([type="checkbox"]) { width: 140px; max-width: 100%; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: var(--r1); padding: var(--s2); }
.interactive-visual > .scene-controls label { flex-wrap: wrap; font-size: var(--small); }
.adaptive-body details { margin-block: var(--s2); padding: var(--s2); border: 1px solid var(--line-soft); border-radius: var(--r1); }
.adaptive-body summary { cursor: pointer; }
.adaptive-body button[aria-pressed="true"] { background: var(--surface); color: var(--text); }
.interactive-visual fieldset { display: grid; gap: var(--s2); border: 0; margin: var(--s3) 0; padding: 0; min-width: 0; }
.interactive-visual legend { color: var(--muted); font-size: var(--small); margin-bottom: var(--s2); }
.interactive-visual label { display: flex; align-items: center; gap: var(--s2); padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r1); cursor: pointer; }
.interactive-visual label:has(input:checked) { background: var(--surface); border-color: var(--text); }
.interactive-visual input { flex: 0 0 auto; width: auto; accent-color: var(--text); }
.interactive-visual textarea { width: 100%; min-height: 100px; padding: var(--s3); background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: var(--r1); resize: vertical; }
.rich > *:first-child { margin-top: 0; }
.rich > *:last-child { margin-bottom: 0; }
.rich p { margin: 0 0 var(--s3); white-space: pre-wrap; overflow-wrap: anywhere; }
.rich h3.md-heading { font-size: var(--body); font-weight: 600; margin: var(--s4) 0 var(--s2); }
.rich h3.md-h3, .rich h3.md-h4 { font-size: var(--small); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.rich ul, .rich ol { margin: 0 0 var(--s3); padding-left: var(--s5); }
.rich li { margin: var(--s1) 0; }
.rich blockquote { margin: 0 0 var(--s3); padding-left: var(--s3); border-left: var(--unit) solid var(--line); color: var(--muted); }
.rich code { background: var(--surface); border-radius: var(--r1); padding: 0 var(--s1); font-size: .92em; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
.code-block { margin: 0 0 var(--s3); border: var(--unit) solid var(--line-soft); border-radius: var(--r1); overflow: hidden; background: var(--surface); }
.code-banner { display: flex; align-items: center; justify-content: space-between; padding: var(--s1) var(--s2); border-bottom: var(--unit) solid var(--line-soft); color: var(--quiet); font-size: var(--small); font-family: ui-monospace, Consolas, monospace; }
.code-banner .quiet-button { font-size: var(--small); padding: 0 var(--s1); }
.code-block pre { margin: 0; padding: var(--s3); overflow-x: auto; }
.code-block code { background: none; padding: 0; color: var(--text); font-size: var(--small); line-height: 1.6; }
.table-scroll { margin: 0 0 var(--s3); overflow-x: auto; }
.table-scroll table { border-collapse: collapse; min-width: 100%; font-variant-numeric: tabular-nums; font-size: var(--small); }
.table-scroll th, .table-scroll td { padding: var(--s2) var(--s3); text-align: left; border-bottom: var(--unit) solid var(--line-soft); font-weight: 400; }
.table-scroll th { color: var(--text); }
.math-display { margin: 0 0 var(--s3); overflow-x: auto; padding: var(--s2) 0; }
.math-expression { color: var(--text); }
.adaptive-body .math-expression { display: inline-block; max-width: 100%; overflow-x: auto; vertical-align: middle; padding-block: 4px; }
.field-math-preview { flex-basis: 100%; max-width: 100%; overflow-x: auto; }
.katex { font-size: 1.1em; }
.math-display .katex-display { margin: 0; padding-block: 4px; }
.math-display { max-width: 100%; }
.math-fallback { color: var(--muted); }
.rich a { color: var(--accent); text-underline-offset: 2px; }
`;
export const MESSAGE_RENDERER_SCRIPT = `
const formatLearningMath=${formatLearningMath.toString()};
${CANVAS_MATH_SCRIPT}
const mathRenderCache=new Map(),richTextSources=new WeakMap();
function renderMathLabel(node,text){node.replaceChildren();for(const child of inlineNodes(formatLearningMath(String(text))))node.append(child);return node;}
function mathFallback(tex,display){const span=document.createElement('code');span.className='math-fallback';span.textContent=(display?'\\\\[':'\\\\(')+tex+(display?'\\\\]':'\\\\)');return span}
function renderMathSafe(tex,display){
  if(!window.katex||tex.length>20000)return mathFallback(tex,display);
  const span=document.createElement('span');span.className='math-expression';
  const cacheKey=String(display)+':'+tex,cached=mathRenderCache.get(cacheKey);if(cached)return cached.cloneNode(true);
  try{window.katex.render(tex,span,{displayMode:display,output:'htmlAndMathml',trust:false,throwOnError:true,strict:'ignore',maxExpand:1000,maxSize:20,macros:{}});if(tex.length<=2000&&typeof span.cloneNode==='function'){if(mathRenderCache.size>=64)mathRenderCache.delete(mathRenderCache.keys().next().value);mathRenderCache.set(cacheKey,span.cloneNode(true));}return span}catch{return mathFallback(tex,display)}
}
function inlineNodes(text){const nodes=[];let rest=text;
  while(rest){const match=/\\\\\\[[\\s\\S]*?\\\\\\]|\\\\\\([\\s\\S]*?\\\\\\)|\\$\\$[\\s\\S]*?\\$\\$|(?<![\\\\\\d])\\$(?!\\s)(?:\\\\.|[^$\\\\\\n])+(?<!\\s)\\$|\\*\\*[^*]+\\*\\*|\\*[^*\\n]+\\*|\`[^\`\\n]+\`|!?\\[[^\\]]*]\\([^)\\s]+\\)/.exec(rest);
    if(!match){if(rest)nodes.push(document.createTextNode(rest.replaceAll('\\\\$', '$')));break}
    if(match.index>0)nodes.push(document.createTextNode(rest.slice(0,match.index).replaceAll('\\\\$', '$')));
    const token=match[0];rest=rest.slice(match.index+token.length);
    if(token.startsWith('\\\\[')||token.startsWith('\\\\('))nodes.push(renderMathSafe(token.slice(2,-2),token.startsWith('\\\\[')));
    else if(token.startsWith("$$"))nodes.push(renderMathSafe(token.slice(2,-2),true));
    else if(token.startsWith("$"))nodes.push(renderMathSafe(token.slice(1,-1),false));
    else if(token.startsWith("**")){const strong=document.createElement("strong");strong.textContent=token.slice(2,-2);nodes.push(strong)}
    else if(token.startsWith("*")){const em=document.createElement("em");em.textContent=token.slice(1,-1);nodes.push(em)}
    else if(token.startsWith("\`")){const code=document.createElement("code");code.textContent=token.slice(1,-1);nodes.push(code)}
    else{const embedded=token.startsWith('!'),label=token.slice(embedded?2:1,token.indexOf("]")),href=token.slice(token.indexOf("](")+2,-1),artifact=typeof createWorkbenchArtifact==='function'?createWorkbenchArtifact(label,href,embedded):null;if(artifact){nodes.push(artifact);continue;}const link=document.createElement("a");link.textContent=label||href;if(/^https?:\\/\\//i.test(href)){link.setAttribute("href",href);link.setAttribute("rel","noopener noreferrer");link.setAttribute("target","_blank")}nodes.push(link)}
  }
  return nodes}
function codeBlock(language,source){const wrap=document.createElement("div");wrap.className="code-block";const banner=document.createElement("div");banner.className="code-banner";const label=document.createElement("span");label.textContent=language||"text";const copy=document.createElement("button");copy.type="button";copy.className="quiet-button";copy.textContent="Copy";copy.addEventListener("click",()=>{void navigator.clipboard?.writeText(source).then(()=>{copy.textContent="Copied"}).catch(()=>{copy.textContent="Copy failed"})});banner.append(label,copy);const pre=document.createElement("pre");const code=document.createElement("code");code.textContent=source;pre.append(code);wrap.append(banner,pre);return wrap}
function tableCells(line){
  const source=line.trim().replace(/^\\||\\|$/g,''),cells=[];let cell='',close='';
  for(let i=0;i<source.length;){
    if(close){if(source.startsWith(close,i)){cell+=close;i+=close.length;close='';}else if(source[i]==='\\\\'&&source[i+1]==='$'){cell+=source.slice(i,i+2);i+=2;}else{cell+=source[i++];}continue;}
    const opening=['\\\\(','\\\\[','$$','$'].find(delimiter=>source.startsWith(delimiter,i));
    if(opening){close=opening==='\\\\('? '\\\\)':opening==='\\\\['?'\\\\]':opening;cell+=opening;i+=opening.length;continue;}
    if(source[i]==='\\\\'&&i+1<source.length){cell+=source[i+1]==='|'?'|':source.slice(i,i+2);i+=2;continue;}
    if(source[i]==='|'){cells.push(cell.trim());cell='';i++;continue;}cell+=source[i++];
  }
  cells.push(cell.trim());return cells;
}
function renderTable(lines){const table=document.createElement("div");table.className="table-scroll";const element=document.createElement("table");const rows=lines.filter(line=>!/^\\s*\\|?[\\s:-]+\\|[\\s:|-]*$/.test(line)).map(tableCells);
  const head=document.createElement("thead");const headRow=document.createElement("tr");for(const cell of rows[0]||[]){const th=document.createElement("th");th.scope="col";for(const node of inlineNodes(cell))th.append(node);headRow.append(th)}head.append(headRow);element.append(head);
  const body=document.createElement("tbody");for(const row of rows.slice(1)){const tr=document.createElement("tr");for(const cell of row){const td=document.createElement("td");for(const node of inlineNodes(cell))td.append(node);tr.append(td)}body.append(tr)}element.append(body);table.append(element);return table}
function renderRichText(container,text){
  const source=String(text);if(richTextSources.get(container)===source)return container;richTextSources.set(container,source);text=formatLearningMath(source);
  container.replaceChildren();container.classList.add("rich");
  const lines=String(text).split("\\n");let index=0;
  while(index<lines.length){const line=lines[index];
    const fence=/^\`\`\`([\\w.+-]*)\\s*$/.exec(line);
    if(fence){const source=[];index+=1;while(index<lines.length&&!/^\`\`\`\\s*$/.test(lines[index])){source.push(lines[index]);index+=1}index+=1;container.append(codeBlock(fence[1],source.join("\\n")));continue}
    const trimmed=line.trimStart(),displayDelimiter=trimmed.startsWith('\\\\[')?['\\\\[','\\\\]']:trimmed.startsWith('$$')?['$$','$$']:null;
    if(displayDelimiter){
      const source=[];let current=trimmed.slice(displayDelimiter[0].length),closed=false;
      while(index<lines.length){const end=current.indexOf(displayDelimiter[1]);if(end>=0){source.push(current.slice(0,end));const trailing=current.slice(end+displayDelimiter[1].length);if(trailing.trim())lines.splice(index+1,0,trailing);index++;closed=true;break}source.push(current);index++;current=lines[index]||'';}
      const block=document.createElement('div');block.className='math-display';block.append(closed?renderMathSafe(source.join('\\n').trim(),true):mathFallback(source.join('\\n').trim(),true));container.append(block);continue;
    }
    if(/^\\s*\\|.*\\|\\s*$/.test(line)&&index+1<lines.length&&/^\\s*\\|?[\\s:-]+\\|[\\s:|-]*$/.test(lines[index+1])){const block=[];while(index<lines.length&&/^\\s*\\|/.test(lines[index])){block.push(lines[index]);index+=1}container.append(renderTable(block));continue}
    const heading=/^(#{1,4})\\s+(.*)$/.exec(line);
    if(heading){const element=document.createElement("h3");element.className="md-heading md-h"+heading[1].length;for(const node of inlineNodes(heading[2]))element.append(node);container.append(element);index+=1;continue}
    if(/^\\s*>\\s?/.test(line)){const quote=document.createElement("blockquote");const block=[];while(index<lines.length&&/^\\s*>\\s?/.test(lines[index])){block.push(lines[index].replace(/^\\s*>\\s?/,""));index+=1}for(const node of inlineNodes(block.join(" ")))quote.append(node);container.append(quote);continue}
    if(/^\\s*([-*+]|\\d+[.)])\\s+/.test(line)){const ordered=/^\\s*\\d/.test(line);const list=document.createElement(ordered?"ol":"ul");while(index<lines.length&&/^\\s*([-*+]|\\d+[.)])\\s+/.test(lines[index])){const item=document.createElement("li");for(const node of inlineNodes(lines[index].replace(/^\\s*([-*+]|\\d+[.)])\\s+/,"")))item.append(node);list.append(item);index+=1}container.append(list);continue}
    if(!line.trim()){index+=1;continue}
    const paragraph=[];while(index<lines.length&&lines[index].trim()&&!lines[index].trimStart().startsWith('\\\\[')&&!/^\`\`\`/.test(lines[index])&&!/^\\s*\\$\\$/.test(lines[index])&&!/^\\s*\\|/.test(lines[index])&&!/^#{1,4}\\s/.test(lines[index])&&!/^\\s*>/.test(lines[index])&&!/^\\s*([-*+]|\\d+[.)])\\s+/.test(lines[index])){paragraph.push(lines[index]);index+=1}if(!paragraph.length){paragraph.push(lines[index]);index+=1}const element=document.createElement("p");for(const node of inlineNodes(paragraph.join("\\n")))element.append(node);container.append(element);
  }
  return container}
`;
