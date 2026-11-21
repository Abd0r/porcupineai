import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
	getSessionPinned,
	getSessionProject,
	moveSessionToTrash,
	setSessionPinned,
	setSessionProject,
} from "../src/server/workbench-session-projects.ts";

describe("durable project association", () => {
	it("persists pin and unpin without changing the project or chat history", () => {
		const root = mkdtempSync(join(tmpdir(), "session-pin-"));
		try {
			const manager = SessionManager.create(root, join(root, "sessions"));
			manager.appendMessage({ role: "user", content: "Keep this", timestamp: Date.now() });
			setSessionProject(manager, "research");
			expect(getSessionPinned(manager)).toBe(false);
			setSessionPinned(manager, true);
			const reopened = SessionManager.open(manager.getSessionFile()!);
			expect(getSessionPinned(reopened)).toBe(true);
			expect(getSessionProject(reopened)).toBe("research");
			expect(JSON.stringify(reopened.buildSessionContext())).toContain("Keep this");
			setSessionPinned(reopened, false);
			expect(getSessionPinned(SessionManager.open(reopened.getSessionFile()!))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("retains session identity, history and cwd when moved between canonical projects", () => {
		const root = mkdtempSync(join(tmpdir(), "porcupine-project-link-"));
		try {
			const session = SessionManager.create(root, join(root, "sessions"));
			session.appendMessage({ role: "user", content: "Original work", timestamp: Date.now() });
			const id = session.getSessionId();
			setSessionProject(session, join(root, "Project", "research"));
			let reopened = SessionManager.open(session.getSessionFile()!);
			expect(getSessionProject(reopened)).toBe(join(root, "Project", "research"));
			expect(reopened.getSessionId()).toBe(id);
			expect(reopened.getCwd()).toBe(root);
			expect(JSON.stringify(reopened.buildSessionContext().messages)).toContain("Original work");
			setSessionProject(reopened, null);
			reopened = SessionManager.open(reopened.getSessionFile()!);
			expect(getSessionProject(reopened)).toBeNull();
			const original = reopened.getSessionFile()!;
			const result = moveSessionToTrash(reopened);
			expect(existsSync(original)).toBe(false);
			expect(readFileSync(result.trashPath, "utf8")).toContain("Original work");
			reopened.appendCustomEntry("late-event", {});
			reopened.flushPersistOnExit();
			expect(existsSync(original)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
