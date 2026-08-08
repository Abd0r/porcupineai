import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@porcupineai/ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

/**
 * Interaction-mode regressions: /auto and /modes must drive one canonical
 * state, mode switches must reach the live bash guard without a session
 * rebuild, and Ask mode must confirm commands through the wired callback.
 */
describe("interaction modes on the session", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `porcupine-modes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function createSession(confirmCallback?: (title: string, message: string) => Promise<boolean>) {
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.create(tempDir, join(agentDir, "sessions"), { id: "modes-test" });
		const resourceLoader = new DefaultResourceLoader({ cwd: tempDir, agentDir, settingsManager });
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model,
			thinkingLevel: "high",
			settingsManager,
			sessionManager,
			resourceLoader,
			confirmCallback,
		});
		return session;
	}

	it("keeps /auto and /modes on one canonical state", async () => {
		const session = await createSession();
		try {
			expect(session.interactionMode).toBe("normal");
			expect(session.isAutoModeEnabled).toBe(false);

			session.setAutoMode(true);
			expect(session.interactionMode).toBe("auto");
			expect(session.isAutoModeEnabled).toBe(true);

			session.toggleAutoMode();
			expect(session.interactionMode).toBe("normal");
			expect(session.isAutoModeEnabled).toBe(false);

			session.setInteractionMode("auto");
			expect(session.isAutoModeEnabled).toBe(true);
		} finally {
			session.dispose();
		}
	});

	it("restores legacy snapshots where /auto and /modes disagreed as Auto", async () => {
		const session = await createSession();
		try {
			// Legacy snapshot: /auto was a separate flag, so autoModeEnabled=true
			// could coexist with interactionMode="normal". Auto was the intent.
			session.restoreEphemeralSessionState({
				interactionMode: "normal",
				autoModeEnabled: true,
				reasoningMode: "high",
				thinkingLevel: "high",
			});
			expect(session.interactionMode).toBe("auto");
			expect(session.isAutoModeEnabled).toBe(true);
		} finally {
			session.dispose();
		}
	});

	it("asks in Ask mode and switches the guard live without a rebuild", async () => {
		const confirmations: string[] = [];
		const session = await createSession(async (title, _message) => {
			confirmations.push(title);
			return false;
		});
		try {
			const bashTool = session.agent.state.tools.find((tool) => tool.name === "bash")!;

			// Normal mode: a safe command runs directly, no confirmation asked.
			const normal = await bashTool.execute("bash-1", { command: "printf ok" });
			expect(normal.content).toBeDefined();
			expect(confirmations).toHaveLength(0);

			// Switch to Ask at runtime: the same safe command now requires the
			// wired confirm callback — denied because it returns false.
			session.setInteractionMode("ask");
			await expect(bashTool.execute("bash-2", { command: "printf ok" })).rejects.toThrow(/denied/i);
			expect(confirmations).toHaveLength(1);

			// Back to Normal: runs directly again (no rebuild needed).
			session.setInteractionMode("normal");
			await bashTool.execute("bash-3", { command: "printf ok" });
			expect(confirmations).toHaveLength(1);
		} finally {
			session.dispose();
		}
	});

	it("confirms file mutations only in Ask mode, failing closed without a human", async () => {
		const confirmations: string[] = [];
		const session = await createSession(async (title, _message) => {
			confirmations.push(title);
			return false;
		});
		try {
			const filePath = join(tempDir, "modes.txt");
			writeFileSync(filePath, "before\n");
			const editTool = session.agent.state.tools.find((tool) => tool.name === "edit")!;

			// Normal mode: edits run directly.
			const normal = await editTool.execute("edit-1", {
				path: "modes.txt",
				edits: [{ oldText: "before", newText: "mid" }],
			});
			expect(normal.content).toBeDefined();
			expect(confirmations).toHaveLength(0);

			// Ask mode with a callback: confirm is asked and denied.
			session.setInteractionMode("ask");
			await expect(
				editTool.execute("edit-2", { path: "modes.txt", edits: [{ oldText: "mid", newText: "after" }] }),
			).rejects.toThrow(/denied/i);
			expect(confirmations).toHaveLength(1);

			// Headless Ask (no callback wired): mutation fails closed, does not run.
			const headless = await createSession();
			try {
				headless.setInteractionMode("ask");
				const headlessEdit = headless.agent.state.tools.find((tool) => tool.name === "edit")!;
				await expect(
					headlessEdit.execute("edit-3", {
						path: "modes.txt",
						edits: [{ oldText: "mid", newText: "gone" }],
					}),
				).rejects.toThrow(/denied/i);
			} finally {
				headless.dispose();
			}
		} finally {
			session.dispose();
		}
	});
});
