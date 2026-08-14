import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { type RequestHeaderEntry, SessionManager, type SystemPromptEntry } from "../src/core/session-manager.ts";

const tempRoots: string[] = [];

function tempSessionDir(): string {
	const dir = join(tmpdir(), `porcupine-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempRoots.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempRoots) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
	tempRoots.length = 0;
});

describe("session traceability entries (dsh lesson 1: model-visible == logged)", () => {
	test("appendSystemPrompt writes a durable system_prompt entry with hash", () => {
		const manager = SessionManager.create("/tmp", tempSessionDir());
		const prompt = "You are a benchmark agent.";
		const hash = createHash("sha1").update(prompt).digest("hex");
		const id = manager.appendSystemPrompt(prompt, hash, "session-start");

		const entries = manager.getEntries();
		const found = entries.find((e) => e.id === id) as SystemPromptEntry | undefined;
		expect(found).toBeDefined();
		expect(found?.type).toBe("system_prompt");
		expect(found?.prompt).toBe(prompt);
		expect(found?.promptHash).toBe(hash);
		expect(found?.reason).toBe("session-start");
	});

	test("appendRequestHeader writes the dispatch envelope", () => {
		const manager = SessionManager.create("/tmp", tempSessionDir());
		const id = manager.appendRequestHeader({
			model: "deepseek-v4-flash",
			provider: "deepseek",
			thinkingLevel: "high",
			promptHash: "abc123",
			toolNames: ["read", "bash", "edit"],
		});

		const found = manager.getEntries().find((e) => e.id === id) as RequestHeaderEntry | undefined;
		expect(found?.type).toBe("request_header");
		expect(found?.model).toBe("deepseek-v4-flash");
		expect(found?.thinkingLevel).toBe("high");
		expect(found?.toolNames).toEqual(["read", "bash", "edit"]);
	});

	test("traceability entries never project into LLM context", () => {
		const manager = SessionManager.create("/tmp", tempSessionDir());
		manager.appendSystemPrompt("prompt text", "hash1", "session-start");
		manager.appendRequestHeader({
			model: "m",
			thinkingLevel: "off",
			promptHash: "hash1",
			toolNames: ["read"],
		});
		manager.appendMessage({ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() });

		const context = manager.buildSessionContext();
		expect(context.messages.length).toBe(1);
		expect(context.messages[0].role).toBe("user");
	});

	test("entries are flushed to disk immediately (read-critical)", () => {
		const dir = tempSessionDir();
		const manager = SessionManager.create("/tmp", dir);
		// Seed an assistant message so persistence activates.
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			timestamp: Date.now(),
			stopReason: "stop",
		} as never);
		manager.appendSystemPrompt("prompt", "hash", "session-start");
		manager.appendRequestHeader({ model: "m", thinkingLevel: "off", promptHash: "hash", toolNames: [] });

		const file = manager.getSessionFile();
		expect(file).toBeDefined();
		expect(existsSync(file!)).toBe(true);
		const raw = readFileSync(file!, "utf8");
		expect(raw).toContain('"type":"system_prompt"');
		expect(raw).toContain('"type":"request_header"');
	});

	test("forking a branched session preserves traceability entries on the path", () => {
		const manager = SessionManager.create("/tmp", tempSessionDir());
		manager.appendSystemPrompt("prompt", "hash", "session-start");
		manager.appendMessage({ role: "user", content: [{ type: "text", text: "q" }], timestamp: Date.now() });
		// An assistant message activates file persistence (first-assistant flush).
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "a" }],
			timestamp: Date.now(),
			stopReason: "stop",
		} as never);
		const branchFile = manager.createBranchedSession(manager.getLeafId()!);
		expect(branchFile).toBeDefined();
		const raw = readFileSync(branchFile!, "utf8");
		expect(raw).toContain('"type":"system_prompt"');
	});
});
