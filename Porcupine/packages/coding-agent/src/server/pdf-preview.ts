/** Browser PDF rendering; the document stays inside the authenticated local preview flow. */
export const PDF_PREVIEW_SCRIPT = String.raw`
window.createWorkbenchPdfViewer=function(host,bytes,name){
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const toolbar=node('div'),previous=node('button','Previous page'),next=node('button','Next page'),pageInput=node('input'),total=node('span'),zoom=node('select'),status=node('p','Loading PDF…'),stage=node('div'),textDetails=node('details'),text=node('pre');
  toolbar.className='pdf-toolbar';stage.className='pdf-stage';stage.tabIndex=0;stage.setAttribute('aria-label','PDF pages');status.setAttribute('role','status');status.className='artifact-note';textDetails.append(node('summary','Page text'),text);
  for(const button of [previous,next]){button.type='button';button.disabled=true;}
  pageInput.type='number';pageInput.min='1';pageInput.value='1';pageInput.disabled=true;pageInput.setAttribute('aria-label','PDF page');zoom.setAttribute('aria-label','PDF zoom');
  for(const [value,label] of [['fit','Fit width'],['0.75','75%'],['1','100%'],['1.5','150%'],['2','200%']]){const option=node('option',label);option.value=value;zoom.append(option);}zoom.value='fit';
  toolbar.append(previous,pageInput,total,next,zoom);host.replaceChildren(toolbar,status,stage,textDetails);
  const passwordForm=node('form'),password=node('input'),unlock=node('button','Unlock PDF');passwordForm.className='pdf-password';passwordForm.hidden=true;password.type='password';password.autocomplete='off';password.setAttribute('aria-label','PDF password');unlock.type='submit';passwordForm.append(password,unlock);host.append(passwordForm);
  let disposed=false,documentPdf=null,loading=null,renderTask=null,pageNumber=1,revision=0,passwordReply=null,resizeFrame=0;
  const failure=error=>{if(!disposed){status.textContent='Could not display this PDF: '+(error.message||String(error))+'. You can still download the original.';stage.setAttribute('aria-busy','false');}};
  const controls=()=>{previous.disabled=!documentPdf||pageNumber<=1;next.disabled=!documentPdf||pageNumber>=documentPdf.numPages;pageInput.disabled=!documentPdf;pageInput.value=String(pageNumber);total.textContent=documentPdf?'of '+documentPdf.numPages:'';};
  async function draw(){
    if(disposed||!documentPdf)return;const current=++revision;if(renderTask)renderTask.cancel();renderTask=null;controls();status.textContent='Rendering page '+pageNumber+' of '+documentPdf.numPages+'…';stage.setAttribute('aria-busy','true');text.textContent='';
    try{const page=await documentPdf.getPage(pageNumber);if(disposed||current!==revision)return;const original=page.getViewport({scale:1}),fit=Math.max(.1,Math.min(4,((stage.clientWidth||640)-24)/original.width)),scale=zoom.value==='fit'?fit:Number(zoom.value),viewport=page.getViewport({scale}),ratio=Math.max(.1,Math.min(window.devicePixelRatio||1,2,Math.sqrt(8000000/(viewport.width*viewport.height)),4096/viewport.width,4096/viewport.height)),canvas=node('canvas');
      canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));canvas.style.width=Math.floor(viewport.width)+'px';canvas.style.height=Math.floor(viewport.height)+'px';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',name+' · Page '+pageNumber+' of '+documentPdf.numPages);stage.replaceChildren(canvas);
      const task=page.render({canvas,viewport,transform:[ratio,0,0,ratio,0,0],background:'rgb(255,255,255)'});renderTask=task;await task.promise;if(disposed||current!==revision)return;renderTask=null;stage.setAttribute('aria-busy','false');status.textContent='Page '+pageNumber+' of '+documentPdf.numPages;
      try{const content=await page.getTextContent();if(!disposed&&current===revision)text.textContent=content.items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':' ')).join('');}catch{if(!disposed&&current===revision)text.textContent='Text extraction is unavailable for this page.';}
    }catch(error){if(!disposed&&current===revision&&error.name!=='RenderingCancelledException')failure(error);}
  }
  previous.addEventListener('click',()=>{if(pageNumber>1){pageNumber--;void draw();}});next.addEventListener('click',()=>{if(documentPdf&&pageNumber<documentPdf.numPages){pageNumber++;void draw();}});
  pageInput.addEventListener('change',()=>{const value=Number(pageInput.value);if(documentPdf&&Number.isInteger(value)&&value>=1&&value<=documentPdf.numPages){pageNumber=value;void draw();}else controls();});zoom.addEventListener('change',()=>void draw());
  passwordForm.addEventListener('submit',event=>{event.preventDefault();if(passwordReply&&password.value){passwordForm.hidden=true;status.textContent='Unlocking PDF…';passwordReply(password.value);password.value='';}});
  let lastWidth=0;const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{const width=stage.clientWidth;if(width===lastWidth)return;lastWidth=width;if(zoom.value==='fit'){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>void draw());}});if(observer)observer.observe(stage);
  const ready=(async()=>{try{loading=pdfjs.getDocument({data:bytes,cMapUrl:'/workbench/pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'/workbench/pdf/standard_fonts/',wasmUrl:'/workbench/pdf/wasm/',iccUrl:'/workbench/pdf/iccs/',isEvalSupported:false,isImageDecoderSupported:false,enableXfa:false});loading.onPassword=(update,reason)=>{if(disposed)return;passwordReply=update;passwordForm.hidden=false;status.textContent=reason===2?'Incorrect password. Try again.':'This PDF requires a password.';password.focus();};const loaded=await loading.promise;if(disposed)return;documentPdf=loaded;pageInput.max=String(loaded.numPages);controls();await draw();}catch(error){failure(error);}})();
  return{ready,destroy(){if(disposed)return;disposed=true;++revision;if(observer)observer.disconnect();cancelAnimationFrame(resizeFrame);if(renderTask)renderTask.cancel();if(loading)void loading.destroy().catch(()=>{});password.value='';passwordReply=null;documentPdf=null;stage.replaceChildren();}};
};
`;

