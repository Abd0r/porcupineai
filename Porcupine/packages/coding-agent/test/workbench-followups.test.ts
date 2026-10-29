import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { createHarness, fauxModel } from "./test-harness.ts";

describe("workbench follow-ups", () => {
	it("injects a GUI prompt after a running tool, before the next assistant response", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started!: () => void;
		const toolStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const h = await createHarness({
			responses: [{ toolCalls: [{ name: "read", args: {} }] }, "Revised response"],
			baseToolsOverride: {
				read: {
					name: "read",
					label: "read",
					description: "Read fixture",
					parameters: Type.Object({}),
					async execute() {
						started();
						await gate;
						return { content: [{ type: "text", text: "Read complete" }], details: {} };
					},
				},
			},
		});
		try {
			const api = adaptSessionToServeApi(h.session, h.tempDir),
				running = api.sendUserMessage("Original task");
			await toolStarted;
			await api.queueFollowUp!("Change the task now", [
				{
					name: "photo.png",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
				},
			]);
			expect(api.getFollowUps!()).toHaveLength(1);
			expect(api.getFollowUps!()[0]).toContain("Change the task now");
			release();
			await running;
			const next = h.faux.contexts[1];
			expect(JSON.stringify(next)).toContain("Change the task now");
			expect(
				next.messages.some(
					(message) =>
						message.role === "user" &&
						Array.isArray(message.content) &&
						message.content.some((part) => part.type === "image"),
				),
			).toBe(true);
			expect(h.faux.contexts).toHaveLength(2);
			expect(api.getFollowUps!()).toEqual([]);
		} finally {
			release();
			await h.cleanup();
		}
	});
	it("cancels queued steering without dropping peer notices, follow-ups or image blocks", async () => {
		const h = await createHarness({ model: fauxModel });
		try {
			await h.session.steer("Remove me");
			h.agent.steer({
				role: "custom",
				customType: "peer",
				content: "Keep peer report",
				display: false,
				timestamp: Date.now(),
			});
			await h.session.steer("Keep photo", [{ type: "image", mimeType: "image/png", data: "photo-bytes" }]);
			await h.session.followUp("Keep later");
			const api = adaptSessionToServeApi(h.session);
			const updates: unknown[] = [];
			const unsubscribe = api.onEvent((event) => {
				if ((event as { type: string }).type === "queue_update") updates.push(event);
			});
			expect(api.getFollowUps!()).toEqual(["Remove me", "Keep photo", "Keep later"]);
			expect(api.removeFollowUp!(0, "Wrong")).toBe(false);
			expect(api.removeFollowUp!(0, "Remove me")).toBe(true);
			expect(updates.at(-1)).toMatchObject({
				type: "queue_update",
				followUp: ["Keep photo", "Keep later"],
				steering: [],
			});
			unsubscribe();
			expect(h.agent.drainSteeringMessages()).toMatchObject([
				{ role: "custom", content: "Keep peer report" },
				{
					role: "user",
					content: [
						{ type: "text", text: "Keep photo" },
						{ type: "image", data: "photo-bytes" },
					],
				},
			]);
			expect(h.session.getFollowUpMessages()).toEqual(["Keep later"]);
		} finally {
			await h.cleanup();
		}
	});
	it("delivers GUI steering already queued before the first model step", async () => {
		const h = await createHarness({ responses: [{ text: "First response", delayMs: 150 }, "Follow-up response"] });
		try {
			const started = new Promise<void>((resolve) =>
				h.session.subscribe((event) => {
					if (event.type === "agent_start") resolve();
				}),
			);
			const api = adaptSessionToServeApi(h.session);
			const running = api.sendUserMessage("Original prompt");
			await started;
			await api.queueFollowUp!("Queued follow-up");
			expect(api.getFollowUps!()).toEqual(["Queued follow-up"]);
			await running;
			expect(api.getFollowUps!()).toEqual([]);
			const transcript = api.getTimeline!().flatMap((event) =>
				event.type === "message_end"
					? [
							typeof event.message.content === "string"
								? event.message.content
								: event.message.content
										.filter((part) => part.type === "text")
										.map((part) => (part.type === "text" ? part.text : ""))
										.join("\n"),
						]
					: [],
			);
			expect(transcript.indexOf("Queued follow-up")).toBeLessThan(transcript.indexOf("First response"));
			expect(transcript).toContain("First response");
			expect(h.faux.callCount).toBe(1);
		} finally {
			h.cleanup();
		}
	});
	it("keeps queue order and cancels only the expected pending item", async () => {
		const h = await createHarness({ model: fauxModel });
		try {
			await h.session.followUp("First follow-up");
			await h.session.followUp("Second follow-up");
			await h.session.followUp("Keep photo", [{ type: "image", mimeType: "image/png", data: "photo-bytes" }]);
			const api = adaptSessionToServeApi(h.session);
			expect(api.getFollowUps?.()).toEqual(["First follow-up", "Second follow-up", "Keep photo"]);
			expect(api.removeFollowUp?.(0, "Wrong prompt")).toBe(false);
			expect(api.removeFollowUp?.(0, "First follow-up")).toBe(true);
			expect(h.session.getFollowUpMessages()).toEqual(["Second follow-up", "Keep photo"]);
			expect(h.agent.drainFollowUpMessages()[1]).toMatchObject({
				role: "user",
				content: [
					{ type: "text", text: "Keep photo" },
					{ type: "image", mimeType: "image/png", data: "photo-bytes" },
				],
			});
		} finally {
			await h.cleanup();
		}
	});
});
