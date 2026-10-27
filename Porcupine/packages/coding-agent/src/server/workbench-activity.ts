/** Ordered, inline runtime evidence. No inferred phases or decorative progress. */
export const WORKBENCH_ACTIVITY_SCRIPT = `
let goalFingerprint='',previousGoalActivity=null;
const subagentRuns=new Map();
function activityRow(className,label,state){
  ui.welcome.hidden=true;
  const row=document.createElement('details');row.className=className;row.dataset.state=state;
  const heading=document.createElement('summary'),name=document.createElement('span'),status=document.createElement('span');
  name.textContent=label;status.className='tool-state';status.textContent=state;heading.append(name,status);row.append(heading);ui.feed.append(row);return row;
}
function renderTracker(view){
  const goal=view&&view.goal;if(!goal)return;
  const fingerprint=JSON.stringify(goal);if(fingerprint===goalFingerprint)return;goalFingerprint=fingerprint;
  if(previousGoalActivity)previousGoalActivity.open=false;
  const row=activityRow('goal-activity','Goal · '+goal.objective,goal.status);row.open=goal.status==='active';
  const steps=document.createElement('ol');steps.className='goal-steps';
  const glyphs={done:'✓',active:'›',blocked:'!',pending:'○'};
  for(const step of goal.steps||[]){const item=document.createElement('li');item.className='goal-step';item.dataset.status=step.status;const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=glyphs[step.status]||'○';glyph.setAttribute('aria-label',step.status);const text=document.createElement('span');text.textContent=step.objective;if(step.note)text.title=step.note;item.append(glyph,text);steps.append(item);}
  row.append(steps);previousGoalActivity=row;scrollFeed();
}
async function refreshTracker(id=sessionId){const epoch=++trackerEpoch;if(!id)return;try{const view=await json('/session/'+encodeURIComponent(id)+'/goal-plan');if(epoch===trackerEpoch&&id===sessionId)renderTracker(view.supported===false?null:view)}catch{}}
function applySubagents(runs){
  for(const run of runs){const fingerprint=JSON.stringify([run.name,run.task,run.status]),previous=subagentRuns.get(run.id);if(previous&&previous.fingerprint===fingerprint)continue;
    if(previous){previous.row.dataset.state=run.status;previous.status.textContent=run.status;previous.label.textContent='@'+run.name;previous.body.textContent=run.task||'Delegated task';previous.fingerprint=fingerprint;continue;}
    const row=activityRow('subagent-activity','@'+run.name,run.status),body=document.createElement('div');body.className='activity-detail';body.textContent=run.task||'Delegated task';row.append(body);
    subagentRuns.set(run.id,{fingerprint,row,label:row.children[0].children[0],status:row.children[0].children[1],body});scrollFeed();
  }
}
function noteSubagent(message){const info=message.details||{};const report=String(message.customType||'').includes('report');const id=info.from||info.id||info.agentTag||info.subagentId||'agent';const row=activityRow('subagent-activity',(report?'Sub-agent report':'Sub-agent message')+' · '+id,report?(info.ok===false?'failed':'done'):'message');const body=document.createElement('div');body.className='activity-detail';body.textContent=textOf(message.content);row.append(body);scrollFeed();}
function resetActivity(){goalFingerprint='';previousGoalActivity=null;subagentRuns.clear();}
`;
