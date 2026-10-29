/** Yield between history batches without reordering live events or completing a stale restore. */
export async function replayWorkbenchTimeline<T>(
	items: readonly T[],
	apply: (item: T) => void,
	isCurrent: () => boolean,
	yieldFrame: () => Promise<void>,
): Promise<boolean> {
	for (let index = 0; index < items.length; index++) {
		if (!isCurrent()) return false;
		apply(items[index]);
		if ((index + 1) % 40 === 0 && index + 1 < items.length) await yieldFrame();
	}
	return isCurrent();
}

export const REPLAY_SCRIPT = `const replayWorkbenchTimeline=${replayWorkbenchTimeline.toString()};`;
