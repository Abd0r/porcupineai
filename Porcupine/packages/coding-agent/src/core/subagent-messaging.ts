/**
 * Sub-agent message bus (WoT: agents talk to each other).
 *
 * Open addressing: any running agent may message any other running agent by
 * tag (`@buck`) or id — peer groups are labels, not gates. The main agent is
 * `@porcupine` (`@main` stays accepted). Everything is routed through this
 * in-memory bus, so the main agent can also inspect the whole conversation
 * (transparency over opaque side channels).
 */

import { randomUUID } from "node:crypto";
import { formatAgentTag, isMainAgentRef, normalizeAgentName } from "./subagent-names.ts";

export interface PeerMessage {
	id: string;
	from: string;
	to: string;
	text: string;
	at: string;
}

export type PeerSendResult = { ok: true; message: PeerMessage } | { ok: false; error: string };

export interface SubagentMessageBusHooks {
	/**
	 * Called for sub→sub sends so the session can deliver LIVE (steer into the
	 * target's running context). Return true when delivered — the message is then
	 * not queued in the target's inbox (no double delivery via check_messages).
	 */
	onDeliver?: (message: PeerMessage) => boolean;
	/** Called for sub→main sends so the session can inject instantly. */
	onMainMessage?: (message: PeerMessage) => void;
}

export class SubagentMessageBus {
	/** sub-agent id → peer group label (informational only; never gates sends). */
	private readonly members = new Map<string, string>();
	/** sub-agent id → human tag name (without `@`). */
	private readonly names = new Map<string, string>();
	private readonly inboxes = new Map<string, PeerMessage[]>();
	private readonly mainInbox: PeerMessage[] = [];
	private readonly outbox: PeerMessage[] = [];
	/** Live-delivery hooks wired by the session (instant WoT injection). */
	private hooks: SubagentMessageBusHooks = {};

	setHooks(hooks: SubagentMessageBusHooks): void {
		this.hooks = hooks;
	}

	/** Register a sub-agent into the bus under its peer-group label, with its tag name. */
	register(id: string, peerGroup: string, name?: string): void {
		this.members.set(id, peerGroup);
		if (name) this.names.set(id, name);
		if (!this.inboxes.has(id)) this.inboxes.set(id, []);
	}

	/** Remove a sub-agent when its run settles. */
	unregister(id: string): void {
		this.members.delete(id);
		this.names.delete(id);
		this.inboxes.delete(id);
	}

	/** Whether a sub-agent is registered (messaging-enabled) on the bus. */
	isMember(id: string): boolean {
		return this.members.has(id);
	}

	/** The peer group a sub-agent belongs to, if any. */
	groupOf(id: string): string | undefined {
		return this.members.get(id);
	}

	/** Display reference for an id: its `@tag`, or a short id when untagged. */
	displayRef(id: string): string {
		const name = this.names.get(id);
		if (name) return formatAgentTag(name);
		return id.length > 10 ? id.slice(0, 10) : id;
	}

	/** Resolve a `to` reference (tag with or without `@`, or raw id) to a member id. */
	resolveTarget(ref: string): string | undefined {
		const trimmed = ref.trim();
		if (this.members.has(trimmed)) return trimmed;
		const name = normalizeAgentName(trimmed);
		for (const [id, claimed] of this.names) {
			if (claimed === name) return id;
		}
		return undefined;
	}

	/** Live tags for addressing help and error messages. */
	activeTags(): string[] {
		return [...this.names.values()].map((name) => formatAgentTag(name));
	}

	/**
	 * Send a message from one sub-agent to another by tag or id, OR to the
	 * main agent (`@porcupine`, `@main`). Any running agent may address any
	 * other running agent.
	 */
	send(from: string, to: string, text: string): PeerSendResult {
		if (!this.members.has(from)) return { ok: false, error: "this sub-agent is not messaging-enabled" };
		if (!text.trim()) return { ok: false, error: "empty message" };

		const isMainTarget = isMainAgentRef(to);
		const targetId = isMainTarget ? undefined : this.resolveTarget(to);
		if (!isMainTarget && targetId === undefined) {
			const known = this.activeTags().join(", ");
			return { ok: false, error: `unknown agent: ${to}${known ? ` (active: ${known})` : ""}` };
		}
		if (!isMainTarget && targetId === from) return { ok: false, error: "cannot message yourself" };

		const message: PeerMessage = {
			id: randomUUID(),
			from,
			to: isMainTarget ? "@main" : targetId!,
			text: text.trim().slice(0, 4_000),
			at: new Date().toISOString(),
		};
		if (isMainTarget) {
			this.mainInbox.push(message);
			// Instant delivery into the main agent's context (WoT live injection).
			this.hooks.onMainMessage?.(message);
		} else {
			// Instant delivery into the peer's running context when a live steerer
			// exists; otherwise queue for check_messages.
			const deliveredLive = this.hooks.onDeliver?.(message) === true;
			if (!deliveredLive && !isMainTarget) this.inboxes.get(targetId!)?.push(message);
		}
		this.outbox.push(message);
		return { ok: true, message };
	}

	/**
	 * Record a main→sub message (parent steering a child). The steerer already
	 * delivers it live; this keeps the audit trail complete without duplicating.
	 */
	recordMainToSub(to: string, text: string): PeerMessage {
		const message: PeerMessage = {
			id: randomUUID(),
			from: "@main",
			to,
			text: text.trim().slice(0, 4_000),
			at: new Date().toISOString(),
		};
		this.outbox.push(message);
		return message;
	}

	/** Drain (and remove) messages addressed to the main agent. */
	drainMainInbox(): PeerMessage[] {
		const drained = [...this.mainInbox];
		this.mainInbox.length = 0;
		return drained;
	}

	/** Remove a single main-inbox message once it has been injected live (dedupe). */
	markDeliveredToMain(id: string): void {
		const index = this.mainInbox.findIndex((message) => message.id === id);
		if (index >= 0) this.mainInbox.splice(index, 1);
	}

	/** Drain (and remove) a sub-agent's incoming messages. */
	drainInbox(id: string): PeerMessage[] {
		const inbox = this.inboxes.get(id);
		if (!inbox) return [];
		this.inboxes.set(id, []);
		return inbox;
	}

	/** Every message ever routed (main-agent visibility / audit). */
	allMessages(): PeerMessage[] {
		return [...this.outbox];
	}
}
