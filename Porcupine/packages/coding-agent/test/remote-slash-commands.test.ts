import { describe, expect, it } from "vitest";
import {
	buildRemoteCatalog,
	formatRemoteCommandList,
	RESERVED_BRIDGE_COMMANDS,
	type RemoteCommandDescriptor,
	resolveRemoteCommand,
} from "../src/porcupine/remote-slash-commands.ts";

const builtins: RemoteCommandDescriptor[] = [
	{ name: "settings", kind: "builtin", description: "Open settings menu" },
	{ name: "model", kind: "builtin", description: "Select model", argumentHint: "<provider/model>" },
	{ name: "status", kind: "builtin", description: "grep-status shadow" },
];

const prompts: RemoteCommandDescriptor[] = [
	{ name: "fix-bugs", kind: "prompt", description: "Review and fix bugs", argumentHint: "<repo>" },
];

const skills: RemoteCommandDescriptor[] = [
	{ name: "skill:web-search", kind: "skill", description: "Search the web" },
	{ name: "skill:write-paper", kind: "skill", description: "Draft a paper" },
];

const extensions: RemoteCommandDescriptor[] = [
	{ name: "custom-review", kind: "extension", description: "Run custom review", argumentHint: "<id>" },
];

const sample = [...builtins, ...prompts, ...skills, ...extensions];

describe("RESERVED_BRIDGE_COMMANDS", () => {
	it("covers the reserved bridge command surface", () => {
		expect(RESERVED_BRIDGE_COMMANDS).toEqual(["start", "status", "help", "commands"]);
	});
});

describe("buildRemoteCatalog", () => {
	it("preserves canonical /command invocation and command line", () => {
		const c = buildRemoteCatalog(sample, "telegram");
		const settings = c.commands.find((e) => e.command === "settings");
		expect(settings).toBeDefined();
		expect(settings!.alias).toBe("settings");
		expect(settings!.commandLine).toBe("/settings");

		const skill = c.commands.find((e) => e.command === "skill:web-search");
		expect(skill).toBeDefined();
		expect(skill!.commandLine).toBe("/skill:web-search");
	});

	it("keeps safe names as-is and sanitizes colon/hyphen names per platform", () => {
		const tel = buildRemoteCatalog(sample, "telegram");
		const telSkill = tel.commands.find((e) => e.command === "skill:web-search")!;
		expect(telSkill.alias).toMatch(/^[a-z0-9_]{1,32}$/);
		expect(telSkill.alias).toBe("skill_web_search");
		expect(telSkill.alias).not.toContain(":");
		// Telegram forbids hyphen: custom-review -> custom_review
		const telExt = tel.commands.find((e) => e.command === "custom-review")!;
		expect(telExt.alias).toBe("custom_review");

		const disc = buildRemoteCatalog(sample, "discord");
		const discExt = disc.commands.find((e) => e.command === "custom-review")!;
		expect(discExt.alias).toBe("custom-review"); // hyphen is valid on Discord
		expect(discExt.alias).toMatch(/^[a-z0-9_-]{1,32}$/);
	});

	it("never assigns a reserved bridge command name as an alias", () => {
		const c = buildRemoteCatalog(sample, "telegram");
		const aliases = new Set(c.commands.map((e) => e.alias));
		for (const r of RESERVED_BRIDGE_COMMANDS) {
			expect(aliases.has(r)).toBe(false);
		}
	});

	it("represents reserved bridge commands in the catalog", () => {
		const c = buildRemoteCatalog(sample, "telegram");
		expect(c.reserved).toEqual(RESERVED_BRIDGE_COMMANDS);
	});

	it("resolves collisions with stable, distinct aliases", () => {
		const colliding: RemoteCommandDescriptor[] = [
			{ name: "skill:a-b", kind: "skill", description: "one" },
			// Distinct canonical name, but normalizes to the same Telegram alias.
			{ name: "skill_a/b", kind: "prompt", description: "two" },
		];
		const c = buildRemoteCatalog(colliding, "telegram");
		expect(c.commands.length).toBe(2);
		const a = c.commands[0].alias;
		const b = c.commands[1].alias;
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[a-z0-9_]{1,32}$/);
		expect(b).toMatch(/^[a-z0-9_]{1,32}$/);
		expect(c.commandOf.get(a)).toBe("skill:a-b");
		expect(c.commandOf.get(b)).toBe("skill_a/b");
	});

	it("keeps aliases within 1-32 chars for telegram", () => {
		const long: RemoteCommandDescriptor[] = [
			{ name: `skill:${"very-long-".repeat(6)}name`, kind: "skill", description: "long" },
		];
		const c = buildRemoteCatalog(long, "telegram");
		for (const e of c.commands) {
			expect(e.alias.length).toBeGreaterThanOrEqual(1);
			expect(e.alias.length).toBeLessThanOrEqual(32);
		}
	});

	it("is deterministic across repeated builds", () => {
		const a = buildRemoteCatalog(sample, "telegram");
		const b = buildRemoteCatalog(sample, "telegram");
		expect(a.commands).toEqual(b.commands);
		const aliasOf = Array.from(a.aliasOf.entries()).sort();
		expect(aliasOf).toEqual(Array.from(b.aliasOf.entries()).sort());
	});

	it("excludes hidden easter eggs unless explicitly included", () => {
		const withHidden: RemoteCommandDescriptor[] = [
			...sample,
			{ name: "coin-flip", kind: "extension", description: "hidden game", hidden: true },
		];
		const hidden = buildRemoteCatalog(withHidden, "telegram");
		expect(hidden.commands.length).toBe(sample.length);
		expect(hidden.commands.some((e) => e.command === "coin-flip")).toBe(false);

		const shown = buildRemoteCatalog(withHidden, "telegram", { includeHidden: true });
		expect(shown.commands.length).toBe(sample.length + 1);
		expect(shown.commands.some((e) => e.command === "coin-flip")).toBe(true);
	});

	it("bounds descriptions per platform", () => {
		const longDesc = "d".repeat(400);
		const desc: RemoteCommandDescriptor[] = [{ name: "wide", kind: "extension", description: longDesc }];
		const tel = buildRemoteCatalog(desc, "telegram");
		expect(tel.commands[0].description.length).toBeLessThanOrEqual(256);

		const disc = buildRemoteCatalog(desc, "discord");
		expect(disc.commands[0].description.length).toBeLessThanOrEqual(100);
	});
});

