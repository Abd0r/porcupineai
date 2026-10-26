/**
 * Message rendering for the browser workbench.
 *
 * Model text is parsed into DOM nodes, never into HTML strings. Supported blocks:
 * fenced code with a language label and copy control, tables, headings, lists,
 * blockquotes, paragraphs, and inline code, bold, italic and links. Math uses an
 * explicit LaTeX subset rendered as MathML Core, so there is no font bundle and no
 * external asset. An unsupported command stays visible as literal text.
 */

export const RICH_TEXT_STYLES = `
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
math { font-size: 1.05em; color: var(--text); }
.math-fallback { color: var(--muted); }
.rich a { color: var(--accent); text-underline-offset: 2px; }
`;
export const MESSAGE_RENDERER_SCRIPT = `
const MATH_GREEK={alpha:"\\u03b1",beta:"\\u03b2",gamma:"\\u03b3",delta:"\\u03b4",epsilon:"\\u03f5",varepsilon:"\\u03b5",zeta:"\\u03b6",eta:"\\u03b7",theta:"\\u03b8",vartheta:"\\u03d1",iota:"\\u03b9",kappa:"\\u03ba",lambda:"\\u03bb",mu:"\\u03bc",nu:"\\u03bd",xi:"\\u03be",pi:"\\u03c0",rho:"\\u03c1",sigma:"\\u03c3",tau:"\\u03c4",upsilon:"\\u03c5",phi:"\\u03d5",varphi:"\\u03c6",chi:"\\u03c7",psi:"\\u03c8",omega:"\\u03c9",Gamma:"\\u0393",Delta:"\\u0394",Theta:"\\u0398",Lambda:"\\u039b",Xi:"\\u039e",Pi:"\\u03a0",Sigma:"\\u03a3",Phi:"\\u03a6",Psi:"\\u03a8",Omega:"\\u03a9"};
const MATH_OPS={pm:"\\u00b1",mp:"\\u2213",times:"\\u00d7",cdot:"\\u22c5",div:"\\u00f7",le:"\\u2264",leq:"\\u2264",ge:"\\u2265",geq:"\\u2265",ne:"\\u2260",neq:"\\u2260",approx:"\\u2248",equiv:"\\u2261",sim:"\\u223c",propto:"\\u221d",to:"\\u2192",rightarrow:"\\u2192",leftarrow:"\\u2190",Rightarrow:"\\u21d2",leftrightarrow:"\\u2194",mapsto:"\\u21a6",in:"\\u2208",notin:"\\u2209",subset:"\\u2282",supset:"\\u2283",cup:"\\u222a",cap:"\\u2229",forall:"\\u2200",exists:"\\u2203",infty:"\\u221e",partial:"\\u2202",nabla:"\\u2207",sum:"\\u2211",prod:"\\u220f",int:"\\u222b",oint:"\\u222e",hbar:"\\u210f",ell:"\\u2113",ldots:"\\u2026",cdots:"\\u22ef",pm_:"\\u00b1"};
const MATH_ACCENTS={vec:"\\u2192",hat:"^",bar:"\\u00af",overline:"\\u00af",tilde:"~",dot:"\\u02d9"};
function mathNode(tag,attrs){const node=document.createElementNS("http://www.w3.org/1998/Math/MathML",tag);for(const key of Object.keys(attrs||{}))node.setAttribute(key,String(attrs[key]));return node}
function mathText(tag,text){const node=mathNode(tag);node.textContent=text;return node}
function mathTokens(tex){const tokens=[];let i=0;while(i<tex.length){const char=tex[i];if(/\\s/.test(char)){tokens.push({kind:"space",text:char});i+=1;continue}if(char==="\\\\"){let name="";i+=1;while(i<tex.length&&/[A-Za-z]/.test(tex[i])){name+=tex[i];i+=1}if(!name){tokens.push({kind:"op",text:tex[i]||""});i+=1;continue}tokens.push({kind:"command",name});continue}tokens.push({kind:"char",text:char});i+=1}return tokens}
function readGroup(tokens,state){while(state.i<tokens.length&&tokens[state.i].kind==="space")state.i+=1;const token=tokens[state.i];if(!token){return[]}if(token.kind!=="char"||token.text!=="{"){state.i+=1;return[token]}let depth=0;const start=state.i+1;for(let i=state.i;i<tokens.length;i+=1){const current=tokens[i];if(current.kind==="char"&&current.text==="{")depth+=1;else if(current.kind==="char"&&current.text==="}"){depth-=1;if(depth===0){state.i=i+1;return tokens.slice(start,i)}}}state.i=tokens.length;return tokens.slice(start)}
function parseMath(tokens){const nodes=[];const state={i:0};let buffer="";const flush=()=>{if(buffer){nodes.push({tag:"mtext",text:buffer});buffer=""}};
  while(state.i<tokens.length){const token=tokens[state.i];
    if(token.kind==="char"&&(token.text==="^"||token.text==="_")){flush();state.i+=1;const script=parseMath(readGroup(tokens,state));const base=nodes.pop()||{tag:"mrow",children:[]};nodes.push({tag:token.text==="^"?"msup":"msub",children:[base,{tag:"mrow",children:script}]});continue}
    if(token.kind==="char"&&token.text==="{"){flush();nodes.push({tag:"mrow",children:parseMath(readGroup(tokens,state))});continue}
    if(token.kind!=="command"){if(token.kind==="space"){buffer+=" ";state.i+=1;continue}buffer+=token.text;state.i+=1;continue}
    const name=token.name;state.i+=1;
    if(MATH_GREEK[name]){flush();nodes.push({tag:"mi",text:MATH_GREEK[name]});continue}
    if(MATH_OPS[name]){flush();nodes.push({tag:"mo",text:MATH_OPS[name]});continue}
    if(name==="frac"||name==="dfrac"||name==="tfrac"){flush();const numerator=readGroup(tokens,state);const denominator=readGroup(tokens,state);nodes.push({tag:"mfrac",children:[{tag:"mrow",children:parseMath(numerator)},{tag:"mrow",children:parseMath(denominator)}]});continue}
    if(name==="sqrt"){flush();let index=null;while(state.i<tokens.length&&tokens[state.i].kind==="space")state.i+=1;if(tokens[state.i]&&tokens[state.i].kind==="char"&&tokens[state.i].text==="["){let depth=0;const start=state.i+1;for(let i=state.i;i<tokens.length;i+=1){if(tokens[i].kind==="char"&&tokens[i].text==="[")depth+=1;else if(tokens[i].kind==="char"&&tokens[i].text==="]"){depth-=1;if(depth===0){index=tokens.slice(start,i);state.i=i+1;break}}}}const radicand=readGroup(tokens,state);nodes.push(index?{tag:"mroot",children:[{tag:"mrow",children:parseMath(radicand)},{tag:"mrow",children:parseMath(index)}]}:{tag:"msqrt",children:parseMath(radicand)});continue}
    if(MATH_ACCENTS[name]){flush();const base=nodes.pop()||{tag:"mrow",children:parseMath(readGroup(tokens,state))};nodes.push({tag:"mover",children:[base,{tag:"mo",text:MATH_ACCENTS[name]}]});continue}
    if(name==="text"||name==="mathrm"||name==="operatorname"){flush();const group=readGroup(tokens,state);nodes.push({tag:"mtext",text:group.map(part=>part.text||"").join("")});continue}
    if(name==="mathbf"||name==="mathit"){flush();nodes.push({tag:"mstyle",children:parseMath(readGroup(tokens,state))});continue}
    if(name==="left"||name==="right"){flush();const next=tokens[state.i];state.i+=1;if(next)nodes.push({tag:"mo",text:next.kind==="command"?next.name:next.text});continue}
    if(name==="quad"||name==="qquad"){flush();nodes.push({tag:"mtext",text:"\\u2003"});continue}
    flush();nodes.push({tag:"mtext",text:"\\\\"+name});
  }
  flush();return nodes}
function mathElements(nodes){return nodes.map(node=>{if(node.tag==="mrow"||node.tag==="msqrt"||node.tag==="mstyle"||node.tag==="mfrac"||node.tag==="msub"||node.tag==="msup"||node.tag==="mover"||node.tag==="munder"||node.tag==="mroot"){const element=mathNode(node.tag);for(const child of mathElements(node.children))element.append(child);return element}return mathText(node.tag,node.text)})}
function renderMath(tex,display){const math=mathNode("math",{display:display?"block":"inline",xmlns:"http://www.w3.org/1998/Math/MathML"});for(const element of mathElements(parseMath(mathTokens(tex))))math.append(element);return math}
function mathFallback(tex,display){const span=document.createElement("code");span.className="math-fallback";span.textContent=(display?"$$":"$")+tex+(display?"$$":"$");return span}
function renderMathSafe(tex,display){try{const parts=parseMath(mathTokens(tex));if(!parts.length)return mathFallback(tex,display);const math=mathNode("math",{display:display?"block":"inline",xmlns:"http://www.w3.org/1998/Math/MathML"});for(const element of mathElements(parts))math.append(element);return math}catch{return mathFallback(tex,display)}}
function inlineNodes(text){const nodes=[];let rest=text;
  while(rest){const match=/(\\$\\$[^$]+\\$\\$|\\$[^$\\n]+\\$|\\*\\*[^*]+\\*\\*|\\*[^*\\n]+\\*|\`[^\`\\n]+\`|\\[[^\\]]+\\]\\([^)\\s]+\\))/.exec(rest);
    if(!match){if(rest)nodes.push(document.createTextNode(rest));break}
    if(match.index>0)nodes.push(document.createTextNode(rest.slice(0,match.index)));
    const token=match[0];rest=rest.slice(match.index+token.length);
    if(token.startsWith("$$"))nodes.push(renderMathSafe(token.slice(2,-2),false));
    else if(token.startsWith("$"))nodes.push(renderMathSafe(token.slice(1,-1),false));
    else if(token.startsWith("**")){const strong=document.createElement("strong");strong.textContent=token.slice(2,-2);nodes.push(strong)}
    else if(token.startsWith("*")){const em=document.createElement("em");em.textContent=token.slice(1,-1);nodes.push(em)}
    else if(token.startsWith("\`")){const code=document.createElement("code");code.textContent=token.slice(1,-1);nodes.push(code)}
    else{const link=document.createElement("a");const label=token.slice(1,token.indexOf("]"));const href=token.slice(token.indexOf("](")+2,-1);link.textContent=label;if(/^https?:\\/\\//i.test(href)){link.setAttribute("href",href);link.setAttribute("rel","noopener noreferrer");link.setAttribute("target","_blank")}nodes.push(link)}
  }
  return nodes}
function codeBlock(language,source){const wrap=document.createElement("div");wrap.className="code-block";const banner=document.createElement("div");banner.className="code-banner";const label=document.createElement("span");label.textContent=language||"text";const copy=document.createElement("button");copy.type="button";copy.className="quiet-button";copy.textContent="Copy";copy.addEventListener("click",()=>{void navigator.clipboard?.writeText(source).then(()=>{copy.textContent="Copied"}).catch(()=>{copy.textContent="Copy failed"})});banner.append(label,copy);const pre=document.createElement("pre");const code=document.createElement("code");code.textContent=source;pre.append(code);wrap.append(banner,pre);return wrap}
function renderTable(lines){const table=document.createElement("div");table.className="table-scroll";const element=document.createElement("table");const rows=lines.filter(line=>!/^\\s*\\|?[\\s:-]+\\|[\\s:|-]*$/.test(line)).map(line=>line.replace(/^\\s*\\||\\|\\s*$/g,"").split("|").map(cell=>cell.trim()));
  const head=document.createElement("thead");const headRow=document.createElement("tr");for(const cell of rows[0]||[]){const th=document.createElement("th");th.scope="col";th.textContent=cell;headRow.append(th)}head.append(headRow);element.append(head);
  const body=document.createElement("tbody");for(const row of rows.slice(1)){const tr=document.createElement("tr");for(const cell of row){const td=document.createElement("td");td.textContent=cell;tr.append(td)}body.append(tr)}element.append(body);table.append(element);return table}
function renderRichText(container,text){
  container.replaceChildren();container.classList.add("rich");
  const lines=String(text).split("\\n");let index=0;
  while(index<lines.length){const line=lines[index];
    const fence=/^\`\`\`([\\w.+-]*)\\s*$/.exec(line);
    if(fence){const source=[];index+=1;while(index<lines.length&&!/^\`\`\`\\s*$/.test(lines[index])){source.push(lines[index]);index+=1}index+=1;container.append(codeBlock(fence[1],source.join("\\n")));continue}
    if(/^\\s*\\$\\$[^$]*\\$\\$\\s*$/.test(line)){const body=line.replace(/^\\s*\\$\\$/,"").replace(/\\$\\$\\s*$/,"");index+=1;const block=document.createElement("div");block.className="math-display";block.append(renderMathSafe(body.trim(),true));container.append(block);continue}
    if(/^\\s*\\$\\$/.test(line)){const source=[line.replace(/^\\s*\\$\\$/,"")];index+=1;while(index<lines.length&&!/\\$\\$\\s*$/.test(lines[index])){source.push(lines[index]);index+=1}if(index<lines.length)source.push(lines[index].replace(/\\$\\$\\s*$/,""));index+=1;const wrap=document.createElement("div");wrap.className="math-display";wrap.append(renderMathSafe(source.join("\\n").trim(),true));container.append(wrap);continue}
    if(/^\\s*\\|.*\\|\\s*$/.test(line)&&index+1<lines.length&&/^\\s*\\|?[\\s:-]+\\|[\\s:|-]*$/.test(lines[index+1])){const block=[];while(index<lines.length&&/^\\s*\\|/.test(lines[index])){block.push(lines[index]);index+=1}container.append(renderTable(block));continue}
    const heading=/^(#{1,4})\\s+(.*)$/.exec(line);
    if(heading){const element=document.createElement("h3");element.className="md-heading md-h"+heading[1].length;for(const node of inlineNodes(heading[2]))element.append(node);container.append(element);index+=1;continue}
    if(/^\\s*>\\s?/.test(line)){const quote=document.createElement("blockquote");const block=[];while(index<lines.length&&/^\\s*>\\s?/.test(lines[index])){block.push(lines[index].replace(/^\\s*>\\s?/,""));index+=1}for(const node of inlineNodes(block.join(" ")))quote.append(node);container.append(quote);continue}
    if(/^\\s*([-*+]|\\d+[.)])\\s+/.test(line)){const ordered=/^\\s*\\d/.test(line);const list=document.createElement(ordered?"ol":"ul");while(index<lines.length&&/^\\s*([-*+]|\\d+[.)])\\s+/.test(lines[index])){const item=document.createElement("li");for(const node of inlineNodes(lines[index].replace(/^\\s*([-*+]|\\d+[.)])\\s+/,"")))item.append(node);list.append(item);index+=1}container.append(list);continue}
    if(!line.trim()){index+=1;continue}
    const paragraph=[];while(index<lines.length&&lines[index].trim()&&!/^\`\`\`/.test(lines[index])&&!/^\\s*\\$\\$/.test(lines[index])&&!/^\\s*\\|/.test(lines[index])&&!/^#{1,4}\\s/.test(lines[index])&&!/^\\s*>/.test(lines[index])&&!/^\\s*([-*+]|\\d+[.)])\\s+/.test(lines[index])){paragraph.push(lines[index]);index+=1}if(!paragraph.length){paragraph.push(lines[index]);index+=1}const element=document.createElement("p");for(const node of inlineNodes(paragraph.join("\\n")))element.append(node);container.append(element);
  }
  return container}
`;
