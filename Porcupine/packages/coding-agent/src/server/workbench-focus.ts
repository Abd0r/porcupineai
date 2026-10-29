interface FocusOption {
	tabIndex: number;
	focus(): void;
}

/** Native listbox navigation changes focus; selecting a model still requires activation. */
export function moveWorkbenchListFocus(items: readonly FocusOption[], active: unknown, key: string): boolean {
	if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return false;
	const current = items.indexOf(active as FocusOption);
	const index =
		key === "Home"
			? 0
			: key === "End"
				? items.length - 1
				: key === "ArrowDown"
					? (current + 1) % items.length
					: current <= 0
						? items.length - 1
						: current - 1;
	for (const item of items) item.tabIndex = -1;
	items[index].tabIndex = 0;
	items[index].focus();
	return true;
}

export const FOCUS_SCRIPT = `const moveWorkbenchListFocus=${moveWorkbenchListFocus.toString()};`;
