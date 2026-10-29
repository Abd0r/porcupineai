import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { PORCUPINE_WEB_UI } from "../src/server/web-ui.ts";
import { WORKBENCH_CLIENT_SCRIPT } from "../src/server/workbench-client.ts";
import { replayWorkbenchTimeline } from "../src/server/workbench-replay.ts";

function restoreHarness(following = false) {
	const start = PORCUPINE_WEB_UI.indexOf("async function restoreWorkbenchConnection(event){"),
		end = PORCUPINE_WEB_UI.indexOf("function renderEvent(event){", start);
	const frames: Array<() => void> = [],
		seen: number[] = [];
	const feed = {
		children: [] as { classList: { add: () => void } }[],
		dataset: {} as Record<string, string>,
		scrollTop: 55,
		scrollHeight: 2000,
		replaceChildren() {
			this.children = [];
		},
		querySelectorAll: () => [],
		setAttribute: vi.fn(),
	};
	const elements = new Map<string, { textContent: string; hidden: boolean }>();
	const context = {
		connectionEpoch: 1,
		replayEpoch: 0,
		replaying: false,
		canQueueFollowUps: false,
		feedGesture: 0,
		followOutput: following,
		sessionId: "session",
		liveThinking: null,
		streamingAssistant: null,
		ui: { feed, welcome: { hidden: false } },
		toolRuns: new Map(),
		replayWorkbenchTimeline,
		$: (id: string) => {
			if (!elements.has(id)) elements.set(id, { textContent: "", hidden: false });
			return elements.get(id);
		},
		renderFollowUps() {},
		flushAssistantRender() {},
		resetActivity() {},
		clearVisuals() {},
		updateSend() {},
		showPermission() {},
		applySubagents: vi.fn(),
		setBusy: vi.fn(),
		ensureThinkingRow() {},
		refreshTracker() {},
		requestAnimationFrame: (fn: () => void) => {
			frames.push(fn);
		},
		renderEvent: (item: number) => {
			seen.push(item);
			feed.children.push({ classList: { add() {} } });
		},
	};
	const promise: Promise<void> = runInNewContext(
		`${PORCUPINE_WEB_UI.slice(start, end)}\nrestoreWorkbenchConnection({timeline:Array.from({length:120},(_,i)=>i),subagents:[],streaming:false})`,
		context,
	);
	return {
		context,
		frames,
		seen,
		promise,
		async flush() {
			while (frames.length) {
				frames.shift()!();
				await setImmediate();
			}
			await promise;
		},
	};
}

describe("history restoration state", () => {
	it("retains a reader's position and settles only after the whole transcript", async () => {
		const h = restoreHarness();
		expect(h.seen).toHaveLength(40);
		expect(h.context.setBusy).not.toHaveBeenCalled();
		await h.flush();
		expect(h.seen).toHaveLength(120);
		expect(h.context.ui.feed.scrollTop).toBe(55);
		expect(h.context.replaying).toBe(false);
		expect(h.context.setBusy).toHaveBeenCalledWith(false);
	});
	it("respects scrolling during a batch instead of jumping back to Latest", async () => {
		const h = restoreHarness(true);
		h.context.feedGesture++;
		h.context.ui.feed.scrollTop = 120;
		h.context.followOutput = false;
		await h.flush();
		expect(h.context.ui.feed.scrollTop).toBe(120);
	});
	it("does not clear another connection's replay flag or apply stale workers", async () => {
		const h = restoreHarness();
		h.context.connectionEpoch = 2;
		h.context.replayEpoch = 2;
		h.context.replaying = true;
		await h.flush();
		expect(h.seen).toHaveLength(40);
		expect(h.context.replaying).toBe(true);
		expect(h.context.applySubagents).not.toHaveBeenCalled();
		expect(h.context.setBusy).not.toHaveBeenCalled();
	});
	it("awaits restored history before delivering the next live event from the same stream chunk", async () => {
		const start = WORKBENCH_CLIENT_SCRIPT.indexOf("async function connectEvents(id){"),
			end = WORKBENCH_CLIENT_SCRIPT.indexOf("const toolRuns=new Map();", start);
		let release = () => {};
		const pause = new Promise<void>((resolve) => {
			release = resolve;
		});
		const seen: string[] = [];
		const read = vi
			.fn()
			.mockResolvedValueOnce({
				done: false,
				value: new TextEncoder().encode('data: {"type":"server_connected"}\n\ndata: {"type":"agent_start"}\n\n'),
			})
			.mockResolvedValue({ done: true });
		const context = {
			connectionEpoch: 0,
			streamController: null,
			sessionId: "session",
			liveThinking: null,
			ui: { status: { textContent: "" } },
			AbortController,
			TextDecoder,
			json: async () => ({}),
			refreshSessionSurfaces() {},
			refreshContext() {},
			refreshCommands() {},
			api: async () => ({ ok: true, body: { getReader: () => ({ read }) } }),
			setConnection() {},
			setError() {},
			renderEvent: async (event: { type: string }) => {
				seen.push(event.type);
				if (event.type === "server_connected") await pause;
			},
		};
		const done: Promise<void> = runInNewContext(
			`${WORKBENCH_CLIENT_SCRIPT.slice(start, end)}\nconnectEvents('session')`,
			context,
		);
		await setImmediate();
		expect(seen).toEqual(["server_connected"]);
		release();
		await done;
		expect(seen).toEqual(["server_connected", "agent_start"]);
	});
});
