import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { WORKBENCH_ACTIVITY_SCRIPT } from "../src/server/workbench-activity.ts";
import { APPEARANCE_SCRIPT } from "../src/server/workbench-appearance.ts";

describe("default GUI appearance", () => {
	it.each([false, true])("defaults to Pixel and follows system dark = %s", (dark) => {
		const elements = new Map<
				string,
				{ value: string; checked: boolean; hidden: boolean; textContent: string; addEventListener: () => void }
			>(),
			get = (id: string) => {
				if (!elements.has(id))
					elements.set(id, { value: "", checked: false, hidden: false, textContent: "", addEventListener() {} });
				return elements.get(id)!;
			},
			attrs = new Map<string, string>();
		let systemDark = dark,
			changed = () => {};
		runInNewContext(APPEARANCE_SCRIPT, {
			$: get,
			document: {
				documentElement: { setAttribute: (key: string, value: string) => attrs.set(key, value) },
				querySelectorAll: () => [],
			},
			window: {
				localStorage: { getItem: () => null },
				matchMedia: () => ({
					get matches() {
						return systemDark;
					},
					addEventListener: (_name: string, fn: () => void) => {
						changed = fn;
					},
				}),
				dispatchEvent() {},
			},
			Event,
			applyPanelPlacements() {},
		});
		expect(attrs.get("data-theme")).toBe("pixel");
		expect(get("appearance-mode").value).toBe("system");
		expect(attrs.get("data-colour-mode")).toBe(dark ? "dark" : "light");
		systemDark = !dark;
		changed();
		expect(attrs.get("data-colour-mode")).toBe(dark ? "light" : "dark");
	});
});
describe("task overlay corner geometry", () => {
	it("restores the Tasks visibility choice and saves a later toggle", () => {
		const save = vi.fn(),
			nodes = new Map<
				string,
				{
					dataset: Record<string, string>;
					hidden: boolean;
					parentNode: null;
					parentElement: null;
					listeners: Map<string, () => void>;
					setAttribute: () => void;
					addEventListener: (name: string, fn: () => void) => void;
				}
			>();
		const get = (id: string) => {
			if (!nodes.has(id)) {
				const listeners = new Map<string, () => void>();
				nodes.set(id, {
					dataset: {},
					hidden: false,
					parentNode: null,
					parentElement: null,
					listeners,
					setAttribute() {},
					addEventListener: (name, fn) => listeners.set(name, fn),
				});
			}
			return nodes.get(id)!;
		};
		runInNewContext(WORKBENCH_ACTIVITY_SCRIPT, {
			$: get,
			ui: { feed: { parentElement: { append() {} } } },
			document: { querySelector: () => null },
			window: {
				localStorage: {
					getItem: (key: string) => (key === "porcupine.workbench.tasks-open" ? "false" : null),
					setItem: save,
				},
				matchMedia: () => ({ matches: false, addEventListener() {} }),
				addEventListener() {},
			},
		});
		expect(get("work-rail").dataset.open).toBe("false");
		expect(get("work-rail-overlay").dataset.open).toBe("false");
		get("rail-toggle").listeners.get("click")!();
		expect(save).toHaveBeenCalledWith("porcupine.workbench.tasks-open", "true");
	});
	it.each([700, 270])("anchors to the outer conversation corner and stops above composer at %s", (composerTop) => {
		const main = { getBoundingClientRect: () => ({ top: 100 }) },
			feedStage = {
				append(node: { parentElement: unknown }) {
					node.parentElement = feedStage;
				},
			},
			style = { top: "", setProperty: vi.fn() },
			nodes = new Map<
				string,
				{
					dataset: Record<string, string>;
					parentElement: unknown;
					hidden: boolean;
					style: typeof style;
					addEventListener: () => void;
				}
			>();
		const get = (id: string) => {
			if (!nodes.has(id))
				nodes.set(id, { dataset: {}, parentElement: main, hidden: false, style, addEventListener() {} });
			return nodes.get(id)!;
		};
		runInNewContext(`${WORKBENCH_ACTIVITY_SCRIPT}\npositionTaskOverlay();`, {
			$: get,
			ui: { feed: { parentElement: feedStage }, form: { getBoundingClientRect: () => ({ top: composerTop }) } },
			document: { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 158 }) }) },
			window: {
				matchMedia: () => ({ matches: false, addEventListener() {} }),
				localStorage: { getItem: () => null },
				addEventListener() {},
			},
		});
		expect(get("work-rail-overlay").parentElement).toBe(main);
		expect(style.top).toBe("66px");
		expect(style.setProperty).toHaveBeenCalledWith("--overlay-available-height", `${composerTop - 174}px`);
	});
});
