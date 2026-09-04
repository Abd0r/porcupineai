/**
 * Shared conversation lifecycle contract (Section D).
 *
 * The TUI owns the canonical conversation state. This module defines the
 * platform-neutral events every talking channel (Telegram / Discord / iMessage
 * and future adapters) consumes. No channel invents its own lifecycle model.
 *
 * The mapper is pure: session events in, one lifecycle event (or undefined)
 * out. `waiting_for_approval` and `waiting_for_answer` are produced by dialog
 * producers (the Section B coordinator and channel adapters), never by this
 * mapper. Event text is bounded and carries no secrets by construction: only
 * the prompt excerpt needed for correlation is kept.
 */

import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "../core/agent-session.ts";
import { lastUserMessageText, textsMatch } from "./telegram-bridge.ts";

export type ConversationChannel = "tui" | "telegram" | "discord" | "imessage" | "task";

export interface ConversationOrigin {
	channel: ConversationChannel;
	/** Authorized actor id when the turn originated remotely; absent for TUI turns. */
	actor?: string;
}

export type ConversationLifecycleState =
	| "received"
	| "queued"
	| "working"
	| "tool_started"
	| "tool_updated"
	| "waiting_for_approval"
	| "waiting_for_answer"
	| "completed"
	| "failed"
	| "cancelled";

export interface ConversationEvent {
	/** Correlates every event of one prompt turn across TUI and channels. */
	turnId: string;
	state: ConversationLifecycleState;
	origin: ConversationOrigin;
	/** Bounded excerpt for correlation/display; never raw internal errors. */
	text?: string;
	/** Tool name for tool_started / tool_updated. */
	toolName?: string;
	at: number;
}

const TERMINAL_STATES: ReadonlySet<ConversationLifecycleState> = new Set(["completed", "failed", "cancelled"]);

export function isTerminalConversationState(state: ConversationLifecycleState): boolean {
	return TERMINAL_STATES.has(state);
}

/** Maximum characters kept on a lifecycle event excerpt. */
export const CONVERSATION_TEXT_MAX_LENGTH = 2000;

export function truncateConversationText(text: string | undefined): string | undefined {
	if (text === undefined) return undefined;
	const trimmed = text.trim();
	if (trimmed.length <= CONVERSATION_TEXT_MAX_LENGTH) return trimmed || undefined;
	return `${trimmed.slice(0, CONVERSATION_TEXT_MAX_LENGTH - 1)}…`;
}

export function createTurnId(): string {
	return randomUUID();
}

/** A remote prompt awaiting its turn, used to attribute a turn to its channel. */
export interface TurnCandidate {
	channel: Exclude<ConversationChannel, "tui">;
	actor?: string;
	text: string;
}

/**
 * Attribute a turn's last user text to the remote channel that queued it.
 * Falls back to a TUI origin when nothing matches: TUI turns stay in the TUI.
 */
export function resolveTurnOrigin(
	turnText: string | undefined,
	candidates: readonly TurnCandidate[],
): ConversationOrigin {
	if (turnText !== undefined) {
		const match = candidates.find((candidate) => textsMatch(candidate.text, turnText));
		if (match) {
			return match.actor === undefined ? { channel: match.channel } : { channel: match.channel, actor: match.actor };
		}
	}
	return { channel: "tui" };
}

/**
 * Minimal ordered log of one turn's lifecycle for channel adapters.
 * Adapters read states in order (received → … → terminal) and render only
 * the states their platform supports. Entries after a terminal state are
 * dropped so a retry or late event can never resurrect a finished turn.
 */
export class ConversationLifecycleTracker {
	private readonly turns = new Map<string, ConversationEvent[]>();

	/** Record an event; creates the turn log on first sight. Drops post-terminal noise. */
	track(event: ConversationEvent): ConversationEvent | undefined {
		const log = this.turns.get(event.turnId);
		if (log === undefined) {
			this.turns.set(event.turnId, [event]);
			return event;
		}
		const last = log[log.length - 1];
		if (last && isTerminalConversationState(last.state)) return undefined;
		log.push(event);
		return event;
	}

	states(turnId: string): ConversationLifecycleState[] {
		return (this.turns.get(turnId) ?? []).map((event) => event.state);
	}

	origin(turnId: string): ConversationOrigin | undefined {
		return this.turns.get(turnId)?.[0]?.origin;
	}

	clear(turnId: string): void {
		this.turns.delete(turnId);
	}

	get pendingCount(): number {
		return this.turns.size;
	}
}

function stopReasonOf(message: unknown): string | undefined {
	const reason = (message as { stopReason?: unknown } | null)?.stopReason;
	return typeof reason === "string" ? reason : undefined;
}

/**
 * Map one session event to its canonical lifecycle event. Returns undefined
 * for events that carry no lifecycle transition (streaming deltas, metadata,
 * retry continuations). Pure and total: never throws on unknown shapes.
 */
export function mapSessionEventToLifecycle(
	event: AgentSessionEvent,
	context: { turnId: string; origin: ConversationOrigin; at?: number },
): ConversationEvent | undefined {
	const at = context.at ?? Date.now();
	const base = { turnId: context.turnId, origin: context.origin, at };
	switch (event.type) {
		case "message_start": {
			if (event.message?.role !== "user") return undefined;
			return { ...base, state: "received", text: truncateConversationText(lastUserMessageText([event.message])) };
		}
		case "queue_update": {
			if (event.steering.length === 0 && event.followUp.length === 0) return undefined;
			return { ...base, state: "queued" };
		}
		case "agent_start":
			return { ...base, state: "working" };
		case "tool_execution_start":
			return { ...base, state: "tool_started", toolName: event.toolName };
		case "tool_execution_update":
			return { ...base, state: "tool_updated", toolName: event.toolName };
		case "message_end": {
			if (event.message?.role !== "assistant") return undefined;
			const stopReason = stopReasonOf(event.message);
			if (stopReason === "aborted") return { ...base, state: "cancelled" };
			if (stopReason === "error") return { ...base, state: "failed" };
			return undefined;
		}
		case "agent_end": {
			// A retry follows: the turn has not terminated, so emit nothing and
			// let the terminal response produce the single completed event.
			if (event.willRetry) return undefined;
			return { ...base, state: "completed" };
		}
		default:
			return undefined;
	}
}
