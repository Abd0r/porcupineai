import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";
import { PROJECT_NOTES_SCRIPT } from "../src/server/workbench-project-notes-ui.ts";

class Element {
	value = "";
	textContent = "";
	hidden = false;
	open = false;
	disabled = false;
	children: Element[] = [];
	style = {};
	dataset = {};
	listeners = new Map<string, () => void>();
	following: Element | undefined;
	after(element: Element) {
		this.following = element;
	}
	focus() {}
	replaceChildren(...children: Element[]) {
		this.children = children;
	}
	append(...children: Element[]) {
		this.children.push(...children);
	}
	showModal() {
		this.open = true;
	}
	close() {
		this.open = false;
	}
	addEventListener(event: string, listener: () => void) {
		this.listeners.set(event, listener);
	}
}

it("shows the saved version after a conflict and retries only after explicit review, keeping the draft", async () => {
	const elements = new Map<string, Element>();
	const get = (id: string) => {
		let element = elements.get(id);
		if (!element) {
			element = new Element();
			elements.set(id, element);
		}
		return element;
	};
	const opened = { id: "note", title: "Plan", text: "Earlier text", color: "amber", revision: "old" };
	const latest = { ...opened, text: "New saved text", revision: "current" };
	const requests: unknown[] = [];
	const context = createContext({
		$: get,
		document: { createElement: () => new Element() },
		activeProject: "demo",
		openProject() {},
		renderRichText() {},
		setInterval() {},
		opened,
		async json(_path: string, options?: { body: string }) {
			if (!options) return { notes: [latest] };
			const body = JSON.parse(options.body);
			requests.push(body);
			if (body.revision !== latest.revision) throw new Error("This note changed");
			return latest;
		},
	});
	runInContext(PROJECT_NOTES_SCRIPT, context);
	runInContext("openProjectNote(opened,'demo'); noteUi.text.value='My unsaved draft';", context);
	await runInContext("persistProjectNote(false)", context);
	const draft = get("project-note-text"),
		save = get("project-note-save");
	const conflict = get("project-note-status").following;
	expect(draft.value).toBe("My unsaved draft");
	expect(save.disabled).toBe(true);
	expect(conflict?.children[1]?.textContent).toBe("New saved text");
	await runInContext("persistProjectNote(false)", context);
	expect(requests).toHaveLength(1);
	conflict?.children[2]?.listeners.get("click")?.();
	expect(save.disabled).toBe(false);
	await runInContext("persistProjectNote(false)", context);
	expect(requests[1]).toMatchObject({ revision: "current", text: "My unsaved draft" });
});
