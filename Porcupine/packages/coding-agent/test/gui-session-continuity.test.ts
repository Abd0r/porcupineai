import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@porcupineai/ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createSessionManager } from "../src/main.ts";
import { adaptSessionToServeApi, listServeSessions } from "../src/modes/serve-mode.ts";
import { startServeApi } from "../src/server/http-api.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("TUI to GUI session continuity", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function savedConversation() {
		const root = mkdtempSync(join(tmpdir(), "porcupine-gui-continuity-"));
		roots.push(root);
		const sessionDir = join(root, "sessions");
		const manager = SessionManager.create(root, sessionDir);
		manager.appendMessage({ role: "user", content: "Continue the TUI implementation", timestamp: Date.now() });
		manager.forceFlushToDisk();
		return { root, sessionDir, manager };
	}

	it("opens the saved TUI conversation by default when launching the GUI", async () => {
		const { root, sessionDir, manager } = savedConversation();
		const resumed = await createSessionManager(parseArgs(["--gui"]), root, sessionDir, SettingsManager.inMemory());
		expect(resumed.getSessionId()).toBe(manager.getSessionId());
		expect(resumed.buildSessionContext().messages).toEqual(manager.buildSessionContext().messages);
	});

	it.each([[], ["--serve"], ["--gui", "--no-session"], ["--gui", "--name", "New work"]])(
		"preserves explicit fresh-session behavior for %j",
		async (...args) => {
			const { root, sessionDir, manager } = savedConversation();
			const selected = await createSessionManager(parseArgs(args), root, sessionDir, SettingsManager.inMemory());
			expect(selected.getSessionId()).not.toBe(manager.getSessionId());
			expect(selected.buildSessionContext().messages).toEqual([]);
		},
	);

	it("honors an explicit GUI session id instead of selecting another conversation", async () => {
		const { root, sessionDir, manager } = savedConversation();
		const selected = await createSessionManager(
			parseArgs(["--gui", "--session-id", manager.getSessionId()]),
			root,
			sessionDir,
			SettingsManager.inMemory(),
		);
		expect(selected.getSessionId()).toBe(manager.getSessionId());
	});

	it("discovers saved TUI conversations from other workspaces in a custom session directory", async () => {
		const { sessionDir, manager } = savedConversation();
		const sessions = await listServeSessions(sessionDir);
		expect(sessions.some((session) => session.id === manager.getSessionId())).toBe(true);
	});

	it("replays TUI history and sends it to the model on the next GUI turn, persisting into the same file", async () => {
		const { root, sessionDir, manager } = savedConversation();
		const faux = registerFauxProvider();
		let resumedContext = "";
		faux.setResponses([
			fauxAssistantMessage("TUI implementation checkpoint"),
			(context) => {
				resumedContext = JSON.stringify(context.messages);
				return fauxAssistantMessage("GUI continuation completed");
			},
		]);
		const credentials = AuthStorage.inMemory();
		const model = faux.getModel();
		await credentials.modify(model.provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials,
			modelsPath: join(root, "models.json"),
			allowModelNetwork: false,
		});
		modelRuntime.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			api: model.api,
			models: [{ ...model }],
		});
		const options = {
			cwd: root,
			agentDir: root,
			modelRuntime,
			model,
			resourceLoader: createTestResourceLoader(),
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
		};
		const terminal = await createAgentSession({ ...options, sessionManager: manager });
		try {
			await terminal.session.prompt("Remember the TUI checkpoint");
			manager.forceFlushToDisk();
		} finally {
			terminal.session.dispose();
		}
		const selected = await createSessionManager(parseArgs(["--gui"]), root, sessionDir, options.settingsManager);
		const browser = await createAgentSession({ ...options, sessionManager: selected });
		const adapted = adaptSessionToServeApi(browser.session, root);
		adapted.setClientSurface?.("web");
		const handle = await startServeApi({ session: adapted, port: 0, token: "test-continuity" });
		try {
			expect(JSON.stringify(adapted.getTimeline?.())).toContain("TUI implementation checkpoint");
			const response = await fetch(`http://127.0.0.1:${handle.port()}/session/${adapted.id}/message`, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: "Bearer test-continuity" },
				body: JSON.stringify({ text: "Continue from the GUI checkpoint" }),
			});
			expect(response.status).toBe(202);
			await expect.poll(() => JSON.stringify(browser.session.messages)).toContain("GUI continuation completed");
			expect(resumedContext).toContain("TUI implementation checkpoint");
			expect(resumedContext).toContain("Continue from the GUI checkpoint");
			expect(selected.getSessionFile()).toBe(manager.getSessionFile());
			selected.forceFlushToDisk();
			const reopened = SessionManager.open(manager.getSessionFile()!);
			expect(JSON.stringify(reopened.buildSessionContext().messages)).toContain("GUI continuation completed");
		} finally {
			await handle.close();
			browser.session.dispose();
			faux.unregister();
		}
	});
});
