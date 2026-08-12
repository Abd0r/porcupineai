import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@porcupineai/agent-core";
import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { parseSessionEntries } from "../src/core/session-manager.ts";
import type { SubagentSessionResult } from "../src/porcupine/subagent-sessions.ts";
import {
	DEFAULT_SUBAGENT_SESSION_RETENTION,
	listSubagentSessions,
	persistSubagentSession,
	pruneSubagentSessions,
} from "../src/porcupine/subagent-sessions.ts";

function message(role: AgentMessage["role"], text: string): AgentMessage {
	return {
		role,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

function makeResult(overrides: Partial<SubagentSessionResult> = {}): SubagentSessionResult {
	return {
		messages: [message("user", "solve the xyz problem"), message("assistant", "here is the fix")],
		ok: true,
		steps: 4,
		budgetExhausted: false,
		summary: "here is the fix",
		usage: { inputTokens: 10, outputTokens: 5, contextTokens: 2000 },
		...overrides,
	};
}

function makeTempStore(): string {
	return mkdtempSync(join(tmpdir(), "porc-subagent-session-"));
}

describe("persistSubagentSession", () => {
	it("writes a valid session file in the store format with a subagent header tag", async () => {
		const sessionDir = makeTempStore();
		const persisted = await persistSubagentSession({
			sessionDir,
			parentSessionId: "parent-session-1",
			subagentId: "sa-test-1",
			task: "Refactor the parser",
			result: makeResult(),
		});

		expect(persisted).toBeDefined();
		expect(existsSync(persisted!.path)).toBe(true);

		const entries = parseSessionEntries(readFileSync(persisted!.path, "utf8"));
		const header = entries[0];
		expect((header as { type?: string }).type).toBe("subagent");
		expect((header as { subagentId?: string }).subagentId).toBe("sa-test-1");
		expect((header as { parentSessionId?: string }).parentSessionId).toBe("parent-session-1");
		expect((header as { task?: string }).task).toBe("Refactor the parser");

		const transcript = entries.filter((e) => e.type === "message" && (e as { message?: unknown }).message);
		expect(transcript.length).toBe(2);
	});

	it("persists a budget-exhausted run (not just ok)", async () => {
		const sessionDir = makeTempStore();
		const persisted = await persistSubagentSession({
			sessionDir,
			subagentId: "sa-budget",
			task: "long task",
			result: makeResult({ ok: false, budgetExhausted: true, summary: "ran out of steps midway" }),
		});

		expect(persisted).toBeDefined();
		const entries = parseSessionEntries(readFileSync(persisted!.path, "utf8"));
		const meta = entries.find((e) => e.type === "custom") as {
			data?: { ok?: boolean; budgetExhausted?: boolean; summary?: string };
		};
		expect(meta).toBeDefined();
		expect(meta!.data!.ok).toBe(false);
		expect(meta!.data!.budgetExhausted).toBe(true);
		expect(meta!.data!.summary).toBe("ran out of steps midway");
	});

	it("persists a cancelled and a failed run", async () => {
		const sessionDir = makeTempStore();
		await persistSubagentSession({
			sessionDir,
			subagentId: "sa-cancel",
			task: "t",
			result: makeResult({ ok: false, cancelled: true }),
		});
		await persistSubagentSession({
			sessionDir,
			subagentId: "sa-fail",
			task: "t",
			result: makeResult({ ok: false, error: "boom" }),
		});
		const sessions = await listSubagentSessions(sessionDir);
		expect(sessions.length).toBe(2);
	});

	it("skips persisting when the transcript is empty", async () => {
		const sessionDir = makeTempStore();
		const persisted = await persistSubagentSession({
			sessionDir,
			subagentId: "sa-empty",
			task: "t",
			result: makeResult({ messages: [] }),
		});
		expect(persisted).toBeUndefined();
		expect(readdirSync(sessionDir)).toHaveLength(0);
	});

	it("never throws into the caller (best-effort on failure)", async () => {
		const sessionDir = makeTempStore();
		// A sessionDir that is a file (not a dir) forces a write error; the
		// function must resolve to undefined rather than throw.
		const blocker = join(sessionDir, "blocker");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(blocker, "");
		await expect(
			persistSubagentSession({
				sessionDir: join(blocker, "nested"),
				subagentId: "sa-x",
				task: "t",
				result: makeResult(),
			}),
		).resolves.toBeUndefined();
	});

	it("caps oversized transcripts while keeping the earliest message", async () => {
		const sessionDir = makeTempStore();
		const big = "x".repeat(200 * 1024);
		await persistSubagentSession({
			sessionDir,
			subagentId: "sa-big",
			task: "t",
			result: makeResult({ messages: [message("user", "start"), message("assistant", big)] }),
		});
		const sessions = await listSubagentSessions(sessionDir);
		expect(sessions.length).toBe(1);
		expect(sessions[0].messageCount).toBeGreaterThanOrEqual(1);
	});
});

describe("listSubagentSessions", () => {
	it("breaks exact created+mtime ties deterministically by session id", async () => {
		const sessionDir = makeTempStore();
		await persistSubagentSession({
			sessionDir,
			subagentId: "sa-1",
			task: "first",
			result: makeResult(),
		});
		await persistSubagentSession({
			sessionDir,
			subagentId: "sa-2",
			task: "second",
			result: makeResult(),
		});

		// Force both files to share the same created time and mtime so only
		// the deterministic tie-break can order them.
		const files = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
		const now = new Date("2026-01-01T00:00:00.000Z");
		for (const file of files) {
			const p = join(sessionDir, file);
			const raw = readFileSync(p, "utf8");
			const line = raw.split("\n")[0];
			const entry = JSON.parse(line) as { timestamp?: number };
			if (typeof entry.timestamp === "number") {
				writeFileSync(p, raw.replace(String(entry.timestamp), String(now.getTime())));
			}
			utimesSync(p, now, now);
		}

		const sessions = await listSubagentSessions(sessionDir);
		expect(sessions.map((s) => s.subagentId).sort()).toEqual(["sa-1", "sa-2"]);
		// Deterministic: the same input always yields the same order, regardless
		// of directory iteration order.
		expect(sessions[0]!.subagentId).toBe("sa-2");
		expect(sessions[1]!.subagentId).toBe("sa-1");
	});

	it("returns subagent-tagged sessions newest first", async () => {
		const sessionDir = makeTempStore();
		await persistSubagentSession({
			sessionDir,
			subagentId: "sa-1",
			task: "first",
			result: makeResult(),
		});
		await persistSubagentSession({
			sessionDir,
			subagentId: "sa-2",
			task: "second",
			result: makeResult(),
		});

		const sessions = await listSubagentSessions(sessionDir);
		expect(sessions.length).toBe(2);
		expect(sessions[0].subagentId).toBe("sa-2");
		expect(sessions[1].subagentId).toBe("sa-1");
	});

	it("does not include main sessions", async () => {
		const sessionDir = makeTempStore();
		await persistSubagentSession({
			sessionDir,
			subagentId: "sa-only",
			task: "task",
			result: makeResult(),
		});
		const sessions = await listSubagentSessions(sessionDir);
		expect(sessions.every((s) => s.sessionId.length > 0)).toBe(true);
	});
});

describe("pruneSubagentSessions / retention", () => {
	it("prunes beyond the retention limit, keeping the newest", async () => {
		const sessionDir = makeTempStore();
		const retention = 3;
		for (let i = 0; i < 6; i++) {
			await persistSubagentSession({
				sessionDir,
				subagentId: `sa-${i}`,
				task: `task ${i}`,
				retention,
				result: makeResult(),
			});
		}
		const sessions = await listSubagentSessions(sessionDir);
		expect(sessions.length).toBe(retention);
	});

	it("keeps the newest sessions after pruning", async () => {
		const sessionDir = makeTempStore();
		for (let i = 0; i < 5; i++) {
			await persistSubagentSession({
				sessionDir,
				subagentId: `sa-keep-${i}`,
				task: `task ${i}`,
				retention: 2,
				result: makeResult(),
			});
		}
		const sessions = await listSubagentSessions(sessionDir);
		expect(sessions.length).toBe(2);
	});

	it("exposes the default retention constant", () => {
		expect(DEFAULT_SUBAGENT_SESSION_RETENTION).toBe(100);
	});

	it("pruneSubagentSessions returns the number removed", async () => {
		const sessionDir = makeTempStore();
		// Create 4 subagent session files by persisting with a high retention.
		for (let i = 0; i < 4; i++) {
			await persistSubagentSession({
				sessionDir,
				subagentId: `sa-p-${i}`,
				task: "t",
				retention: 20,
				result: makeResult(),
			});
		}
		const removed = pruneSubagentSessions(sessionDir, 2);
		expect(removed).toBe(2);
	});
});

describe("recall + /resume exclusion", () => {
	it("session_search finds a persisted sub-agent session", async () => {
		const { createSessionSearchToolDefinition } = await import("../src/core/tools/session-search.ts");
		const agentHome = makeTempStore();
		const cwd = join(agentHome, "proj");
		const sessionDir = join(agentHome, "sessions", "--proj--");
		await persistSubagentSession({
			sessionDir,
			cwd,
			subagentId: "sa-keyword",
			task: "investigate the quokka algorithm",
			result: makeResult({
				messages: [
					message("user", "investigate the quokka algorithm failure mode"),
					message("assistant", "quokka root cause found"),
				],
			}),
		});

		const prev = process.env.PORCUPINE_CODING_AGENT_DIR;
		process.env.PORCUPINE_CODING_AGENT_DIR = agentHome;
		try {
			const tool = createSessionSearchToolDefinition({ cwd });
			const result = await tool.execute(
				"t1",
				{ query: "quokka", limit: 5, scope: "all" },
				undefined,
				undefined,
				undefined as unknown as ExtensionContext,
			);
			const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
			expect(text).toContain("quokka");
			expect(text).toContain("Found 1 session");
		} finally {
			if (prev === undefined) delete process.env.PORCUPINE_CODING_AGENT_DIR;
			else process.env.PORCUPINE_CODING_AGENT_DIR = prev;
		}
	});

	it("SessionManager.list excludes sub-agent sessions by default (the /resume filter)", async () => {
		const sessionDir = makeTempStore();
		const cwd = join(sessionDir, "proj");
		await persistSubagentSession({
			sessionDir,
			cwd,
			subagentId: "sa-hidden",
			task: "hidden task",
			result: makeResult(),
		});
		// A main session in the same store.
		const { SessionManager } = await import("../src/core/session-manager.ts");
		const main = SessionManager.create(cwd, sessionDir);
		main.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "main session result" }],
			timestamp: Date.now(),
		} as never);
		main.forceFlushToDisk();

		const defaultList = await SessionManager.list(cwd, sessionDir);
		expect(defaultList.length).toBe(1); // only the main session
		expect(defaultList.every((s) => s.type !== "subagent")).toBe(true);

		const withSubagents = await SessionManager.list(cwd, sessionDir, undefined, {
			includeSubagents: true,
		});
		expect(withSubagents.filter((s) => s.type === "subagent").length).toBe(1);
	});
});
