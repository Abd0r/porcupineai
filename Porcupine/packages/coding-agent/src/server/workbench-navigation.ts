/** Live runtime navigation and composer controls. No installers or tool execution actions. */
export const GOAL_CARD = `
<section class="goal-card" id="goal-card" aria-label="Tracked goal">
  <header class="goal-head"><button class="goal-toggle" id="goal-toggle" type="button" aria-expanded="true" aria-controls="goal-body"><span class="goal-kicker">Goal</span><span class="goal-state" id="goal-state"></span><span class="goal-chevron" aria-hidden="true">▾</span></button></header>
  <div class="goal-body" id="goal-body">
  <p class="goal-objective" id="goal-objective"></p>
  <ol class="goal-steps" id="goal-steps"></ol>
  <p class="goal-empty" id="goal-empty">No goal tracked yet.</p>
  </div>
</section>`;
export const STACKS_NAVIGATION = `
<details class="nav-tree" id="stacks-tree" hidden><summary>Stacks</summary>
  <details class="nav-branch" id="skills-folder"><summary>Skills <span id="skills-count" class="nav-count"></span></summary><input class="nav-search" id="skills-search" type="search" maxlength="256" aria-label="Search skills" placeholder="Find a skill"><nav id="skills-items" aria-label="Installed skills"></nav><button class="nav-more" id="skills-more" type="button" hidden>Load more skills</button></details>
  <details class="nav-branch" id="tools-folder"><summary>Tools <span id="tools-count" class="nav-count"></span></summary><input class="nav-search" id="tools-search" type="search" maxlength="256" aria-label="Search tools" placeholder="Find a tool"><nav id="tools-items" aria-label="Configured tools"></nav><button class="nav-more" id="tools-more" type="button" hidden>Load more tools</button></details>
</details>`;
export const STACKS_DIALOG = `
<dialog class="settings-dialog stack-dialog" id="stack-dialog" aria-labelledby="stack-title"><header class="settings-heading"><h2 id="stack-title">Stack</h2><form method="dialog"><button class="quiet-button" aria-label="Close stack details">×</button></form></header><section class="settings-section"><p id="stack-description"></p><p id="stack-availability"></p><pre id="stack-content" tabindex="0"></pre></section></dialog>`;
export const SUBAGENT_CARD = `
<section class="goal-card subagent-card" id="subagent-card" aria-label="Sub-agents">
  <header class="goal-head"><button class="goal-toggle" id="subagent-toggle" type="button" aria-expanded="true" aria-controls="subagent-body"><span class="goal-kicker">Sub-agents</span><span class="goal-state" id="subagent-state"></span><span class="goal-chevron" aria-hidden="true">▾</span></button></header>
  <div class="goal-body" id="subagent-body"><ol class="goal-steps" id="subagent-list"></ol><p class="goal-empty" id="subagent-empty">No sub-agent activity.</p></div>
</section>`;
export const MODEL_DIALOG = `
<dialog class="settings-dialog" id="model-dialog" aria-labelledby="model-title"><header class="settings-heading"><h2 id="model-title">Choose a model</h2><form method="dialog"><button class="quiet-button" aria-label="Close model picker">×</button></form></header>
<section class="settings-section"><p id="model-scope-note">Applies to this conversation only.</p><input class="nav-search" id="model-search" type="search" maxlength="120" aria-label="Search models" placeholder="Search by name, provider or id" autocomplete="off"><div class="model-list" id="model-list" role="listbox" aria-label="Available models"></div><p id="model-status" class="settings-note"></p></section></dialog>`;
export const CONTEXT_RING = `<button class="context-ring" id="context-ring" type="button" aria-label="Context usage"><svg viewBox="0 0 36 36" width="24" height="24" aria-hidden="true"><circle class="ring-track" cx="18" cy="18" r="15"/><circle class="ring-fill" id="ring-fill" cx="18" cy="18" r="15"/></svg><span class="context-tip" id="context-tip" role="status"></span></button>`;
export const SESSION_COMPOSER_CONTROLS = `<div class="session-controls" id="session-controls" hidden><label>Reasoning <select id="reasoning-mode" aria-label="Reasoning mode"></select></label><label>Autonomy <select id="autonomy-mode" aria-label="Autonomy mode"><option value="ask">Ask</option><option value="normal">Normal</option><option value="auto">Auto</option></select></label><button class="model-label" id="session-model" type="button" title="Change model for this conversation"></button>${CONTEXT_RING}</div>`;
export const SESSION_NAVIGATION_STYLES = `
.sidebar { overflow-y: auto; scrollbar-width: thin; }
.sidebar-toggle { display: grid; place-items: center; width: var(--s7); height: var(--s7); padding: 0; border: 0; border-radius: var(--r1); background: transparent; color: var(--quiet); }
.sidebar-toggle:hover { color: var(--text); background: var(--surface); }
.topbar { gap: var(--s3); justify-content: flex-start; }
.topbar strong { flex: 1; }
.shell[data-sidebar="collapsed"] { grid-template-columns: 0 minmax(0,1fr); }
.shell[data-sidebar="collapsed"] .sidebar { padding-inline: 0; border: 0; opacity: 0; pointer-events: none; }
.shell[data-sidebar] { transition: grid-template-columns var(--motion-normal) var(--motion-ease); }
.sidebar { transition: opacity var(--motion-fast) var(--motion-ease), padding var(--motion-normal) var(--motion-ease); }
.context-ring { position: relative; display: grid; place-items: center; width: var(--s7); height: var(--s7); padding: 0; border: 0; background: transparent; border-radius: 50%; }
.context-ring svg { transform: rotate(-90deg); }
.ring-track { fill: none; stroke: color-mix(in srgb, var(--line) 85%, transparent); stroke-width: 4; }
.ring-fill { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linecap: round; stroke-dasharray: 94.25; stroke-dashoffset: 94.25; transition: stroke-dashoffset var(--motion-normal) var(--motion-ease), stroke var(--motion-fast) var(--motion-ease); }
.context-ring[data-level="warn"] .ring-fill { stroke: #e8c07a; }
.context-ring[data-level="high"] .ring-fill { stroke: var(--danger); }
.context-tip { position: absolute; top: calc(100% + var(--s2)); right: 0; z-index: 9; display: none; width: max-content; max-width: 260px; padding: var(--s2) var(--s3); border: var(--unit) solid var(--line); border-radius: var(--r1); background: var(--surface); color: var(--text); font-size: var(--small); line-height: 1.5; box-shadow: 0 12px 30px rgb(0 0 0 / 35%); }
.context-ring:hover .context-tip, .context-ring:focus-visible .context-tip { display: block; }
.goal-card {
  width: 292px; max-height: 52dvh; overflow: auto; padding: var(--s3); display: grid; gap: var(--s2);
  border-radius: var(--r1);
  border: var(--unit) solid color-mix(in srgb, var(--line) 80%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 86%, transparent), color-mix(in srgb, var(--canvas) 94%, transparent));
  backdrop-filter: blur(16px) saturate(120%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 7%),
    0 1px 2px rgb(0 0 0 / 30%),
    0 18px 44px -14px rgb(0 0 0 / 60%);
  animation: goal-float-in var(--motion-normal) var(--motion-ease) both;
  transition: box-shadow var(--motion-normal) var(--motion-ease), transform var(--motion-normal) var(--motion-ease);
}
@keyframes goal-float-in { from { opacity: 0; transform: translateY(-8px) scale(.985); } to { opacity: 1; transform: none; } }
@media (hover: hover) {
  .goal-card:hover { transform: translateY(-1px); box-shadow: inset 0 1px 0 rgb(255 255 255 / 9%), 0 2px 4px rgb(0 0 0 / 32%), 0 26px 60px -18px rgb(0 0 0 / 68%); }
}
.goal-card[hidden] { display: none; }
.goal-head { display: flex; }
.goal-toggle { display: flex; align-items: baseline; gap: var(--s2); width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; }
.goal-toggle .goal-kicker { flex: none; }
.goal-toggle .goal-state { margin-left: auto; }
.goal-chevron { color: var(--quiet); font-size: var(--small); transition: transform var(--motion-fast) var(--motion-ease); }
.goal-card.collapsed .goal-chevron { transform: rotate(-90deg); }
.goal-body { display: grid; gap: var(--s2); }
.goal-card.collapsed .goal-body { display: none; }
.goal-kicker { font-size: var(--small); letter-spacing: .08em; text-transform: uppercase; color: var(--quiet); }
.goal-state { font-size: var(--small); color: var(--muted); }
.goal-state[data-state="active"] { color: var(--accent); }
.goal-state[data-state="done"] { color: var(--text); }
.goal-state[data-state="blocked"] { color: var(--danger); }
.goal-objective { margin: 0; font-size: var(--small); color: var(--text); overflow-wrap: anywhere; }
.goal-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s1); }
.goal-step { display: grid; grid-template-columns: auto minmax(0,1fr); gap: var(--s2); font-size: var(--small); color: var(--muted); align-items: baseline; }
.goal-step .glyph { width: 1.1em; text-align: center; color: var(--quiet); }
.goal-step[data-status="active"] { color: var(--text); }
.goal-step[data-status="active"] .glyph { color: var(--accent); }
.goal-step[data-status="done"] .glyph { color: var(--accent); }
.goal-step[data-status="done"] .goal-text { color: var(--quiet); text-decoration: line-through; }
.goal-step[data-status="blocked"] .glyph { color: var(--danger); }
.goal-empty { margin: 0; font-size: var(--small); color: var(--quiet); }

.nav-tree, .nav-branch { color: var(--muted); font-size: var(--small); }
.nav-tree > summary { color: var(--text); font-size: var(--body); padding: var(--s1) var(--s2); cursor: pointer; }
.nav-branch { margin: var(--s2) 0 0 var(--s4); }
.nav-branch > summary { cursor: pointer; padding: var(--s1); }
.nav-count { color: var(--quiet); margin-left: var(--s1); font-variant-numeric: tabular-nums; }
.nav-search { width: 100%; min-width: 0; margin: var(--s2) 0; padding: var(--s1) var(--s2); color: var(--text); background: var(--surface); border: var(--unit) solid var(--line); border-radius: var(--r1); font-size: var(--small); }
.nav-branch nav { display: grid; gap: var(--s1); max-height: 32dvh; overflow-y: auto; }
.nav-entry, .nav-more { text-align: left; color: var(--muted); background: transparent; border: 0; border-radius: var(--r1); padding: var(--s1) var(--s2); font-size: var(--small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-entry:hover, .nav-more:hover { background: var(--surface-hover); color: var(--text); }
.nav-more { color: var(--quiet); margin-top: var(--s2); }
#stack-content { white-space: pre-wrap; overflow-wrap: anywhere; font: var(--small)/1.6 ui-monospace, Consolas, monospace; color: var(--text); }
.session-controls { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s4); color: var(--muted); font-size: var(--small); align-items: center; }
.session-controls label { display: inline-flex; align-items: center; gap: var(--s1); }
.session-controls select { color: var(--text); background: transparent; border: 0; border-radius: var(--r1); padding: var(--s1); cursor: pointer; max-width: 10rem; font-size: var(--small); }
.session-controls select:disabled { cursor: not-allowed; opacity: .55; }
.session-controls select option { background: var(--surface); color: var(--text); }
.model-label { color: var(--quiet); max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compose-options { min-width: 0; display: grid; gap: var(--s1); }
.main { position: relative; }
@media (max-width: 1080px) {
  .goal-card { position: static; width: auto; max-height: none; margin: var(--s4) var(--s5) 0; }
}
@media(max-width:700px) { .model-label { display: none; } .session-controls { gap: var(--s1) var(--s2); } .compose-options > .hint { display: none; } }

.goal-stack { display: grid; gap: var(--s2); min-width: 0; }
.goal-stack .goal-card { position: static; width: auto; max-height: 40dvh; }
.subagent-card { position: static; }
@media (max-width: 1080px) { .goal-stack { display: none; } }
`;
export const SESSION_NAVIGATION_SCRIPT = `
let modelScope='session',modelCache=null;
const modelUi={dialog:$('model-dialog'),search:$('model-search'),list:$('model-list'),status:$('model-status'),scope:$('model-scope-note')};
function modelContext(value){if(!value)return '';return value>=1000000?Math.round(value/1000000)+'M context':Math.round(value/1000)+'K context'}
function renderModelList(){const query=(modelUi.search.value||'').toLowerCase();const current=modelCache&&modelCache.current;modelUi.list.replaceChildren();const models=((modelCache&&modelCache.models)||[]).filter(model=>!query||(model.name+' '+model.provider+' '+model.id).toLowerCase().includes(query));if(!models.length){const empty=document.createElement('p');empty.className='caption';empty.textContent='No matching model.';modelUi.list.append(empty);return}for(const model of models){const row=document.createElement('button');row.type='button';row.className='model-row';row.setAttribute('role','option');const selected=current&&current.provider===model.provider&&current.id===model.id;row.setAttribute('aria-selected',String(Boolean(selected)));const name=document.createElement('span');name.className='model-name';name.textContent=model.name;const meta=document.createElement('span');meta.className='model-meta';meta.textContent=model.provider+' · '+modelContext(model.contextWindow)+(model.reasoning?' · reasoning':'');row.append(name,meta);row.addEventListener('click',()=>void chooseModel(model));modelUi.list.append(row)}}
async function openModelPicker(scope){if(!sessionId){setError('Open a conversation first.');return}modelScope=scope;modelUi.scope.textContent=scope==='default'?'Sets the default model for new conversations.':scope==='subagent'?'Sets the model sub-agents run on. They fall back to the conversation model when unset.':'Applies to this conversation only.';modelUi.status.textContent='Loading models…';modelUi.search.value='';modelUi.dialog.showModal();try{const result=await json('/session/'+encodeURIComponent(sessionId)+'/models');if(result.supported===false){modelUi.status.textContent='This session does not expose model selection.';return}modelCache=result;modelUi.status.textContent=result.models.length+' models available'+(result.subagentModel?' · sub-agents: '+result.subagentModel:'');const current=$('subagent-model-current');if(current)current.textContent=result.subagentModel?'Sub-agents currently run on '+result.subagentModel:'Sub-agents inherit the conversation model.';renderModelList()}catch(error){modelUi.status.textContent=error.message}}
async function chooseModel(model){modelUi.status.textContent='Switching…';try{const result=await json('/session/'+encodeURIComponent(sessionId)+'/models',{method:'POST',body:JSON.stringify({provider:model.provider,id:model.id,scope:modelScope})});if(modelScope==='session'){modelCache=result;modelUi.status.textContent='Now using '+model.name;void refreshSessionSurfaces(sessionId);void refreshContext(sessionId)}else if(modelScope==='subagent'){modelUi.status.textContent='Sub-agents now use '+model.name;const current=$('subagent-model-current');if(current)current.textContent='Sub-agents currently run on '+model.provider+'/'+model.id}else{modelUi.status.textContent='Default set to '+model.name}modelUi.dialog.close()}catch(error){modelUi.status.textContent=error.message}}
modelUi.search.addEventListener('input',renderModelList);
const modelOpen=$('session-model'),modelDefaultOpen=$('model-default-open'),modelSubagentOpen=$('model-subagent-open');
modelOpen.addEventListener('click',()=>void openModelPicker('session'));
if(modelDefaultOpen)modelDefaultOpen.addEventListener('click',()=>void openModelPicker('default'));
if(modelSubagentOpen)modelSubagentOpen.addEventListener('click',()=>void openModelPicker('subagent'));
let sessionSurface=null,surfaceEpoch=0,stackInspection=0,trackerEpoch=0;
const goalUi={card:$('goal-card'),toggle:$('goal-toggle'),state:$('goal-state'),objective:$('goal-objective'),steps:$('goal-steps'),empty:$('goal-empty')};
const goalGlyph={done:'\u2713',active:'\u25B8',blocked:'!',pending:'\u25CB'};
function renderTracker(view){const goal=view&&view.goal;goalUi.steps.replaceChildren();
  if(!goal){goalUi.state.textContent='';goalUi.state.removeAttribute('data-state');goalUi.objective.textContent='';goalUi.empty.hidden=false;return}
  goalUi.empty.hidden=true;goalUi.state.textContent=goal.status;goalUi.state.dataset.state=goal.status;goalUi.objective.textContent=goal.objective;
  for(const step of goal.steps){const item=document.createElement('li');item.className='goal-step';item.dataset.status=step.status;const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=goalGlyph[step.status]||'\u25CB';glyph.setAttribute('aria-label',step.status);const text=document.createElement('span');text.className='goal-text';text.textContent=step.objective;if(step.note)text.title=step.note;item.append(glyph,text);goalUi.steps.append(item)}}
const ringUi={ring:$('context-ring'),fill:$('ring-fill'),tip:$('context-tip')};
function formatTokens(value){if(!Number.isFinite(value))return '—';if(value>=1000000){const millions=value/1000000;return (millions>=10?Math.round(millions):Math.round(millions*10)/10)+'M'}if(value>=1000){const thousands=value/1000;return (thousands>=100?Math.round(thousands):Math.round(thousands*10)/10)+'k'}return String(Math.round(value))}
const RING_CIRCUMFERENCE=2*Math.PI*15;
let lastContext=null;
const subagentUi={card:$('subagent-card'),toggle:$('subagent-toggle'),state:$('subagent-state'),list:$('subagent-list'),empty:$('subagent-empty')};
const subagentRuns=new Map();
const subagentCollapseKey='porcupine.workbench.subagents-collapsed';
function applySubagentCollapse(collapsed,save=false){subagentUi.card.classList.toggle('collapsed',collapsed);subagentUi.toggle.setAttribute('aria-expanded',String(!collapsed));if(save)try{window.localStorage.setItem(subagentCollapseKey,collapsed?'1':'0')}catch{}}
try{applySubagentCollapse(window.localStorage.getItem(subagentCollapseKey)==='1')}catch{}
subagentUi.toggle.addEventListener('click',()=>applySubagentCollapse(!subagentUi.card.classList.contains('collapsed'),true));
function cleanAgentSummary(value){return String(value||'').replace(/^@[\\w-]+\\s*(?:[\\u00b7:-])?\\s*/,'')}
function renderSubagents(){subagentUi.list.replaceChildren();const runs=[...subagentRuns.values()];if(!runs.length){subagentUi.state.textContent='';subagentUi.state.removeAttribute('data-state');subagentUi.empty.hidden=false;return}const active=runs.filter(run=>run.status==='running').length;subagentUi.state.textContent=active?active+' running':'idle';subagentUi.state.dataset.state=active?'active':'done';for(const run of runs.slice(-6)){const item=document.createElement('li');item.className='goal-step';item.dataset.status=run.status==='running'?'active':run.status==='done'?'done':'blocked';const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=run.status==='running'?'◌':run.status==='done'?'✓':'!';const text=document.createElement('span');text.className='goal-text';text.textContent=run.name+' · '+(run.summary?cleanAgentSummary(run.summary):run.status);item.append(glyph,text);subagentUi.list.append(item)}subagentUi.empty.hidden=runs.length>0}
function noteSubagent(message){const info=message.details&&typeof message.details==='object'?message.details:{};const tag=String(info.agentTag||info.tag||message.agentTag||message.tag||info.subagentId||message.subagentId||'agent');const run=subagentRuns.get(tag)||{name:'@'+String(tag).slice(0,12),status:'running',summary:''};const text=textOf(message.content)||'';run.summary=text.split(String.fromCharCode(10))[0].replace(/^@[w-]+s*[·:-]?s*/,'').slice(0,90);run.status=String(message.customType||'').includes('report')?'done':'running';subagentRuns.set(tag,run);renderSubagents()}
const limitsUi={open:$('settings-open'),compact:$('limit-compact'),subagents:$('limit-subagents'),apply:$('limits-apply'),status:$('limits-status')};
function syncLimitInputs(){if(!lastContext)return;limitsUi.compact.value=String(Math.round(lastContext.compactAtPercent||80));limitsUi.subagents.value=String(Math.round(lastContext.maxSubagents||3))}
limitsUi.open.addEventListener('click',()=>{syncLimitInputs();void refreshContext(sessionId).then(syncLimitInputs)});
limitsUi.apply.addEventListener('click',async()=>{if(!sessionId){limitsUi.status.textContent='Open a conversation first.';return}limitsUi.apply.disabled=true;limitsUi.status.textContent='Applying…';try{const stats=await json('/session/'+encodeURIComponent(sessionId)+'/context',{method:'POST',body:JSON.stringify({compactAtPercent:Number(limitsUi.compact.value),maxSubagents:Number(limitsUi.subagents.value)})});renderContext(stats);syncLimitInputs();limitsUi.status.textContent='Applied · compacts at '+Math.round(stats.compactAtPercent)+'% · '+stats.maxSubagents+' sub-agents'}catch(error){limitsUi.status.textContent=error.message}finally{limitsUi.apply.disabled=false}});
async function refreshContext(id=sessionId){if(!id)return;try{const stats=await json('/session/'+encodeURIComponent(id)+'/context');renderContext(stats)}catch{}}
function renderContext(stats){if(!stats||stats.supported===false)return;lastContext=stats;if(!limitsUi.compact.closest('[hidden]'))syncLimitInputs();const percent=Math.max(0,Math.min(100,Number(stats.percent)||0));ringUi.fill.style.strokeDashoffset=String(RING_CIRCUMFERENCE*(1-percent/100));ringUi.ring.dataset.level=percent>=Number(stats.compactAtPercent||80)?'high':percent>=60?'warn':'ok';ringUi.tip.textContent=formatTokens(stats.tokens)+' / '+formatTokens(stats.contextWindow)+' · '+percent+'% · compacts at '+Number(stats.compactAtPercent||80)+'% · up to '+Number(stats.maxSubagents||3)+' sub-agents';ringUi.ring.setAttribute('aria-label','Context usage '+percent+' percent, '+formatTokens(stats.tokens)+' of '+formatTokens(stats.contextWindow))}
const goalCollapseKey='porcupine.workbench.goal-collapsed';
function applyGoalCollapse(collapsed,save=false){goalUi.card.classList.toggle('collapsed',collapsed);goalUi.toggle.setAttribute('aria-expanded',String(!collapsed));if(save)try{window.localStorage.setItem(goalCollapseKey,collapsed?'1':'0')}catch{}}
try{applyGoalCollapse(window.localStorage.getItem(goalCollapseKey)==='1')}catch{}
goalUi.toggle.addEventListener('click',()=>applyGoalCollapse(!goalUi.card.classList.contains('collapsed'),true));
async function refreshTracker(id=sessionId){const epoch=++trackerEpoch;if(!id){renderTracker(null);return}try{const view=await json('/session/'+encodeURIComponent(id)+'/goal-plan');if(epoch===trackerEpoch&&id===sessionId)renderTracker(view.supported===false?null:view)}catch{if(epoch===trackerEpoch&&id===sessionId)renderTracker(null)}}
const surfaceUi={root:$('session-controls'),reasoning:$('reasoning-mode'),autonomy:$('autonomy-mode'),model:$('session-model'),stacks:$('stacks-tree'),dialog:$('stack-dialog')};
const catalogFolders={skills:{folder:$('skills-folder'),count:$('skills-count'),search:$('skills-search'),items:$('skills-items'),more:$('skills-more'),offset:0,epoch:0,timer:null},tools:{folder:$('tools-folder'),count:$('tools-count'),search:$('tools-search'),items:$('tools-items'),more:$('tools-more'),offset:0,epoch:0,timer:null}};
function updateControlDisabled(){const disabled=streaming||!sessionSurface||!sessionSurface.writable||sessionSurface.busy;surfaceUi.reasoning.disabled=disabled;surfaceUi.autonomy.disabled=disabled;}
function applySessionControls(snapshot){if(!snapshot||snapshot.supported===false){sessionSurface=null;surfaceUi.root.hidden=true;return}sessionSurface=snapshot;surfaceUi.root.hidden=false;surfaceUi.reasoning.replaceChildren();for(const mode of snapshot.availableReasoningModes||[]){const option=document.createElement('option');option.value=mode;option.textContent=({off:'Off',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Maximum',adaptive:'Adaptive'})[mode]||mode;surfaceUi.reasoning.append(option)}surfaceUi.reasoning.value=snapshot.reasoningMode;surfaceUi.autonomy.value=snapshot.interactionMode;surfaceUi.autonomy.title=snapshot.interactionMode==='ask'?'Confirm every bash command and file mutation.':snapshot.interactionMode==='auto'?'Flagged bash uses fail-closed model judgment. Hardline blocks remain; this is not a sandbox.':'Routine operations run directly; flagged bash requires approval.';surfaceUi.model.textContent=snapshot.model?snapshot.model.name:'';surfaceUi.model.title=snapshot.model?snapshot.model.provider+'/'+snapshot.model.id+' · change model':'';updateControlDisabled()}
async function refreshSessionSurfaces(id=sessionId){const epoch=++surfaceEpoch;sessionSurface=null;surfaceUi.root.hidden=true;surfaceUi.stacks.hidden=true;for(const folder of Object.values(catalogFolders)){folder.epoch++;folder.offset=0;folder.items.replaceChildren();folder.more.hidden=true}if(!id)return;try{const [controls,catalog]=await Promise.all([json('/session/'+encodeURIComponent(id)+'/controls'),json('/session/'+encodeURIComponent(id)+'/catalog')]);if(id!==sessionId||epoch!==surfaceEpoch)return;applySessionControls(controls);surfaceUi.stacks.hidden=!catalog.supported;catalogFolders.skills.count.textContent=String(catalog.skillsCount||0);catalogFolders.tools.count.textContent=String(catalog.toolsCount||0);for(const kind of ['skills','tools'])if(catalogFolders[kind].folder.open)void loadCatalogFolder(kind)}catch(error){if(id===sessionId&&epoch===surfaceEpoch)setError('Could not load session controls: '+error.message)}}
async function patchSessionControl(patch){if(!sessionId||!sessionSurface)return;const id=sessionId,previous=sessionSurface;surfaceUi.reasoning.disabled=true;surfaceUi.autonomy.disabled=true;try{const applied=await json('/session/'+encodeURIComponent(id)+'/controls',{method:'PATCH',body:JSON.stringify(patch)});if(id===sessionId){setError('');applySessionControls(applied)}}catch(error){if(id===sessionId){applySessionControls(previous);setError(error.message)}}}
surfaceUi.reasoning.addEventListener('change',()=>void patchSessionControl({reasoningMode:surfaceUi.reasoning.value}));
surfaceUi.autonomy.addEventListener('change',()=>void patchSessionControl({interactionMode:surfaceUi.autonomy.value}));
async function inspectStack(kind,name){const epoch=++stackInspection,id=sessionId;surfaceUi.dialog.showModal();$('stack-title').textContent=name;$('stack-description').textContent='Loading…';$('stack-availability').textContent='';$('stack-content').textContent='';try{const result=await json('/session/'+encodeURIComponent(id)+'/catalog/'+kind+'/'+encodeURIComponent(name));if(epoch!==stackInspection||id!==sessionId)return;$('stack-description').textContent=result.entry.description;$('stack-availability').textContent=(kind==='skills'?'Skill instructions':'Tool schema')+' · '+result.entry.availability+' · '+result.entry.scope;$('stack-content').textContent=result.content}catch(error){if(epoch===stackInspection)$('stack-content').textContent=error.message}}
async function loadCatalogFolder(kind,append=false){const folder=catalogFolders[kind],id=sessionId;if(!id||surfaceUi.stacks.hidden)return;const epoch=++folder.epoch,offset=append?folder.offset:0;if(!append)folder.items.replaceChildren();folder.more.disabled=true;try{const result=await json('/session/'+encodeURIComponent(id)+'/catalog?kind='+kind+'&query='+encodeURIComponent(folder.search.value||'')+'&offset='+offset+'&limit=50');if(epoch!==folder.epoch||id!==sessionId)return;for(const entry of result.entries){const button=document.createElement('button');button.type='button';button.className='nav-entry';button.textContent=entry.name;button.title=entry.description+' · '+entry.availability;button.addEventListener('click',()=>void inspectStack(kind,entry.name));folder.items.append(button)}folder.offset=offset+result.entries.length;folder.more.hidden=folder.offset>=result.total;if(result.total===0){const empty=document.createElement('p');empty.className='caption';empty.textContent='No matching '+kind;folder.items.append(empty)}}catch(error){if(id===sessionId)setError(error.message)}finally{if(epoch===folder.epoch)folder.more.disabled=false}}
for(const kind of ['skills','tools']){const folder=catalogFolders[kind];folder.folder.addEventListener('toggle',()=>{if(folder.folder.open)void loadCatalogFolder(kind)});folder.search.addEventListener('input',()=>{clearTimeout(folder.timer);folder.epoch++;folder.timer=setTimeout(()=>void loadCatalogFolder(kind),180)});folder.more.addEventListener('click',()=>void loadCatalogFolder(kind,true))}
`;
