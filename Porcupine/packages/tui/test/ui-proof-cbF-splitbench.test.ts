import { test } from "node:test";
import { Box } from "../src/components/box.ts";
import { Text } from "../src/components/text.ts";
import { Container } from "../src/tui.ts";

function bench(name: string, tree: Container, n = 2000): void {
	for (let i = 0; i < 100; i++) tree.render(100);
	const t0 = performance.now();
	for (let i = 0; i < n; i++) tree.render(100);
	const ms = performance.now() - t0;
	console.log(`[bench] ${name}: ${(ms / n).toFixed(4)}ms/render (${n} renders)`);
}

test("split bench: text-only vs box vs container-walk", () => {
	const tOnly = new Container();
	for (let i = 0; i < 100; i++) tOnly.addChild(new Text(`line ${i} ${"x".repeat(40)}`, 100, 0));
	bench("100 Text", tOnly);

	const bOnly = new Container();
	for (let i = 0; i < 100; i++) bOnly.addChild(new Box(1, 1));
	bench("100 Box", bOnly);

	const nested = new Container();
	for (let i = 0; i < 100; i++) {
		const b = new Box(1, 1);
		b.addChild(new Text(`msg ${i} ${"y".repeat(50)}`, 100, 0));
		nested.addChild(b);
	}
	bench("100 Box+Text", nested);
});
