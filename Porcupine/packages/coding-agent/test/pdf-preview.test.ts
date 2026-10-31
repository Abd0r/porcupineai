import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { PDF_PREVIEW_SCRIPT } from "../src/server/pdf-preview.ts";

class Element {
	children: Element[] = [];
	style: Record<string, string> = {};
	attributes: Record<string, string> = {};
	handlers = new Map<string, (event?: { preventDefault(): void }) => void>();
	value = "";
	disabled = false;
	hidden = false;
	clientWidth = 640;
	textContent = "";
	readonly tagName: string;
	constructor(tagName: string) {
		this.tagName = tagName;
	}
	append(...nodes: Element[]) {
		this.children.push(...nodes);
	}
	replaceChildren(...nodes: Element[]) {
		this.children = nodes;
	}
	setAttribute(key: string, value: string) {
		this.attributes[key] = value;
	}
	addEventListener(key: string, handler: (event?: { preventDefault(): void }) => void) {
		this.handlers.set(key, handler);
	}
	focus() {}
}

function harness(fail = false) {
	const host = new Element("div"),
		renders: Array<{ canvas: Element; viewport: { width: number; height: number } }> = [];
	const cancel = vi.fn(),
		destroy = vi.fn(async () => {});
	const getPage = vi.fn(async (number: number) => ({
		getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
		render: (options: { canvas: Element; viewport: { width: number; height: number } }) => {
			renders.push(options);
			return { promise: Promise.resolve(), cancel };
		},
		getTextContent: async () => ({ items: [{ str: `Page ${number} readable text`, hasEOL: true }] }),
	}));
	const loading: {
		promise: Promise<{ numPages: number; getPage: typeof getPage }>;
		destroy: typeof destroy;
		onPassword?: (reply: (password: string) => void, reason: number) => void;
	} = {
		promise: fail ? Promise.reject(new Error("Invalid PDF")) : Promise.resolve({ numPages: 3, getPage }),
		destroy,
	};
	const getDocument = vi.fn(() => loading);
	const window = { devicePixelRatio: 3, createWorkbenchPdfViewer: undefined as unknown };
	runInNewContext(PDF_PREVIEW_SCRIPT, {
		window,
		document: { createElement: (tag: string) => new Element(tag) },
		pdfjs: { getDocument },
		cancelAnimationFrame() {},
		requestAnimationFrame: (callback: () => void) => {
			callback();
			return 1;
		},
	});
	const create = window.createWorkbenchPdfViewer as (
		host: Element,
		bytes: Uint8Array,
		name: string,
	) => { ready: Promise<void>; destroy(): void };
	const controller = create(host, new Uint8Array([37, 80, 68, 70]), "report.pdf");
	const toolbar = host.children[0],
		status = host.children[1],
		stage = host.children[2];
	return { host, toolbar, status, stage, controller, renders, destroy, loading, getDocument, getPage, cancel };
}

describe("local PDF preview", () => {
	it("renders pages to canvas without a native viewer, with bounded pixels and readable page text", async () => {
		const h = harness();
		await h.controller.ready;
		expect(h.renders).toHaveLength(1);
		expect(h.stage.children[0].tagName).toBe("canvas");
		expect(h.stage.children[0].attributes["aria-label"]).toBe("report.pdf · Page 1 of 3");
		expect(h.status.textContent).toBe("Page 1 of 3");
		expect(h.host.children[3].children[1].textContent).toContain("Page 1 readable text");
		expect(h.getDocument).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.any(Uint8Array),
				cMapUrl: "/workbench/pdf/cmaps/",
				standardFontDataUrl: "/workbench/pdf/standard_fonts/",
			}),
		);
		h.controller.destroy();
		expect(h.destroy).toHaveBeenCalledOnce();
	});
	it("navigates and zooms while preserving the page identity", async () => {
		const h = harness();
		await h.controller.ready;
		h.toolbar.children[3].handlers.get("click")!();
		await setImmediate();
		expect(h.status.textContent).toBe("Page 2 of 3");
		h.toolbar.children[4].value = "2";
		h.toolbar.children[4].handlers.get("change")!();
		await setImmediate();
		expect(h.renders.at(-1)?.viewport.width).toBe(1200);
		expect(h.stage.children[0].attributes["aria-label"]).toContain("Page 2");
		h.controller.destroy();
	});
	it("does not mount a late page after closing the preview", async () => {
		const h = harness();
		h.controller.destroy();
		await h.controller.ready;
		expect(h.renders).toHaveLength(0);
		expect(h.stage.children).toHaveLength(0);
	});
	it("ignores an older page request that resolves after a newer selection", async () => {
		const h = harness();
		await h.controller.ready;
		const original = await h.getPage.mock.results[0].value;
		let finish!: (page: typeof original) => void;
		h.getPage.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		h.toolbar.children[3].handlers.get("click")!();
		h.toolbar.children[3].handlers.get("click")!();
		await setImmediate();
		expect(h.status.textContent).toBe("Page 3 of 3");
		finish(original);
		await setImmediate();
		expect(h.stage.children[0].attributes["aria-label"]).toContain("Page 3");
		expect(h.renders).toHaveLength(2);
		h.controller.destroy();
	});
	it("explains invalid documents instead of leaving a blank frame", async () => {
		const h = harness(true);
		await h.controller.ready;
		expect(h.status.textContent).toContain("Invalid PDF");
		expect(h.status.textContent).toContain("download the original");
		expect(h.renders).toHaveLength(0);
		h.controller.destroy();
	});
	it("unlocks password-protected documents without retaining the password", async () => {
		const h = harness();
		await h.controller.ready;
		const reply = vi.fn(),
			form = h.host.children[4],
			password = form.children[0];
		h.loading.onPassword!(reply, 1);
		expect(form.hidden).toBe(false);
		password.value = "fixture-password";
		form.handlers.get("submit")!({ preventDefault() {} });
		expect(reply).toHaveBeenCalledWith("fixture-password");
		expect(password.value).toBe("");
		h.controller.destroy();
	});
});
