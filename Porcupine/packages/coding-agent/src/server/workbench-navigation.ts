/** Live runtime navigation and composer controls. No installers or tool execution actions. */
export const GOAL_CARD = `
<section class="goal-card" id="goal-card" aria-label="Tracked goal">
  <header class="goal-head"><span class="goal-kicker">Goal</span><span class="goal-state" id="goal-state"></span></header>
  <p class="goal-objective" id="goal-objective"></p>
  <ol class="goal-steps" id="goal-steps"></ol>
  <p class="goal-empty" id="goal-empty">No goal tracked yet.</p>
  <div class="goal-plan-row">
    <button class="plan-toggle" id="plan-toggle" type="button" aria-pressed="false" title="Plan mode blocks mutating tools for later turns. It does not save a plan artifact in the browser.">Plan mode</button>
    <span class="goal-fence" id="goal-fence" hidden>Fence on</span>
  </div>
</section>`;
export const STACKS_NAVIGATION = `
<details class="nav-tree" id="stacks-tree" hidden><summary>Stacks</summary>
  <details class="nav-branch" id="skills-folder"><summary>Skills <span id="skills-count" class="nav-count"></span></summary><input class="nav-search" id="skills-search" type="search" maxlength="256" aria-label="Search skills" placeholder="Find a skill"><nav id="skills-items" aria-label="Installed skills"></nav><button class="nav-more" id="skills-more" type="button" hidden>Load more skills</button></details>
  <details class="nav-branch" id="tools-folder"><summary>Tools <span id="tools-count" class="nav-count"></span></summary><input class="nav-search" id="tools-search" type="search" maxlength="256" aria-label="Search tools" placeholder="Find a tool"><nav id="tools-items" aria-label="Configured tools"></nav><button class="nav-more" id="tools-more" type="button" hidden>Load more tools</button></details>
</details>`;
export const STACKS_DIALOG = `
<dialog class="settings-dialog stack-dialog" id="stack-dialog" aria-labelledby="stack-title"><header class="settings-heading"><h2 id="stack-title">Stack</h2><form method="dialog"><button class="quiet-button" aria-label="Close stack details">×</button></form></header><section class="settings-section"><p id="stack-description"></p><p id="stack-availability"></p><pre id="stack-content" tabindex="0"></pre></section></dialog>`;
export const SESSION_COMPOSER_CONTROLS = `<div class="session-controls" id="session-controls" hidden><label>Reasoning <select id="reasoning-mode" aria-label="Reasoning mode"></select></label><label>Autonomy <select id="autonomy-mode" aria-label="Autonomy mode"><option value="ask">Ask</option><option value="normal">Normal</option><option value="auto">Auto</option></select></label><span class="model-label" id="session-model"></span></div>`;
export const SESSION_NAVIGATION_STYLES = `
.sidebar { overflow-y: auto; scrollbar-width: thin; }
.goal-card { position: absolute; top: var(--s4); right: var(--s5); z-index: 4; width: 268px; max-height: 46dvh; overflow: auto; border: var(--unit) solid var(--line-soft); border-radius: var(--r2); padding: var(--s3); display: grid; gap: var(--s2); background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(6px); box-shadow: 0 10px 30px rgb(0 0 0 / 18%); }
.goal-card[hidden] { display: none; }
.goal-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s2); }
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
.goal-plan-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); border-top: var(--unit) solid var(--line-soft); padding-top: var(--s2); }
.goal-fence { font-size: var(--small); color: var(--accent); }
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
.plan-toggle { border: var(--unit) solid var(--line); background: transparent; color: var(--muted); border-radius: var(--r1); padding: var(--s1) var(--s3); font-size: var(--small); }
.plan-toggle[aria-pressed="true"] { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }
.plan-toggle:disabled { opacity: .55; cursor: not-allowed; }
.model-label { color: var(--quiet); max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compose-options { min-width: 0; display: grid; gap: var(--s1); }
.content { position: relative; }
@media (max-width: 1080px) {
  .goal-card { position: static; width: auto; max-height: none; margin: 0 0 var(--s4); }
}
@media(max-width:700px) { .model-label { display: none; } .session-controls { gap: var(--s1) var(--s2); } .compose-options > .hint { display: none; } }
`;
export const SESSION_NAVIGATION_SCRIPT = `
let sessionSurface=null,surfaceEpoch=0,stackInspection=0,trackerEpoch=0;
const goalUi={card:$('goal-card'),state:$('goal-state'),objective:$('goal-objective'),steps:$('goal-steps'),empty:$('goal-empty'),fence:$('goal-fence')};
const goalGlyph={done:'\u2713',active:'\u25B8',blocked:'!',pending:'\u25CB'};
function renderTracker(view){const goal=view&&view.goal;goalUi.card.hidden=false;goalUi.fence.hidden=!view||!view.planFence;goalUi.steps.replaceChildren();
  if(!goal){goalUi.state.textContent='';goalUi.state.removeAttribute('data-state');goalUi.objective.textContent='';goalUi.empty.hidden=false;return}
  goalUi.empty.hidden=true;goalUi.state.textContent=goal.status;goalUi.state.dataset.state=goal.status;goalUi.objective.textContent=goal.objective;
  for(const step of goal.steps){const item=document.createElement('li');item.className='goal-step';item.dataset.status=step.status;const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=goalGlyph[step.status]||'\u25CB';glyph.setAttribute('aria-label',step.status);const text=document.createElement('span');text.className='goal-text';text.textContent=step.objective;if(step.note)text.title=step.note;item.append(glyph,text);goalUi.steps.append(item)}}
async function refreshTracker(id=sessionId){const epoch=++trackerEpoch;if(!id){renderTracker(null);return}try{const view=await json('/session/'+encodeURIComponent(id)+'/goal-plan');if(epoch===trackerEpoch&&id===sessionId)renderTracker(view.supported===false?null:view)}catch{if(epoch===trackerEpoch&&id===sessionId)renderTracker(null)}}
const surfaceUi={plan:$('plan-toggle'),root:$('session-controls'),reasoning:$('reasoning-mode'),autonomy:$('autonomy-mode'),model:$('session-model'),stacks:$('stacks-tree'),dialog:$('stack-dialog')};
const catalogFolders={skills:{folder:$('skills-folder'),count:$('skills-count'),search:$('skills-search'),items:$('skills-items'),more:$('skills-more'),offset:0,epoch:0,timer:null},tools:{folder:$('tools-folder'),count:$('tools-count'),search:$('tools-search'),items:$('tools-items'),more:$('tools-more'),offset:0,epoch:0,timer:null}};
function updateControlDisabled(){const disabled=streaming||!sessionSurface||!sessionSurface.writable||sessionSurface.busy;surfaceUi.reasoning.disabled=disabled;surfaceUi.autonomy.disabled=disabled;if(surfaceUi.plan)surfaceUi.plan.disabled=disabled}
function applySessionControls(snapshot){if(!snapshot||snapshot.supported===false){sessionSurface=null;surfaceUi.root.hidden=true;return}sessionSurface=snapshot;surfaceUi.root.hidden=false;surfaceUi.reasoning.replaceChildren();for(const mode of snapshot.availableReasoningModes||[]){const option=document.createElement('option');option.value=mode;option.textContent=({off:'Off',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Maximum',adaptive:'Adaptive'})[mode]||mode;surfaceUi.reasoning.append(option)}surfaceUi.reasoning.value=snapshot.reasoningMode;surfaceUi.autonomy.value=snapshot.interactionMode;surfaceUi.autonomy.title=snapshot.interactionMode==='ask'?'Confirm every bash command and file mutation.':snapshot.interactionMode==='auto'?'Flagged bash uses fail-closed model judgment. Hardline blocks remain; this is not a sandbox.':'Routine operations run directly; flagged bash requires approval.';surfaceUi.plan.setAttribute('aria-pressed',String(Boolean(snapshot.planFence)));surfaceUi.plan.disabled=!snapshot.writable||Boolean(snapshot.busy);surfaceUi.model.textContent=snapshot.model?snapshot.model.name:'';surfaceUi.model.title=snapshot.model?snapshot.model.provider+'/'+snapshot.model.id:'';updateControlDisabled()}
async function refreshSessionSurfaces(id=sessionId){const epoch=++surfaceEpoch;sessionSurface=null;surfaceUi.root.hidden=true;surfaceUi.stacks.hidden=true;for(const folder of Object.values(catalogFolders)){folder.epoch++;folder.offset=0;folder.items.replaceChildren();folder.more.hidden=true}if(!id)return;try{const [controls,catalog]=await Promise.all([json('/session/'+encodeURIComponent(id)+'/controls'),json('/session/'+encodeURIComponent(id)+'/catalog')]);if(id!==sessionId||epoch!==surfaceEpoch)return;applySessionControls(controls);surfaceUi.stacks.hidden=!catalog.supported;catalogFolders.skills.count.textContent=String(catalog.skillsCount||0);catalogFolders.tools.count.textContent=String(catalog.toolsCount||0);for(const kind of ['skills','tools'])if(catalogFolders[kind].folder.open)void loadCatalogFolder(kind)}catch(error){if(id===sessionId&&epoch===surfaceEpoch)setError('Could not load session controls: '+error.message)}}
async function patchSessionControl(patch){if(!sessionId||!sessionSurface)return;const id=sessionId,previous=sessionSurface;surfaceUi.reasoning.disabled=true;surfaceUi.autonomy.disabled=true;try{const applied=await json('/session/'+encodeURIComponent(id)+'/controls',{method:'PATCH',body:JSON.stringify(patch)});if(id===sessionId){setError('');applySessionControls(applied)}}catch(error){if(id===sessionId){applySessionControls(previous);setError(error.message)}}}
surfaceUi.reasoning.addEventListener('change',()=>void patchSessionControl({reasoningMode:surfaceUi.reasoning.value}));
surfaceUi.plan.addEventListener('click',()=>{if(sessionSurface)void patchSessionControl({planFence:!sessionSurface.planFence})});
surfaceUi.autonomy.addEventListener('change',()=>void patchSessionControl({interactionMode:surfaceUi.autonomy.value}));
async function inspectStack(kind,name){const epoch=++stackInspection,id=sessionId;surfaceUi.dialog.showModal();$('stack-title').textContent=name;$('stack-description').textContent='Loading…';$('stack-availability').textContent='';$('stack-content').textContent='';try{const result=await json('/session/'+encodeURIComponent(id)+'/catalog/'+kind+'/'+encodeURIComponent(name));if(epoch!==stackInspection||id!==sessionId)return;$('stack-description').textContent=result.entry.description;$('stack-availability').textContent=(kind==='skills'?'Skill instructions':'Tool schema')+' · '+result.entry.availability+' · '+result.entry.scope;$('stack-content').textContent=result.content}catch(error){if(epoch===stackInspection)$('stack-content').textContent=error.message}}
async function loadCatalogFolder(kind,append=false){const folder=catalogFolders[kind],id=sessionId;if(!id||surfaceUi.stacks.hidden)return;const epoch=++folder.epoch,offset=append?folder.offset:0;if(!append)folder.items.replaceChildren();folder.more.disabled=true;try{const result=await json('/session/'+encodeURIComponent(id)+'/catalog?kind='+kind+'&query='+encodeURIComponent(folder.search.value||'')+'&offset='+offset+'&limit=50');if(epoch!==folder.epoch||id!==sessionId)return;for(const entry of result.entries){const button=document.createElement('button');button.type='button';button.className='nav-entry';button.textContent=entry.name;button.title=entry.description+' · '+entry.availability;button.addEventListener('click',()=>void inspectStack(kind,entry.name));folder.items.append(button)}folder.offset=offset+result.entries.length;folder.more.hidden=folder.offset>=result.total;if(result.total===0){const empty=document.createElement('p');empty.className='caption';empty.textContent='No matching '+kind;folder.items.append(empty)}}catch(error){if(id===sessionId)setError(error.message)}finally{if(epoch===folder.epoch)folder.more.disabled=false}}
for(const kind of ['skills','tools']){const folder=catalogFolders[kind];folder.folder.addEventListener('toggle',()=>{if(folder.folder.open)void loadCatalogFolder(kind)});folder.search.addEventListener('input',()=>{clearTimeout(folder.timer);folder.epoch++;folder.timer=setTimeout(()=>void loadCatalogFolder(kind),180)});folder.more.addEventListener('click',()=>void loadCatalogFolder(kind,true))}
`;