export const PDF_PREVIEW_MODULE = `import * as pdfjs from '/workbench/pdf/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/workbench/pdf/pdf.worker.mjs';
${PDF_PREVIEW_SCRIPT}`;

export const PDF_STANDALONE_MODULE = `
import '/workbench/pdf/viewer.mjs';
const host=document.getElementById('pdf-document'),title=document.getElementById('pdf-title'),download=document.getElementById('pdf-download');
function applyPdfAppearance(){try{const saved=JSON.parse(localStorage.getItem('porcupine.workbench.appearance.v1')||'null'),theme=saved?.theme||'pixel',mode=saved?.mode||'system';if(['pixel','workbench','cyberpunk','static','tokyo-night'].includes(theme))document.documentElement.dataset.theme=theme;document.documentElement.dataset.colourMode=mode==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):mode==='dark'?'dark':'light';}catch{}}applyPdfAppearance();matchMedia('(prefers-color-scheme:dark)').addEventListener('change',applyPdfAppearance);window.addEventListener('storage',event=>{if(event.key==='porcupine.workbench.appearance.v1')applyPdfAppearance();});
const params=new URLSearchParams(location.hash.slice(1)),source=params.get('source'),name=params.get('name')||'Document.pdf';history.replaceState(null,'',location.pathname);title.textContent=name;document.title=name+' · Porcupine';
let viewer=null,downloadUrl=null;
try{if(!source||!source.startsWith('blob:'+location.origin+'/'))throw new Error('Open a PDF from a Porcupine preview first');const response=await fetch(source);if(!response.ok)throw new Error('This PDF link has expired. Reopen it from Porcupine');const blob=await response.blob();downloadUrl=URL.createObjectURL(blob);download.href=downloadUrl;download.download=name;download.hidden=false;viewer=window.createWorkbenchPdfViewer(host,new Uint8Array(await blob.arrayBuffer()),name);await viewer.ready;}catch(error){host.textContent=error.message;}
window.addEventListener('pagehide',()=>{if(viewer)viewer.destroy();if(downloadUrl)URL.revokeObjectURL(downloadUrl);});
`;
