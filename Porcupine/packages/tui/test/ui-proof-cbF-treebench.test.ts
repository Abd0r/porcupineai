import assert from "node:assert/strict";
import { test } from "node:test";
import { Box } from "../src/components/box.ts";
import { Text } from "../src/components/text.ts";
import { Container } from "../src/tui.ts";

// Measure the per-render cost of a deep chat-like tree: N message blocks,
// each with markdown-ish text lines + tool output blocks.
function buildChatTree(messageCount: number, _linesPerMessage = 12): Container {
	const root = new Container();
	for (let i = 0; i < messageCount; i++) {
		const block = new Box(1, 1);
		block.addChild(new Text(`message ${i}: ${"line of text ".repeat(8)}`, 100, 0));
		block.addChild(new Text("```ts\nconst x = 42;\n```", 100, 0));
		const output = new Box(1, 1);
		output.addChild(new Text(`$ command ${i}\n${"out ".repeat(60)}`, 100, 0));
		block.addChild(output);
		root.addChild(block);
	}
	return root;
}

test("chat-tree render cost: 20 messages x 1000 renders", () => {
	const tree = buildChatTree(20);
	// warm
	for (let i = 0; i < 50; i++) tree.render(100);
	const t0 = performance.now();
	for (let i = 0; i < 1000; i++) tree.render(100);
	const ms = performance.now() - t0;
	console.log(`[bench] 20-message tree x1000 renders: ${ms.toFixed(1)}ms (${(ms / 1000).toFixed(3)}ms/render)`);
	assert.ok(ms < 5000, "render must stay cheap");
});

test("chat-tree render cost: 200 messages x 1000 renders (long session)", () => {
	const tree = buildChatTree(200);
	for (let i = 0; i < 50; i++) tree.render(100);
	const t0 = performance.now();
	for (let i = 0; i < 1000; i++) tree.render(100);
	const ms = performance.now() - t0;
	console.log(`[bench] 200-message tree x1000 renders: ${ms.toFixed(1)}ms (${(ms / 1000).toFixed(3)}ms/render)`);
	assert.ok(ms < 5000, "render must stay cheap");
});
