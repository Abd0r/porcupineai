import { FOLLOWUP_SCRIPT } from "./workbench-followups.ts";
/** Session transport and interaction state for the bundled, same-origin workbench. */
export const WORKBENCH_CLIENT_SCRIPT = String.raw`
let sessionListEpoch=0,busyRevision=0,connected=false,connectionEpoch=0,replaying=false,replayEpoch=0,pendingAssistantRender=null,renderFrame=0;
function queueAssistantRender(node,text){pendingAssistantRender={node,text};if(!renderFrame)renderFrame=requestAnimationFrame(flushAssistantRender);}
function flushAssistantRender(){if(renderFrame)cancelAnimationFrame(renderFrame);renderFrame=0;if(!pendingAssistantRender)return;const {node,text}=pendingAssistantRender;pendingAssistantRender=null;renderRichText(node.lastChild,text);scrollFeed();}
const conversationViews=new Map(),sessionNames=new Map();
${FOLLOWUP_SCRIPT}
function updateSend(){ui.send.disabled=replaying||queueSubmissions.has(sessionId)||commandBusy||(streaming&&!canQueueFollowUps&&!/^\/kill(?:\s|$)/.test(ui.prompt.value.trim()))||!connected||attachmentReading.has(sessionId)||(!ui.prompt.value.trim()&&!chatAttachments().length);ui.prompt.setAttribute('aria-busy',String(streaming||replaying));ui.send.setAttribute('aria-label',streaming&&canQueueFollowUps?'Queue follow-up':'Send message');ui.send.title=streaming&&canQueueFollowUps?'Send at the next tool or response boundary':'Send message';}
function resizeComposer(){ui.prompt.style.height='auto';ui.prompt.style.height=Math.min(ui.prompt.scrollHeight,Math.max(60,(window.visualViewport?window.visualViewport.height:innerHeight)*.25))+'px';updateSend();}
function nearBottom(){return ui.feed.scrollHeight-ui.feed.scrollTop-ui.feed.clientHeight<100;}
function scrollFeed(force=false){if(!replaying&&(force||followOutput))ui.feed.scrollTop=ui.feed.scrollHeight;}
let followOutput=true,feedGesture=0;
for(const type of ['wheel','touchstart','pointerdown','keydown'])ui.feed.addEventListener(type,()=>{feedGesture++;},{passive:true});
ui.feed.addEventListener('scroll',()=>{followOutput=nearBottom();$('jump-latest').hidden=followOutput;});
$('jump-latest').addEventListener('click',()=>{followOutput=true;scrollFeed(true);$('jump-latest').hidden=true;});
function setConnection(value){connected=value;ui.status.textContent=value?(streaming?'Working':'Ready'):'Disconnected';ui.status.dataset.state=value?(streaming?'working':'ready'):'offline';$('reconnect').hidden=value;ui.stop.disabled=!value;updateSend();updateControlDisabled();}
function rememberView(){if(!sessionId)return;conversationViews.set(sessionId,{nodes:[...ui.feed.children],draft:ui.prompt.value,scroll:ui.feed.scrollTop,follow:followOutput});}
function resetSessionView(id){
  replaying=false;replayEpoch=connectionEpoch;ui.feed.dataset.replaying='false';
  flushAssistantRender();rememberView();
  if(liveThinking){stopThinking(liveThinking);liveThinking=null;}
  renderFollowUps();canQueueFollowUps=false;clearVisuals();toolRuns.clear();streamingAssistant=null;resetActivity();
  lastContext=null;ringUi.ring.hidden=true;ringUi.fill.style.strokeDashoffset=String(RING_CIRCUMFERENCE);ringUi.tip.textContent='Context usage unavailable';
  limitsUi.status.textContent='';hideCommandMenu();modelUi.dialog.close();modelEpoch++;stackInspection++;surfaceUi.dialog.close();sessionId=id;const cached=conversationViews.get(id);ui.feed.replaceChildren(...(cached?cached.nodes:[]));ui.prompt.value=cached?cached.draft:'';
  ui.welcome.hidden=ui.feed.children.length>0;ui.feed.scrollTop=cached?cached.scroll:0;followOutput=cached?cached.follow:true;$('jump-latest').hidden=followOutput;renderAttachments();resizeComposer();
  for(const button of document.querySelectorAll('.session')){button.classList.toggle('active',button.title===id);button.setAttribute('aria-current',button.title===id?'page':'false');}
  ui.title.textContent=sessionNames.get(id)||'Conversation '+id.slice(-8);
  setBusy(false);setError('');
}
async function connectEvents(id){
  if(activeProject)closeProjectPage();
  const epoch=++connectionEpoch;
  if(streamController)streamController.abort();
  const controller=new AbortController();streamController=controller;
  if(sessionId!==id)resetSessionView(id);
  setConnection(false);ui.status.textContent='Connecting…';
  try{
    await json('/session',{method:'POST',body:JSON.stringify({id})});
    if(epoch!==connectionEpoch)return;
    void refreshSessionSurfaces(id);void refreshContext(id);void refreshCommands(id);
    const response=await api('/session/'+encodeURIComponent(id)+'/events',{signal:controller.signal});
    if(!response.ok)throw new Error('Could not open session events ('+response.status+')');
    if(!response.body)throw new Error('Streaming is unavailable in this browser.');
    if(epoch!==connectionEpoch)return;
    setConnection(true);setError('');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    for(;;){
      const result=await reader.read();if(epoch!==connectionEpoch)return;if(result.done)break;
      buffer+=decoder.decode(result.value,{stream:true});let match;
      while((match=/\r?\n\r?\n/.exec(buffer))){
        const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);
        const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
        if(!data)continue;
        let event;try{event=JSON.parse(data)}catch{continue}
        await renderEvent(event);if(epoch!==connectionEpoch)return;
      }
    }
    if(epoch===connectionEpoch)throw new Error('Connection closed. Reconnect to continue. Your draft is preserved.');
  }catch(error){if(epoch===connectionEpoch&&error.name!=='AbortError'){controller.abort();setConnection(false);if(liveThinking){stopThinking(liveThinking);liveThinking=null;}setError(error.message)}}
}
const toolRuns=new Map();
function toolDescription(name,args){return describeWorkbenchActivity(name,args).summary;}
function toolResultText(result){const text=textOf(result&&result.content),details=result&&result.details;const diff=details&&(typeof details.diff==='string'?details.diff:typeof details.patch==='string'?details.patch:'');return text+(diff?'\n\nChanges\n'+diff:'');}
function setToolOutput(run,text,tail=false){run.resultText=text;run.tail=tail;const full=run.args+(text?'\n\n'+text:'');run.more.hidden=text.length<=16000;run.more.textContent=run.expanded?'Show preview':'Show full output';run.more.setAttribute('aria-expanded',String(run.expanded));run.output.textContent=run.expanded||text.length<=16000?full:run.args+'\n\n'+(tail?text.slice(-16000):text.slice(0,16000))+'\n[Preview · expand for full saved output]';}
function showToolStart(event){
	if(!replaying&&liveThinking){if(liveThinking.hasReasoning)finalizeThinking(liveThinking.reasoningText);else{stopThinking(liveThinking);liveThinking.wrap.remove();liveThinking=null;}}
	if(collaborationTool(event,'start'))return;
  ui.welcome.hidden=true;
  const row=document.createElement('details');row.className='tool-activity';row.dataset.state='running';
  const summary=document.createElement('summary'),name=document.createElement('span'),state=document.createElement('span'),icon=document.createElement('span');
  icon.className='activity-glyph';icon.setAttribute('aria-hidden','true');const activity=describeWorkbenchActivity(String(event.toolName||''),event.args);row.dataset.kind=activity.kind;icon.append(activityGlyph(activity.kind));
  name.textContent=toolDescription(String(event.toolName||'tool'),event.args);name.title=name.textContent;state.className='tool-state';state.textContent='Running';summary.append(icon,name,state);
  const output=document.createElement('pre');output.textContent=JSON.stringify(event.args||{},null,2);row.append(summary,output);ui.feed.append(row);
  const more=document.createElement('button');more.type='button';more.className='quiet-button tool-output-more';more.hidden=true;row.append(more);
  const run={row,state,output,icon,more,args:output.textContent,resultText:'',expanded:false,tail:false};more.addEventListener('click',()=>{run.expanded=!run.expanded;setToolOutput(run,run.resultText,run.tail)});
  toolRuns.set(event.toolCallId||event.toolName,run);scrollFeed();
}
function showToolUpdate(event){const run=toolRuns.get(event.toolCallId||event.toolName);if(!run)return;setToolOutput(run,toolResultText(event.partialResult),true);scrollFeed();}
function showToolEnd(event){if(collaborationTool(event,'end'))return;if(liveThinking&&!replaying)setThinkingLabel('Working');const run=toolRuns.get(event.toolCallId||event.toolName);if(!run)return;run.row.dataset.state=event.isError?'failed':'done';run.state.textContent=event.isError?'Failed':'Done';const svg=document.createElementNS(MATH_NS,'svg'),path=document.createElementNS(MATH_NS,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');path.setAttribute('d',event.isError?'m7 7 10 10M17 7 7 17':'m5 12 4 4L19 6');svg.append(path);run.icon.replaceChildren(svg);setToolOutput(run,toolResultText(event.result));toolRuns.delete(event.toolCallId||event.toolName);}
function filterSessions(){const query=$('session-search').value.trim().toLowerCase();for(const button of document.querySelectorAll('.session'))button.parentNode.hidden=Boolean(query&&!button.textContent.toLowerCase().includes(query));for(const group of ui.sessions.querySelectorAll('.pinned-sessions'))group.hidden=![...group.querySelectorAll('.session-row')].some(row=>!row.hidden);}
async function refreshSessions(selectFirst=false){
  const epoch=++sessionListEpoch,data=await json('/session');if(epoch!==sessionListEpoch)return;sessionCatalog=data.sessions||[];
  for(const item of sessionCatalog)if(item.name)sessionNames.set(item.id,item.name.startsWith("[Adaptive UI response]")?"Interactive session":item.name);
  renderSessionNavigation();if(activeProject)renderProjectChats();if(!activeProject&&sessionNames.has(sessionId))ui.title.textContent=sessionNames.get(sessionId);
  if(selectFirst&&sessionCatalog.length)void connectEvents(data.currentSessionId||sessionCatalog[0].id);else if(selectFirst)await createSession();
}
async function createSession(project=null){ui.newSession.disabled=true;try{const data=await json('/session',{method:'POST',body:'{}'});if(project)await json('/session/'+encodeURIComponent(data.sessionId)+'/project',{method:'PUT',body:JSON.stringify({name:project})});await refreshSessions(false);if(project)await refreshProjects();void connectEvents(data.sessionId);}finally{ui.newSession.disabled=false;}}
ui.authForm.addEventListener('submit',async event=>{event.preventDefault();token=ui.token.value.trim();setError('',true);const submit=ui.authForm.querySelector('button');submit.disabled=true;try{const capabilities=await json('/workbench');canAssignProjects=capabilities.canAssignProjects===true;canDeleteSessions=capabilities.canDeleteSessions===true;canPinSessions=capabilities.canPinSessions===true;await refreshSessions(true);ui.newSession.hidden=capabilities.canCreateSessions===false;projectsUi.tree.hidden=capabilities.projects===false;ui.auth.hidden=true;if(capabilities.projects)void refreshProjects();ui.token.value='';ui.prompt.focus()}catch(error){token='';setError(error.message,true)}finally{submit.disabled=false}});
ui.newSession.addEventListener('click',async()=>{setError('');try{await createSession()}catch(error){setError(error.message)}});
ui.form.addEventListener('submit',async event=>{
  event.preventDefault();const text=ui.prompt.value.trim();if((!text&&!chatAttachments().length)||!sessionId||(streaming&&!canQueueFollowUps&&!/^\/kill(?:\s|$)/.test(text))||!connected||attachmentReading.has(sessionId))return;
  if(queueSubmissions.has(sessionId))return;
  if(text.startsWith('/')&&await submitSlashCommand(text))return;
  if(streaming&&canQueueFollowUps){await submitFollowUp(text);return;}
  const id=sessionId,submittedConnection=connectionEpoch,attachments=chatAttachments();attachmentDrafts.delete(id);renderAttachments();setError('');ui.prompt.value='';resizeComposer();setBusy(true);const submittedBusyRevision=busyRevision;
  try{await json('/session/'+encodeURIComponent(id)+'/message',{method:'POST',body:JSON.stringify({text,attachments:attachments.map(({name,data})=>({name,data}))})});}
  catch(error){attachmentDrafts.set(id,[...attachments,...chatAttachments(id)]);if(id===sessionId){renderAttachments();if(submittedConnection===connectionEpoch&&submittedBusyRevision===busyRevision)setBusy(false);if(!ui.prompt.value)ui.prompt.value=text;else ui.prompt.value=text+'\n\n'+ui.prompt.value;resizeComposer();setError(error.message);ui.prompt.focus()}else{const view=conversationViews.get(id);if(view)view.draft=text+(view.draft?'\n\n'+view.draft:'');}}
});
ui.prompt.addEventListener('input',resizeComposer);
ui.prompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();ui.form.requestSubmit()}});
ui.stop.addEventListener('click',async()=>{if(!sessionId||!connected)return;const id=sessionId;ui.stop.disabled=true;try{await json('/session/'+encodeURIComponent(id)+'/abort',{method:'POST',body:'{}'});}catch(error){if(id===sessionId)setError(error.message)}finally{ui.stop.disabled=false}});
$('reconnect').addEventListener('click',()=>{if(sessionId)void connectEvents(sessionId)});
$('session-search').addEventListener('input',filterSessions);
for(const button of document.querySelectorAll('[data-prompt]'))button.addEventListener('click',()=>{ui.prompt.value=button.dataset.prompt;resizeComposer();ui.prompt.focus()});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('dialog[open]')&&window.matchMedia('(max-width: 700px)').matches)applySidebar(true)});
$('sidebar-dismiss').addEventListener('click',()=>{applySidebar(true);sidebarToggle.focus()});
window.addEventListener('focus',()=>{if(!ui.auth.hidden)return;void refreshSessions(false).catch(error=>setError(error.message));if(!projectsUi.tree.hidden)void refreshProjects();});
`;
