/** Browser-only declarative 2D/chart renderer. Embedded in the same-origin workbench script. */
export const VISUAL_RENDERER_SCRIPT = String.raw`
const visualObservers=new Map(),componentCards=new Map(),componentAnswers=new Map();
function componentAnswerText(content){const text=textOf(content);if(text.length>24000||!text.startsWith('[Adaptive UI response]\n'))return null;try{const value=JSON.parse(text.slice(23));if(!isRecord(value)||!validText(value.componentId,200)||typeof value.title!=='string'||value.title.length>100||typeof value.revision!=='string'||value.revision.length>12000||!Array.isArray(value.answers)||value.answers.length>12||!value.answers.every(answer=>typeof answer==='string'&&answer.length<=4000))return null;return value}catch{return null}}
function restoreComponentAnswer(content){const answer=componentAnswerText(content);if(!answer)return;componentAnswers.set(answer.componentId,answer);const card=componentCards.get(answer.componentId);if(card&&card.restore)card.restore(answer)}
function componentUserText(content){const answer=componentAnswerText(content);return answer?'Answer to '+answer.title+'\n'+answer.answers.join('; '):userMessageText(content)}

function clearVisuals(){for(const item of visualObservers.values())if(item.observer)item.observer.disconnect();visualObservers.clear();componentCards.clear();componentAnswers.clear()}
function observeVisual(canvas,draw){const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>{if(visualObservers.has(canvas))draw()}):null;visualObservers.set(canvas,{draw,observer});if(observer)observer.observe(canvas)}
function redrawVisuals(){for(const item of visualObservers.values())item.draw()}
window.addEventListener('porcupine-theme-change',redrawVisuals);
window.addEventListener('resize',redrawVisuals);
function plotColors(canvas){const style=window.getComputedStyle(canvas);return{text:style.getPropertyValue('--plot-text').trim(),label:style.getPropertyValue('--plot-label').trim(),grid:style.getPropertyValue('--plot-grid').trim(),axis:style.getPropertyValue('--plot-axis').trim()}}
function validText(value,max){return typeof value==='string'&&value.trim().length>0&&value.length<=max}
function bounded(value,min,max){return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max}
function validPoint2(value){return Array.isArray(value)&&value.length===2&&value.every(n=>bounded(n,-20,20))}
function validVisual(visual){
  if(!isRecord(visual)||(visual.componentId!==undefined&&!validText(visual.componentId,80))||visual.version!==2||!validText(visual.title,100)||!(visual.description===undefined||(typeof visual.description==='string'&&visual.description.length<=300)))return false;
  if(visual.kind==='question')return hasOnlyKeys(visual,['version','kind','title','question','options'],['description','multiple','componentId'])&&validText(visual.question,2000)&&Array.isArray(visual.options)&&visual.options.length<=12&&visual.options.every(option=>validText(option,200))&&(visual.multiple===undefined||typeof visual.multiple==='boolean');
  if(visual.kind==='diagram'){
    if(!hasOnlyKeys(visual,['version','kind','title','objects'],['description','componentId'])||!Array.isArray(visual.objects)||visual.objects.length<1||visual.objects.length>80)return false;
    return visual.objects.every(o=>{
      if(!isRecord(o)||!validColor(o.color))return false;
      if(o.type==='text')return hasOnlyKeys(o,['type','position','text','color'])&&validPoint2(o.position)&&validText(o.text,120);
      if(!validLabel(o.label))return false;
      if(o.type==='rectangle')return hasOnlyKeys(o,['type','position','size','color'],['label'])&&validPoint2(o.position)&&Array.isArray(o.size)&&o.size.length===2&&o.size.every(n=>bounded(n,.05,20));
      if(o.type==='circle')return hasOnlyKeys(o,['type','position','radius','color'],['label'])&&validPoint2(o.position)&&bounded(o.radius,.05,10);
      return ['line','arrow'].includes(o.type)&&hasOnlyKeys(o,['type','from','to','color'],['label'])&&validPoint2(o.from)&&validPoint2(o.to);
    });
  }
  if(visual.kind!=='chart'||!hasOnlyKeys(visual,['version','kind','title','chartType','xLabel','yLabel','series'],['description','componentId'])||!['line','scatter','bar'].includes(visual.chartType)||!validText(visual.xLabel,60)||!validText(visual.yLabel,60)||!Array.isArray(visual.series)||visual.series.length<1||visual.series.length>8)return false;
  return visual.series.every(s=>hasOnlyKeys(s,['name','color','points'])&&validText(s.name,60)&&validColor(s.color)&&Array.isArray(s.points)&&s.points.length>=1&&s.points.length<=200&&s.points.every(p=>hasOnlyKeys(p,['x','y'],['error','label'])&&bounded(p.x,-1e12,1e12)&&bounded(p.y,-1e12,1e12)&&(p.error===undefined||bounded(p.error,0,1e12))&&validLabel(p.label)));
}
function visualElement(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node}
function renderVisual(visual,callId){
  if(visual&&visual.version===1){renderVisualization(visual);return}
  if(!validVisual(visual)){if(visual){const error=visualElement('p','This visual could not be displayed. Ask the agent to correct its data.');error.setAttribute('role','status');ui.feed.append(error)}return;}
  const identity=visual.componentId||callId;
  const previous=identity&&componentCards.get(identity);
  if(previous){for(const canvas of previous.card.querySelectorAll('canvas')){const item=visualObservers.get(canvas);if(item&&item.observer)item.observer.disconnect();visualObservers.delete(canvas)}}
  ui.welcome.hidden=true;
  const card=visualElement('section');card.className='visualization-card';
  function mountComponent(){if(previous&&previous.card.parentNode===ui.feed){ui.feed.insertBefore(card,previous.card);previous.card.remove()}else ui.feed.append(card)}
  card.append(visualElement('h2',visual.title),visualElement('div',visual.description||(visual.kind==='diagram'?'2D conceptual diagram':'Data chart')));
  card.classList.add('interactive-visual');if(identity){card.dataset.componentId=identity;componentCards.set(identity,{card})}
  if(visual.description)renderRichText(card.lastChild,visual.description);
  if(visual.kind==='question'){
    card.lastChild.remove();
    if(visual.description){const description=visualElement('div');renderRichText(description,visual.description);card.append(description)}
    const question=visualElement('div');renderRichText(question,visual.question);card.append(question);
    const form=visualElement('form'),group=visualElement('fieldset'),legend=visualElement('legend',visual.multiple?'Choose all that apply':'Your answer');group.append(legend);
    const inputs=[];
    for(const option of visual.options){const label=visualElement('label'),input=visualElement('input');input.type=visual.multiple?'checkbox':'radio';input.name='answer';input.value=option;label.append(input,document.createTextNode(option));group.append(label);inputs.push(input)}
    const written=visualElement('textarea');written.setAttribute('aria-label','Written answer');written.maxLength=4000;written.placeholder='Type your answer';if(!inputs.length)group.append(written);
    const submit=visualElement('button','Send answer'),status=visualElement('p');submit.type='submit';status.setAttribute('role','status');form.append(group,submit,status);card.append(form);const owner=sessionId,revision=JSON.stringify([visual.question,visual.options,Boolean(visual.multiple)]);
    const restore=answer=>{if(answer.revision!==revision)return;for(const input of inputs)input.checked=answer.answers.includes(input.value);written.value=answer.answers.join('; ');group.disabled=true;submit.disabled=true;status.textContent='Answer sent.'};
    if(identity){componentCards.set(identity,{card,restore});const saved=componentAnswers.get(identity);if(saved)restore(saved)}
    form.addEventListener('submit',async event=>{event.preventDefault();const answers=inputs.filter(input=>input.checked).map(input=>input.value);const answer=inputs.length?answers.join('; '):written.value.trim();if(!answer){status.textContent='Choose or write an answer first.';return}if(owner!==sessionId||streaming||!connected){status.textContent='Wait until the agent is ready and connected.';return}submit.disabled=true;setBusy(true);try{await json('/session/'+encodeURIComponent(owner)+'/message',{method:'POST',body:JSON.stringify({text:identity?'[Adaptive UI response]\n'+JSON.stringify({componentId:identity,revision,title:visual.title,question:visual.question,answers:inputs.length?answers:[answer]}):'Answer to '+visual.title+'\n'+visual.question+'\n\n'+answer})});group.disabled=true;if(identity)componentAnswers.set(identity,{revision,answers:inputs.length?answers:[answer]});status.textContent='Answer sent.'}catch(error){submit.disabled=false;setBusy(false);status.textContent=error.message}});
    mountComponent();scrollFeed();return;
  }
  const canvas=visualElement('canvas');canvas.className='scene-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',visual.title+'. '+(visual.description||'')+' Full values and labels are available below.');card.append(canvas);
  const details=visualElement('details');details.className='scene-contents';details.append(visualElement('summary',visual.kind==='diagram'?'Diagram contents':'Data and uncertainty'));
  if(visual.kind==='diagram'){
    const list=visualElement('ul');for(const o of visual.objects){let text=o.type==='text'?o.text:(o.label||o.type);text+=' · '+o.type; text+=o.from?' from ('+o.from+') to ('+o.to+')':' at ('+o.position+')';if(o.size)text+=' size ('+o.size+')';if(o.radius)text+=' radius '+o.radius;list.append(visualElement('li',text))}details.append(list);
  }else{
    const legend=visualElement('ul');legend.className='chart-legend';for(const s of visual.series)legend.append(visualElement('li',s.name+' · '+s.points.length+' samples'));card.append(legend);
    const table=visualElement('table');table.append(visualElement('caption',visual.title+' · supplied values; uncertainty is absolute ±y where provided.'));
    const head=visualElement('thead'),row=visualElement('tr');for(const name of ['Series',visual.xLabel,visual.yLabel,'± y uncertainty','Label']){const cell=visualElement('th',name);cell.setAttribute('scope','col');row.append(cell)}head.append(row);table.append(head);
    const body=visualElement('tbody');for(const s of visual.series)for(const p of s.points){const tr=visualElement('tr');for(const value of [s.name,p.x,p.y,p.error===undefined?'Not supplied':p.error,p.label||''])tr.append(visualElement('td',value));body.append(tr)}table.append(body);details.append(table);
  }
  card.append(details);
  const ask=visualElement('button','Ask about this visual');ask.type='button';ask.className='stop';ask.addEventListener('click',()=>{ui.prompt.value='Explain "'+visual.title+'" step by step, including its labels and assumptions.';resizeComposer();ui.prompt.focus()});card.append(ask);
  mountComponent();scrollFeed();
  const ctx=canvas.getContext('2d');if(!ctx)return;let colors=plotColors(canvas);
  function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}
  function draw(){
    colors=plotColors(canvas);
    const rect=canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);ctx.font='12px system-ui';ctx.textAlign='center';ctx.lineWidth=2;
    if(visual.kind==='diagram'){
      let extent=4;for(const o of visual.objects){if(o.from)extent=Math.max(extent,...o.from.map(Math.abs),...o.to.map(Math.abs));else extent=Math.max(extent,...o.position.map((n,i)=>Math.abs(n)+(o.radius||((o.size&&o.size[i]/2)||0))))}
      const scale=Math.max(1,Math.min(w-50,h-50))/(extent*2),xy=p=>[w/2+p[0]*scale,h/2-p[1]*scale];
      for(const o of visual.objects){ctx.strokeStyle=o.color;ctx.fillStyle=o.color;
        if(o.from){const a=xy(o.from),b=xy(o.to);line(...a,...b);if(o.type==='arrow'){const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);ctx.beginPath();ctx.moveTo(...b);ctx.lineTo(b[0]-9*Math.cos(angle-.45),b[1]-9*Math.sin(angle-.45));ctx.lineTo(b[0]-9*Math.cos(angle+.45),b[1]-9*Math.sin(angle+.45));ctx.closePath();ctx.fill()}if(o.label)ctx.fillText(o.label,(a[0]+b[0])/2,(a[1]+b[1])/2-10,w-20);
        }else{const p=xy(o.position);if(o.type==='rectangle'){ctx.globalAlpha=.3;ctx.fillRect(p[0]-o.size[0]*scale/2,p[1]-o.size[1]*scale/2,o.size[0]*scale,o.size[1]*scale);ctx.globalAlpha=1;const sx=o.size[0]*scale/2,sy=o.size[1]*scale/2;line(p[0]-sx,p[1]-sy,p[0]+sx,p[1]-sy);line(p[0]+sx,p[1]-sy,p[0]+sx,p[1]+sy);line(p[0]+sx,p[1]+sy,p[0]-sx,p[1]+sy);line(p[0]-sx,p[1]+sy,p[0]-sx,p[1]-sy)}else if(o.type==='circle'){ctx.beginPath();ctx.arc(...p,o.radius*scale,0,Math.PI*2);ctx.stroke()}if(o.type==='text'||o.label)ctx.fillText(o.type==='text'?o.text:o.label,p[0],p[1]-5,w-20)}
      }
      return;
    }
    const points=visual.series.flatMap(s=>s.points),xs=points.map(p=>p.x),ys=points.flatMap(p=>[p.y-(p.error||0),p.y+(p.error||0)]);
    if(visual.chartType==='bar'){
      ys.push(0);
      // Reserve half a category interval so grouped end bars stay inside the plot.
      const positions=[...new Set(xs)].sort((a,b)=>a-b);let interval=positions.length===1?1:Infinity;
      for(let i=1;i<positions.length;i++)interval=Math.min(interval,positions[i]-positions[i-1]);
      xs.push(positions[0]-interval/2,positions[positions.length-1]+interval/2);
    }
    function range(values){let min=Math.min(...values),max=Math.max(...values);if(min===max){const pad=Math.max(1,Math.abs(min)*.05);min-=pad;max+=pad}else{const pad=(max-min)*.08;min-=pad;max+=pad}return[min,max]}
    const xr=range(xs),yr=range(ys),left=Math.min(80,w*.25),right=w-20,top=38,bottom=h-52,plotW=Math.max(1,right-left),plotH=Math.max(1,bottom-top),px=x=>left+(x-xr[0])/(xr[1]-xr[0])*plotW,py=y=>bottom-(y-yr[0])/(yr[1]-yr[0])*plotH;
    ctx.fillStyle=colors.text;ctx.fillText(visual.yLabel,w/2,18,w-16);ctx.fillText(visual.xLabel,w/2,h-8,w-16);
    const format=n=>n===0?'0':(Math.abs(n)>=1e5||Math.abs(n)<.001)?n.toExponential(1):Number(n.toPrecision(4)).toString();
    ctx.font='10px system-ui';ctx.lineWidth=1;
    for(let i=0;i<=4;i++){const x=xr[0]+(xr[1]-xr[0])*i/4,y=yr[0]+(yr[1]-yr[0])*i/4;ctx.strokeStyle=colors.grid;line(px(x),top,px(x),bottom);line(left,py(y),right,py(y));ctx.fillStyle=colors.label;ctx.textAlign='center';ctx.fillText(format(x),px(x),bottom+16,plotW/4);ctx.textAlign='right';ctx.fillText(format(y),left-7,py(y)+3,left-10)}
    ctx.strokeStyle=colors.axis;line(left,top,left,bottom);line(left,bottom,right,bottom);
    const uniqueX=[...new Set(points.map(p=>p.x))].sort((a,b)=>a-b);let gap=plotW;for(let i=1;i<uniqueX.length;i++)gap=Math.min(gap,px(uniqueX[i])-px(uniqueX[i-1]));const barWidth=Math.max(.1,Math.min(28,gap*.7/visual.series.length));
    for(let si=0;si<visual.series.length;si++){const s=visual.series[si];ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=2;ctx.textAlign='center';let previous=null;
      for(const p of s.points){const x=px(p.x)+(visual.chartType==='bar'?(si-(visual.series.length-1)/2)*barWidth:0),y=py(p.y);
        if(visual.chartType==='bar'){const zero=py(0);ctx.globalAlpha=.75;ctx.fillRect(x-barWidth/2,Math.min(y,zero),barWidth*.9,Math.max(1,Math.abs(y-zero)));ctx.globalAlpha=1}else{if(previous&&visual.chartType==='line')line(previous[0],previous[1],x,y);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill()}
        if(p.error!==undefined){const a=py(p.y-p.error),b=py(p.y+p.error);line(x,a,x,b);line(x-4,a,x+4,a);line(x-4,b,x+4,b)}
        if(p.label)ctx.fillText(p.label,x,y-9,Math.max(40,plotW/4));previous=[x,y];
      }
    }
    // The table retains full precision and labels when the canvas is dense.
    let legendX=left;for(const s of visual.series){ctx.fillStyle=s.color;ctx.textAlign='left';ctx.fillText(s.name,legendX,h-27,plotW/visual.series.length-4);legendX+=plotW/visual.series.length}
  }
  observeVisual(canvas,draw);draw();
}
`;
