import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	dispatchRemoteSlash,
	isRemoteDeclined,
	type RemoteCommandContext,
	redactCommandOutput,
} from "../src/porcupine/remote-command-dispatcher.ts";
import { PorcupineTaskStore } from "../src/porcupine/task-scheduler.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

function makeContext(overrides: Partial<RemoteCommandContext> = {}): RemoteCommandContext {
	const agentDir = mkdtempSync(join(tmpdir(), "porcupine-remote-dispatch-"));
	return {
		agentDir,
		taskStore: new PorcupineTaskStore(agentDir),
		session: { id: "s-1", cwd: "/repo", mode: "normal" },
		...overrides,
	};
}

function cleanup(context: RemoteCommandContext): void {
	rmSync(context.agentDir, { recursive: true, force: true });
}

describe("remote slash dispatch", () => {
	it("replies to /session with id, cwd and mode", async () => {
		const ctx = makeContext();
		const result = await dispatchRemoteSlash("/session", ctx);
		expect(result.kind).toBe("text");
		expect(result.kind === "text" && result.text).toContain("s-1");
		expect(result.kind === "text" && result.text).toContain("/repo");
		expect(result.kind === "text" && result.text).toContain("normal");
		cleanup(ctx);
	});

	it("lists tasks and shows 'no tasks' when the store is empty", async () => {
		const ctx = makeContext();
		const result = await dispatchRemoteSlash("/task list", ctx);
		expect(result.kind).toBe("text");
		expect(result.kind === "text" && result.text).toContain("No tasks");
		cleanup(ctx);
	});

	it("adds a task through the store and lists it back", async () => {
		const ctx = makeContext();
		const added = await dispatchRemoteSlash('/task add Check alerts :: "run the audit"', ctx);
		expect(added.kind).toBe("text");
		expect(added.kind === "text" && added.text).toContain("created");

		const listed = await dispatchRemoteSlash("/task list", ctx);
		expect(listed.kind).toBe("text");
		expect(listed.kind === "text" && listed.text).toContain("Check alerts");
		cleanup(ctx);
	});

	it("queues /task run and flags a notification target for the result", async () => {
		const ctx = makeContext();
		await dispatchRemoteSlash('/task add Audit :: "audit the repo"', ctx);
		const task = ctx.taskStore.listTasks()[0]!;

		const result = await dispatchRemoteSlash(`/task run ${task.id}`, ctx);
		expect(result.kind).toBe("text");
		expect(result.kind === "text" && result.text).toContain("Queued");
		expect(result.kind === "text" && result.notificationTarget).toBe(true);
		const run = ctx.taskStore.listRuns(task.id)[0];
		expect(run?.status).toBe("claimed");
		cleanup(ctx);
	});

	it("rejects an invalid /task form with the usage line", async () => {
		const ctx = makeContext();
		const result = await dispatchRemoteSlash("/task bogus", ctx);
		expect(result.kind).toBe("text");
		expect(result.kind === "text" && result.text).toContain("Usage");
		cleanup(ctx);
	});

	it("reads /goal status but declines starting a goal turn", async () => {
		const ctx = makeContext({ getGoalStatus: () => "No active goal." });
		expect((await dispatchRemoteSlash("/goal status", ctx)).kind).toBe("text");

		const declined = await dispatchRemoteSlash("/goal build the future", ctx);
		expect(declined.kind).toBe("declined");
		expect(declined.kind === "declined" && declined.text).toContain("terminal");
		cleanup(ctx);
	});

	it("declines remote email sending but allows inbox reads", async () => {
		const ctx = makeContext({
			getEmail: async (text) => `EMAIL-OUT:${text}`,
		});
		const inbox = await dispatchRemoteSlash("/email inbox", ctx);
		expect(inbox.kind).toBe("text");
		expect(inbox.kind === "text" && inbox.text).toContain("EMAIL-OUT");

		const send = await dispatchRemoteSlash("/email send 3", ctx);
		expect(send.kind).toBe("declined");
		cleanup(ctx);
	});

	it("routes /x through the compose-only engine", async () => {
		const ctx = makeContext({ getX: async (text) => `X-OUT:${text}` });
		const result = await dispatchRemoteSlash('/x draft "hello world"', ctx);
		expect(result.kind).toBe("text");
		expect(result.kind === "text" && result.text).toContain("X-OUT");
		cleanup(ctx);
	});

	it("accepts /model with an argument but declines the bare selector", async () => {
		const ctx = makeContext({
			setModel: (arg) => `Model set to ${arg}`,
		});
		expect((await dispatchRemoteSlash("/model deepseek/deepseek-v4", ctx)).kind).toBe("text");
		const bare = await dispatchRemoteSlash("/model", ctx);
		expect(bare.kind).toBe("declined");
		cleanup(ctx);
	});

	it("applies /reasoning and /auto state toggles via callbacks", async () => {
		const ctx = makeContext({
			setReasoning: (arg) => `Reasoning ${arg}`,
			setAuto: (arg) => `Auto ${arg}`,
		});
		const reasoning = await dispatchRemoteSlash("/reasoning high", ctx);
		expect(reasoning.kind).toBe("text");
		expect(reasoning.kind === "text" && reasoning.text).toContain("Reasoning high");

		const auto = await dispatchRemoteSlash("/auto status", ctx);
		expect(auto.kind).toBe("text");
		expect(auto.kind === "text" && auto.text).toContain("Auto status");
		cleanup(ctx);
	});

	it("hard-declines lifecycle commands", async () => {
		const ctx = makeContext();
		for (const command of ["/refresh", "/restart", "/quit", "/kill", "/reload", "/new", "/clone"]) {
			const result = await dispatchRemoteSlash(command, ctx);
			expect(result.kind).toBe("declined");
			expect(result.kind === "declined" && result.text).toContain("terminal");
		}
		cleanup(ctx);
	});

	it("returns not-found for an unknown command without leaking internals", async () => {
		const ctx = makeContext();
		const result = await dispatchRemoteSlash("/definitely-not-a-command", ctx);
		expect(result.kind).toBe("not-found");
		expect(result.kind === "not-found" && result.text).not.toContain("Error");
		cleanup(ctx);
	});

	it("redacts secrets from engine output", async () => {
		const ctx = makeContext({
			getSessionReport: () => "session ok token=super-secret-abc api_key=another-secret",
		});
		const result = await dispatchRemoteSlash("/session", ctx);
		expect(result.kind === "text" && result.text).not.toContain("super-secret-abc");
		expect(result.kind === "text" && result.text).toContain("session ok");
		cleanup(ctx);
	});

	it("keeps TUI-only selectors declined", async () => {
		const ctx = makeContext();
		for (const command of ["/settings", "/tree", "/trust", "/resume", "/modes", "/view x", "/hotkeys", "/fork"]) {
			expect((await dispatchRemoteSlash(command, ctx)).kind).toBe("declined");
		}
		cleanup(ctx);
	});
});

describe("redactCommandOutput", () => {
	it("masks token, key, and password values", () => {
		const cleaned = redactCommandOutput(
			"token=abc123 def api_key=xyz password=hunter2 Bearer eyJhbGciOiJIUzI1NiJ9.abc",
		);
		expect(cleaned).not.toContain("abc123");
		expect(cleaned).not.toContain("xyz");
		expect(cleaned).not.toContain("hunter2");
		expect(cleaned).not.toContain("eyJhbGciOiJIUzI1NiJ9.abc");
		expect(cleaned).toContain("[redacted]");
	});

	it("leaves plain text untouched", () => {
		expect(redactCommandOutput("all clear here")).toBe("all clear here");
	});
});

describe("isRemoteDeclined", () => {
	it("flags lifecycle and TUI-only command names", () => {
		expect(isRemoteDeclined("refresh")).toBe(true);
		expect(isRemoteDeclined("quit")).toBe(true);
		expect(isRemoteDeclined("settings")).toBe(true);
		expect(isRemoteDeclined("session")).toBe(false);
	});
});
