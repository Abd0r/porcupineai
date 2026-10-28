/** Explicit context-file inspection. Documents are kept in memory only, never browser persistence. */
export const CONTEXT_SETTINGS_SCRIPT = `
let contextEditor=null;
function contextElement(tag,text){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element}
async function loadWorkbenchSettings(){
  if(contextEditor)return;
  try{
    const capabilities=await json('/workbench');if(!capabilities.contextFiles)return;
    const result=await json('/workbench/context'),section=$('context-settings'),host=$('context-files');
    const select=contextElement('select');select.setAttribute('aria-label','Context file');select.append(contextElement('option','Choose a file to inspect'));select.children[0].value='';
    for(const file of result.files){const option=contextElement('option',(file.scope==='global'?'Global':'Workspace')+' · '+file.name);option.value=file.id;select.append(option)}
    const path=contextElement('p'),effect=contextElement('p'),area=contextElement('textarea');area.className='context-editor';area.setAttribute('aria-label','Context file contents');area.spellcheck=false;area.readOnly=true;area.hidden=true;
    const counter=contextElement('p'),actions=contextElement('div');actions.className='context-actions';
    const edit=contextElement('button','Edit'),save=contextElement('button','Save changes'),cancel=contextElement('button','Cancel'),reload=contextElement('button','Reload file');
    for(const button of [edit,save,cancel,reload]){button.type='button';button.className='quiet-button';button.hidden=true;actions.append(button)}
    const error=contextElement('p');error.className='error';error.setAttribute('role','alert');error.hidden=true;
    host.replaceChildren(select,path,effect,area,counter,actions,error);section.hidden=false;
    contextEditor={select,path,effect,area,counter,edit,save,cancel,reload,error,document:null,editing:false};
    function fail(message){error.textContent=message;error.hidden=!message}
    function count(){counter.textContent=contextEditor.document?area.value.length+' / '+contextEditor.document.charLimit+' characters':''}
    function editing(value){contextEditor.editing=value;area.readOnly=!value;select.disabled=value;edit.hidden=value||!contextEditor.document;save.hidden=!value;cancel.hidden=!value;reload.hidden=!contextEditor.document;reload.textContent=value?'Discard & reload':'Reload file';count()}
    let contextLoad=0;
    async function load(){const id=select.value,epoch=++contextLoad;if(!id)return;fail('');try{const document=await json('/workbench/context/'+encodeURIComponent(id));if(epoch!==contextLoad||id!==select.value)return;contextEditor.document=document;path.textContent=document.path;effect.textContent=document.effect+(document.exists?'':' This file does not exist yet. Editing and saving will create it.');area.value=document.content;area.maxLength=document.charLimit;area.hidden=false;editing(false)}catch(e){fail(e.message)}}
    select.addEventListener('change',()=>{contextEditor.document=null;area.value='';area.hidden=true;path.textContent='';effect.textContent='';editing(false);void load()});
    edit.addEventListener('click',()=>{editing(true);area.focus()});
    cancel.addEventListener('click',()=>{area.value=contextEditor.document.content;editing(false);fail('')});
    reload.addEventListener('click',()=>void load());
    area.addEventListener('input',count);
    save.addEventListener('click',async()=>{if(!contextEditor.document||!contextEditor.editing)return;save.disabled=true;fail('');try{const document=await json('/workbench/context/'+encodeURIComponent(contextEditor.document.id),{method:'PUT',body:JSON.stringify({content:area.value,revision:contextEditor.document.revision})});contextEditor.document=document;area.value=document.content;effect.textContent='Saved to disk. '+document.effect;editing(false)}catch(e){fail(e.message)}finally{save.disabled=false}});
  }catch(error){appearanceError('Could not load context settings: '+error.message)}
}
`;
export const CONTEXT_SETTINGS_STYLES = `
#context-files > select { width: 100%; padding: var(--s2); background: var(--surface); color: var(--text); border: var(--unit) solid var(--line); border-radius: var(--r1); margin-bottom: var(--s4); }
#context-files > p { overflow-wrap: anywhere; }
.context-editor { display: block; width: 100%; height: 32dvh; resize: vertical; padding: var(--s3); background: var(--surface); color: var(--text); border: var(--unit) solid var(--line); border-radius: var(--r1); font: var(--small)/1.6 ui-monospace, Consolas, monospace; }
.context-editor:read-only { color: var(--muted); }
.context-actions { display: flex; flex-wrap: wrap; gap: var(--s2); }
.context-actions button { border: var(--unit) solid var(--line); }
`;
