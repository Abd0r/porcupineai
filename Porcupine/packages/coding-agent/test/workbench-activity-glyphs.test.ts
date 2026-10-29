import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { describeWorkbenchActivity } from "../src/server/workbench-activity-description.ts";
import { ACTIVITY_GLYPHS_SCRIPT } from "../src/server/workbench-glyphs.ts";
import { THINKING_SCRIPT } from "../src/server/workbench-thinking.ts";

class ThinkingNode {
	textContent = "";
	children: ThinkingNode[] = [];
	dataset: Record<string, string> = {};
	attributes: Record<string, string> = {};
	classes = new Set<string>();
	classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) };
	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	append(...nodes: ThinkingNode[]) {
		this.children.push(...nodes);
	}
	replaceChildren(...nodes: ThinkingNode[]) {
		this.children = nodes;
	}
	addEventListener() {}
}

describe("workbench activity identity", () => {
	it.each([
		["read", { path: "skills/review/SKILL.md" }, "skill", "Reading a skill"],
		["write", { path: "src/main.ts" }, "coding", "Writing main.ts"],
		["edit", { path: "src/main.py" }, "coding", "Editing main.py"],
		["read", { path: "notes.md" }, "reading", "Reading notes.md"],
		["write", { path: "notes.md" }, "writing", "Writing notes.md"],
		["web_search", { query: "SVG animation" }, "web", "Searching SVG animation"],
		["capability_search", { query: "review" }, "searching", "Finding tools and skills"],
		["subagent", {}, "spawn", "Starting a subagent"],
		["send_to_subagent", { to: "@reader", text: "private peer text" }, "sending", "Sending a message"],
		["send_message", {}, "sending", "Sending a message"],
		["check_messages", {}, "receiving", "Checking messages"],
		["stop_subagent", {}, "stopping", "Stopping subagents"],
		["plan", {}, "planning", "Updating the plan"],
		["custom_tool", { secret: "do not expose" }, "tool", "Using a tool"],
	])("gives %s a recognisable activity without raw arguments", (tool, args, kind, summary) => {
		expect(describeWorkbenchActivity(tool as string, args)).toEqual({ kind, summary });
	});
	it("renders distinct SVG scenes and uses reasoning for an unknown worker state", () => {
		const context = {
			MATH_NS: "http://www.w3.org/2000/svg",
			document: {
				createElementNS: (_ns: string, tag: string) => ({
					tag,
					dataset: {} as Record<string, string>,
					attributes: {} as Record<string, string>,
					children: [] as unknown[],
					setAttribute(name: string, value: string) {
						this.attributes[name] = value;
					},
					append(node: unknown) {
						this.children.push(node);
					},
				}),
			},
		};
		const scenes = runInNewContext(
			`${ACTIVITY_GLYPHS_SCRIPT}\n['reasoning','coding','skill','reading','writing','editing','web','terminal','delegation','planning','searching','tool','spawn','sending','receiving','report','stopping'].map(kind=>activityGlyph(kind))`,
			context,
		);
		expect(new Set(scenes.map((scene: unknown) => JSON.stringify(scene))).size).toBe(17);
		expect(runInNewContext("activityGlyph('dreaming').dataset.kind", context)).toBe("reasoning");
	});
	it("keeps the same neutron star through reasoning updates and stops live motion when finished", () => {
		const result = runInNewContext(
			`${THINKING_SCRIPT}\n${ACTIVITY_GLYPHS_SCRIPT}\nconst row=createThinkingRow();startThinking(row);const star=row.glyph.children[0];setReasoningText(row,'Inspect');setReasoningText(row,'Inspect and verify');const live=row.wrap.classes.has('thinking-live');stopThinking(row,3);({live,stopped:!row.wrap.classes.has('thinking-live'),same:star===row.glyph.children[0],kind:star.dataset.kind,label:row.label.textContent,paths:star.children.map(path=>path.attributes.class)})`,
			{
				document: { createElement: () => new ThinkingNode(), createElementNS: () => new ThinkingNode() },
				appearancePreferences: { showReasoning: false },
				renderRichText: (node: ThinkingNode, text: string) => {
					node.textContent = text;
				},
				scrollFeed() {},
			},
		);
		expect(result).toEqual({
			live: true,
			stopped: true,
			same: true,
			kind: "reasoning",
			label: "Thought for 3 seconds",
			paths: ["glyph-halo", "glyph-beam", "glyph-star"],
		});
	});
});
