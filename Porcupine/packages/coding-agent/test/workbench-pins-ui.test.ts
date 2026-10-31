import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { ORGANIZATION_SCRIPT } from "../src/server/workbench-organization-ui.ts";

class Element {
	children: Element[] = [];
	dataset: Record<string, string> = {};
	attrs: Record<string, string> = {};
	textContent = "";
	className = "";
	value = "";
	disabled = false;
	hidden = false;
	parentNode?: Element;
	focus = vi.fn();
	listeners = new Map<string, (event?: unknown) => unknown>();
	append(...nodes: Element[]) {
		for (const node of nodes) {
			node.parentNode = this;
			this.children.push(node);
		}
	}
	replaceChildren(...nodes: Element[]) {
		this.children = [];
		this.append(...nodes);
	}
	setAttribute(name: string, value: string) {
		this.attrs[name] = value;
	}
	addEventListener(event: string, fn: (event?: unknown) => unknown) {
		this.listeners.set(event, fn);
	}
	querySelectorAll(selector: string): Element[] {
		return this.children.flatMap((node) => [
			...(node.className.split(" ").includes(selector.slice(1)) ? [node] : []),
			...node.querySelectorAll(selector),
		]);
	}
	showModal() {}
	close() {}
}
describe("pinned conversation navigation", () => {
	it("shows pinned chats once, preserves project metadata and exposes pin/unpin without row clutter", async () => {
		const nodes = new Map<string, Element>(),
			get = (id: string) => {
				if (!nodes.has(id)) nodes.set(id, new Element());
				return nodes.get(id)!;
			},
			sessions = get("sessions"),
			project = new Element(),
			json = vi.fn(async () => ({}));
		const context = {
			document: {
				createElement: () => new Element(),
				querySelectorAll: () => sessions.querySelectorAll(".session"),
			},
			$: get,
			ui: { sessions },
			sessionId: "a",
			sessionNames: new Map([
				["a", "Research"],
				["b", "Other"],
			]),
			filterSessions() {},
			json,
			refreshSessions: async () => {},
			window: { matchMedia: () => ({ matches: false }) },
		};
		const actions = runInNewContext(
			`${ORGANIZATION_SCRIPT}\ncanPinSessions=true;sessionCatalog=[{id:'a',name:'Research',pinned:true,project:'science'},{id:'b',name:'Other'}];projectSessionHosts.set('science',project);renderSessionNavigation();({open:openConversationMenu,render:renderSessionNavigation,unpin:()=>sessionCatalog[0].pinned=false})`,
			{ ...context, project },
		) as { open: (id: string) => void; render: () => void; unpin: () => void };
		expect(sessions.children[0].className).toBe("pinned-sessions");
		expect(sessions.querySelectorAll(".session")).toHaveLength(2);
		expect(project.querySelectorAll(".session")).toHaveLength(0);
		expect(project.children[0].textContent).toBe("Conversations shown in Pinned");
		actions.open("a");
		expect(get("conversation-pin").textContent).toBe("Unpin conversation");
		await get("conversation-pin").listeners.get("click")!();
		expect(json).toHaveBeenCalledWith("/session/a/pin", { method: "PUT", body: '{"pinned":false}' });
		actions.unpin();
		actions.render();
		expect(sessions.querySelectorAll(".session")).toHaveLength(1);
		expect(project.querySelectorAll(".session")).toHaveLength(1);
		expect(project.querySelectorAll(".session")[0].textContent).toBe("Research");
		actions.open("a");
		expect(get("conversation-pin").textContent).toBe("Pin conversation");
	});
});
