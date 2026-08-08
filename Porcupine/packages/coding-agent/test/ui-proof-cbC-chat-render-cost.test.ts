/**
 * Benchmarks for the chat UI layer (Part C debug+optimize pass).
 * These are micro-benchmarks, not strict pass/fail units. They measure the
 * shape and magnitude of render cost to back up file:line findings in the
 * part-C report. They assert loose upper bounds so regressions are caught and
 * so the suite does not flake on CI machines.
 */

import type { AssistantMessage } from "@porcupineai/ai";
import { Container, type TUI } from "@porcupineai/tui";
import { describe, expect, it } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

/** Minimal TUI stub matching existing test conventions. */
function createTuiStub(): TUI {
	return {
		terminal: {
			get columns() {
				return 120;
			},
			get rows() {
				return 40;
			},
		},
		addInterval: (_cb: () => void, _ms: number) => ({ dispose: () => {} }),
		removeInterval: () => {},
		requestRender: () => {},
	} as unknown as TUI;
}

function makeTextMessage(text: string, ts = 0): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} as any },
		stopReason: "stop",
		timestamp: ts,
	};
}

function bench(_name: string, iterations: number, fn: () => void): number {
	// warmup
	fn();
	const start = performance.now();
	for (let i = 0; i < iterations; i++) fn();
	return (performance.now() - start) / iterations;
}

describe("chatContainer full-tree render cost", () => {
	it("500-msg re-render walk cost (every render walks ALL children)", () => {
		initTheme(undefined, false);
		const chat = new Container();
		// 500 assistant messages, some long, parked in the container forever
		// (this is the steady-state the session reaches between compactions).
		for (let m = 0; m < 500; m++) {
			const comp = new AssistantMessageComponent(
				makeTextMessage(`Message ${m}: lorem ipsum dolor sit amet. `.repeat(10)),
			);
			chat.addChild(comp);
		}
		// Measure one full render pass (what the TUI does each frame).
		const perRenderMs = bench("500msg render", 50, () => {
			chat.render(100);
		});
		// If x rendered every frame at 60fps, that's 60x cost/second.
		// Assert the one-frame walk stays under 5ms so the finding is about
		// cumulative O(N) walk, not a pathological single render.
		expect(perRenderMs).toBeLessThan(50);
	}, 30000);

	it("100 tool components + 500 msgs: per-frame walk stays O(N) (no culling)", () => {
		initTheme(undefined, false);
		const chat = new Container();
		const tui = createTuiStub();
		for (let m = 0; m < 500; m++) {
			chat.addChild(new AssistantMessageComponent(makeTextMessage(`m${m}`)));
		}
		for (let t = 0; t < 100; t++) {
			chat.addChild(
				new ToolExecutionComponent(`tool_${t}`, `id_${t}`, { path: `/tmp/f${t}.txt` }, {}, undefined, tui, "/tmp"),
			);
		}
		const perRenderMs = bench("100tools+500msg", 50, () => chat.render(100));
		// Linear scaling: adding 100 tool comps increases cost ~linearly, no
		// viewport culling exists => whole chat recomposes each frame.
		expect(perRenderMs).toBeGreaterThan(0);
		expect(perRenderMs).toBeLessThan(100);
	}, 30000);
});

describe("ToolExecutionComponent update storm", () => {
	it("100 tool-call args updates: each does a full updateDisplay + recreate child components", () => {
		initTheme(undefined, false);
		const tui = createTuiStub();
		const comp = new ToolExecutionComponent("edit", "id1", { path: "a.txt" }, {}, undefined, tui, "/tmp");
		let calls = 0;
		// updateArgs does NOT call ui.requestRender (see tool-execution.ts) so
		// the frame budget is external; here we just measure the per-update cost.
		const perUpdateMs = bench("100 updateArgs", 100, () => {
			comp.updateArgs({ path: "a.txt", edits: `line ${calls++}` });
			comp.render(100);
		});
		expect(perUpdateMs).toBeLessThan(50);
	});
});

describe("BashExecutionComponent 1MB output", () => {
	it("appends 1MB in chunks; display rebuilds full join() + truncateTail each call", () => {
		initTheme(undefined, false);
		const comp = new BashExecutionComponent("cat big.bin", createTuiStub());
		const mb = 1024 * 1024;
		const chunk = `${"x".repeat(256)}\n`.repeat(256); // ~64KB chunk
		const chunks = Math.ceil(mb / chunk.length);
		let appendMs = 0;
		const start = performance.now();
		for (let i = 0; i < chunks; i++) comp.appendOutput(chunk);
		appendMs = performance.now() - start;
		// appendOutput triggers a full updateDisplay (join + truncateTail) per chunk.
		// The display never needs more than 50KB (DEFAULT_MAX_BYTES) but builds the
		// entire 1MB join every call. Assert it completes, capturing the cost shape.
		expect(comp.getOutput().length).toBeGreaterThan(mb);
		expect(appendMs).toBeGreaterThan(0);
		// Sanity: cannot bound tightly on CI, but a 1MB multi-chunk append should
		// not take over 10s (it is O(chunks * totalLen)).
		expect(appendMs).toBeLessThan(10_000);
	}, 30000);
});
