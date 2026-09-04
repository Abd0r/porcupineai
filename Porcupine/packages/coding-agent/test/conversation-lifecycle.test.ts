import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import {
	CONVERSATION_TEXT_MAX_LENGTH,
	ConversationLifecycleTracker,
	type ConversationOrigin,
	createTurnId,
	isTerminalConversationState,
	mapSessionEventToLifecycle,
	resolveTurnOrigin,
	truncateConversationText,
} from "../src/porcupine/conversation-lifecycle.ts";

const ORIGIN: ConversationOrigin = { channel: "telegram", actor: "111" };
const CONTEXT = { turnId: "turn-1", origin: ORIGIN };

function userStart(text: string): AgentSessionEvent {
	return { type: "message_start", message: { role: "user", content: [{ type: "text", text }] } } as never;
}

describe("mapSessionEventToLifecycle", () => {
	it("maps a user message to received with its text", () => {
		const event = mapSessionEventToLifecycle(userStart("build the repo"), CONTEXT);
		expect(event?.state).toBe("received");
		expect(event?.text).toBe("build the repo");
		expect(event?.origin).toEqual(ORIGIN);
		expect(event?.turnId).toBe("turn-1");
	});

	it("ignores non-user message starts", () => {
		expect(
			mapSessionEventToLifecycle(
				{ type: "message_start", message: { role: "assistant", content: [] } } as never,
				CONTEXT,
			),
		).toBeUndefined();
	});

	it("maps a non-empty queue update to queued and an empty one to nothing", () => {
		expect(
			mapSessionEventToLifecycle({ type: "queue_update", steering: [], followUp: ["later"] } as never, CONTEXT)
				?.state,
		).toBe("queued");
		expect(
			mapSessionEventToLifecycle({ type: "queue_update", steering: [], followUp: [] } as never, CONTEXT),
		).toBeUndefined();
	});

	it("maps agent start and tool execution to working and tool states", () => {
		expect(mapSessionEventToLifecycle({ type: "agent_start" } as never, CONTEXT)?.state).toBe("working");
		const started = mapSessionEventToLifecycle(
			{ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: {} } as never,
			CONTEXT,
		);
		expect(started?.state).toBe("tool_started");
		expect(started?.toolName).toBe("bash");
		const updated = mapSessionEventToLifecycle(
			{ type: "tool_execution_update", toolCallId: "t1", toolName: "read", args: {}, partialResult: {} } as never,
			CONTEXT,
		);
		expect(updated?.state).toBe("tool_updated");
		expect(updated?.toolName).toBe("read");
	});

	it("never emits a terminal event for a retry turn", () => {
		expect(
			mapSessionEventToLifecycle({ type: "agent_end", messages: [], willRetry: true } as never, CONTEXT),
		).toBeUndefined();
		expect(
			mapSessionEventToLifecycle({ type: "agent_end", messages: [], willRetry: false } as never, CONTEXT)?.state,
		).toBe("completed");
	});

	it("maps aborted and errored assistant ends to cancelled and failed", () => {
		const aborted = mapSessionEventToLifecycle(
			{ type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } } as never,
			CONTEXT,
		);
		expect(aborted?.state).toBe("cancelled");
		const failed = mapSessionEventToLifecycle(
			{ type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } } as never,
			CONTEXT,
		);
		expect(failed?.state).toBe("failed");
		expect(
			mapSessionEventToLifecycle(
				{ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } } as never,
				CONTEXT,
			),
		).toBeUndefined();
		expect(
			mapSessionEventToLifecycle({ type: "message_end", message: { role: "user", content: [] } } as never, CONTEXT),
		).toBeUndefined();
	});

	it("ignores streaming deltas and session metadata", () => {
		for (const event of [
			{ type: "message_update", message: { role: "assistant", content: [] } },
			{ type: "session_info_changed", name: undefined },
			{ type: "entry_appended", entry: { type: "custom" } },
			{ type: "agent_settled" },
		] as never[]) {
			expect(mapSessionEventToLifecycle(event, CONTEXT)).toBeUndefined();
		}
	});
});

describe("resolveTurnOrigin", () => {
	it("attributes a turn to the remote channel that queued it", () => {
		expect(resolveTurnOrigin("list the docs", [{ channel: "discord", actor: "u1", text: "list the docs" }])).toEqual({
			channel: "discord",
			actor: "u1",
		});
	});

	it("matches skill-expanded prompts embedded as their own line", () => {
		expect(
			resolveTurnOrigin("# Skill\n\nexplain compaction\n\nRead first.", [
				{ channel: "telegram", text: "explain compaction" },
			]),
		).toEqual({ channel: "telegram" });
	});

	it("falls back to a TUI origin so TUI turns never forward remotely", () => {
		expect(resolveTurnOrigin("terminal task", [{ channel: "telegram", text: "other task" }])).toEqual({
			channel: "tui",
		});
		expect(resolveTurnOrigin(undefined, [])).toEqual({ channel: "tui" });
	});
});

describe("ConversationLifecycleTracker", () => {
	it("keeps one ordered lifecycle per turn and retains its origin", () => {
		const tracker = new ConversationLifecycleTracker();
		tracker.track({ turnId: "t", state: "received", origin: { channel: "discord", actor: "u1" }, at: 0 });
		tracker.track({ turnId: "t", state: "working", origin: { channel: "discord", actor: "u1" }, at: 1 });
		tracker.track({ turnId: "t", state: "completed", origin: { channel: "discord", actor: "u1" }, at: 2 });
		expect(tracker.states("t")).toEqual(["received", "working", "completed"]);
		expect(tracker.origin("t")).toEqual({ channel: "discord", actor: "u1" });
	});

	it("drops events after a terminal state and clears finished turns", () => {
		const tracker = new ConversationLifecycleTracker();
		tracker.track({ turnId: "t", state: "completed", origin: { channel: "tui" }, at: 0 });
		expect(tracker.track({ turnId: "t", state: "working", origin: { channel: "tui" }, at: 1 })).toBeUndefined();
		expect(tracker.states("t")).toEqual(["completed"]);
		tracker.clear("t");
		expect(tracker.pendingCount).toBe(0);
		expect(tracker.states("t")).toEqual([]);
	});
});

describe("lifecycle helpers", () => {
	it("treats only completed, failed, and cancelled as terminal", () => {
		expect(isTerminalConversationState("completed")).toBe(true);
		expect(isTerminalConversationState("failed")).toBe(true);
		expect(isTerminalConversationState("cancelled")).toBe(true);
		expect(isTerminalConversationState("working")).toBe(false);
		expect(isTerminalConversationState("waiting_for_approval")).toBe(false);
	});

	it("bounds event text and creates unique turn ids", () => {
		expect(truncateConversationText(undefined)).toBeUndefined();
		expect(truncateConversationText("  hi  ")).toBe("hi");
		const long = truncateConversationText("x".repeat(CONVERSATION_TEXT_MAX_LENGTH + 500));
		expect(long!.length).toBeLessThanOrEqual(CONVERSATION_TEXT_MAX_LENGTH);
		expect(createTurnId()).not.toBe(createTurnId());
	});
});
