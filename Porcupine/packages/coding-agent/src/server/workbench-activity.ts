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
  for(const run of runs){const fingerprint=JSON.stringify(run);if(subagentRuns.get(run.id)===fingerprint)continue;subagentRuns.set(run.id,fingerprint);
    const label='@'+run.name+' · '+(run.lastTool?toolWords(run.lastTool):run.phase==='compacting'?'Compacting context':run.task||'Sub-agent');
    const row=activityRow('subagent-activity',label,run.status);const body=document.createElement('div');body.className='activity-detail';body.textContent=run.task+(Number.isFinite(run.steps)?' · '+run.steps+' step'+(run.steps===1?'':'s'):'');if(run.lastToolArgs){const args=document.createElement('pre');args.textContent=JSON.stringify(run.lastToolArgs,null,2);body.append(args)}row.append(body);scrollFeed();
  }
}
function noteSubagent(message){const info=message.details||{};const report=String(message.customType||'').includes('report');const id=info.from||info.id||info.agentTag||info.subagentId||'agent';const row=activityRow('subagent-activity',(report?'Sub-agent report':'Sub-agent message')+' · '+id,report?(info.ok===false?'failed':'done'):'message');const body=document.createElement('div');body.className='activity-detail';body.textContent=textOf(message.content);row.append(body);scrollFeed();}
function resetActivity(){goalFingerprint='';previousGoalActivity=null;subagentRuns.clear();}
`;
