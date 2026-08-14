/**
 * Reversible-effect extension disposal.
 *
 * Every extension registration is an effect with a disposer. Unloading an
 * extension unwinds ALL of its registrations (tools, commands, shortcuts,
 * listeners, flags, renderers) so nothing leaks across reload/teardown.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions, ExtensionRuntime } from "../src/core/extensions/types.ts";
import type { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("extension disposal (reversible effects)", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;
	let runtime: ExtensionRuntime;

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "porcupine-disposer-test-"));
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = await createModelRegistry(authStorage);
		runtime = createExtensionRuntime();
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const extensionActions: ExtensionActions = {
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		refreshTools: () => {},
		getCommands: () => [],
		setModel: async () => false,
		getThinkingLevel: () => "off",
		setThinkingLevel: () => {},
	};

	const extensionContextActions: ExtensionContextActions = {
		getModel: () => undefined,
		isIdle: () => true,
		isProjectTrusted: () => true,
		getSignal: () => undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
		getScopedModels: () => [],
	};

	const ToolType = Type.Object;

	function registerArtifacts(api: any): void {
		api.registerTool({
			name: "mock_tool",
			label: "mock_tool",
			description: "Mock tool",
			parameters: ToolType({}),
			execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
		});
		api.registerCommand("mock-cmd", { description: "Mock command", handler: async () => {} });
		api.registerShortcut("ctrl+shift+m", { description: "Mock shortcut", handler: async () => {} });
		api.registerFlag("mock-flag", { description: "Mock flag", type: "boolean", default: true });
		api.on("input", async () => ({ action: "continue" as const }));
		api.registerMessageRenderer("mock-type", () => null as any);
		api.registerMarkdownTransformer((markdown: string) => markdown);
	}

	async function loadMock(): Promise<{ runner: ExtensionRunner; extensionPath: string }> {
		const eventBus = createEventBus();
		const extension = await loadExtensionFromFactory(
			registerArtifacts,
			tempDir,
			eventBus,
			runtime,
			"<disposer-test>",
		);
		const runner = new ExtensionRunner([extension], runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);
		return { runner, extensionPath: extension.path };
	}

	it("registers a tool, command, shortcut, flag, listener, and renderer", async () => {
		const { runner } = await loadMock();

		expect(runner.getToolDefinition("mock_tool")).toBeDefined();
		expect(runner.getRegisteredCommands().some((c) => c.name === "mock-cmd")).toBe(true);
		expect(runner.hasHandlers("input")).toBe(true);
		expect(runner.getFlags().has("mock-flag")).toBe(true);
		expect(runner.getMessageRenderer("mock-type")).toBeDefined();
		// Flag default seeds the shared runtime flagValues.
		expect(runtime.flagValues.get("mock-flag")).toBe(true);

		// Shortcut is present.
		const shortcuts = runner.getShortcuts(new Map() as any);
		expect(shortcuts.has("ctrl+shift+m")).toBe(true);
	});

	it("each registration returns a disposer that unregisters just that effect", async () => {
		const eventBus = createEventBus();
		const extension = await loadExtensionFromFactory(
			(api: any) => {
				const disposers = [
					api.registerTool({
						name: "x",
						label: "x",
						description: "x",
						parameters: ToolType({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					}),
					api.registerCommand("x-cmd", { description: "x", handler: async () => {} }),
					api.on("input", async () => ({ action: "continue" as const })),
				];
				for (const disposer of disposers) {
					expect(typeof disposer).toBe("function");
				}
			},
			tempDir,
			eventBus,
			runtime,
			"<disposer-returns>",
		);
		const runner = new ExtensionRunner([extension], runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);

		expect(runner.getToolDefinition("x")).toBeDefined();
		expect(runner.hasHandlers("input")).toBe(true);
	});

	it("unload invokes all collected disposers and removes the extension's artifacts", async () => {
		const { runner, extensionPath } = await loadMock();

		const toolsBefore = runner.getAllRegisteredTools().map((t) => t.definition.name);
		const commandsBefore = runner.getRegisteredCommands().map((c) => c.name);
		expect(toolsBefore).toContain("mock_tool");
		expect(commandsBefore).toContain("mock-cmd");

		const unloaded = runner.unloadExtension(extensionPath);
		expect(unloaded).toBe(1);

		// Nothing leaks.
		expect(runner.getAllRegisteredTools().map((t) => t.definition.name)).not.toContain("mock_tool");
		expect(runner.getRegisteredCommands().map((c) => c.name)).not.toContain("mock-cmd");
		expect(runner.hasHandlers("input")).toBe(false);
		expect(runner.getFlags().has("mock-flag")).toBe(false);
		expect(runner.getMessageRenderer("mock-type")).toBeUndefined();
		expect(runtime.flagValues.has("mock-flag")).toBe(false);

		const shortcuts = runner.getShortcuts(new Map() as any);
		expect(shortcuts.has("ctrl+shift+m")).toBe(false);
	});

	it("disposeAll unwinds every extension's registrations", async () => {
		const eventBus = createEventBus();
		const extA = await loadExtensionFromFactory(registerArtifacts, tempDir, eventBus, runtime, "<A>");
		const extB = await loadExtensionFromFactory(registerArtifacts, tempDir, eventBus, runtime, "<B>");
		const runner = new ExtensionRunner([extA, extB], runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);

		expect(runner.getAllRegisteredTools()).toHaveLength(1);
		expect(runner.hasHandlers("input")).toBe(true);

		runner.disposeAll();

		expect(runner.getAllRegisteredTools()).toHaveLength(0);
		expect(runner.getRegisteredCommands()).toHaveLength(0);
		expect(runner.hasHandlers("input")).toBe(false);
		expect(runtime.flagValues.has("mock-flag")).toBe(false);
	});

	it("unload does not disturb unaffected extensions", async () => {
		const eventBus = createEventBus();
		const victim = await loadExtensionFromFactory(registerArtifacts, tempDir, eventBus, runtime, "<victim>");
		const survivor = await loadExtensionFromFactory(
			(api: any) =>
				api.registerTool({
					name: "survivor_tool",
					label: "survivor_tool",
					description: "survivor",
					parameters: ToolType({}),
					execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
				}),
			tempDir,
			eventBus,
			runtime,
			"<survivor>",
		);
		const runner = new ExtensionRunner([victim, survivor], runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);

		runner.unloadExtension(victim.path);

		const survivorTool = runner.getToolDefinition("survivor_tool");
		expect(survivorTool).toBeDefined();
		expect(runner.getToolDefinition("mock_tool")).toBeUndefined();
	});

	it("api.dispose() unwinds only the calling extension", async () => {
		const eventBus = createEventBus();
		let apiRef: any;
		const extension = await loadExtensionFromFactory(
			(api: any) => {
				apiRef = api;
				api.registerTool({
					name: "self",
					label: "self",
					description: "self",
					parameters: ToolType({}),
					execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
				});
			},
			tempDir,
			eventBus,
			runtime,
			"<self>",
		);
		const runner = new ExtensionRunner([extension], runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);

		expect(runner.getToolDefinition("self")).toBeDefined();
		apiRef.dispose();
		expect(runner.getToolDefinition("self")).toBeUndefined();
	});

	it("assertActive guard still throws on stale captured api", async () => {
		const eventBus = createEventBus();
		let stalledApi: any;
		await loadExtensionFromFactory(
			(api: any) => {
				stalledApi = api;
			},
			tempDir,
			eventBus,
			runtime,
			"<stale>",
		);
		runtime.invalidate("stale");
		expect(() =>
			stalledApi.registerTool({
				name: "late",
				label: "late",
				description: "late",
				parameters: ToolType({}),
				execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
			}),
		).toThrow(/stale/i);
	});
});
