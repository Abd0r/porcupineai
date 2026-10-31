import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@porcupineai/ai/compat";
import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { PorcupineTaskStore } from "../src/porcupine/task-scheduler.ts";
import { AttendedTaskRunner } from "../src/server/attended-task-runner.ts";
import { startServeApi } from "../src/server/http-api.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("scheduled tasks through the SDK and authenticated GUI", () => {
	it.each([false, true])("preserves TUI context and enforces the GUI approval decision (%s)", async (allow) => {
		const root = mkdtempSync(join(tmpdir(), "porcupine-gui-cron-sdk-"));
		const faux = registerFauxProvider();
		const output = join(root, "verified.txt");
		let modelContext = "";
		faux.setResponses([
			(context) => {
				modelContext = JSON.stringify(context.messages);
				return fauxAssistantMessage(fauxToolCall("write", { path: output, content: "Verified file" }), {
					stopReason: "toolUse",
				});
			},
			() => {
				if (!allow)
					return fauxAssistantMessage("", { stopReason: "error", errorMessage: "Write permission denied" });
				expect(readFileSync(output, "utf8")).toBe("Verified file");
				return fauxAssistantMessage("Verified the saved file contents.");
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
		modelRuntime.registerProvider(model.provider, { baseUrl: model.baseUrl, api: model.api, models: [{ ...model }] });
		const manager = SessionManager.create(root, join(root, "sessions"));
		manager.appendMessage({
			role: "user",
			content: "TUI checkpoint: preserve the project context",
			timestamp: Date.now(),
		});
		manager.forceFlushToDisk();
		const { session } = await createAgentSession({
			cwd: root,
			agentDir: root,
			modelRuntime,
			model,
			sessionManager: SessionManager.open(manager.getSessionFile()!),
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
			resourceLoader: createTestResourceLoader(),
		});
		session.setInteractionMode("ask");
		session.setClientSurface("none");
		const store = new PorcupineTaskStore(root);
		const task = store.createTask({ title: "Verify file", prompt: "Write the requested file and verify it." });
		store.queueTaskRun(task.id);
		const runner = new AttendedTaskRunner(root);
		const api = runner.register(session, adaptSessionToServeApi(session, root));
		const handle = await startServeApi({ session: api, port: 0, token: "task-test-token" });
		const base = `http://127.0.0.1:${handle.port()}`;
		const controller = new AbortController();
		const events: string[] = [];
		let stream: Promise<void> | undefined;
		try {
			await runner.tick();
			expect(store.listRuns()[0]?.status).toBe("claimed");
			const response = await fetch(`${base}/session/${api.id}/events`, {
				headers: { authorization: "Bearer task-test-token" },
				signal: controller.signal,
			});
			const reader = response.body!.getReader();
			stream = (async () => {
				const decoder = new TextDecoder();
				let buffer = "";
				for (;;) {
					const { done, value } = await reader.read();
					if (done) return;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop()!;
					for (const line of lines) if (line.startsWith("data: ")) events.push(line.slice(6));
				}
			})().catch((error: unknown) => {
				if (!controller.signal.aborted) throw error;
			});
			await expect.poll(() => events.find((event) => event.includes('"type":"permission_request"'))).toBeDefined();
			const permission = JSON.parse(events.find((event) => event.includes('"type":"permission_request"'))!) as {
				permissionId: string;
			};
			expect(existsSync(output)).toBe(false);
			const approval = await fetch(`${base}/session/${api.id}/permissions/${permission.permissionId}/response`, {
				method: "POST",
				headers: { authorization: "Bearer task-test-token", "content-type": "application/json" },
				body: JSON.stringify({ allow }),
			});
			expect(approval.status).toBe(200);
			await expect.poll(() => store.listRuns()[0]?.status).toBe(allow ? "completed" : "failed");
			expect(existsSync(output)).toBe(allow);
			expect(modelContext).toContain("TUI checkpoint");
			expect(modelContext).toContain("Porcupine Task: Verify file");
			session.sessionManager.forceFlushToDisk();
			const terminal = SessionManager.open(manager.getSessionFile()!);
			expect(JSON.stringify(terminal.buildSessionContext().messages)).toContain("Porcupine Task: Verify file");
			expect(new PorcupineTaskStore(root).listRuns()).toEqual(store.listRuns());
			expect(events.some((event) => event.includes('"type":"message_end"'))).toBe(true);
		} finally {
			runner.stop();
			controller.abort();
			await stream;
			await handle.close();
			await runner.close();
			session.dispose();
			faux.unregister();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
