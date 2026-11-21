import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CONTEXT_SETTINGS_SCRIPT } from "../src/server/workbench-settings.ts";

class Element {
	value = "";
	textContent = "";
	hidden = false;
	disabled = false;
	readOnly = false;
	readonly children: Element[] = [];
	readonly handlers = new Map<string, () => void | Promise<void>>();
	append(...children: Element[]) {
		this.children.push(...children);
	}
	replaceChildren(...children: Element[]) {
		this.children.splice(0, this.children.length, ...children);
	}
	setAttribute() {}
	focus() {}
	addEventListener(type: string, handler: () => void | Promise<void>) {
		this.handlers.set(type, handler);
	}
}
type Editor = Record<"select" | "area" | "edit" | "save" | "cancel" | "reload" | "error" | "path", Element>;
function harness(request: (path: string, options?: { method?: string; body?: string }) => Promise<unknown>) {
	const elements = new Map<string, Element>();
	const context = {
		json: request,
		document: { createElement: () => new Element() },
		$: (id: string) => {
			if (!elements.has(id)) elements.set(id, new Element());
			return elements.get(id);
		},
		appearanceError() {},
	};
	runInNewContext(CONTEXT_SETTINGS_SCRIPT, context);
	return {
		start: () => runInNewContext("loadWorkbenchSettings()", context) as Promise<void>,
		editor: () => runInNewContext("contextEditor", context) as Editor,
	};
}
const doc = (id: string) => ({
	id,
	path: id,
	content: `Contents of ${id}`,
	revision: "v1",
	effect: "Future turns.",
	charLimit: 1000,
	exists: true,
});
describe("context editor ownership", () => {
	it("preserves edits typed while the submitted version is saving", async () => {
		let finish!: (value: unknown) => void;
		const h = harness(async (path, options) => {
			if (path === "/workbench") return { contextFiles: true };
			if (path === "/workbench/context") return { files: [] };
			if (options?.method === "PUT")
				return new Promise((resolve) => {
					finish = resolve;
				});
			return doc("a");
		});
		await h.start();
		const e = h.editor();
		e.select.value = "a";
		e.select.handlers.get("change")!();
		await setImmediate();
		e.edit.handlers.get("click")!();
		e.area.value = "Submitted version";
		const saving = e.save.handlers.get("click")!();
		e.area.value = "New unsaved edits";
		finish({ ...doc("a"), content: "Submitted version", revision: "v2" });
		await saving;
		expect(e.area.value).toBe("New unsaved edits");
		expect(e.area.readOnly).toBe(false);
	});
	it("keeps the selected document when an older save finishes after cancellation", async () => {
		let finish!: (value: unknown) => void;
		const h = harness(async (path, options) => {
			if (path === "/workbench") return { contextFiles: true };
			if (path === "/workbench/context") return { files: [] };
			if (options?.method === "PUT")
				return new Promise((resolve) => {
					finish = resolve;
				});
			return doc(path.split("/").pop()!);
		});
		await h.start();
		const e = h.editor();
		e.select.value = "a";
		e.select.handlers.get("change")!();
		await setImmediate();
		e.edit.handlers.get("click")!();
		e.area.value = "Saved A";
		const saving = e.save.handlers.get("click")!();
		e.cancel.handlers.get("click")!();
		e.select.value = "b";
		e.select.handlers.get("change")!();
		await setImmediate();
		finish({ ...doc("a"), content: "Saved A", revision: "v2" });
		await saving;
		expect(e.select.value).toBe("b");
		expect(e.path.textContent).toBe("b");
		expect(e.area.value).toBe("Contents of b");
	});
	it("ignores an older load error after another document has loaded", async () => {
		let fail!: (error: Error) => void;
		const h = harness(async (path) => {
			if (path === "/workbench") return { contextFiles: true };
			if (path === "/workbench/context") return { files: [] };
			if (path.endsWith("/a"))
				return new Promise((_resolve, reject) => {
					fail = reject;
				});
			return doc("b");
		});
		await h.start();
		const e = h.editor();
		e.select.value = "a";
		e.select.handlers.get("change")!();
		e.select.value = "b";
		e.select.handlers.get("change")!();
		await setImmediate();
		fail(new Error("Old A failed"));
		await setImmediate();
		expect(e.area.value).toBe("Contents of b");
		expect(e.error.hidden).toBe(true);
	});
});
