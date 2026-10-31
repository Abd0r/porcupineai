import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@porcupineai/ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { startServeApi } from "../src/server/http-api.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("durable conversation policy", () => {
	const cleanup: Array<() => void> = [];
	afterEach(() => {
		for (const dispose of cleanup.splice(0).reverse()) dispose();
	});

	async function fixture(reasoning = false) {
		const root = mkdtempSync(join(tmpdir(), "porcupine-policy-"));
		cleanup.push(() => rmSync(root, { recursive: true, force: true }));
		const faux = registerFauxProvider();
		cleanup.push(() => faux.unregister());
		const model = { ...faux.getModel(), reasoning };
		const credentials = AuthStorage.inMemory();
		await credentials.modify(model.provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials,
			modelsPath: join(root, "models.json"),
			allowModelNetwork: false,
		});
		modelRuntime.registerProvider(model.provider, { baseUrl: model.baseUrl, api: model.api, models: [{ ...model }] });
		const manager = SessionManager.create(root, join(root, "sessions"));
		async function open(sessionManager = manager, defaultInteractionMode: "ask" | "normal" | "auto" = "normal") {
			const { session } = await createAgentSession({
				cwd: root,
				agentDir: root,
				model,
				modelRuntime,
				sessionManager,
				settingsManager: SettingsManager.inMemory({ defaultInteractionMode, defaultThinkingLevel: "low" }),
				resourceLoader: createTestResourceLoader(),
			});
			cleanup.push(() => session.dispose());
			return session;
		}
		return { manager, open, root, faux };
	}

	it.each(["ask", "normal", "auto"] as const)(
		"restores %s and adaptive mode across fresh SDK clients",
		async (mode) => {
			const { manager, open } = await fixture();
			const terminal = await open();
			terminal.setInteractionMode(mode);
			terminal.setReasoningMode("adaptive");
			terminal.dispose();
			// Deliberately do not flush here: selecting a policy before the first response must survive exit.
			const browser = await open(SessionManager.open(manager.getSessionFile()!));
			browser.setClientSurface("web");
			expect(browser.interactionMode).toBe(mode);
			expect(browser.getReasoningMode()).toBe("adaptive");
			browser.setAutoMode(mode !== "auto");
			browser.setReasoningMode("off");
			const returned = await open(SessionManager.open(manager.getSessionFile()!));
			expect(returned.interactionMode).toBe(mode !== "auto" ? "auto" : "normal");
			expect(returned.getReasoningMode()).toBe("off");
		},
	);

	it("keeps branch policy isolated and restores it when navigating", async () => {
		const { manager, open } = await fixture();
		const session = await open();
		session.setInteractionMode("ask");
		session.setAdaptiveReasoning(true);
		const safeLeaf = manager.getLeafId()!;
		session.setInteractionMode("auto");
		session.setAdaptiveReasoning(false);
		await session.navigateTree(safeLeaf);
		expect(session.interactionMode).toBe("ask");
		expect(session.isAdaptiveReasoningEnabled).toBe(true);
		expect((await open(SessionManager.open(manager.getSessionFile()!))).interactionMode).toBe("ask");
	});

	it("restores adaptive effort after a real turn without overwriting the default effort for other chats", async () => {
		const { manager, open, faux } = await fixture(true);
		let calls = 0;
		faux.setResponses([
			() => {
				calls++;
				return fauxAssistantMessage("high");
			},
			() => {
				calls++;
				return fauxAssistantMessage("Verified the implementation");
			},
		]);
		const session = await open();
		session.setReasoningMode("adaptive");
		await session.prompt("Verify this implementation properly");
		expect(calls).toBe(2);
		expect(session.adaptiveLastResolved).toBe("high");
		expect(session.settingsManager.getDefaultThinkingLevel()).toBe("low");
		manager.forceFlushToDisk();
		session.dispose();
		const restored = await open(SessionManager.open(manager.getSessionFile()!));
		expect(restored.getReasoningMode()).toBe("adaptive");
		expect(restored.thinkingLevel).toBe("high");
		expect(restored.adaptiveLastResolved).toBe("high");
		restored.toggleAdaptiveReasoning();
		expect(restored.adaptiveLastResolved).toBeUndefined();
		expect((await open(SessionManager.open(manager.getSessionFile()!))).getReasoningMode()).toBe("high");
	});

	it("retains the initial default in a saved checkpoint without an explicit mode change", async () => {
		const { manager, open } = await fixture();
		const terminal = await open(manager, "ask");
		manager.forceFlushToDisk();
		terminal.dispose();
		expect((await open(SessionManager.open(manager.getSessionFile()!))).interactionMode).toBe("ask");
	});

	it("round-trips authenticated GUI controls into a newly opened terminal session", async () => {
		const { manager, open, root } = await fixture();
		const terminal = await open(manager, "ask");
		terminal.setAdaptiveReasoning(true);
		terminal.dispose();
		const browser = await open(SessionManager.open(manager.getSessionFile()!));
		const adapted = adaptSessionToServeApi(browser, root);
		adapted.setClientSurface?.("web");
		const handle = await startServeApi({ session: adapted, port: 0, token: "policy-regression" });
		const url = `http://127.0.0.1:${handle.port()}/session/${adapted.id}/controls`;
		const headers = { authorization: "Bearer policy-regression", "content-type": "application/json" };
		try {
			const current = await fetch(url, { headers });
			expect(await current.json()).toMatchObject({ interactionMode: "ask", reasoningMode: "adaptive" });
			for (const patch of [{ interactionMode: "auto" }, { reasoningMode: "off" }]) {
				const response = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(patch) });
				expect(response.status).toBe(200);
			}
			browser.dispose();
			const returned = await open(SessionManager.open(manager.getSessionFile()!));
			expect(returned.interactionMode).toBe("auto");
			expect(returned.getReasoningMode()).toBe("off");
			expect(returned.sessionId).toBe(terminal.sessionId);
			expect(JSON.stringify(returned.messages)).not.toContain("porcupine.session-policy");
		} finally {
			await handle.close();
		}
	});

	it("does not leak conversation choices into a new session", async () => {
		const { manager, open, root } = await fixture();
		const first = await open();
		first.setAutoMode(true);
		first.toggleAdaptiveReasoning();
		const fresh = await open(SessionManager.create(root, manager.getSessionDir()));
		expect(fresh.interactionMode).toBe("normal");
		expect(fresh.isAdaptiveReasoningEnabled).toBe(false);
	});

	it.each([
		{ version: 1, interactionMode: "auto", adaptive: "yes" },
		{ version: 1, interactionMode: ["auto"], adaptive: true },
		{ version: 2, interactionMode: "auto", adaptive: true },
		{ version: 1, interactionMode: "auto", adaptive: true, adaptiveLastResolved: "unknown" },
	])("rejects malformed latest policy %j without resurrecting older Auto authority", async (record) => {
		const { manager, open } = await fixture();
		const session = await open();
		session.setAutoMode(true);
		manager.appendCustomEntry("porcupine.session-policy", record);
		manager.forceFlushToDisk();
		const restored = await open(SessionManager.open(manager.getSessionFile()!));
		expect(restored.interactionMode).toBe("ask");
		expect(restored.isAdaptiveReasoningEnabled).toBe(false);
	});

	it("clamps refreshed concrete reasoning to the active model", async () => {
		const { open } = await fixture();
		const session: AgentSession = await open();
		session.restoreEphemeralSessionState({
			interactionMode: "ask",
			autoModeEnabled: false,
			reasoningMode: "adaptive",
			thinkingLevel: "high",
			adaptiveLastResolved: "high",
		});
		expect(session.getAvailableThinkingLevels()).toContain(session.thinkingLevel);
		expect(session.adaptiveLastResolved).toBe(session.thinkingLevel);
	});
});
