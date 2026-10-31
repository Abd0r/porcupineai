/** Present useful peer text separately from runtime accounting and transport metadata. */
export function describeCollaborationMessage(
	message: { customType?: string; content?: unknown; details?: unknown },
	sender?: string,
): { kind: string; title: string; body: string } | null {
	if (message.customType !== "subagent_message" && message.customType !== "subagent_report") return null;
	let body =
		typeof message.content === "string"
			? message.content
			: Array.isArray(message.content)
				? message.content
						.filter((part) => part && part.type === "text" && typeof part.text === "string")
						.map((part) => part.text)
						.join("\n\n")
				: "";
	const report = message.customType === "subagent_report";
	const header = report
		? body.match(
				/^\s*⚙️ Sub-agent ([^\n]+?) (?:✓ done|⏹ cancelled|⏹ budget exhausted|✗ failed) after \d+ step\(s\) \(~[^\n]* ctx\)\.\s*(?:\n|$)/,
			)
		: body.match(/^\s*📨 Sub-agent ([^:\n]+):\s?/);
	if (header) body = body.slice(header[0].length).trim();
	const candidate = sender || header?.[1];
	const name = candidate && /^@[a-zA-Z0-9_-]{1,24}$/.test(candidate) ? candidate : undefined;
	const details =
		message.details && typeof message.details === "object" ? (message.details as Record<string, unknown>) : {};
	return {
		kind: report ? "report" : "receiving",
		title:
			(report
				? name
					? `Report from ${name}`
					: "Worker report"
				: name
					? `Message from ${name}`
					: "Subagent message") + (report && details.ok === false ? " · needs attention" : ""),
		body: body || (report ? "No report text supplied." : "No message text supplied."),
	};
}

export const COLLABORATION_STYLES = `
.collaboration-card { margin: 0 0 var(--s4); padding: 10px 0; border-bottom: 1px solid var(--line-soft); color: var(--muted); font-size: var(--small); }
.collaboration-card > summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; }
.collaboration-card > summary::-webkit-details-marker { display: none; }
.collaboration-card > summary::after { content: '›'; margin-left: auto; color: var(--quiet); transform: rotate(0); }
.collaboration-card[open] > summary::after { transform: rotate(90deg); }
.collaboration-card > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.collaboration-body { margin: 12px 0 0 26px; line-height: 1.65; overflow-wrap: anywhere; color: var(--text); }
.collaboration-body > :first-child { margin-top: 0; }
.collaboration-body > :last-child { margin-bottom: 0; }
.collaboration-card[data-state="failed"] > summary { color: var(--danger); }
.collaboration-card[data-state="notice"] .glyph-packet { animation: glyph-send 850ms ease-out both; }
.collaboration-card[data-state="notice"] .glyph-report { stroke-dasharray: 24; animation: glyph-write 1s ease-out both; }
.restored.collaboration-card * { animation: none !important; }
`;

export const COLLABORATION_SCRIPT = `
const describeCollaborationMessage=${describeCollaborationMessage.toString()};
const collaborationCalls=new Map(),subagentNames=new Map(),collaborationTools=new Set(['subagent','send_to_subagent','send_message','check_messages','stop_subagent']);
function collaborationCard(kind,title,text,state){const row=document.createElement('details'),head=document.createElement('summary'),icon=document.createElement('span'),label=document.createElement('span'),body=document.createElement('div');row.className='collaboration-card';row.dataset.state=state;icon.className='activity-glyph';icon.setAttribute('aria-hidden','true');icon.append(activityGlyph(kind));label.textContent=title;head.append(icon,label);body.className='collaboration-body rich';renderRichText(body,text);row.open=kind!=='report'&&text.length>0&&text.length<=280;row.append(head,body);ui.welcome.hidden=true;ui.feed.append(row);scrollFeed();return{row,icon,label,body};}
function collaborationTool(event,phase){
  if(!collaborationTools.has(event.toolName))return false;
  const id=event.toolCallId||event.toolName;
  if(phase==='start'){
    const activity=describeWorkbenchActivity(event.toolName,event.args),args=event.args||{},text=typeof args.text==='string'?args.text:typeof args.task==='string'?args.task:activity.summary;
    const ref=typeof args.to==='string'?args.to:typeof args.name==='string'?'@'+args.name:'',target=subagentNames.get(ref)||(/^@[a-zA-Z0-9_-]{1,24}$/.test(ref)?ref:'');
    const card=collaborationCard(activity.kind,activity.summary+(target?' · '+target:''),text,replaying?'pending':'running');card.target=target;collaborationCalls.set(id,card);
  }else{
    const card=collaborationCalls.get(id);if(!card)return true;collaborationCalls.delete(id);
    const info=event.result&&event.result.details||{},failed=event.isError||info.isError===true||info.ok===false||info.started===false,name=event.toolName;
    card.row.dataset.state=failed?'failed':'done';
    card.label.textContent=failed?(name==='subagent'?'Could not start subagent':name==='stop_subagent'?'Could not stop subagent':'Message action failed'):(name==='subagent'?'Subagent started':name==='stop_subagent'?(info.stopped===0?'No subagents stopped':'Subagents stopped'):name==='check_messages'?'Inbox checked':'Message sent')+(card.target?' · '+card.target:'');
    if(failed)card.row.open=true;else if(name==='subagent')card.row.open=false;
  }return true;
}
function renderCollaborationMessage(message){const info=message.details||{},sender=subagentNames.get(info.from||info.id),view=describeCollaborationMessage(message,sender);if(view)collaborationCard(view.kind,view.title,view.body,replaying?'done':'notice');}
`;