describe("resolveRemoteCommand", () => {
	it("resolves a platform alias back to the exact canonical command line", () => {
		const c = buildRemoteCatalog(sample, "telegram");
		const resolved = resolveRemoteCommand(c, "skill_web_search", "remote docs");
		expect(resolved).toEqual({ command: "skill:web-search", commandLine: "/skill:web-search remote docs" });
	});

	it("returns the bare command line when no argument text", () => {
		const c = buildRemoteCatalog(sample, "telegram");
		const resolved = resolveRemoteCommand(c, "settings");
		expect(resolved).toEqual({ command: "settings", commandLine: "/settings" });
	});

	it("accepts a leading slash and leading whitespace", () => {
		const c = buildRemoteCatalog(sample, "discord");
		const resolved = resolveRemoteCommand(c, "/custom-review", " 42 ");
		expect(resolved).toEqual({ command: "custom-review", commandLine: "/custom-review 42" });
	});

	it("returns null for unknown aliases", () => {
		const c = buildRemoteCatalog(sample, "telegram");
		expect(resolveRemoteCommand(c, "nope")).toBeNull();
		expect(resolveRemoteCommand(c, "/nonexistent", "x")).toBeNull();
	});
});

describe("formatRemoteCommandList", () => {
	it("produces a paginated listing keyed on /commands", () => {
		const c = buildRemoteCatalog(sample, "imessage");
		const text = formatRemoteCommandList(c);
		expect(text).toContain("/commands");
		expect(text).toContain("/settings");
		expect(text).toContain("/skill:web-search");
		// shows aliases for altered names on platforms with restrictions
		const tel = buildRemoteCatalog(sample, "telegram");
		const telList = formatRemoteCommandList(tel);
		expect(telList.toLowerCase()).toContain("skill_web_search");
	});

	it("filters by query", () => {
		const c = buildRemoteCatalog(sample, "imessage");
		const filtered = formatRemoteCommandList(c, "skill");
		expect(filtered).toContain("/skill:web-search");
		expect(filtered).not.toContain("/settings");
	});

	it("paginates and reports page numbers", () => {
		const many = Array.from({ length: 45 }, (_, i) => ({
			name: `skill:item-${i}`,
			kind: "skill" as const,
			description: `command number ${i}`,
		}));
		const c = buildRemoteCatalog(many, "imessage");
		const page2 = formatRemoteCommandList(c, "2", { pageSize: 20 });
		expect(page2).toContain("page 2");
		expect(page2.toLowerCase()).toContain("/skill:item-20");
		// full listing spans pages
		const header = formatRemoteCommandList(c);
		expect(header).toContain("1/3");
	});

	it("never emits markers for hidden-only content", () => {
		const c = buildRemoteCatalog(sample, "imessage");
		expect(c.commands.length).toBe(sample.length);
	});
});
