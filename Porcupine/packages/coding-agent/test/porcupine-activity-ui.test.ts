import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

describe("setPorcupineActivity UI wiring (animations.ts)", () => {
	it("maps unmapped tools to '🧰 Using <tool>'", () => {
		const prototype = InteractiveMode as unknown as { prototype: { toolChip(t: string, a?: unknown): unknown } };
		// subagent tool → its own 🤖 chip (not the generic 🧰 Using).
		const sub = prototype.prototype.toolChip.call({}, "subagent", {});
		expect(sub).toEqual({ phase: "subagent" });
		// Sending a message (main → sub, WoT) → 📨 Sending message.
		const send = prototype.prototype.toolChip.call({}, "send_to_subagent", {});
		expect(send).toEqual({ phase: "sending-message" });
		const wot = prototype.prototype.toolChip.call({}, "send_message", {});
		expect(wot).toEqual({ phase: "sending-message" });
		// Unmapped tools fall back to 🧰 Using <tool>.
		const chip = prototype.prototype.toolChip.call({}, "tasks", {});
		expect(chip).toEqual({ phase: "using-tool", name: "tasks" });
		// Known tools keep their phase (web_search → web-search).
		const known = prototype.prototype.toolChip.call({}, "web_search", {});
		expect(known).toEqual({ phase: "web-search" });
		const extract = prototype.prototype.toolChip.call({}, "web_extract", {});
		expect(extract).toEqual({ phase: "web-extract" });
	});

	it("joins multiple sub-agents in slot order with commas in the strip chip", () => {
		const prototype = InteractiveMode as unknown as {
			prototype: {
				toolChip(t: string, a?: unknown): { phase: string; name?: string };
				subagentActivityIndicator(
					runs: Array<{
						name: string;
						lastTool?: string;
						lastToolArgs?: unknown;
						phase?: "tool" | "thinking";
					}>,
				): { frames: string[] } | undefined;
			};
		};
		const fakeThis = { toolChip: prototype.prototype.toolChip };

		// One worker extracting.
		const one = prototype.prototype.subagentActivityIndicator.call(fakeThis, [
			{ name: "buck", lastTool: "web_extract", phase: "tool" },
		]);
		expect(one!.frames[0]).toBe("🤖(@buck 📄 Extracting).");

		// Two workers, slot order preserved: #1 extracting, #2 searching.
		const two = prototype.prototype.subagentActivityIndicator.call(fakeThis, [
			{ name: "buck", lastTool: "web_extract", phase: "tool" },
			{ name: "tinker", lastTool: "web_search", phase: "tool" },
		]);
		expect(two!.frames[0]).toBe("🤖(@buck 📄 Extracting, @tinker 🌐 Searching).");

		// Slot order never changes even if #2 was active most recently.
		const ordered = prototype.prototype.subagentActivityIndicator.call(fakeThis, [
			{
				name: "buck",
				lastTool: "read",
				lastToolArgs: { path: "/x/skills/vcs/git-basics/SKILL.md" },
				phase: "tool",
			},
			{ name: "fudgy", phase: "thinking" },
		]);
		expect(ordered!.frames[0]).toBe("🤖(@buck 📖 Reading skill: git-basics, @fudgy 🧠 Thinking).");
	});

	it("does not restart glyphs when the animation id is unchanged", () => {
		const setIndicator = vi.fn();
		const setMessage = vi.fn();
		// Force no easter-egg swap so phase stays "thinking".
		vi.spyOn(Math, "random").mockReturnValue(0.99);
		const fakeThis: any = {
			extensionActivityOverride: undefined,
			activityPhase: "thinking",
			activityEasterEgg: undefined,
			workingMessage: undefined,
			workingIndicatorOptions: undefined,
			workingVisible: true,
			pendingTools: new Map(),
			editor: { focused: true },
			isEditorFocused: () => true,
			activeStatusIndicator: {
				kind: "working",
				setIndicator,
				setMessage,
			},
			session: { isStreaming: true, isCompacting: false, isBashRunning: false },
			ui: { requestRender: vi.fn(), setFocus: vi.fn() },
		};

		// Soft update without explicit showInterruptHint — must still keep the suffix
		// while the agent is streaming.
		(InteractiveMode as any).prototype.setPorcupineActivity.call(fakeThis, "thinking");

		expect(setIndicator).not.toHaveBeenCalled();
		expect(setMessage).toHaveBeenCalled();
		// Message is hint-only; label lives in animated frames
		const message = setMessage.mock.calls[0][0] as string;
		expect(message).toBe("(esc to interrupt)");
		expect(message).not.toMatch(/·/);
		expect(message).not.toMatch(/escape/i);
		expect(fakeThis.activityPhase).toBe("thinking");
		vi.restoreAllMocks();
	});

	it("does not let soft Working stomp a live tool animation", () => {
		const setIndicator = vi.fn();
		const setMessage = vi.fn();
		const fakeThis: any = {
			extensionActivityOverride: undefined,
			activityPhase: "reading",
			activityEasterEgg: undefined,
			workingMessage: undefined,
			workingIndicatorOptions: undefined,
			workingVisible: true,
			pendingTools: new Map([["t1", {}]]),
			editor: { focused: true },
			isEditorFocused: () => true,
			activeStatusIndicator: {
				kind: "working",
				setIndicator,
				setMessage,
			},
			session: { isStreaming: true, isCompacting: false, isBashRunning: false },
			ui: { requestRender: vi.fn(), setFocus: vi.fn() },
		};

		// Soft call (orchestrator step:start / streaming) without force
		(InteractiveMode as any).prototype.setPorcupineActivity.call(fakeThis, "working");

		expect(setIndicator).not.toHaveBeenCalled();
		expect(fakeThis.activityPhase).toBe("reading");
	});

	it("swaps glyphs when the animation id changes", () => {
		const setIndicator = vi.fn();
		const setMessage = vi.fn();
		const fakeThis: any = {
			extensionActivityOverride: undefined,
			activityPhase: "working",
			activityEasterEgg: undefined,
			workingMessage: undefined,
			workingIndicatorOptions: undefined,
			workingVisible: true,
			pendingTools: new Map(),
			editor: { focused: true },
			isEditorFocused: () => true,
			activeStatusIndicator: {
				kind: "working",
				setIndicator,
				setMessage,
			},
			session: { isStreaming: true, isCompacting: false, isBashRunning: false },
			ui: { requestRender: vi.fn(), setFocus: vi.fn() },
		};

		(InteractiveMode as any).prototype.setPorcupineActivity.call(fakeThis, "editing");

		expect(setIndicator).toHaveBeenCalledTimes(1);
		const options = setIndicator.mock.calls[0][0];
		// Fixed emoji + cycling dots: "✏️ Editing." / ".." / "..." / ".."
		expect(options.frames).toEqual(["✏️ Editing.", "✏️ Editing..", "✏️ Editing...", "✏️ Editing.."]);
		const message = setMessage.mock.calls[0][0] as string;
		expect(message).toBe("(esc to interrupt)");
		expect(fakeThis.activityPhase).toBe("editing");
	});
});
