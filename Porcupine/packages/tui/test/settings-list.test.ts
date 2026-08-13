import assert from "node:assert";
import { describe, it } from "node:test";
import { SettingsList, type SettingsListTheme } from "../src/components/settings-list.ts";

const testTheme: SettingsListTheme = {
	label: (text) => text,
	value: (text) => text,
	description: (text) => text,
	cursor: "> ",
	hint: (text) => text,
};

const items = [
	{
		id: "ui-mode",
		label: "UI mode",
		currentValue: "regular",
		values: ["regular", "fullscreen"],
	},
];

describe("SettingsList", () => {
	it("includes spaces in an active search instead of changing the selected setting", () => {
		const changes: Array<{ id: string; value: string }> = [];
		const list = new SettingsList(
			items.map((item) => ({ ...item })),
			10,
			testTheme,
			(id, value) => changes.push({ id, value }),
			() => {},
			{ enableSearch: true },
		);

		for (const character of "UI mode") list.handleInput(character);

		assert.deepStrictEqual(changes, []);
		assert.match(list.render(80)[0] ?? "", /UI mode/);

		list.handleInput("\r");
		assert.deepStrictEqual(changes, [{ id: "ui-mode", value: "fullscreen" }]);
	});

	it("keeps Space as a change shortcut before a search query is entered", () => {
		const changes: Array<{ id: string; value: string }> = [];
		const list = new SettingsList(
			items.map((item) => ({ ...item })),
			10,
			testTheme,
			(id, value) => changes.push({ id, value }),
			() => {},
			{ enableSearch: true },
		);

		list.handleInput(" ");

		assert.deepStrictEqual(changes, [{ id: "ui-mode", value: "fullscreen" }]);
	});

	it("clamps the value column width so current values survive on narrow terminals (BUG-4)", () => {
		const list = new SettingsList(
			[{ id: "mode", label: "Mode", currentValue: "fullscreen", values: ["regular", "fullscreen"] }],
			10,
			testTheme,
			() => {},
			() => {},
			{},
		);

		// usedWidth = prefix(2) + maxLabelWidth(4) + separator(2) = 8, so at container width
		// 14 the value receives 4 columns and must be present ("full"), not silently dropped.
		const [row] = list.render(14);
		assert.ok(row.startsWith("> Mode"), `setting row should render: ${JSON.stringify(row)}`);
		assert.ok(row.includes("full"), `value column should be preserved at width 14: ${JSON.stringify(row)}`);
	});

	it("truncates gracefully without negative-width value arithmetic on very narrow terminals (BUG-4)", () => {
		const list = new SettingsList(
			[{ id: "mode", label: "Mode", currentValue: "fullscreen", values: ["regular", "fullscreen"] }],
			10,
			testTheme,
			() => {},
			() => {},
			{},
		);
		for (const width of [4, 6, 8]) {
			const lines = list.render(width);
			assert.ok(lines.length > 0, `expected lines for width ${width}`);
		}
	});
});
