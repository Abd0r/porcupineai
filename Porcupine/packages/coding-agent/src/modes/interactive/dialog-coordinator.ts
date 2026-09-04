/**
 * Owns the lifetime of one logical TUI dialog race.
 *
 * Interactive mode creates one coordinator for its session. Each race gets a
 * private AbortController. The first participant to settle wins; the finally
 * block aborts every losing participant and removes the external signal hook.
 */
export interface DialogRaceOptions {
	signal?: AbortSignal;
}

export class DialogCoordinator {
	private readonly controllers = new Set<AbortController>();

	/**
	 * Run a dialog across one or more participants. The factory is called once
	 * with the race signal, so every participant observes the same cancellation.
	 */
	race<T>(
		options: DialogRaceOptions | undefined,
		factory: (signal: AbortSignal) => readonly Promise<T>[],
	): Promise<T> {
		const controller = new AbortController();
		this.controllers.add(controller);
		const externalSignal = options?.signal;
		const onExternalAbort = () => controller.abort();
		if (externalSignal) externalSignal.addEventListener("abort", onExternalAbort, { once: true });

		return (async () => {
			try {
				if (externalSignal?.aborted) controller.abort();
				const participants = factory(controller.signal);
				if (participants.length === 0) throw new Error("dialog race requires at least one participant");
				return await Promise.race(participants);
			} finally {
				controller.abort();
				if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
				this.controllers.delete(controller);
			}
		})();
	}

	/** Abort every dialog owned by this TUI, used during refresh and shutdown. */
	abortAll(): void {
		for (const controller of [...this.controllers]) controller.abort();
		this.controllers.clear();
	}

	/** Exposed for focused lifecycle tests, not for production routing. */
	get pendingCount(): number {
		return this.controllers.size;
	}
}
