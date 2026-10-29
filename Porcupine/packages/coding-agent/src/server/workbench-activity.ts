/** Compact plan and worker summaries sourced from runtime events. */
export const WORKBENCH_ACTIVITY_SCRIPT = `
let trackedGoal=null,trackedPlan=null;
const subagentRuns=new Map(),railUi={root:$('work-rail'),overlay:$('work-rail-overlay'),toggle:$('rail-toggle'),todos:$('todos-panel'),objective:$('todos-objective'),goal:$('todos-goal'),count:$('todos-count'),list:$('todos-list'),workers:$('workers-panel'),workerCount:$('workers-count'),workerList:$('workers-list')};
ui.feed.parentElement.append(railUi.overlay);
railUi.root.dataset.open=String(!window.matchMedia('(max-width:1100px)').matches);
railUi.overlay.dataset.open=railUi.root.dataset.open;
for(const panel of [railUi.todos,railUi.workers]){const key='porcupine.rail.'+panel.id+'.collapsed';try{if(window.localStorage.getItem(key)==='true')panel.open=false}catch{}panel.addEventListener('toggle',()=>{try{window.localStorage.setItem(key,String(!panel.open))}catch{}});}
function updateRail(){const panels=[railUi.todos,railUi.workers],side=panels.some(panel=>!panel.hidden&&panel.dataset.placement!=='hidden'&&panel.parentNode===railUi.root),overlay=panels.some(panel=>!panel.hidden&&panel.dataset.placement!=='hidden'&&panel.parentNode===railUi.overlay);railUi.root.hidden=!side;railUi.overlay.hidden=!overlay;railUi.toggle.hidden=!side&&!overlay;railUi.toggle.setAttribute('aria-expanded',String(overlay?railUi.overlay.dataset.open==='true':side&&railUi.root.dataset.open==='true'));}
function applyPanelPlacements(){const narrow=window.matchMedia('(max-width:1100px)').matches;for(const [panel,key] of [[railUi.todos,'todosPlacement'],[railUi.workers,'workersPlacement']]){const placement=appearancePreferences[key]||'side',changed=panel.dataset.placement!==placement;panel.dataset.placement=placement;const parent=placement==='overlay'||(placement==='side'&&narrow)?railUi.overlay:railUi.root;if(panel.parentNode!==parent)parent.append(panel);if(changed&&placement==='overlay')railUi.overlay.dataset.open='true';}if(railUi.todos.parentNode===railUi.workers.parentNode&&railUi.todos.nextElementSibling!==railUi.workers)railUi.todos.parentNode.insertBefore(railUi.todos,railUi.workers);updateRail();}
window.matchMedia('(max-width:1100px)').addEventListener('change',()=>applyPanelPlacements());
railUi.toggle.addEventListener('click',()=>{const open=railUi.overlay.hidden?railUi.root.dataset.open!=='true':railUi.overlay.dataset.open!=='true';railUi.root.dataset.open=String(open);railUi.overlay.dataset.open=String(open);railUi.toggle.setAttribute('aria-expanded',String(open));});
window.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('dialog[open],#sidebar[aria-modal="true"]')||railUi.overlay.hidden||railUi.overlay.dataset.open!=='true')return;event.preventDefault();railUi.root.dataset.open='false';railUi.overlay.dataset.open='false';updateRail();railUi.toggle.focus();});

function renderTracker(view){
  trackedGoal=view&&view.goal||null;renderTodos();
}
function renderPlan(plan){trackedPlan=plan&&typeof plan.objective==='string'&&Array.isArray(plan.steps)?plan:null;renderTodos();}
function renderTodos(){
  const current=trackedPlan||trackedGoal;railUi.todos.hidden=!current;railUi.list.replaceChildren();if(!current){updateRail();return;}
  renderMathLabel(railUi.objective,current.objective||'Current task');railUi.goal.hidden=!trackedPlan||!trackedGoal||trackedPlan.objective===trackedGoal.objective;railUi.goal.textContent=trackedGoal?'Goal · '+trackedGoal.objective:'';
  const steps=Array.isArray(current.steps)?current.steps:[];railUi.count.textContent=steps.filter(step=>step.status==='done').length+' / '+steps.length;
  for(const step of steps){const row=document.createElement('li');row.className='todo-item';row.dataset.state=step.status;const symbol=document.createElement('span'),text=document.createElement('span');symbol.className='todo-symbol';symbol.textContent=({done:'✓',active:'›',verifying:'◐',blocked:'!',failed:'×',skipped:'–',cancelled:'–'})[step.status]||'○';symbol.setAttribute('aria-label',step.status);text.className='todo-text';renderMathLabel(text,step.objective);if(step.owner)text.title='Assigned to '+step.owner;row.append(symbol,text);railUi.list.append(row);}updateRail();
}
async function refreshTracker(id=sessionId){const epoch=++trackerEpoch;if(!id)return;try{const view=await json('/session/'+encodeURIComponent(id)+'/goal-plan');if(epoch===trackerEpoch&&id===sessionId)renderTracker(view.supported===false?null:view)}catch{}}
function applySubagents(runs){
  for(const run of runs)if(run.id&&run.name)subagentNames.set(run.id,'@'+run.name);
  const active=runs.filter(run=>run.status==='running'),ids=new Set(active.map(run=>run.id));for(const [id,worker] of subagentRuns)if(!ids.has(id)){worker.row.remove();subagentRuns.delete(id)}
  for(const run of active){const activity=run.activity||{kind:'dreaming',summary:run.status==='running'?'Working on the task':'Task '+run.status};let worker=subagentRuns.get(run.id);
    if(!worker){const row=document.createElement('section');row.className='worker';row.dataset.workerId=run.id;const icon=document.createElement('span'),name=document.createElement('div'),tag=document.createElement('span'),state=document.createElement('span'),task=document.createElement('p'),summary=document.createElement('p');icon.className='worker-icon';icon.setAttribute('aria-hidden','true');name.className='worker-name';state.className='worker-state';task.className='worker-task';summary.className='worker-activity';name.append(tag,state);row.append(icon,name,task,summary);railUi.workerList.append(row);worker={row,icon,tag,state,task,summary,kind:null};subagentRuns.set(run.id,worker);}
    worker.row.dataset.state=run.status;worker.tag.textContent='@'+run.name;worker.state.textContent=run.status;worker.task.textContent=run.task||'Delegated task';worker.summary.textContent=activity.summary;if(worker.kind!==activity.kind){worker.icon.replaceChildren(activityGlyph(activity.kind));worker.kind=activity.kind;}
  }railUi.workers.hidden=subagentRuns.size===0;railUi.workerCount.textContent=String([...subagentRuns.values()].filter(worker=>worker.row.dataset.state==='running').length)+' active';updateRail();
}
function noteSubagent(message){if(!String(message.customType||'').includes('report'))return;const info=message.details||{},id=info.id||info.from||info.subagentId||info.agentTag;for(const [key,worker] of subagentRuns){if(key===id||worker.tag.textContent==='@'+String(info.from||info.agentTag||'').replace(/^@/,'')){worker.row.remove();subagentRuns.delete(key)}}railUi.workers.hidden=subagentRuns.size===0;railUi.workerCount.textContent=String(subagentRuns.size)+' active';updateRail();}

function resetActivity(){collaborationCalls.clear();subagentNames.clear();trackedGoal=null;trackedPlan=null;subagentRuns.clear();railUi.workerList.replaceChildren();railUi.workers.hidden=true;renderTodos();}
`;
