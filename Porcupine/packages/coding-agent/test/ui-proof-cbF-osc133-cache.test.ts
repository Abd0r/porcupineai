/**
 * REGRESSION: components that mutate their parent's render result must not
 * compound markers across renders once the parent caches (instance-stable
 * Container/Box fast paths). AssistantMessageComponent + UserMessageComponent
 * prepend OSC133 zone markers to lines[0]/lines[last] — they must copy first.
 */

import { Container } from "@porcupineai/tui";
import { beforeAll, describe, expect, it } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

function assistantMessage() {
	return {
		role: "assistant",
		content: [{ type: "text", text: "hello world" }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	} as never;
}

describe("OSC133 marker stability with cached renders", () => {
	beforeAll(() => {
		initTheme();
	});
	it("assistant message markers do not compound across renders", () => {
		const root = new Container();
		const component = new AssistantMessageComponent(assistantMessage(), false, getMarkdownTheme());
		root.addChild(component);

		const first = root.render(100).join("\n");
		const second = root.render(100).join("\n");
		const third = root.render(100).join("\n");

		expect(second).toBe(first);
		expect(third).toBe(first);
		// Exactly one OSC133 zone start marker per message.
		const markerCount = (first.match(/^\u001b]133;/gm) ?? []).length;
		expect(markerCount).toBeLessThanOrEqual(2);
	});

	it("user message markers do not compound across renders", () => {
		const root = new Container();
		const component = new UserMessageComponent("hi", getMarkdownTheme());
		root.addChild(component);

		const first = root.render(100).join("\n");
		const second = root.render(100).join("\n");
		expect(second).toBe(first);
		expect((first.match(/^\u001b]133;/gm) ?? []).length).toBeLessThanOrEqual(2);
	});
});
