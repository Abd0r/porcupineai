export const COMMAND_MENU = `<div id="command-menu" class="command-menu" role="listbox" aria-label="Slash commands" hidden></div>`;
export const COMMAND_STYLES = `
.composer-wrap { position: relative; }
.command-menu { position: absolute; bottom: calc(100% + 10px); left: 0; right: 0; max-height: min(340px,45dvh); overflow: auto; padding: 7px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); box-shadow: 0 8px 28px rgb(0 0 0 / 14%); z-index: 10; }
.command-option { display: grid; grid-template-columns: minmax(90px,auto) 1fr; gap: 12px; width: 100%; text-align: left; background: transparent; border: 0; color: var(--text); padding: 8px 10px; border-radius: 7px; font-size: 12px; }
.command-option small { color: var(--quiet); font-size: 11px; }
.command-option[aria-selected="true"] { background: var(--surface); }
.command-result { padding: 12px 0; border-top: 1px solid var(--line-soft); font-size: 12px; color: var(--muted); }
.command-result summary { font-weight: 500; color: var(--text); cursor: pointer; }
.command-result pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; overflow: auto; font: 11px/1.8 ui-monospace,monospace; margin-top: 10px; }
`;
export const COMMAND_SCRIPT = String.raw`
let slashCatalog=[],slashEpoch=0,slashMatches=[],slashIndex=0,commandBusy=false;
async function refreshCommands(id=sessionId){const epoch=++slashEpoch;slashCatalog=[];hideCommandMenu();if(!id)return;try{const data=await json('/session/'+encodeURIComponent(id)+'/commands');if(epoch===slashEpoch&&id===sessionId)slashCatalog=data.commands||[];}catch{}}
function hideCommandMenu(){$('command-menu').hidden=true;ui.prompt.removeAttribute('aria-activedescendant');ui.prompt.setAttribute('aria-expanded','false');}
function updateCommandMenu(){const prefix=/^\/([^\s]*)$/.exec(ui.prompt.value);if(!prefix||chatAttachments().length){hideCommandMenu();return;}slashMatches=slashCatalog.filter(item=>item.name.toLowerCase().startsWith(prefix[1].toLowerCase())).slice(0,30);slashIndex=Math.min(slashIndex,Math.max(0,slashMatches.length-1));const menu=$('command-menu');menu.replaceChildren();menu.hidden=!slashMatches.length;ui.prompt.setAttribute('aria-controls','command-menu');ui.prompt.setAttribute('aria-expanded',String(!menu.hidden));for(const [index,item] of slashMatches.entries()){const button=document.createElement('button'),name=document.createElement('span'),description=document.createElement('small');button.type='button';button.id='command-option-'+index;button.className='command-option';button.setAttribute('role','option');button.setAttribute('aria-selected',String(index===slashIndex));name.textContent='/'+item.name;description.textContent=item.description+(item.availability==='terminal'?' · terminal only':'');button.append(name,description);button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>chooseSlashCommand(index));menu.append(button);}if(!menu.hidden)ui.prompt.setAttribute('aria-activedescendant','command-option-'+slashIndex);}
function chooseSlashCommand(index){const item=slashMatches[index];if(!item)return;ui.prompt.value='/'+item.name+' ';hideCommandMenu();resizeComposer();ui.prompt.focus();}
ui.prompt.addEventListener('input',()=>{slashIndex=0;updateCommandMenu()});
ui.prompt.addEventListener('keydown',event=>{if($('command-menu').hidden)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();hideCommandMenu();return;}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopImmediatePropagation();slashIndex=(slashIndex+(event.key==='ArrowDown'?1:-1)+slashMatches.length)%slashMatches.length;updateCommandMenu();document.getElementById('command-option-'+slashIndex)?.scrollIntoView({block:'nearest'});return;}if(event.key==='Tab'||(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&ui.prompt.value!=='/'+slashMatches[slashIndex]?.name)){event.preventDefault();event.stopImmediatePropagation();chooseSlashCommand(slashIndex);}},true);
function renderCommandResult(event){ui.welcome.hidden=true;const row=document.createElement('details'),head=document.createElement('summary'),body=document.createElement('pre');row.className='command-result';head.textContent=event.command;body.textContent=event.text;row.open=true;row.append(head,body);ui.feed.append(row);scrollFeed();}
async function submitSlashCommand(text){if(!text.startsWith('/'))return false;if(chatAttachments().length){setError('Send attachments with a regular message, without a slash command.');return true;}const match=/^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);if(!match)return false;const name=match[1].toLowerCase(),args=match[2]?.trim()||'',id=sessionId;if(commandBusy)return true;hideCommandMenu();setError('');commandBusy=true;updateSend();try{
  if(name==='new')await createSession();
  else if(name==='settings')appearance.open.click();
  else if(name==='model'&&!args)await openModelPicker('session');
  else if(['modes','reasoning','thinking'].includes(name)&&!args)$(name==='modes'?'autonomy-mode':'reasoning-mode').focus();
  else if(name==='resume'){if(args){const item=sessionCatalog.find(item=>item.id===args||sessionNames.get(item.id)===args);if(!item)throw new Error('Conversation not found. Choose one from the sidebar.');void connectEvents(item.id);}else{applySidebar(false);$('session-search').focus();}}
  else if(name==='projects'&&!args){applySidebar(false);projectsUi.tree.open=true;await refreshProjects();}
  else if(name==='stacks'&&!args){applySidebar(false);$('stacks-tree').open=true;$('skills-folder').open=true;$('tools-folder').open=true;}
  else if(name==='copy'){const last=[...ui.feed.querySelectorAll('.message.assistant .message-body')].at(-1);if(!last)throw new Error('No response to copy.');await navigator.clipboard.writeText(last.innerText);}
  else if(name==='reasoning-show'){if(args&&!['yes','no','on','off'].includes(args))throw new Error('Usage: /reasoning-show [yes|no]');appearance.reasoning.checked=args?['yes','on'].includes(args):!appearance.reasoning.checked;appearance.reasoning.dispatchEvent(new Event('change'));}
  else if(name==='hotkeys')renderCommandResult({command:text,text:'Enter: send · Shift+Enter: newline · Ctrl/Cmd+B: sidebar · /: commands · Tab: choose command · Escape: dismiss'});
  else await json('/session/'+encodeURIComponent(id)+'/command',{method:'POST',body:JSON.stringify({text})});
  if(sessionId===id){ui.prompt.value='';resizeComposer();await refreshSessionSurfaces(id);await refreshContext(id);await refreshSessions(false);}
 }catch(error){if(sessionId===id)setError(error.message);}finally{commandBusy=false;updateSend();}return true;}
`;
