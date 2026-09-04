import { describe, expect, it } from "vitest";
import { SubagentMessageBus } from "../src/core/subagent-messaging.ts";

describe("WoT sub-agent message bus", () => {
	it("routes messages between peers in the same group", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-alpha", "audit");
		bus.register("sa-beta", "audit");
		const result = bus.send("sa-alpha", "sa-beta", "did you check the registry?");
		expect(result.ok).toBe(true);
		const inbox = bus.drainInbox("sa-beta");
		expect(inbox.length).toBe(1);
		expect(inbox[0]?.from).toBe("sa-alpha");
		expect(inbox[0]?.text).toContain("registry");
	});

	it("routes across groups: any agent may address any other agent", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-a", "group-1", "buck");
		bus.register("sa-b", "group-2", "tinker");
		const result = bus.send("sa-a", "@tinker", "hi from another group");
		expect(result.ok).toBe(true);
		expect(bus.drainInbox("sa-b").length).toBe(1);
	});

	it("refuses unknown-peer and self sends with addressing help", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-a", "group-1", "buck");
		const unknown = bus.send("sa-a", "@ghost", "hi");
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) expect(unknown.error).toContain("@buck");
		expect(bus.send("sa-a", "@buck", "hi").ok).toBe(false); // self by tag
		expect(bus.send("sa-a", "sa-a", "hi").ok).toBe(false); // self by id
		expect(bus.send("sa-ghost", "sa-a", "hi").ok).toBe(false); // not registered
	});

	it("resolves tags with or without @ and reaches the main agent as @porcupine", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-a", "group-1", "buck");
		bus.register("sa-b", "group-1", "fudgy");
		expect(bus.resolveTarget("@fudgy")).toBe("sa-b");
		expect(bus.resolveTarget("FUDGY")).toBe("sa-b");
		expect(bus.resolveTarget("sa-b")).toBe("sa-b");
		expect(bus.displayRef("sa-a")).toBe("@buck");
		expect(bus.displayRef("sa-unknown-id")).toBe("sa-unknown");
		const result = bus.send("sa-a", "@porcupine", "blocker: need user decision on X");
		expect(result.ok).toBe(true);
		expect(bus.drainMainInbox().length).toBe(1);
	});

	it("allows any messaging-enabled sub-agent to reach the main agent (@main)", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-a", "group-1");
		const result = bus.send("sa-a", "@main", "blocker: need user decision on X");
		expect(result.ok).toBe(true);
		expect(bus.drainMainInbox().length).toBe(1);
	});

	it("unregisters a sub-agent when it settles (no more routing to it)", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-a", "g");
		bus.register("sa-b", "g");
		bus.unregister("sa-b");
		expect(bus.send("sa-a", "sa-b", "hi").ok).toBe(false);
		expect(bus.isMember("sa-b")).toBe(false);
	});

	it("keeps a full audit trail of routed messages", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-a", "g");
		bus.register("sa-b", "g");
		bus.send("sa-a", "sa-b", "one");
		bus.send("sa-b", "@main", "two");
		expect(bus.allMessages().length).toBe(2);
	});

	it("delivers sub→sub live via onDeliver when a steerer exists (no inbox double), else queues", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-a", "g");
		bus.register("sa-b", "g");
		bus.register("sa-c", "g");
		const delivered: string[] = [];
		bus.setHooks({
			onDeliver: (message) => {
				if (message.to === "sa-b") {
					delivered.push(message.text);
					return true; // live-injected — skip inbox
				}
				return false; // sa-c has no steerer — queue for check_messages
			},
		});
		bus.send("sa-a", "sa-b", "live hello");
		bus.send("sa-a", "sa-c", "queued hello");
		expect(delivered).toEqual(["live hello"]);
		expect(bus.drainInbox("sa-b").length).toBe(0); // live-delivered, not queued
		expect(bus.drainInbox("sa-c").length).toBe(1); // queued
	});

	it("fires onMainMessage for instant sub→main injection and supports markDeliveredToMain dedupe", () => {
		const bus = new SubagentMessageBus();
		bus.register("sa-a", "g");
		const received: string[] = [];
		let lastId = "";
		bus.setHooks({
			onMainMessage: (message) => {
				received.push(message.text);
				lastId = message.id;
			},
		});
		bus.send("sa-a", "@main", "urgent update");
		bus.send("sa-a", "@main", "second");
		bus.send("sa-a", "@main", "third");
		expect(received).toEqual(["urgent update", "second", "third"]);
		// Marking the LATEST as delivered (injected live) removes only it —
		// the earlier ones stay for the report fold-in safety net.
		bus.markDeliveredToMain(lastId);
		expect(bus.drainMainInbox().length).toBe(2);
	});

	it("records main→sub messages for audit via recordMainToSub", () => {
		const bus = new SubagentMessageBus();
		bus.recordMainToSub("sa-a", "please focus on the registry");
		expect(bus.allMessages()[0]?.from).toBe("@main");
		expect(bus.allMessages()[0]?.text).toContain("registry");
	});
});
