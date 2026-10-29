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
.artifact-content iframe { display: block; width: 100%; height: 65dvh; border: 1px solid var(--line); background: var(--canvas); }
.artifact-content pre { margin: 0; max-height: 65dvh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 ui-monospace,monospace; }
.artifact-actions { display: flex; flex-wrap: wrap; gap: 18px; border-top: 1px solid var(--line-soft); padding: 14px 20px; }
.artifact-actions a { color: var(--accent); font-size: 13px; text-underline-offset: 3px; }
@media(max-width:700px) { .artifact-card button,.artifact-actions a { min-height: 44px; display: inline-flex; align-items: center; } }
`;

export const ARTIFACT_SCRIPT = `
const workbenchArtifactPath=${workbenchArtifactPath.toString()};
let artifactPreviewEpoch=0,artifactPreviewUrl=null;
const artifactDialog=$('artifact-dialog');
function releaseArtifactPreview(){artifactPreviewEpoch++;if(artifactPreviewUrl)URL.revokeObjectURL(artifactPreviewUrl);artifactPreviewUrl=null;$('artifact-content').replaceChildren();for(const id of ['artifact-open','artifact-download'])$(id).removeAttribute('href');}
artifactDialog.addEventListener('close',releaseArtifactPreview);
async function loadWorkbenchArtifact(id,path){const response=await api('/session/'+encodeURIComponent(id)+'/artifact?path='+encodeURIComponent(path));if(!response.ok){let message='File unavailable ('+response.status+')';try{message=(await response.json()).error||message}catch{}throw new Error(message);}return {blob:await response.blob(),kind:response.headers.get('x-porcupine-preview')||'file',name:decodeURIComponent(response.headers.get('x-porcupine-name')||'file')};}
function createWorkbenchArtifact(label,href,embedded){const path=workbenchArtifactPath(href);if(!path)return null;const id=sessionId,card=document.createElement('span'),name=document.createElement('span'),note=document.createElement('span'),preview=document.createElement('button');card.className='artifact-card';name.className='artifact-name';name.textContent=label||path.split('/').pop();note.className='artifact-note';note.textContent=(path.split('.').pop()||'FILE').toUpperCase()+' · Workspace file';preview.type='button';preview.textContent='Preview / download';preview.setAttribute('aria-label','Preview '+name.textContent);card.append(name,note,preview);
  preview.addEventListener('click',async()=>{releaseArtifactPreview();const epoch=artifactPreviewEpoch;$('artifact-title').textContent=name.textContent;$('artifact-content').textContent='Loading preview…';$('artifact-open').hidden=true;$('artifact-download').hidden=true;artifactDialog.showModal();try{const file=await loadWorkbenchArtifact(id,path);if(epoch!==artifactPreviewEpoch||!artifactDialog.open)return;const url=URL.createObjectURL(file.blob);artifactPreviewUrl=url;const host=$('artifact-content');host.replaceChildren();if(file.kind==='image'){const image=document.createElement('img');image.alt=file.name;image.src=url;host.append(image);}else if(file.kind==='pdf'){const frame=document.createElement('iframe');frame.title='PDF preview: '+file.name;frame.src=url;host.append(frame);const hint=document.createElement('p');hint.className='artifact-note';hint.textContent='If your browser cannot display this PDF, use Open in new tab or Download.';host.append(hint);}else if(file.kind==='text'){const text=document.createElement('pre');text.textContent=await file.blob.slice(0,256*1024).text();if(epoch!==artifactPreviewEpoch)return;if(file.blob.size>256*1024)text.textContent+='\\n[Preview limited to 256 KiB. Download for the full file.]';host.append(text);}else host.textContent='Preview unavailable for this file format. Download it to open in its app.';const download=$('artifact-download');download.href=url;download.download=file.name;download.hidden=false;const open=$('artifact-open');open.hidden=file.kind==='file';if(!open.hidden)open.href=url;}catch(error){if(epoch===artifactPreviewEpoch)$('artifact-content').textContent=error.message;}});
  if(embedded&&/\\.(png|jpe?g|webp|gif)$/i.test(path)&&typeof IntersectionObserver!=='undefined'){const observer=new IntersectionObserver(entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();void loadWorkbenchArtifact(id,path).then(file=>{if(file.kind!=='image'||!card.isConnected)return;const image=document.createElement('img'),url=URL.createObjectURL(file.blob);image.className='artifact-thumbnail';image.alt=label||file.name;image.loading='lazy';image.addEventListener('load',()=>{URL.revokeObjectURL(url);scrollFeed();},{once:true});image.addEventListener('error',()=>URL.revokeObjectURL(url),{once:true});image.src=url;card.prepend(image);}).catch(()=>{note.textContent='Image unavailable · Open preview to retry';});});observer.observe(card);}
  return card;
}
`;
