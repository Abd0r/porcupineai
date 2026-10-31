import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { APPEARANCE_SCRIPT } from "../src/server/workbench-appearance.ts";
import { VIEWPORT_SCRIPT } from "../src/server/workbench-viewport.ts";

describe("visible workbench viewport", () => {
	it.each([false, true])("contains drawer keyboard focus unless a modal is open = %s", (modal) => {
		const first = { focus: vi.fn(), getClientRects: () => [{}] },
			last = { focus: vi.fn(), getClientRects: () => [{}] },
			listeners = new Map<string, (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => void>();
		const document = {
			activeElement: last,
			documentElement: { style: { setProperty() {} } },
			querySelector: () => (modal ? {} : null),
		};
		runInNewContext(VIEWPORT_SCRIPT, {
			innerHeight: 844,
			document,
			window: {
				addEventListener: (
					name: string,
					fn: (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => void,
				) => listeners.set(name, fn),
				matchMedia: () => ({ matches: true }),
			},
			resizeComposer() {},
			shell: { dataset: { sidebar: "open" } },
			sidebarToggle: last,
			$: () => ({ querySelectorAll: () => [first] }),
		});
		const preventDefault = vi.fn();
		listeners.get("keydown")!({ key: "Tab", shiftKey: false, preventDefault });
		expect(first.focus.mock.calls.length).toBe(modal ? 0 : 1);
		document.activeElement = first;
		listeners.get("keydown")!({ key: "Tab", shiftKey: true, preventDefault });
		expect(last.focus.mock.calls.length).toBe(modal ? 0 : 1);
	});
	it("fits a keyboard-reduced visual viewport and restores the layout height", () => {
		const height = vi.fn(),
			resizeComposer = vi.fn(),
			listeners = new Map<string, () => void>();
		const viewport = { height: 420, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) };
		runInNewContext(VIEWPORT_SCRIPT, {
			innerHeight: 844,
			document: { documentElement: { style: { setProperty: height } } },
			window: { visualViewport: viewport, addEventListener() {} },
			resizeComposer,
		});
		expect(height).toHaveBeenLastCalledWith("--workbench-height", "420px");
		viewport.height = 844;
		listeners.get("resize")!();
		expect(height).toHaveBeenLastCalledWith("--workbench-height", "844px");
		expect(resizeComposer).toHaveBeenCalledTimes(2);
	});
	it("works without the optional VisualViewport API", () => {
		const height = vi.fn();
		runInNewContext(VIEWPORT_SCRIPT, {
			innerHeight: 640,
			document: { documentElement: { style: { setProperty: height } } },
			window: { addEventListener() {} },
			resizeComposer() {},
		});
		expect(height).toHaveBeenCalledWith("--workbench-height", "640px");
	});
});

describe("motion preference", () => {
	it.each([false, true])("restores reduce motion = %s without discarding older appearance choices", (reduceMotion) => {
		const elements = new Map<
			string,
			{
				value: string;
				checked: boolean;
				hidden: boolean;
				textContent: string;
				listeners: Map<string, () => void>;
				addEventListener: (name: string, fn: () => void) => void;
			}
		>();
		const get = (id: string) => {
			if (!elements.has(id)) {
				const listeners = new Map<string, () => void>();
				elements.set(id, {
					value: "",
					checked: false,
					hidden: false,
					textContent: "",
					listeners,
					addEventListener: (name, fn) => listeners.set(name, fn),
				});
			}
			return elements.get(id)!;
		};
		const attrs = new Map<string, string>(),
			save = vi.fn();
		runInNewContext(APPEARANCE_SCRIPT, {
			$: get,
			document: {
				documentElement: { setAttribute: (key: string, value: string) => attrs.set(key, value) },
				querySelectorAll: () => [],
			},
			window: {
				localStorage: {
					getItem: () =>
						JSON.stringify({
							theme: "tokyo-night",
							mode: "light",
							todosPlacement: "overlay",
							workersPlacement: "hidden",
							...(reduceMotion ? { reduceMotion: true } : {}),
						}),
					setItem: save,
				},
				matchMedia: () => ({ matches: false, addEventListener() {} }),
				dispatchEvent() {},
			},
			Event,
			applyPanelPlacements() {},
			ui: { feed: { querySelectorAll: () => [] } },
		});
		expect(attrs.get("data-theme")).toBe("tokyo-night");
		expect(attrs.get("data-reduced-motion")).toBe(String(reduceMotion));
		expect(get("appearance-todos-placement").value).toBe("overlay");
		get("appearance-motion").checked = !reduceMotion;
		get("appearance-motion").listeners.get("change")!();
		expect(JSON.parse(save.mock.calls[0][1]).reduceMotion).toBe(!reduceMotion);
	});
});
