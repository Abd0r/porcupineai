/** Local Markdown destinations only. External links retain their ordinary link behaviour. */
export function workbenchArtifactPath(href: string): string | null {
	let path = href.replace(/^sandbox:/, "");
	if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return null;
	try {
		path = decodeURIComponent(path);
	} catch {
		return null;
	}
	if (!path.trim() || /[\x00-\x1f]/.test(path) || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return null;
	return path;
}

export const ARTIFACT_DIALOG = `<dialog id="artifact-dialog" class="artifact-dialog" aria-labelledby="artifact-title"><header class="settings-heading"><h2 id="artifact-title">File preview</h2><form method="dialog"><button class="quiet-button" aria-label="Close file preview">×</button></form></header><div id="artifact-content" class="artifact-content"></div><footer class="artifact-actions"><a id="artifact-open" target="_blank" rel="noopener noreferrer">Open in new tab</a><a id="artifact-download">Download</a></footer></dialog>`;

export const ARTIFACT_STYLES = `
.artifact-card { display: inline-flex; flex-direction: column; vertical-align: top; gap: 8px; width: min(100%,320px); padding: 12px; margin-block: 6px; border: 1px solid var(--line); border-radius: var(--r2); background: var(--surface); white-space: normal; }
.artifact-card .artifact-name { color: var(--text); overflow-wrap: anywhere; font-size: 13px; font-weight: 550; }
.artifact-card .artifact-note { color: var(--quiet); font-size: 11px; }
.artifact-card button { align-self: flex-start; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 12px; padding: 4px 0; text-align: left; }
.artifact-thumbnail { display: block; max-width: 100%; max-height: 220px; object-fit: contain; border-radius: var(--r1); }
.artifact-dialog { width: min(1000px,calc(100% - 32px)); max-height: calc(100dvh - 32px); padding: 0; margin: auto; border: 1px solid var(--line); border-radius: var(--r2); background: var(--elevated); color: var(--text); }
.artifact-dialog::backdrop { background: var(--settings-backdrop); }
.artifact-dialog h2 { overflow-wrap: anywhere; }
.artifact-content { padding: 16px; min-height: 100px; overflow: auto; }
.artifact-content img { display: block; max-width: 100%; max-height: 70dvh; object-fit: contain; margin: auto; }
.pdf-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-bottom: 12px; }
.pdf-toolbar :is(button,input,select),.pdf-password :is(button,input) { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r1); padding: 7px 10px; }
.pdf-toolbar input { width: 5em; }.pdf-toolbar select { margin-left: auto; }
.pdf-stage { width: 100%; max-height: 65dvh; overflow: auto; background: var(--canvas); border: 1px solid var(--line-soft); padding: 12px; }
.pdf-stage canvas { display: block; margin: auto; background: white; max-width: none; }
.pdf-password { display: flex; gap: 8px; flex-wrap: wrap; }
.artifact-content pre { margin: 0; max-height: 65dvh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 ui-monospace,monospace; }
.artifact-actions { display: flex; flex-wrap: wrap; gap: 18px; border-top: 1px solid var(--line-soft); padding: 14px 20px; }
.artifact-actions a { color: var(--accent); font-size: 13px; text-underline-offset: 3px; }
@media(max-width:700px) { .artifact-card button,.artifact-actions a { min-height: 44px; display: inline-flex; align-items: center; } }
`;

export const ARTIFACT_SCRIPT = `
const workbenchArtifactPath=${workbenchArtifactPath.toString()};
let artifactPreviewEpoch=0,artifactPreviewUrl=null,artifactPreviewDispose=null,pdfRendererPromise=null;
const artifactDialog=$('artifact-dialog');
function releaseArtifactPreview(){artifactPreviewEpoch++;if(artifactPreviewDispose)artifactPreviewDispose();artifactPreviewDispose=null;if(artifactPreviewUrl)URL.revokeObjectURL(artifactPreviewUrl);artifactPreviewUrl=null;$('artifact-content').replaceChildren();$('artifact-open').onclick=null;for(const id of ['artifact-open','artifact-download'])$(id).removeAttribute('href');}
artifactDialog.addEventListener('close',releaseArtifactPreview);
function loadPdfRenderer(){if(window.createWorkbenchPdfViewer)return Promise.resolve(window.createWorkbenchPdfViewer);if(!pdfRendererPromise)pdfRendererPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.type='module';script.src='/workbench/pdf/viewer.mjs';script.addEventListener('load',()=>{if(window.createWorkbenchPdfViewer)resolve(window.createWorkbenchPdfViewer);else{pdfRendererPromise=null;reject(new Error('PDF renderer did not initialize'));}script.remove();});script.addEventListener('error',()=>{pdfRendererPromise=null;script.remove();reject(new Error('Could not load the local PDF renderer. Reopen the preview to retry'));});document.head.append(script);});return pdfRendererPromise;}
async function loadWorkbenchArtifact(id,path,source=null){const response=await api(source||('/session/'+encodeURIComponent(id)+'/artifact?path='+encodeURIComponent(path)));if(!response.ok){let message='File unavailable ('+response.status+')';try{message=(await response.json()).error||message}catch{}throw new Error(message);}return {blob:await response.blob(),kind:response.headers.get('x-porcupine-preview')||'file',name:decodeURIComponent(response.headers.get('x-porcupine-name')||'file')};}
async function previewWorkbenchArtifact(label,load,artifactFactory){
  releaseArtifactPreview();const epoch=artifactPreviewEpoch;$('artifact-title').textContent=label;$('artifact-content').textContent='Loading preview…';$('artifact-open').hidden=true;$('artifact-download').hidden=true;artifactDialog.showModal();
  try{const file=await load();if(epoch!==artifactPreviewEpoch||!artifactDialog.open)return;const url=URL.createObjectURL(file.blob);artifactPreviewUrl=url;const host=$('artifact-content');host.replaceChildren();
    const download=$('artifact-download');download.href=url;download.download=file.name;download.hidden=false;const open=$('artifact-open');open.hidden=file.kind==='file';if(!open.hidden)open.href=url;
    if(file.kind==='image'){const image=document.createElement('img');image.alt=file.name;image.src=url;host.append(image);}
    else if(file.kind==='pdf'){const destination=source=>'/workbench/pdf/viewer.html#source='+encodeURIComponent(source)+'&name='+encodeURIComponent(file.name);open.href=destination(url);open.onclick=()=>{const detached=URL.createObjectURL(file.blob);open.href=destination(detached);setTimeout(()=>URL.revokeObjectURL(detached),120000);};host.textContent='Loading PDF renderer…';const [createViewer,buffer]=await Promise.all([loadPdfRenderer(),file.blob.arrayBuffer()]);if(epoch!==artifactPreviewEpoch||!artifactDialog.open)return;const viewer=createViewer(host,new Uint8Array(buffer),file.name);artifactPreviewDispose=()=>viewer.destroy();await viewer.ready;}
    else if(file.kind==='text'){const markdown=/\\.(md|markdown)$/i.test(file.name),text=document.createElement(markdown?'div':'pre');const source=await file.blob.slice(0,256*1024).text();if(markdown)renderRichText(text,source,artifactFactory);else text.textContent=source;if(epoch!==artifactPreviewEpoch)return;if(file.blob.size>256*1024)text.append(document.createTextNode('\\n[Preview limited to 256 KiB. Download for the full file.]'));host.append(text);}
    else host.textContent='Preview unavailable for this file format. Download it to open in its app.';
  }catch(error){if(epoch===artifactPreviewEpoch)$('artifact-content').textContent=error.message;}
}
function createWorkbenchArtifact(label,href,embedded,project=null,base=''){const path=workbenchArtifactPath(href);if(!path)return null;const id=sessionId,load=()=>project?loadWorkbenchArtifact(null,null,'/workbench/projects/'+encodeURIComponent(project)+'/files/'+(base?base+'/':'')+path.split('/').map(encodeURIComponent).join('/')+'?raw=1'):loadWorkbenchArtifact(id,path),card=document.createElement('span'),name=document.createElement('span'),note=document.createElement('span'),preview=document.createElement('button');card.className='artifact-card';name.className='artifact-name';name.textContent=label||path.split('/').pop();note.className='artifact-note';note.textContent=(path.split('.').pop()||'FILE').toUpperCase()+' · Workspace file';preview.type='button';preview.textContent='Preview / download';preview.setAttribute('aria-label','Preview '+name.textContent);card.append(name,note,preview);
  preview.addEventListener('click',()=>previewWorkbenchArtifact(name.textContent,load,project?(label,href,embedded)=>createWorkbenchArtifact(label,href,embedded,project,(base?base+'/':'')+(path.includes('/')?path.slice(0,path.lastIndexOf('/')):'')):undefined));
  if(embedded&&/\\.(png|jpe?g|webp|gif)$/i.test(path)&&typeof IntersectionObserver!=='undefined'){const observer=new IntersectionObserver(entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();void load().then(file=>{if(file.kind!=='image'||!card.isConnected)return;const image=document.createElement('img'),url=URL.createObjectURL(file.blob);image.className='artifact-thumbnail';image.alt=label||file.name;image.loading='lazy';image.addEventListener('load',()=>{URL.revokeObjectURL(url);scrollFeed();},{once:true});image.addEventListener('error',()=>URL.revokeObjectURL(url),{once:true});image.src=url;card.prepend(image);}).catch(()=>{note.textContent='Image unavailable · Open preview to retry';});});observer.observe(card);}
  return card;
}
`;
