/**
 * Serve mode (`porcupine serve`): run the agent as a headless HTTP service.
 *
 * Reuses the exact runtime bootstrap main.ts already builds (project trust,
 * providers, settings, extensions) and exposes it through the HTTP API in
 * {@link src/server/http-api.ts} — the OpenCode-style server surface:
 *
 *   GET    /health
 *   GET    /session
 *   POST   /session
 *   POST   /session/:id/message   { text }
 *   POST   /session/:id/abort
 *   GET    /session/:id/status
 *   POST   /session/:id/permissions/:permissionId/response  { allow }
 *   GET    /session/:id/events    (Server-Sent Events)
 *
 * The server stays alive until SIGINT/SIGTERM, then shuts down the runtime.
 */

import { randomUUID } from "node:crypto";
import { VERSION } from "../config.ts";
import type { AgentSession } from "../core/agent-session.ts";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { SessionManager } from "../core/session-manager.ts";
import { type ServeApiSession, startServeApi } from "../server/http-api.ts";
import { ContextFileStore, WorkbenchError } from "../server/workbench-context-files.ts";
import { WorkbenchProjectStore } from "../server/workbench-projects.ts";
import { createSessionSurfaces } from "../server/workbench-session-surfaces.ts";
import { serializeWorkbenchHistory } from "../server/workbench-transcript.ts";

export interface ServeModeOptions {
	port?: number;
	host?: string;
	/** Optional bearer token. When binding a non-loopback host, a token is required. */
	token?: string;
}

/**
 * Adapt a live AgentSession to the HTTP API's minimal session surface.
 * Exported separately so tests can drive the API against a real session
 * without running the blocking server loop.
 */

/** True when the serve host is a loopback destination; an empty host means loopback-default. */
export function isLoopbackHost(host: string | undefined): boolean {
	if (!host) return true;
	const h = host
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
	return h === "localhost" || h === "::1" || h === "::" || h === "127.0.0.1" || /^127\./.test(h);
}

export function adaptSessionToServeApi(session: AgentSession): ServeApiSession {
	const enableVisualTools = () => {
		if (session.isStreaming || session.clientSurface !== "web") return;
		const active = session.getActiveToolNames();
		const visuals = ["visualize", "visualize_3d"].filter(
			(name) => session.getToolDefinition(name) && !active.includes(name),
		);
		if (visuals.length) session.setActiveToolsByName([...active, ...visuals]);
	};
	const goalPlanListeners = new Set<(view: unknown) => void>();
	const tracker = () => ({ goal: session.getGoal(), busy: session.isStreaming });
	const subagentSnapshot = () =>
		session.subagentState.runs.map(({ id, name, task, status }) => ({
			id,
			name,
			task,
			status,
		}));
	session.subscribe((event) => {
		if (event.type !== "goal_changed") return;
		for (const listener of goalPlanListeners) listener(tracker());
	});
	return {
		...createSessionSurfaces(session),
		setClientSurface: (surface) => {
			session.setClientSurface(surface);
			enableVisualTools();
		},
		getGoalPlan: () => tracker(),
		onGoalPlanChange: (listener) => {
			goalPlanListeners.add(listener);
			return () => goalPlanListeners.delete(listener);
		},
		id: session.sessionId,
		sendUserMessage: async (text) => {
			enableVisualTools();
			await session.sendUserMessage(text);
		},
		abort: async () => {
			await session.abort();
		},
		isStreaming: () => session.isStreaming,
		getTimeline: () => serializeWorkbenchHistory(session.sessionManager.getBranch()),
		getSubagents: subagentSnapshot,
		onEvent: (listener) => {
			const events = session.subscribe((event) => listener(event));
			let previous = JSON.stringify(subagentSnapshot());
			const subagents = session.onSubagentEvent(() => {
				const runs = subagentSnapshot(),
					fingerprint = JSON.stringify(runs);
				if (fingerprint === previous) return;
				previous = fingerprint;
				listener({ type: "subagents", runs });
			});
			return () => {
				events();
				subagents();
			};
		},
		onConfirm: (handler) => {
			session.setConfirmCallback(async (title, message) => {
				return new Promise<boolean>((resolve) => {
					// Unguessable permission nonce: never expose a predictable,
					// timestamp+sequence id a caller could guess and approve.
					const id = `perm-${randomUUID()}`;
					handler({ id, title, message }, (allow) => resolve(allow));
				});
			});
			return () => session.setConfirmCallback(undefined);
		},
	};
}

/**
 * Run the headless serve mode. Resolves with an exit code when the process is
 * interrupted (SIGINT/SIGTERM) or the server errors.
 */
export async function runServeMode(runtime: AgentSessionRuntime, options: ServeModeOptions): Promise<number> {
	if (!isLoopbackHost(options.host) && !options.token) {
		process.stderr.write(
			"Refusing to bind a non-loopback host without a token. Pass --token or set PORCUPINE_SERVER_TOKEN.\n",
		);
		return 1;
	}

	runtime.session.setClientSurface("none");
	const additionalRuntimes = new Set<AgentSessionRuntime>();
	const discover = async () => {
		const [local, all] = await Promise.all([
			SessionManager.list(runtime.cwd, runtime.session.sessionManager.getSessionDir()),
			SessionManager.listAll(),
		]);
		return [...new Map([...all, ...local].map((item) => [item.id, item])).values()];
	};
	const attach = async (manager: SessionManager) => {
		const sibling = await runtime.createSibling(manager);
		sibling.session.setClientSurface("none");
		additionalRuntimes.add(sibling);
		return adaptSessionToServeApi(sibling.session);
	};

	const handle = await startServeApi({
		session: adaptSessionToServeApi(runtime.session),
		listSessions: async () =>
			(await discover()).map((item) => ({
				id: item.id,
				name: item.name || item.firstMessage.slice(0, 80) || undefined,
			})),
		openSession: async (id) => {
			const saved = (await discover()).find((item) => item.id === id);
			if (!saved) throw new WorkbenchError(404, "Saved conversation not found");
			return attach(SessionManager.open(saved.path));
		},
		createSession: async () =>
			attach(SessionManager.create(runtime.cwd, runtime.session.sessionManager.getSessionDir())),
		port: options.port,
		host: options.host,
		token: options.token,
		version: VERSION,
		contextFiles: new ContextFileStore(runtime.cwd, runtime.services.agentDir),
		projects: new WorkbenchProjectStore(runtime.cwd),
	});

	process.stderr.write(`Porcupine serve listening on http://${options.host ?? "127.0.0.1"}:${handle.port()}\n`);
	if (!options.token) {
		if (process.env.PORCUPINE_SERVE_ALLOW_TOKENLESS !== "1") {
			// Fail closed: no token and no explicit opt-in means every request is
			// rejected (401) by the server. Prompt the operator to set a token.
			process.stderr.write(
				"Error: no serve token set. Requests will be rejected (401). Pass --token, set PORCUPINE_SERVER_TOKEN,\n" +
					"or opt into tokenless loopback mode with PORCUPINE_SERVE_ALLOW_TOKENLESS=1.\n",
			);
		} else {
			process.stderr.write("Tokenless loopback mode is enabled (PORCUPINE_SERVE_ALLOW_TOKENLESS=1).\n");
		}
	}

	await new Promise<void>((resolve) => {
		const onSignal = (): void => resolve();
		process.once("SIGINT", onSignal);
		process.once("SIGTERM", onSignal);
	});

	await handle.close();
	for (const sibling of additionalRuntimes) await sibling.dispose();
	await runtime.dispose();
	return 0;
}
