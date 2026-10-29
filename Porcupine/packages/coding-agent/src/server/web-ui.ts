import { MESSAGE_RENDERER_SCRIPT, RICH_TEXT_STYLES } from "./message-renderer.ts";
import { VISUAL_RENDERER_SCRIPT } from "./visual-renderer.ts";
import { WORKBENCH_STYLES } from "./web-ui-styles.ts";
import { WORKBENCH_ACTIVITY_SCRIPT } from "./workbench-activity.ts";
import { ACTIVITY_DESCRIPTION_SCRIPT } from "./workbench-activity-description.ts";
import { APPEARANCE_DIALOG, APPEARANCE_SCRIPT, APPEARANCE_STYLES } from "./workbench-appearance.ts";
import { ARTIFACT_DIALOG, ARTIFACT_SCRIPT, ARTIFACT_STYLES } from "./workbench-artifacts-ui.ts";
import {
	ATTACHMENT_BUTTON,
	ATTACHMENT_CONTROLS,
	ATTACHMENT_SCRIPT,
	ATTACHMENT_STYLES,
} from "./workbench-attachments-ui.ts";
import { WORKBENCH_CLIENT_SCRIPT } from "./workbench-client.ts";
import { COLLABORATION_SCRIPT, COLLABORATION_STYLES } from "./workbench-collaboration.ts";
import { WORKBENCH_COLOUR_STYLES } from "./workbench-colours.ts";
import { COMMAND_MENU, COMMAND_SCRIPT, COMMAND_STYLES } from "./workbench-commands-ui.ts";
import { FOCUS_SCRIPT } from "./workbench-focus.ts";
import { FOLLOWUP_STYLES } from "./workbench-followups.ts";
import { ACTIVITY_GLYPHS_SCRIPT, ACTIVITY_GLYPHS_STYLES } from "./workbench-glyphs.ts";
import { WORKBENCH_LAYOUT_STYLES } from "./workbench-layout.ts";
import { MODE_ICON_SCRIPT, MODE_ICON_STYLES } from "./workbench-mode-icons.ts";
import { WORKBENCH_MOTION_STYLES } from "./workbench-motion.ts";
import {
	MODEL_DIALOG,
	SESSION_COMPOSER_CONTROLS,
	SESSION_NAVIGATION_SCRIPT,
	SESSION_NAVIGATION_STYLES,
	STACKS_DIALOG,
	STACKS_NAVIGATION,
} from "./workbench-navigation.ts";
import { ORGANIZATION_DIALOG, ORGANIZATION_SCRIPT, ORGANIZATION_STYLES } from "./workbench-organization-ui.ts";
import { PROJECT_DIALOG, PROJECTS_NAVIGATION, PROJECTS_SCRIPT, PROJECTS_STYLES } from "./workbench-projects-ui.ts";
import { WORKBENCH_RAIL, WORKBENCH_RAIL_STYLES } from "./workbench-rail.ts";
import { REPLAY_SCRIPT } from "./workbench-replay.ts";
import { CONTEXT_SETTINGS_SCRIPT, CONTEXT_SETTINGS_STYLES } from "./workbench-settings.ts";
import { THINKING_SCRIPT, THINKING_STYLES } from "./workbench-thinking.ts";
import { VIEWPORT_SCRIPT, VIEWPORT_STYLES } from "./workbench-viewport.ts";

