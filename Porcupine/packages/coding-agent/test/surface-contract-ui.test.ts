import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorkbenchCommands } from "../src/server/workbench-commands.ts";
import { COMMAND_SCRIPT } from "../src/server/workbench-commands-ui.ts";
import { createHarness } from "./test-harness.ts";

class Element {
	textContent = "";
	value = "";
	hidden = true;
	children: Element[] = [];
	setAttribute(): void {}
	removeAttribute(): void {}
	addEventListener(): void {}
	replaceChildren(): void {
		this.children = [];
	}
	append(...nodes: Element[]): void {
		this.children.push(...nodes);
	}
	focus(): void {}
}

describe("surface contract in GUI command discovery", () => {
	it("labels incomplete capabilities honestly, hides hidden commands, and restores rejected drafts", async () => {
		const h = await createHarness();
		try {
			const commands = createWorkbenchCommands(h.session, h.tempDir);
			const menu = new Element(),
				prompt = new Element(),
				feed = new Element();
			const errors: string[] = [];
			const context = {
				ui: { prompt, feed, welcome: new Element() },
				sessionId: h.session.sessionId,
				document: { createElement: () => new Element() },
				$: () => menu,
				chatAttachments: () => [],
				resizeComposer: () => {},
				updateSend: () => {},
				scrollFeed: () => {},
				setError: (message: string) => errors.push(message),
				refreshSessionSurfaces: async () => {},
				refreshContext: async () => {},
				refreshSessions: async () => {},
				json: async (_path: string, options?: { body: string }) =>
					options
						? commands.execute((JSON.parse(options.body) as { text: string }).text)
						: { commands: commands.catalog() },
			};
			runInNewContext(COMMAND_SCRIPT, context);
			await runInNewContext("refreshCommands()", context);
			prompt.value = "/log";
			runInNewContext("updateCommandMenu()", context);
			expect(menu.children.map((node) => node.children[1]?.textContent).join("\n")).toContain("GUI not wired");
			prompt.value = "/export";
			runInNewContext("updateCommandMenu()", context);
			expect(menu.children[0]?.children[1]?.textContent).toContain("partial GUI support");
			prompt.value = "/armin";
			runInNewContext("updateCommandMenu()", context);
			expect(menu.children).toEqual([]);
			prompt.value = "/login";
			await runInNewContext("submitSlashCommand('/login')", context);
			expect(prompt.value).toBe("/login");
			expect(errors.at(-1)).toContain("not wired in the GUI");
			expect(feed.children).toHaveLength(0);
			expect(h.faux.callCount).toBe(0);
		} finally {
			h.cleanup();
		}
	});
});
