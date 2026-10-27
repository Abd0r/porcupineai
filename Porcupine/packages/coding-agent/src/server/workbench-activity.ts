/** Compact plan and worker summaries sourced from runtime events. */
export const WORKBENCH_ACTIVITY_SCRIPT = `
let trackedGoal=null,trackedPlan=null;
const subagentRuns=new Map(),railUi={root:$('work-rail'),toggle:$('rail-toggle'),todos:$('todos-panel'),objective:$('todos-objective'),goal:$('todos-goal'),count:$('todos-count'),list:$('todos-list'),workers:$('workers-panel'),workerCount:$('workers-count'),workerList:$('workers-list')};
for(const panel of [railUi.todos,railUi.workers]){const key='porcupine.rail.'+panel.id+'.collapsed';try{if(window.localStorage.getItem(key)==='true')panel.open=false}catch{}panel.addEventListener('toggle',()=>{try{window.localStorage.setItem(key,String(!panel.open))}catch{}});}
function updateRail(){const available=!railUi.todos.hidden||!railUi.workers.hidden;railUi.root.hidden=!available;railUi.toggle.hidden=!available;if(!available){railUi.root.dataset.open='false';railUi.toggle.setAttribute('aria-expanded','false');}}
railUi.toggle.addEventListener('click',()=>{const open=railUi.root.dataset.open!=='true';railUi.root.dataset.open=String(open);railUi.toggle.setAttribute('aria-expanded',String(open));});
function renderTracker(view){
  trackedGoal=view&&view.goal||null;renderTodos();
}
function renderPlan(plan){trackedPlan=plan&&typeof plan.objective==='string'&&Array.isArray(plan.steps)?plan:null;renderTodos();}
function renderTodos(){
  const current=trackedPlan||trackedGoal;railUi.todos.hidden=!current;railUi.list.replaceChildren();if(!current){updateRail();return;}
  railUi.objective.textContent=current.objective||'Current task';railUi.goal.hidden=!trackedPlan||!trackedGoal||trackedPlan.objective===trackedGoal.objective;railUi.goal.textContent=trackedGoal?'Goal · '+trackedGoal.objective:'';
  const steps=Array.isArray(current.steps)?current.steps:[];railUi.count.textContent=steps.filter(step=>step.status==='done').length+' / '+steps.length;
  for(const step of steps){const row=document.createElement('li');row.className='todo-item';row.dataset.state=step.status;const symbol=document.createElement('span'),text=document.createElement('span');symbol.className='todo-symbol';symbol.textContent=({done:'✓',active:'›',verifying:'◐',blocked:'!',failed:'×',skipped:'–',cancelled:'–'})[step.status]||'○';symbol.setAttribute('aria-label',step.status);text.className='todo-text';text.textContent=step.objective;if(step.owner)text.title='Assigned to '+step.owner;row.append(symbol,text);railUi.list.append(row);}updateRail();
}
async function refreshTracker(id=sessionId){const epoch=++trackerEpoch;if(!id)return;try{const view=await json('/session/'+encodeURIComponent(id)+'/goal-plan');if(epoch===trackerEpoch&&id===sessionId)renderTracker(view.supported===false?null:view)}catch{}}
function applySubagents(runs){
  for(const run of runs){const activity=run.activity||{kind:'dreaming',summary:run.status==='running'?'Working on the task':'Task '+run.status};let worker=subagentRuns.get(run.id);
    if(!worker){const row=document.createElement('section');row.className='worker';row.dataset.workerId=run.id;const icon=document.createElement('span'),name=document.createElement('div'),tag=document.createElement('span'),state=document.createElement('span'),task=document.createElement('p'),summary=document.createElement('p'),result=document.createElement('p');icon.className='worker-icon';icon.setAttribute('aria-hidden','true');name.className='worker-name';state.className='worker-state';task.className='worker-task';summary.className='worker-activity';result.className='worker-result';result.hidden=true;name.append(tag,state);row.append(icon,name,task,summary,result);railUi.workerList.append(row);worker={row,icon,tag,state,task,summary,result,kind:null};subagentRuns.set(run.id,worker);}
    worker.row.dataset.state=run.status;worker.tag.textContent='@'+run.name;worker.state.textContent=run.status;worker.task.textContent=run.task||'Delegated task';worker.summary.textContent=activity.summary;if(worker.kind!==activity.kind){worker.icon.replaceChildren(activityGlyph(activity.kind));worker.kind=activity.kind;}
  }railUi.workers.hidden=subagentRuns.size===0;railUi.workerCount.textContent=String([...subagentRuns.values()].filter(worker=>worker.row.dataset.state==='running').length)+' active';updateRail();
}
function noteSubagent(message){if(!String(message.customType||'').includes('report'))return;const info=message.details||{},id=info.id||info.from||info.subagentId||info.agentTag||'agent';let worker=subagentRuns.get(id)||[...subagentRuns.values()].find(item=>item.tag.textContent==='@'+String(info.from||info.agentTag||'').replace(/^@/,''));if(!worker){applySubagents([{id,name:String(info.from||info.agentTag||id).replace(/^@/,''),task:'Delegated task',status:info.ok===false?'failed':'done'}]);worker=subagentRuns.get(id);}worker.result.textContent=textOf(message.content).slice(0,500);worker.result.hidden=false;worker.row.dataset.state=info.ok===false?'failed':'done';worker.state.textContent=worker.row.dataset.state;}
function resetActivity(){trackedGoal=null;trackedPlan=null;subagentRuns.clear();railUi.workerList.replaceChildren();railUi.workers.hidden=true;renderTodos();}
`;
