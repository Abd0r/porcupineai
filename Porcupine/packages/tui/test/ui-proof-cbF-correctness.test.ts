import assert from "node:assert/strict";
import { test } from "node:test";
import { Box } from "../src/components/box.ts";
import { Text } from "../src/components/text.ts";

test("Box fast path invalidates when a child's text changes", () => {
	const box = new Box(1, 1);
	const text = new Text("hello", 100, 0);
	box.addChild(text);

	const first = box.render(100);
	// unchanged render returns the cached instance
	assert.equal(box.render(100), first, "stable render reuses the cache");

	text.setText("world");
	const second = box.render(100);
	assert.notEqual(second, first, "child change must invalidate the Box cache");
	assert.ok(second.join("").replace(/ /g, "").includes("world"));
	assert.ok(!second.join("").replace(/ /g, "").includes("hello"));
});

test("Box fast path handles width changes", () => {
	const box = new Box(1, 1);
	box.addChild(new Text("x".repeat(50), 100, 0));
	const w60 = box.render(60);
	const w100 = box.render(100);
	assert.notEqual(w60, w100, "width change must re-render");
	// and back — width change both ways re-renders
	assert.notEqual(box.render(60), w100);
});

test("Box fast path handles child add/remove", () => {
	const box = new Box(1, 1);
	const a = new Text("a", 100, 0);
	box.addChild(a);
	const r1 = box.render(100);
	const b = new Text("b", 100, 0);
	box.addChild(b);
	const r2 = box.render(100);
	assert.notEqual(r2, r1);
	assert.ok(r2.join("").replace(/ /g, "").includes("b"));
	box.removeChild(b);
	const r3 = box.render(100);
	assert.notEqual(r3, r2);
	assert.ok(!r3.join("").replace(/ /g, "").includes("b"));
});
