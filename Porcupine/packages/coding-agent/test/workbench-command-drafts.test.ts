import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { COMMAND_SCRIPT } from "../src/server/workbench-commands-ui.ts";

function harness(text: string) {
	const prompt = { value: text, removeAttribute() {}, setAttribute() {}, addEventListener() {}, focus() {} },
		menu = { hidden: true };
	let finish!: (value: object) => void, fail!: (error: Error) => void;
	const pending = new Promise<object>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	const context = {
		ui: { prompt },
		sessionId: "a",
		connectionEpoch: 1,
		conversationViews: new Map(),
		$: () => menu,
		chatAttachments: () => [],
		setError() {},
		updateSend() {},
		resizeComposer() {},
		json: () => pending,
		refreshSessionSurfaces: async () => {},
		refreshContext: async () => {},
		refreshSessions: async () => {},
		createSession: async () => {},
	};
	return {
		context,
		prompt,
		finish,
		fail,
		start: () =>
			runInNewContext(`${COMMAND_SCRIPT}\nsubmitSlashCommand(${JSON.stringify(text)})`, context) as Promise<boolean>,
	};
}
describe("slash-command draft ownership", () => {
	it("preserves text composed while a command is running", async () => {
		const h = harness("/custom");
		const running = h.start();
		h.prompt.value = "My next prompt";
		h.finish({});
		await running;
		expect(h.prompt.value).toBe("My next prompt");
	});
	it("removes /new before the old conversation draft is cached", async () => {
		const h = harness("/new");
		let saved = "";
		h.context.createSession = async () => {
			saved = h.prompt.value;
			h.context.sessionId = "b";
		};
		await h.start();
		expect(saved).toBe("");
	});
	it("restores a failed command without discarding the newer draft", async () => {
		const h = harness("/custom");
		const running = h.start();
		h.prompt.value = "My next prompt";
		h.fail(new Error("Failed"));
		await running;
		expect(h.prompt.value).toBe("/custom\n\nMy next prompt");
	});
});
