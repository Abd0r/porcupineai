export const ATTACHMENT_CONTROLS = `<div id="chat-attachments" class="chat-attachments" aria-label="Attached files" hidden></div>`;
export const ATTACHMENT_BUTTON = `<button id="attach-files" class="quiet-button attach-button" type="button" aria-label="Attach files or photos" title="Attach files or photos"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button><input id="chat-files" type="file" multiple hidden>`;
export const ATTACHMENT_STYLES = `
.compose-options { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.compose-options .session-controls { flex: 1; min-width: 0; }
.chat-attachments { display: flex; gap: 8px; overflow-x: auto; max-height: 112px; padding-bottom: 10px; }
.attachment-chip { display: flex; align-items: center; gap: 8px; max-width: 240px; flex-shrink: 0; padding: 7px 9px; border: 1px solid var(--line); background: var(--surface); border-radius: 10px; font-size: 11px; color: var(--muted); }
.attachment-chip img { width: 42px; height: 42px; object-fit: cover; border-radius: 6px; }
.attachment-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-chip button { background: transparent; border: 0; color: var(--quiet); padding: 4px; }
.message-photo { display: block; max-width: min(100%,360px); max-height: 280px; object-fit: contain; border-radius: 10px; margin-top: 12px; }
.attach-button { font-size: 22px; line-height: 1; width: 32px; height: 34px; padding: 0; }
`;
export const ATTACHMENT_SCRIPT = String.raw`
const attachmentDrafts=new Map(),attachmentReading=new Set();
function chatAttachments(id=sessionId){return attachmentDrafts.get(id)||[];}
function renderAttachments(){const host=$('chat-attachments');host.replaceChildren();const files=chatAttachments();host.hidden=!files.length;for(const file of files){const chip=document.createElement('div'),name=document.createElement('span'),remove=document.createElement('button');chip.className='attachment-chip';if(/^image\/(png|jpeg|webp|gif)$/.test(file.mime)){const image=document.createElement('img');image.src='data:'+file.mime+';base64,'+file.data;image.alt=file.name;chip.append(image);}name.textContent=file.name;name.title=file.name;remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+file.name);remove.addEventListener('click',()=>{attachmentDrafts.set(sessionId,chatAttachments().filter(item=>item!==file));renderAttachments();updateSend()});chip.append(name,remove);host.append(chip)}$('attach-files').disabled=attachmentReading.has(sessionId);updateSend();}
async function addChatFiles(list){const id=sessionId;if(!id)return;const files=[...list],existing=chatAttachments(id);if(existing.length+files.length>8||existing.reduce((sum,file)=>sum+file.size,0)+files.reduce((sum,file)=>sum+file.size,0)>12*1024*1024){setError('Attach up to 8 files, 12 MiB total.');return;}if(attachmentReading.has(id))return;attachmentReading.add(id);renderAttachments();try{const added=await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read '+file.name));reader.onload=()=>resolve({name:file.name,size:file.size,mime:file.type,data:String(reader.result).split(',')[1]||''});reader.readAsDataURL(file)})));attachmentDrafts.set(id,[...chatAttachments(id),...added]);if(id===sessionId)setError('');}catch(error){if(id===sessionId)setError(error.message)}finally{attachmentReading.delete(id);if(id===sessionId)renderAttachments();}}
$('attach-files').addEventListener('click',()=>$('chat-files').click());
$('chat-files').addEventListener('change',event=>{void addChatFiles(event.target.files||[]);event.target.value='';});
ui.prompt.addEventListener('paste',event=>{const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();void addChatFiles(files);}});
ui.form.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault()});
ui.form.addEventListener('drop',event=>{if(event.dataTransfer?.files.length){event.preventDefault();void addChatFiles(event.dataTransfer.files)}});
function userMessageText(content){return textOf(content).replace(/(^|\n)Attached file: ([^\n]+)\nPath: [^\n]+/g,'$1Attached: $2');}
function renderMessagePhotos(node,content){if(!Array.isArray(content))return;for(const part of content){if(part?.type!=='image'||!['image/png','image/jpeg','image/webp','image/gif'].includes(part.mimeType)||typeof part.data!=='string'||!/^[A-Za-z0-9+/]+=*$/.test(part.data))continue;const image=document.createElement('img');image.className='message-photo';image.alt='Attached photo';image.loading='lazy';image.src='data:'+part.mimeType+';base64,'+part.data;node.lastChild.append(image);}}
`;
