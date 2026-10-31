import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { ACTIVITY_DESCRIPTION_SCRIPT } from "../src/server/workbench-activity-description.ts";
import { COLLABORATION_SCRIPT, describeCollaborationMessage } from "../src/server/workbench-collaboration.ts";

class CardNode {
	children: CardNode[] = [];
	dataset: Record<string, string> = {};
	textContent = "";
	open = false;
	append(...children: CardNode[]) {
		this.children.push(...children);
	}
	setAttribute() {}
}

describe("readable collaboration messages", () => {
	it("shows the report itself without its execution header", () => {
		expect(
			describeCollaborationMessage({
				customType: "subagent_report",
				content: [
					{
						type: "text",
						text: "⚙️ Sub-agent @tinker ✓ done after 16 step(s) (~11,994 ctx).\n\nVerified the fix.\n\nSee `main.ts`.",
					},
				],
				details: { id: "internal-run", ok: true },
			}),
		).toEqual({ kind: "report", title: "Report from @tinker", body: "Verified the fix.\n\nSee `main.ts`." });
	});
	it("shows incoming text with a resolved sender and preserves Markdown/math", () => {
		expect(
			describeCollaborationMessage(
				{
					customType: "subagent_message",
					content: "📨 Sub-agent sa-123: Check $v=2t$.",
					details: { from: "sa-123" },
				},
				"@reader",
			),
		).toEqual({ kind: "receiving", title: "Message from @reader", body: "Check $v=2t$." });
	});
	it("does not mislabel a failed report as completion or expose internal ids", () => {
		expect(
			describeCollaborationMessage({
				customType: "subagent_report",
				content: "Could not verify the result.",
				details: { id: "sa-internal", ok: false },
			}),
		).toEqual({ kind: "report", title: "Worker report · needs attention", body: "Could not verify the result." });
	});
	it("ignores unrelated custom events", () => {
		expect(describeCollaborationMessage({ customType: "project_context", content: "Private context" })).toBeNull();
	});
	it("keeps reports collapsed, short incoming messages readable and sent messages in one settled row", () => {
		const feed = new CardNode();
		runInNewContext(
			`${ACTIVITY_DESCRIPTION_SCRIPT}\n${COLLABORATION_SCRIPT}\nrenderCollaborationMessage({customType:'subagent_report',content:'Verified the fix.'});renderCollaborationMessage({customType:'subagent_message',content:'Ready to review.'});collaborationTool({toolName:'send_to_subagent',toolCallId:'send',args:{to:'@reader',text:'Check the units.'}},'start');collaborationTool({toolName:'send_to_subagent',toolCallId:'send',result:{details:{ok:false}}},'end');`,
			{
				document: { createElement: () => new CardNode() },
				ui: { feed, welcome: { hidden: false } },
				replaying: false,
				activityGlyph: () => new CardNode(),
				renderRichText: (node: CardNode, text: string) => {
					node.textContent = text;
				},
				scrollFeed() {},
			},
		);
		expect(feed.children).toHaveLength(3);
		expect(feed.children.map((node) => node.open)).toEqual([false, true, true]);
		expect(feed.children[2].dataset.state).toBe("failed");
		expect(feed.children[2].children[0].children[1].textContent).toBe("Message action failed");
		expect(feed.children[2].children[1].textContent).toBe("Check the units.");
	});
});