/** Local, same-origin browser workbench served by `porcupine --serve`. */
export const PORCUPINE_WEB_UI = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Porcupine Workbench</title>
<link rel="stylesheet" href="/workbench/math/katex.min.css">
<script src="/workbench/math/katex.min.js"></script>
<style>
${WORKBENCH_STYLES}
${APPEARANCE_STYLES}
${CONTEXT_SETTINGS_STYLES}
${WORKBENCH_MOTION_STYLES}
${RICH_TEXT_STYLES}
${FOLLOWUP_STYLES}
${THINKING_STYLES}
${SESSION_NAVIGATION_STYLES}
${PROJECTS_STYLES}
${WORKBENCH_LAYOUT_STYLES}
${ACTIVITY_GLYPHS_STYLES}
${COLLABORATION_STYLES}
${WORKBENCH_RAIL_STYLES}
${ATTACHMENT_STYLES}
${ORGANIZATION_STYLES}
${COMMAND_STYLES}
${MODE_ICON_STYLES}
${VIEWPORT_STYLES}
${WORKBENCH_COLOUR_STYLES}
${ARTIFACT_STYLES}
</style>
</head>
<body>
<div class="shell">
<button id="sidebar-dismiss" class="sidebar-dismiss" type="button" aria-label="Close navigation" tabindex="-1" hidden></button>
<aside id="sidebar" class="sidebar" aria-label="Conversations">
<div class="brand"><span class="brand-name"><svg class="brand-symbol" viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 26V13a7 7 0 0 1 7-7h2a7 7 0 0 1 0 14h-4"/><path d="m5 13 4-4M5 21l4-4M13 6l3-3M21 6l3-3"/></svg>Porcupine</span><span class="edition">Workbench</span></div>
<button class="new-session" id="new-session" type="button">＋ New conversation</button>
${STACKS_NAVIGATION}
${PROJECTS_NAVIGATION}
<div class="session-section"><p class="caption">Conversations</p><input id="session-search" class="nav-search" type="search" aria-label="Search conversations" placeholder="Search conversations…" autocomplete="off"><nav class="sessions" id="sessions" aria-label="Recent sessions"></nav></div>
<div class="side-foot">Local workspace</div>
</aside>
<main class="main">
<header class="topbar"><button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-controls="sidebar" aria-label="Toggle sidebar" aria-expanded="true" title="Toggle sidebar (Ctrl/Cmd+B)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M9 4v16"/></svg></button><strong id="session-title">Workbench</strong><div class="topbar-actions"><button id="rail-toggle" class="rail-toggle" type="button" aria-controls="work-rail work-rail-overlay" aria-expanded="false" hidden>Tasks</button><button class="quiet-button" id="reconnect" type="button" hidden>Reconnect</button><div class="status" aria-live="polite"><span id="status-text">Ready</span></div><button class="settings-trigger" id="settings-open" type="button" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></svg></button></div></header>

