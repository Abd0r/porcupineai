import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { WORKBENCH_ACTIVITY_SCRIPT } from "../src/server/workbench-activity.ts";
import { moveWorkbenchListFocus } from "../src/server/workbench-focus.ts";

describe("model list keyboard focus", () => {
	it("uses arrows and Home/End without activating or selecting a model", () => {
		const items = Array.from({ length: 3 }, () => ({ tabIndex: -1, focus: vi.fn() }));
		expect(moveWorkbenchListFocus(items, items[0], "ArrowDown")).toBe(true);
		expect(items[1].focus).toHaveBeenCalledOnce();
		expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
		moveWorkbenchListFocus(items, items[1], "End");
		expect(items[2].focus).toHaveBeenCalledOnce();
		moveWorkbenchListFocus(items, items[2], "Home");
		expect(items[0].focus).toHaveBeenCalledOnce();
		moveWorkbenchListFocus(items, items[0], "ArrowUp");
		expect(items[2].focus).toHaveBeenCalledTimes(2);
		expect(moveWorkbenchListFocus(items, items[0], "Enter")).toBe(false);
	});
});

describe("task overlay keyboard dismissal", () => {
	it.each([false, "native", "sidebar"])(
		"respects an open modal = %s and restores Tasks focus when dismissing",
		(modal) => {
			const keys = new Map<string, (event: { key: string; preventDefault: () => void }) => void>();
			const nodes = new Map<
				string,
				{
					dataset: Record<string, string>;
					hidden: boolean;
					parentNode: unknown;
					focus: ReturnType<typeof vi.fn>;
					setAttribute: ReturnType<typeof vi.fn>;
					addEventListener: () => void;
				}
			>();
			const get = (id: string) => {
				if (!nodes.has(id))
					nodes.set(id, {
						dataset: {},
						hidden: false,
						parentNode: null,
						focus: vi.fn(),
						setAttribute: vi.fn(),
						addEventListener() {},
					});
				return nodes.get(id)!;
			};
			runInNewContext(WORKBENCH_ACTIVITY_SCRIPT, {
				$: get,
				ui: { feed: { parentElement: { append() {} } } },
				window: {
					matchMedia: () => ({ matches: true, addEventListener() {} }),
					localStorage: { getItem: () => null },
					addEventListener: (type: string, fn: (event: { key: string; preventDefault: () => void }) => void) =>
						keys.set(type, fn),
				},
				document: {
					querySelector: (selector: string) =>
						modal && selector.includes(modal === "sidebar" ? "#sidebar" : "dialog") ? {} : null,
				},
			});
			const overlay = get("work-rail-overlay");
			overlay.dataset.open = "true";
			get("todos-panel").parentNode = overlay;
			get("workers-panel").parentNode = overlay;
			const preventDefault = vi.fn();
			keys.get("keydown")!({ key: "Escape", preventDefault });
			expect(overlay.dataset.open).toBe(modal ? "true" : "false");
			expect(get("rail-toggle").focus.mock.calls.length).toBe(modal ? 0 : 1);
			expect(preventDefault.mock.calls.length).toBe(modal ? 0 : 1);
		},
	);
});
