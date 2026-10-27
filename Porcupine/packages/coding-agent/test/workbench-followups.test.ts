import { describe, expect, it } from "vitest";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { createHarness, fauxModel } from "./test-harness.ts";

describe("workbench follow-ups", () => {
	it("delivers GUI follow-ups after the active response", async () => {
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
			expect(transcript.indexOf("First response")).toBeLessThan(transcript.indexOf("Queued follow-up"));
			expect(transcript).toContain("Follow-up response");
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