<section class="content" aria-label="Conversation">
<div class="welcome" id="welcome"><h1>What are we working on?</h1><div class="starters"><button type="button" data-prompt="Inspect this workspace and explain its architecture. Identify the most useful next improvement with evidence."><span>Explore a codebase</span></button><button type="button" data-prompt="Help me debug an issue. Start by inspecting the workspace and ask for the failing behavior if it is not evident."><span>Fix something broken</span></button><button type="button" data-prompt="Help me turn an idea into a working implementation. Ask me what I want to build, then inspect the available tools and workspace."><span>Build an idea</span></button></div></div>
<div class="feed-stage"><div class="feed" id="feed" role="log" aria-label="Conversation history" tabindex="0" aria-live="polite" aria-relevant="additions text"></div>
<button id="jump-latest" class="jump-latest" type="button" hidden>↓ Latest message</button></div>
<form class="composer-wrap" id="prompt-form">${COMMAND_MENU}${ATTACHMENT_CONTROLS}<textarea class="composer" id="prompt" rows="1" aria-label="Message Porcupine" placeholder="Message Porcupine…"></textarea><div class="compose-row"><div class="compose-options">${ATTACHMENT_BUTTON}${SESSION_COMPOSER_CONTROLS}<span class="hint">Enter to send · Shift + Enter for a new line</span></div><div class="actions"><button class="stop" id="stop" type="button" hidden>Stop</button><button class="send" id="send" type="submit" aria-label="Send message" title="Send message"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4 18-7Z"/><path d="m10 14 5-5"/></svg></button></div></div></form>
<div class="error" id="error" role="alert" hidden></div>
<div class="notice" id="history-notice">Local workspace</div>
</section>
${WORKBENCH_RAIL}
</main>
</div>
<div class="auth" id="auth">
<form class="auth-card" id="auth-form"><h2>Connect to Porcupine</h2><p>This workbench talks only to the local Porcupine server. Enter its bearer token if one was configured. The token stays in this tab and is not saved.</p><label for="token">Server token</label><input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Leave blank for explicitly tokenless local mode"><button class="send" type="submit">Connect</button><div class="error" id="auth-error" role="alert" hidden></div></form>
</div>
${APPEARANCE_DIALOG}
${ARTIFACT_DIALOG}
${STACKS_DIALOG}
${MODEL_DIALOG}
${PROJECT_DIALOG}
${ORGANIZATION_DIALOG}
<script>
(()=>{
const $=id=>document.getElementById(id);const ui={auth:$('auth'),authForm:$('auth-form'),token:$('token'),authError:$('auth-error'),sessions:$('sessions'),newSession:$('new-session'),feed:$('feed'),welcome:$('welcome'),form:$('prompt-form'),prompt:$('prompt'),send:$('send'),stop:$('stop'),error:$('error'),status:$('status-text'),title:$('session-title')};
let token='',sessionId='',streamController=null,streaming=false,streamingAssistant=null;
const shell=document.querySelector('.shell'),sidebarToggle=$('sidebar-toggle'),sidebarKey='porcupine.workbench.sidebar-collapsed';
function applySidebar(collapsed,save=false){if(!shell||!sidebarToggle)return;shell.dataset.sidebar=collapsed?'collapsed':'open';sidebarToggle.setAttribute('aria-expanded',String(!collapsed));const sidebar=$('sidebar'),returnFocus=collapsed&&sidebar.contains(document.activeElement),mobileOpen=!collapsed&&window.matchMedia('(max-width: 700px)').matches;sidebar.inert=collapsed;sidebar.setAttribute('role',mobileOpen?'dialog':'complementary');if(mobileOpen)sidebar.setAttribute('aria-modal','true');else sidebar.removeAttribute('aria-modal');for(const node of [document.querySelector('.content'),document.querySelector('.topbar-actions'),$('work-rail'),$('work-rail-overlay')])if(node)node.inert=mobileOpen;if(returnFocus)sidebarToggle.focus();else if(save&&mobileOpen)$('session-search').focus();$('sidebar-dismiss').hidden=collapsed||!window.matchMedia('(max-width: 700px)').matches;if(save)try{window.localStorage.setItem(sidebarKey,collapsed?'1':'0')}catch{}}
try{applySidebar(window.matchMedia('(max-width: 700px)').matches||window.localStorage.getItem(sidebarKey)==='1')}catch{}
if(sidebarToggle)sidebarToggle.addEventListener('click',()=>applySidebar(shell.dataset.sidebar!=='collapsed',true));
window.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='b'){event.preventDefault();if(shell)applySidebar(shell.dataset.sidebar!=='collapsed',true)}});
window.matchMedia('(max-width: 700px)').addEventListener('change',event=>applySidebar(event.matches));
function setError(message,auth=false){const el=auth?ui.authError:ui.error;el.textContent=message;el.hidden=!message}
function api(path,options={}){const headers=new Headers(options.headers||{});if(token)headers.set('authorization','Bearer '+token);if(typeof options.body==='string')headers.set('content-type','application/json');return fetch(path,{...options,headers})}
async function json(path,options){const response=await api(path,options);let body={};try{body=await response.json()}catch{}if(!response.ok)throw new Error(body.error||'Request failed ('+response.status+')');return body}
function setBusy(value){streaming=value;ui.feed.setAttribute('aria-busy',String(value));ui.status.textContent=connected?(value?'Working':'Ready'):'Disconnected';ui.status.dataset.state=value?'working':'ready';ui.stop.hidden=!value;updateSend();updateControlDisabled()}
function enterDelay(){const count=ui.feed.children.length%5;return count===0?'0ms':(count*28)+'ms'}
function appendMessage(role,text){ui.welcome.hidden=true;const node=document.createElement('article');node.className='message '+role;node.style.setProperty('--enter-delay',enterDelay());const label=document.createElement('div');label.className='label';label.textContent=role==='user'?'You':role==='assistant'?'':'Activity';const body=document.createElement('div');body.className='message-body';body.textContent=text;if(role==='assistant'){const copy=document.createElement('button');copy.type='button';copy.className='message-copy';copy.textContent='Copy';copy.setAttribute('aria-label','Copy response');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(body.innerText);copy.textContent='Copied'}catch{copy.textContent='Copy unavailable'}});label.append(copy)}node.append(label,body);ui.feed.append(node);scrollFeed();return node}
function textOf(value){if(typeof value==='string')return value;if(!Array.isArray(value))return '';return value.map(part=>{if(typeof part==='string')return part;if(part&&typeof part==='object'&&part.type==='text'&&typeof part.text==='string')return part.text;return ''}).filter(Boolean).join('\n')}
function isRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
function thinkingOf(value){if(!Array.isArray(value))return '';return value.map(part=>part&&typeof part==='object'&&part.type==='thinking'&&!part.redacted&&typeof part.thinking==='string'?part.thinking:'').filter(Boolean).join('\n\n')}
let liveThinking=null;
function ensureThinkingRow(){
  if(liveThinking)return liveThinking;
  const row=createThinkingRow();
  ui.welcome.hidden=true;
  ui.feed.append(row.wrap);
  scrollFeed();
  startThinking(row);
  liveThinking=row;
  return row;
}
function setThinkingLabel(label){
  const row=ensureThinkingRow();
  if(label)row.label.textContent=label;
}
function finalizeThinking(thinkingText,seconds,beforeNode){
  if(!liveThinking){if(!thinkingText)return;ensureThinkingRow();if(beforeNode&&beforeNode.parentNode===ui.feed)ui.feed.insertBefore(liveThinking.wrap,beforeNode);}
  const row=liveThinking;
  if(thinkingText){setReasoningText(row,thinkingText)}
  stopThinking(row,seconds);
  if(replaying)row.label.textContent=thinkingText?'Reasoning':'Activity';
  liveThinking=null;
}
function ensureAssistant(){if(streamingAssistant)return streamingAssistant;ui.welcome.hidden=true;const node=appendMessage('assistant','');streamingAssistant=node;return node}
function hasOnlyKeys(value,required,optional=[]){if(!isRecord(value))return false;const keys=Object.keys(value);return required.every(key=>keys.includes(key))&&keys.every(key=>required.includes(key)||optional.includes(key))}
function validVector(value){return Array.isArray(value)&&value.length===3&&value.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=-20&&n<=20)}
function validColor(value){return typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value)}
function validLabel(value){return value===undefined||(typeof value==='string'&&value.length<=60)}
function validScene(scene){if(!hasOnlyKeys(scene,['version','title','objects'],['description'])||scene.version!==1||typeof scene.title!=='string'||!scene.title.trim()||scene.title.length>100||!(scene.description===undefined||(typeof scene.description==='string'&&scene.description.length<=300))||!Array.isArray(scene.objects)||scene.objects.length<1||scene.objects.length>80)return false;return scene.objects.every(object=>{if(!isRecord(object)||!validColor(object.color)||!validLabel(object.label))return false;if(object.type==='box')return hasOnlyKeys(object,['type','position','size','color'],['label'])&&validVector(object.position)&&Array.isArray(object.size)&&object.size.length===3&&object.size.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=.05&&n<=20);if(object.type==='sphere')return hasOnlyKeys(object,['type','position','radius','color'],['label'])&&validVector(object.position)&&typeof object.radius==='number'&&Number.isFinite(object.radius)&&object.radius>=.05&&object.radius<=10;if(object.type==='arrow')return hasOnlyKeys(object,['type','from','to','color'],['label'])&&validVector(object.from)&&validVector(object.to);return false})}
function renderVisualization(scene){if(!validScene(scene))return;ui.welcome.hidden=true;const card=document.createElement('section');card.className='visualization-card';const heading=document.createElement('h2');renderMathLabel(heading,scene.title);const description=document.createElement('p');renderRichText(description,scene.description||'Interactive 3D scene');const canvas=document.createElement('canvas');canvas.className='scene-canvas';canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',scene.title+'. Drag to rotate, or focus and use the arrow keys.');const controls=document.createElement('div');controls.className='scene-controls';const hint=document.createElement('div');hint.className='visualization-hint';hint.textContent='Drag to rotate · Arrow keys also work';const details=document.createElement('details');details.className='scene-contents';const summary=document.createElement('summary');summary.textContent='Scene contents';const list=document.createElement('ul');for(const object of scene.objects){const item=document.createElement('li');item.textContent=(object.label||object.type)+' · '+object.type;list.append(item)}details.append(summary,list);card.append(heading,description,canvas,controls,hint,details);ui.feed.append(card);scrollFeed();const ctx=canvas.getContext('2d');if(!ctx)return;const mathLabels=createCanvasMathLabels(canvas);function sceneText(text,x,y,width){if(!mathLabels.draw(text,x,y,width))ctx.fillText(text,x,y,width||canvas.getBoundingClientRect().width);}let colors=plotColors(canvas);let yaw=-.68,pitch=.5,drag=null;function project(point,width,height,scale){const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);const x=point[0]*cy-point[2]*sy;const z=point[0]*sy+point[2]*cy;const y=point[1]*cp-z*sp;const depth=z*cp+point[1]*sp;const perspective=54/(54-depth);return{x:width/2+x*scale*perspective,y:height*.53-y*scale*perspective,depth,factor:perspective}}function shade(color,factor){const r=Math.max(0,Math.min(255,Math.round(parseInt(color.slice(1,3),16)*factor)));const g=Math.max(0,Math.min(255,Math.round(parseInt(color.slice(3,5),16)*factor)));const b=Math.max(0,Math.min(255,Math.round(parseInt(color.slice(5,7),16)*factor)));return'rgb('+r+' '+g+' '+b+')'}function draw(){mathLabels.begin();colors=plotColors(canvas);const rect=canvas.getBoundingClientRect();const width=Math.max(1,rect.width),height=Math.max(1,rect.height),ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle=window.getComputedStyle(canvas).getPropertyValue('--canvas').trim()||'#1b1b1c';ctx.fillRect(0,0,width,height);let extent=4;for(const object of scene.objects){if(object.type==='box')extent=Math.max(extent,...object.position.map((n,i)=>Math.abs(n)+object.size[i]/2));else if(object.type==='sphere')extent=Math.max(extent,...object.position.map(n=>Math.abs(n)+object.radius));else extent=Math.max(extent,...object.from.map(Math.abs),...object.to.map(Math.abs))}const scale=Math.min(width,height)/(Math.max(8,extent*2.8));ctx.lineWidth=1;ctx.strokeStyle=colors.grid;for(let i=-4;i<=4;i++){let a=project([-5,0,i],width,height,scale),b=project([5,0,i],width,height,scale),c=project([i,0,-5],width,height,scale),d=project([i,0,5],width,height,scale);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.moveTo(c.x,c.y);ctx.lineTo(d.x,d.y);ctx.stroke()}const axes=[[[-5,0,0],[5,0,0],'#de8c84'],[[0,-4,0],[0,4,0],'#9cce82'],[[0,0,-5],[0,0,5],'#80a9db']];for(const axis of axes){const a=project(axis[0],width,height,scale),b=project(axis[1],width,height,scale);ctx.strokeStyle=axis[2];ctx.globalAlpha=.55;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}ctx.globalAlpha=1;const drawItems=[];const corners=(center,size)=>{const out=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])out.push([center[0]+x*size[0]/2,center[1]+y*size[1]/2,center[2]+z*size[2]/2]);return out};const faces=[[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]];for(const object of scene.objects){if(object.type==='box'){const vertices=corners(object.position,object.size).map(point=>project(point,width,height,scale));for(let i=0;i<faces.length;i++){const points=faces[i].map(index=>vertices[index]);const depth=points.reduce((sum,point)=>sum+point.depth,0)/points.length;drawItems.push({depth,draw:()=>{ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const point of points.slice(1))ctx.lineTo(point.x,point.y);ctx.closePath();ctx.fillStyle=shade(object.color,[.63,.78,.9,1,.55,.7][i]);ctx.fill();ctx.strokeStyle='#091014';ctx.globalAlpha=.72;ctx.stroke();ctx.globalAlpha=1}})}const center=project(object.position,width,height,scale);if(object.label)drawItems.push({depth:center.depth+.01,draw:()=>{ctx.fillStyle=colors.text;ctx.font='12px system-ui';ctx.textAlign='center';sceneText(object.label,center.x,center.y-8)}})}else if(object.type==='sphere'){const center=project(object.position,width,height,scale);const radius=Math.max(2,object.radius*scale*center.factor);drawItems.push({depth:center.depth,draw:()=>{const gradient=ctx.createRadialGradient(center.x-radius*.34,center.y-radius*.38,1,center.x,center.y,radius);gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.2,object.color);gradient.addColorStop(1,shade(object.color,.42));ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.fillStyle=gradient;ctx.fill();ctx.strokeStyle='#090d10';ctx.stroke();if(object.label){ctx.fillStyle=colors.text;ctx.font='12px system-ui';ctx.textAlign='center';sceneText(object.label,center.x,center.y-radius-7)}}})}else{const from=project(object.from,width,height,scale),to=project(object.to,width,height,scale),middle={x:(from.x+to.x)/2,y:(from.y+to.y)/2,depth:(from.depth+to.depth)/2};drawItems.push({depth:middle.depth,draw:()=>{const angle=Math.atan2(to.y-from.y,to.x-from.x);ctx.strokeStyle=object.color;ctx.fillStyle=object.color;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.beginPath();ctx.moveTo(to.x,to.y);ctx.lineTo(to.x-9*Math.cos(angle-.48),to.y-9*Math.sin(angle-.48));ctx.lineTo(to.x-9*Math.cos(angle+.48),to.y-9*Math.sin(angle+.48));ctx.closePath();ctx.fill();if(object.label){ctx.fillStyle=colors.text;ctx.font='12px system-ui';ctx.textAlign='center';sceneText(object.label,middle.x,middle.y-8)}}})}}drawItems.sort((a,b)=>a.depth-b.depth);for(const item of drawItems)item.draw();mathLabels.end()}function addControl(label,change){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',label);button.addEventListener('click',()=>{change();pitch=Math.max(-1.25,Math.min(1.25,pitch));draw()});controls.append(button)}addControl('Rotate left',()=>yaw-=.18);addControl('Rotate right',()=>yaw+=.18);addControl('Tilt up',()=>pitch+=.12);addControl('Tilt down',()=>pitch-=.12);addControl('Reset',()=>{yaw=-.68;pitch=.5});canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId)});canvas.addEventListener('pointermove',event=>{if(!drag)return;yaw+=(event.clientX-drag.x)*.008;pitch=Math.max(-1.25,Math.min(1.25,pitch+(event.clientY-drag.y)*.008));drag={x:event.clientX,y:event.clientY};draw()});canvas.addEventListener('pointerup',()=>{drag=null});canvas.addEventListener('pointercancel',()=>{drag=null});canvas.addEventListener('keydown',event=>{if(event.key==='ArrowLeft')yaw-=.14;else if(event.key==='ArrowRight')yaw+=.14;else if(event.key==='ArrowUp')pitch=Math.min(1.25,pitch+.12);else if(event.key==='ArrowDown')pitch=Math.max(-1.25,pitch-.12);else return;event.preventDefault();draw()});observeVisual(canvas,draw);draw()}
${VISUAL_RENDERER_SCRIPT}
async function restoreWorkbenchConnection(event){const epoch=connectionEpoch;canQueueFollowUps=event.canQueueFollowUps===true;renderFollowUps(event.followUp||[]);
  flushAssistantRender();const readingPosition=ui.feed.scrollTop,wasFollowing=followOutput,gesture=feedGesture;
  if(Array.isArray(event.timeline)||Array.isArray(event.messages)){
    if(liveThinking){stopThinking(liveThinking);liveThinking=null;}
    resetActivity();clearVisuals();toolRuns.clear();ui.feed.replaceChildren();streamingAssistant=null;replaying=true;replayEpoch=epoch;ui.feed.dataset.replaying='true';ui.feed.setAttribute('aria-busy','true');updateSend();
    try{const restored=await replayWorkbenchTimeline(event.timeline||event.messages.map(message=>({type:'message_end',message})),item=>renderEvent(item),()=>epoch===connectionEpoch,()=>new Promise(resolve=>requestAnimationFrame(resolve)));if(!restored)return;}finally{if(replayEpoch===epoch){replaying=false;ui.feed.dataset.replaying='false';}}
    if(epoch!==connectionEpoch)return;
    for(const node of ui.feed.children)node.classList.add('restored');
    for(const run of toolRuns.values()){run.state.textContent='Awaiting result';run.row.dataset.state='pending';}
    $('history-notice').textContent='Local session · Your work, in order.';
  }else $('history-notice').textContent='Live view · This session does not expose earlier messages.';
  for(const card of ui.feed.querySelectorAll('.permission'))card.remove();
  for(const permission of event.permissions||[])showPermission(permission);
  if(event.subagents)applySubagents(event.subagents);
  setBusy(Boolean(event.streaming));if(event.streaming)ensureThinkingRow();ui.welcome.hidden=ui.feed.children.length>0;const userMoved=feedGesture!==gesture,position=userMoved?ui.feed.scrollTop:readingPosition;followOutput=userMoved?followOutput:wasFollowing;ui.feed.scrollTop=followOutput?ui.feed.scrollHeight:position;$('jump-latest').hidden=followOutput;void refreshTracker(sessionId);return;
}
function renderEvent(event){if(!event||typeof event!=='object')return;
if(event.type==='server_connected')return restoreWorkbenchConnection(event);
if(event.type==='session_deleted'){setConnection(false);setError('This conversation was deleted. Choose another conversation or start a new one.');return;}
if(event.type==='command_result'){renderCommandResult(event);return;}
if(event.type==='queue_update'){renderFollowUps(event.followUp||[]);return;}
if(event.type==='subagents'){applySubagents(event.runs||[]);return;}
if(event.type==='permission_resolved'){settlePermission(event.permissionId,event.allow);return;}
if(event.type==='goal_plan'){trackerEpoch++;renderTracker(event.status);return;}
if(event.type==='session_controls'){applySessionControls({...event.controls,supported:true,writable:true});return;}if(event.type==='message_update'&&event.message&&event.message.role==='assistant'){if(thinkingOf(event.message.content)){setThinkingLabel('Reasoning');setReasoningText(liveThinking,thinkingOf(event.message.content));}const text=textOf(event.message.content);if(text)queueAssistantRender(ensureAssistant(),text);return}if(event.type==='message_end'&&event.message){const role=event.message.role;if(role==='user')restoreComponentAnswer(event.message.content);if(role==='custom'){const kind=String(event.message.customType||'');if(kind.startsWith('subagent')){renderCollaborationMessage(event.message);noteSubagent(event.message);return}return}if(role==='assistant'&&!textOf(event.message.content)&&!streamingAssistant){finalizeThinking(thinkingOf(event.message.content));return;}if(role==='user'||role==='assistant'){if(role==='assistant'){flushAssistantRender();const node=streamingAssistant||ensureAssistant();finalizeThinking(thinkingOf(event.message.content),(liveThinking&&(Date.now()-liveThinking.startedAt)/1000)||undefined,node);renderRichText(node.lastChild,textOf(event.message.content));streamingAssistant=null}else{renderMessagePhotos(appendMessage(role,componentUserText(event.message.content)),event.message.content);if(streaming&&!replaying)ensureThinkingRow()}if(role==='user'&&!sessionNames.has(sessionId)){sessionNames.set(sessionId,componentUserText(event.message.content).slice(0,64));ui.title.textContent=sessionNames.get(sessionId);void refreshSessions(false)}}else if(role==='tool'){appendMessage('tool','Tool finished: '+(event.message.toolName||'unknown'))}return}if(event.type==='tool_execution_update'){showToolUpdate(event);return;}if(event.type==='tool_execution_start'){showToolStart(event);return;}if(event.type==='tool_execution_end'){showToolEnd(event);if(event.toolName==='plan'&&event.result&&event.result.details&&'plan' in event.result.details)renderPlan(event.result.details.plan);if(['visualize_3d','visualize'].includes(event.toolName)&&!event.isError)renderVisual(event.result&&event.result.details&&event.result.details.visualization,event.toolCallId);return;}if(event.type==='agent_start'){setBusy(true);if(ui.feed.lastChild&&ui.feed.lastChild.className==='message user')ensureThinkingRow()}if(event.type==='tool_execution_end'&&liveThinking)setThinkingLabel('Reasoning');if(event.type==='agent_end'&&event.willRetry){appendMessage('tool','Retrying the agent turn');return;}if(event.type==='agent_end'||event.type==='agent_settled'){finalizeThinking(liveThinking?liveThinking.reasoningText||"":'');setBusy(false);void refreshContext(sessionId);void refreshTracker(sessionId);void refreshSessionSurfaces(sessionId)}if(event.type==='permission_request')showPermission(event)}
function settlePermission(id,allow){for(const card of ui.feed.querySelectorAll('.permission'))if(card.dataset.permissionId===String(id)){card.dataset.resolved='true';const buttons=card.querySelector('.actions');if(buttons){const result=document.createElement('span');result.className='permission-decision';result.textContent=allow?'Allowed':'Denied';buttons.replaceChildren(result)}}}
function showPermission(event){const permissionSessionId=sessionId;ui.welcome.hidden=true;const card=document.createElement('section');card.className='permission';card.dataset.permissionId=String(event.permissionId);const title=document.createElement('strong');title.textContent=String(event.title||'Approval required');const message=document.createElement('p');message.textContent=String(event.message||'');const buttons=document.createElement('div');buttons.className='actions';const deny=document.createElement('button');deny.className='deny';deny.textContent='Deny';const allow=document.createElement('button');allow.className='allow';allow.textContent='Allow';async function respond(value){allow.disabled=true;deny.disabled=true;try{await json('/session/'+encodeURIComponent(permissionSessionId)+'/permissions/'+encodeURIComponent(String(event.permissionId))+'/response',{method:'POST',body:JSON.stringify({allow:value})});settlePermission(event.permissionId,value)}catch(error){message.textContent=error.message;allow.disabled=false;deny.disabled=false}}deny.addEventListener('click',()=>respond(false));allow.addEventListener('click',()=>respond(true));buttons.append(deny,allow);card.append(title,message,buttons);ui.feed.append(card);scrollFeed()}
${ACTIVITY_DESCRIPTION_SCRIPT}
${ACTIVITY_GLYPHS_SCRIPT}
${COLLABORATION_SCRIPT}
${WORKBENCH_ACTIVITY_SCRIPT}
${ATTACHMENT_SCRIPT}
${WORKBENCH_CLIENT_SCRIPT}
${REPLAY_SCRIPT}
${FOCUS_SCRIPT}
${THINKING_SCRIPT}
${ARTIFACT_SCRIPT}
${MESSAGE_RENDERER_SCRIPT}
${SESSION_NAVIGATION_SCRIPT}
${MODE_ICON_SCRIPT}
${PROJECTS_SCRIPT}
${ORGANIZATION_SCRIPT}
${COMMAND_SCRIPT}
${CONTEXT_SETTINGS_SCRIPT}
${APPEARANCE_SCRIPT}
${VIEWPORT_SCRIPT}
if(window.location&&window.location.hash.startsWith('#token=')){const launchToken=new URLSearchParams(window.location.hash.slice(1)).get('token');window.history.replaceState(null,'',window.location.pathname+window.location.search);if(launchToken){ui.token.value=launchToken;ui.authForm.requestSubmit();}}
})();
</script>
</body>
</html>`;
