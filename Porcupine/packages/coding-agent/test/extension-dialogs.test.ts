import { describe, expect, test } from "vitest";
import { ExtensionInputComponent } from "../src/modes/interactive/components/extension-input.ts";
import { ExtensionSelectorComponent } from "../src/modes/interactive/components/extension-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function render(component: { render(width: number): string[] }): string {
	return stripAnsi(component.render(80).join("\n"));
}

describe("ExtensionSelectorComponent rendering", () => {
	test("default variant lists options with the first row selected", () => {
		initTheme("dark");
		const seen: string[] = [];
		const component = new ExtensionSelectorComponent(
			"Pick a model",
			["alpha", "beta"],
			(option) => seen.push(option),
			() => seen.push("<cancel>"),
		);
		const text = render(component);
		expect(text).toContain("Pick a model");
		expect(text).toContain("alpha");
		expect(text).toContain("beta");
		expect(text).not.toContain("Confirm:");
	});

	test("confirm variant frames the decision with consequence and action labels", () => {
		initTheme("dark");
		const component = new ExtensionSelectorComponent(
			"Delete branch?",
			["Yes", "No"],
			() => {},
			() => {},
			{
				variant: "confirm",
				description: "This removes the branch from the session.",
			},
		);
		const text = render(component);
		expect(text).toContain("Confirm:");
		expect(text).toContain("Delete branch?");
		expect(text).toContain("This removes the branch from the session.");
		expect(text).toContain("Yes, allow");
		expect(text).toContain("No, cancel");
	});

	test("confirm keyboard input resolves the visible allow label to Yes", () => {
		initTheme("dark");
		const seen: string[] = [];
		const component = new ExtensionSelectorComponent(
			"Proceed?",
			["Yes", "No"],
			(option) => seen.push(option),
			() => {},
			{
				variant: "confirm",
			},
		);
		component.handleInput("\n");
		expect(seen).toEqual(["Yes"]);
	});
});

describe("ExtensionInputComponent rendering", () => {
	test("renders the placeholder as a dim hint distinct from selectors", () => {
		initTheme("dark");
		const seen: string[] = [];
		const component = new ExtensionInputComponent(
			"Branch name?",
			"e.g. feature/login",
			(value) => seen.push(value),
			() => seen.push("<cancel>"),
		);
		const text = render(component);
		expect(text).toContain("Branch name?");
		expect(text).toContain("e.g. feature/login");
		expect(text).toContain("❯");
		component.handleInput("\n");
		expect(seen).toHaveLength(1);
	});
});
