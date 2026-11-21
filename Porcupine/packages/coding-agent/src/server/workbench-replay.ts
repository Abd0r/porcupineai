/** Yield between history batches without reordering live events or completing a stale restore. */
export async function replayWorkbenchTimeline<T>(
	items: readonly T[],
	apply: (item: T) => void,
	isCurrent: () => boolean,
	yieldFrame: () => Promise<void>,
): Promise<boolean> {
	for (let index = 0; index < items.length; index++) {
		if (!isCurrent()) return false;
		apply(items[index]);
		if ((index + 1) % 40 === 0 && index + 1 < items.length) await yieldFrame();
	}
	return isCurrent();
}

export const REPLAY_SCRIPT = `
const replayWorkbenchTimeline=${replayWorkbenchTimeline.toString()};
const historyPageSize=120;
const historyControls=document.createElement('div'),earlierHistoryButton=document.createElement('button'),newerHistoryButton=document.createElement('button'),historyStatus=document.createElement('span'),historyGap=document.createElement('p');
historyControls.className='history-controls';historyControls.setAttribute('aria-label','Browse saved history');
for(const button of [earlierHistoryButton,newerHistoryButton]){button.type='button';button.className='quiet-button';}
earlierHistoryButton.textContent='Load older history';newerHistoryButton.textContent='Newer history';historyStatus.setAttribute('role','status');
historyControls.append(earlierHistoryButton,newerHistoryButton,historyStatus);historyGap.className='notice';historyGap.textContent='Newer pages are available above. Recent conversation follows.';
let historyEvents=[],historyBefore=0,historyCursor=0,remoteHistory=false,archiveRows=[],newerHistoryCursors=[],historyRequest=0,loadingEarlierHistory=false;
const unmatchedHistoryResults=new Map();
function setWorkbenchHistory(events=[],before){
  historyRequest++;historyControls.remove();historyGap.remove();archiveRows=[];newerHistoryCursors=[];unmatchedHistoryResults.clear();
  earlierHistoryButton.disabled=false;newerHistoryButton.disabled=false;historyStatus.textContent='';
  remoteHistory=Number.isSafeInteger(before)&&before>=0;historyEvents=remoteHistory?[]:events;
  historyBefore=remoteHistory?before:Math.max(0,events.length-historyPageSize);historyCursor=historyBefore;
  return remoteHistory?events:events.slice(historyBefore);
}
function showEarlierHistoryButton(){
  earlierHistoryButton.hidden=!historyCursor;newerHistoryButton.hidden=!newerHistoryCursors.length;
  if(historyBefore&&!historyControls.isConnected)ui.feed.prepend(historyControls);
}
function discardArchive(){
  historyGap.remove();
  const rows=new Set(archiveRows);
  for(const [key,item] of componentCards)if(rows.has(item.card)){if(item.dispose)item.dispose();componentCards.delete(key);}
  for(const [key,run] of toolRuns)if(rows.has(run.row))toolRuns.delete(key);
  for(const row of rows){for(const canvas of row.querySelectorAll('canvas')){visualObservers.get(canvas)?.observer?.disconnect();visualObservers.delete(canvas);}row.remove();}
  archiveRows=[];
}
async function moveHistory(older){
  if(replaying||!connected||earlierHistoryButton.disabled)return;
  const before=older?historyCursor:newerHistoryCursors.at(-2),request=++historyRequest,owner=sessionId,connection=connectionEpoch;
  const current=()=>request===historyRequest&&owner===sessionId&&connection===connectionEpoch;
  if(older&&!before)return;
  earlierHistoryButton.disabled=true;newerHistoryButton.disabled=true;historyStatus.textContent='Loading history…';
  try{
    const page=before===undefined?null:remoteHistory?await json('/session/'+encodeURIComponent(owner)+'/history?before='+before):{
      timeline:historyEvents.slice(Math.max(0,before-historyPageSize),before),historyBefore:Math.max(0,before-historyPageSize)
    };
    if(!current())return;
    const firstPage=older&&!newerHistoryCursors.length,anchor=historyControls.nextElementSibling;
    const position=firstPage?anchor?.getBoundingClientRect().top:undefined;
    discardArchive();
    if(older)newerHistoryCursors.push(before);else newerHistoryCursors.pop();
    historyCursor=page?.historyBefore??historyBefore;
    if(page)renderArchive(page.timeline);
    if(newerHistoryCursors.length>1){const last=archiveRows.at(-1)||historyControls;last.after(historyGap);}
    showEarlierHistoryButton();
    historyStatus.textContent=page?'Showing '+page.timeline.length+' older events.':'Back to recent history.';
    if(firstPage&&anchor&&position!==undefined)ui.feed.scrollTop+=anchor.getBoundingClientRect().top-position;
    else ui.feed.scrollTop=0;
    if(document.activeElement===document.body||historyControls.contains(document.activeElement))ui.feed.focus({preventScroll:true});
  }catch(error){if(current())historyStatus.textContent=error.message;}
  finally{if(current()){earlierHistoryButton.disabled=false;newerHistoryButton.disabled=false;}}
}
earlierHistoryButton.addEventListener('click',()=>void moveHistory(true));
newerHistoryButton.addEventListener('click',()=>void moveHistory(false));
function renderArchive(events){
  const tail=ui.feed.lastElementChild;
  const assistant=streamingAssistant,thinking=liveThinking,busy=ui.feed.getAttribute('aria-busy');
  streamingAssistant=null;liveThinking=null;
  replaying=true;loadingEarlierHistory=true;ui.feed.setAttribute('aria-busy','true');
  protectedHistoryCards=new Set(componentCards.keys());protectedHistoryAnswers=new Set(componentAnswers.keys());
  try{
    for(const event of events)renderEvent(event);
    const fragment=document.createDocumentFragment();
    let node=tail?.nextElementSibling;
    while(node){const next=node.nextElementSibling;node.classList.add('restored');archiveRows.push(node);fragment.append(node);node=next;}
    historyControls.after(fragment);
    for(const key of componentAnswers.keys())if(!protectedHistoryAnswers.has(key))componentAnswers.delete(key);
  }finally{
    streamingAssistant=assistant;liveThinking=thinking;replaying=false;loadingEarlierHistory=false;protectedHistoryCards=undefined;protectedHistoryAnswers=undefined;
    ui.feed.setAttribute('aria-busy',busy||'false');
  }
}
`;
