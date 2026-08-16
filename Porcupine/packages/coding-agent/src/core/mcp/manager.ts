/**
 * MCP (Model Context Protocol) v1 client — McpManager.
 *
 * Owns one SDK `Client` per enabled stdio server, orchestrates
 * start→connect→list→register and stop/restart lifecycle, and surfaces
 * per-server health status. Registered tools are synthesized as Porcupine
 * `ToolDefinition`s and pushed through an injected registrar (the session
 * wires this into `_customTools` + `_refreshToolRegistry()`).
 *
 * Lifecycle:
 *   - `loadAndStart()` reads merged config and starts each enabled server.
 *   - `stopAll()` stops all servers (session shutdown).
 *   - restart-with-backoff on unexpected child exit.
 */

import { join } from "node:path";
import type { AgentToolResult, ToolExecutionMode } from "@porcupineai/agent-core";
import type { Model } from "@porcupineai/ai";
import type { TSchema } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { defineTool } from "../extensions/types.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import {
	type McpBackend,
	McpHttpBackend,
	McpStdioBackend,
	type McpToolInfo,
	normalizeConnectError,
	sanitizeToolDescription,
	translateSchema,
	UnsupportedSchemaError,
} from "./backend.ts";
import { type LoadedMcpConfig, loadMcpConfig } from "./config.ts";
import { createOAuthProvider, McpOAuthKeyringCache, type McpOAuthTokenCache } from "./oauth.ts";
import { mapPromptInfo, mapPromptMessages, mapResourceInfo, mapResourceReadText } from "./resources.ts";
import {
	createMcpToolGuard,
	FileMcpApprovalStore,
	InMemoryMcpApprovalStore,
	type McpApprovalStore,
	type McpToolGuard,
} from "./security.ts";
import type { McpServerHealth, McpServerStatus, ResolvedMcpServer } from "./types.ts";

/**
 * Default approval store: file-backed when an agent dir is available so
 * approvals survive restarts, falling back to per-session in-memory otherwise.
 */
function defaultApprovalStore(agentDir: string | undefined): McpApprovalStore {
	if (agentDir) return new FileMcpApprovalStore(join(agentDir, "mcp-approvals.json"));
	return new InMemoryMcpApprovalStore();
}

/** Registrar the session implements to push MCP tools into the live registry. */
export interface McpToolRegistrar {
	/** Replace all tools for a server (used on (re)connect/reload). */
	setServerTools(serverKey: string, defs: ToolDefinition[]): void;
	/** Remove all tools for a server (shutdown/disable). */
	removeServer(serverKey: string): void;
	/** Trigger a registry refresh (_refreshToolRegistry). */
	refresh(): void;
}

export interface McpManagerOptions {
	cwd: string;
	agentDir?: string;
	/** Live interaction-mode accessor (Ask/Normal/Auto). */
	getMode: () => "ask" | "normal" | "auto";
	/** Live project-trust accessor. Project-scoped servers only start when trusted. */
	isProjectTrusted: () => boolean;
	/** Interactive confirm callback for the guard (ask/normal gates). */
	confirm?: (title: string, message: string) => Promise<boolean>;
	modelRuntime: ModelRuntime;
	getModel: () => Model<any> | undefined;
	registrar: McpToolRegistrar;
	/** Approval store; defaults to a file-backed store at agentDir/mcp-approvals.json. */
	approvalStore?: McpApprovalStore;
	/** OAuth token cache; defaults to a file cache at ~/.porcupine/agent. */
	oauthCache?: McpOAuthTokenCache;
}

interface RunningServer {
	resolved: ResolvedMcpServer;
	backend: McpBackend;
	health: McpServerHealth;
	/** Agent tool names registered for this server. */
	toolNames: string[];
	/** Resource URIs surfaced into context for this server. */
	resourceUris: string[];
	/** MCP prompt names surfaced as slash commands for this server. */
	promptNames: string[];
	/** OAuth state string surfaced in status. */
	oauthState?: string;
	error?: string;
	restartAttempts: number;
	restartTimer?: ReturnType<typeof setTimeout>;
}

const RESTART_BASE_MS = 1_000;
const RESTART_MAX_MS = 30_000;

export class McpManager {
	private readonly options: McpManagerOptions;
	private readonly guard: McpToolGuard;
	private readonly approvalStore: McpApprovalStore;
	private readonly oauthCache: McpOAuthTokenCache;
	private running = new Map<string, RunningServer>();
	private shuttingDown = false;
	/** In-flight reload promise; concurrent reload()/onListChanged/backoff calls coalesce onto it. */
	private reloading: Promise<LoadedMcpConfig> | null = null;
	/** Last loaded config (for /mcp status + reload diffs). */
	private loaded: LoadedMcpConfig | undefined;

	constructor(options: McpManagerOptions) {
		this.options = options;
		this.approvalStore = options.approvalStore ?? defaultApprovalStore(options.agentDir);
		this.oauthCache = options.oauthCache ?? new McpOAuthKeyringCache(options.agentDir);
		this.guard = createMcpToolGuard({
			modelRuntime: options.modelRuntime,
			model: options.getModel,
			confirm: options.confirm,
			approvalStore: this.approvalStore,
		});
	}

	/** Re-read config and (re)start enabled servers. Not safe to call while running. */
	async loadAndStart(): Promise<void> {
		if (this.loaded || this.running.size > 0) {
			await this.reload();
			return;
		}
		// Warm the OAuth cache (keychain hydrate) before any server connects so
		// persisted tokens are visible to the sync provider interface.
		await this.oauthCache.load?.();
		await this.reload();
	}

	/** Re-read config, diff start/stop changed/disabled servers, re-hash, refresh tools. */
	async reload(): Promise<LoadedMcpConfig> {
		if (this.reloading) {
			// Re-entrancy guard: onListChanged → reload() and backoff timers can
			// both fire. Coalesce onto the in-progress reload so servers are never
			// double-started and every caller gets the real (non-stale) result.
			return this.reloading;
		}
		this.reloading = this.doReload().finally(() => {
			this.reloading = null;
		});
		return this.reloading;
	}

	private async doReload(): Promise<LoadedMcpConfig> {
		const loaded = loadMcpConfig({ cwd: this.options.cwd, agentDir: this.options.agentDir });
		this.loaded = loaded;

		const projectTrusted = this.options.isProjectTrusted();
		// Project-scoped servers must not auto-execute without project trust.
		const desiredKeys = new Set(
			loaded.servers.filter((s) => s.enabled && (s.scope !== "project" || projectTrusted)).map((s) => s.serverKey),
		);

		// Stop disabled/removed/changed servers.
		for (const [key, running] of [...this.running.entries()]) {
			if (!desiredKeys.has(key)) {
				await this.stopServer(key);
			} else {
				const desired = loaded.servers.find((s) => s.serverKey === key);
				if (desired && desired.contentHash !== running.resolved.contentHash) {
					// Config changed → restart to pick up the new command/args.
					await this.stopServer(key);
				} else if (!desired) {
					await this.stopServer(key);
				}
			}
		}

		// Start newly enabled (and trust-gated) servers — and restart any that
		// are still in a failed state (crashed servers reconnect via reload).
		for (const server of loaded.servers) {
			const running = this.running.get(server.serverKey);
			if (!server.enabled || (server.scope === "project" && !projectTrusted)) continue;
			if (!running || running.health === "failed") {
				await this.startServer(server);
			}
		}

		this.options.registrar.refresh();
		return loaded;
	}

	/** Start one server: connect, list tools (+ resources/prompts for http), register. */
	private async startServer(
		resolved: ResolvedMcpServer,
		options: { skipAuthShortCircuit?: boolean } = {},
	): Promise<void> {
		const backend = this.createBackend(resolved);
		const entry: RunningServer = {
			resolved,
			backend,
			health: "failed",
			toolNames: [],
			resourceUris: [],
			promptNames: [],
			oauthState: undefined,
			restartAttempts: 0,
		};
		try {
			if (resolved.type === "http" && resolved.oauth && !options.skipAuthShortCircuit) {
				// Force a pre-connect auth check so a server that needs interactive
				// browser OAuth surfaces `auth_required` cleanly instead of failing.
				const decision = createOAuthProvider(resolved.serverKey, resolved.oauth, this.oauthCache);
				if (decision.authRequired) {
					entry.health = "auth_required";
					entry.oauthState = "auth_required";
					entry.error = undefined;
					this.running.set(resolved.serverKey, entry);
					this.options.registrar.setServerTools(resolved.serverKey, []);
					return;
				}
			}

			await backend.start();
			const tools = await backend.listTools();
			const defs: ToolDefinition[] = [];
			const toolNames: string[] = [];
			for (const tool of tools) {
				const def = this.synthesizeTool(resolved, tool);
				if (!def) continue;
				defs.push(def);
				toolNames.push(def.name);
			}
			entry.toolNames = toolNames;

			// Resources + prompts (http servers, and any backend exposing them).
			if (resolved.type === "http" && backend instanceof McpHttpBackend) {
				await this.loadResourcesAndPrompts(backend, entry);
			}

			this.running.set(resolved.serverKey, entry);
			entry.health = "connected";
			entry.restartAttempts = 0; // Healthy again: reset the reconnect backoff.
			entry.oauthState = resolved.type === "http" ? this.oauthStateFor(resolved) : undefined;
			this.options.registrar.setServerTools(resolved.serverKey, defs);
		} catch (error) {
			entry.health = "failed";
			const normalized = normalizeConnectError(error, resolved.url || "", resolved.headers || {});
			entry.error = normalized instanceof Error ? normalized.message : String(error);
			entry.oauthState = resolved.type === "http" && resolved.oauth ? "auth_required" : undefined;
			this.running.set(resolved.serverKey, entry);
		}
	}

	/** Create the correct backend for a resolved server. */
	private createBackend(resolved: ResolvedMcpServer): McpBackend {
		const onListChanged = () => {
			// Server signaled a tools/prompts/resources list change → re-sync registry.
			if (this.shuttingDown) return;
			void this.reload();
		};
		if (resolved.type === "http") {
			const authDecision = createOAuthProvider(resolved.serverKey, resolved.oauth, this.oauthCache);
			return new McpHttpBackend({
				server: resolved,
				authProvider: authDecision.provider,
				onClose: (error) => this.handleUnexpectedClose(resolved.serverKey, error),
				onListChanged,
			});
		}
		return new McpStdioBackend({
			server: resolved,
			onClose: (error) => this.handleUnexpectedClose(resolved.serverKey, error),
			onListChanged,
		});
	}

	/** Load resources (URIs) and prompts for an http backend into the entry. */
	private async loadResourcesAndPrompts(backend: McpHttpBackend, entry: RunningServer): Promise<void> {
		const resourceUris: string[] = [];
		try {
			const resources = await backend.listResources();
			for (const r of resources) {
				const info = mapResourceInfo({
					uri: r.uri,
					name: r.name,
					description: r.description,
					mimeType: r.mimeType,
				});
				if (info) resourceUris.push(info.uri);
			}
		} catch {
			// resources are best-effort for v2; a server that errors on list just yields none.
		}
		entry.resourceUris = resourceUris;

		const promptNames: string[] = [];
		try {
			const prompts = await backend.listPrompts();
			for (const p of prompts) {
				const info = mapPromptInfo({ name: p.name, description: p.description, arguments: p.arguments });
				if (info) promptNames.push(info.name);
			}
		} catch {
			// best-effort
		}
		entry.promptNames = promptNames;
	}

	/** Derive the status oauthState for an http server from the config + cache. */
	private oauthStateFor(resolved: ResolvedMcpServer): string {
		if (!resolved.oauth) return "none";
		if (resolved.oauth.clientSecret) return "credentialed";
		if (resolved.oauth.privateKey) return "credentialed";
		if (this.oauthCache.has(resolved.serverKey)) return "authorized";
		if (resolved.oauth.clientId || resolved.oauth.scope) return "auth_required";
		return "none";
	}

	/** Handle an unexpected child-process exit by restarting with backoff. */
	private handleUnexpectedClose(serverKey: string, error?: Error): void {
		if (this.shuttingDown) return;
		const entry = this.running.get(serverKey);
		if (!entry) return;
		if (entry.health !== "connected") return;
		entry.health = "failed";
		entry.error = error?.message ?? "server process exited unexpectedly";
		this.options.registrar.removeServer(serverKey);

		const delay = Math.min(RESTART_BASE_MS * 2 ** entry.restartAttempts, RESTART_MAX_MS);
		entry.restartAttempts += 1;
		entry.restartTimer = setTimeout(() => {
			if (this.shuttingDown) return;
			void this.reload()
				.then(() => {
					// reload() handles reconnection.
				})
				.catch(() => {
					// A reload failure (e.g. malformed config) must not become an
					// unhandled promise rejection; the backoff timer retries later.
				});
		}, delay);
	}

	/** Stop one server (close transport). */
	/**
	 * `/mcp auth <server>` — clear cached OAuth tokens and reconnect so the
	 * interactive browser flow (DCR + PKCE) runs: the transport requests auth,
	 * we open the browser + local callback, and tokens land in the keyring cache.
	 */
	async reauthenticate(serverKey: string): Promise<string> {
		const resolved = this.loaded?.servers.find((server) => server.serverKey === serverKey);
		if (!resolved) return `Unknown MCP server: ${serverKey}`;
		this.oauthCache.remove(serverKey);
		await this.stopServer(serverKey);
		try {
			await this.startServer(resolved, { skipAuthShortCircuit: true });
			const status = this.getStatus().find((s) => s.serverKey === serverKey);
			if (status?.health === "auth_required") {
				return `${serverKey}: still awaiting authorization — complete the browser flow, then /mcp reload.`;
			}
			return `${serverKey}: reconnected (${status?.health ?? "unknown"}).`;
		} catch (error) {
			return `${serverKey}: connect failed — ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	private async stopServer(serverKey: string): Promise<void> {
		const entry = this.running.get(serverKey);
		if (!entry) return;
		if (entry.restartTimer) {
			clearTimeout(entry.restartTimer);
		}
		this.options.registrar.removeServer(serverKey);
		this.running.delete(serverKey);
		try {
			await entry.backend.close();
		} catch {
			// best-effort
		}
	}

	/** Stop all servers (session shutdown). */
	async stopAll(): Promise<void> {
		this.shuttingDown = true;
		for (const key of [...this.running.keys()]) {
			const entry = this.running.get(key);
			if (!entry) continue;
			if (entry.restartTimer) clearTimeout(entry.restartTimer);
			this.options.registrar.removeServer(key);
			try {
				await entry.backend.close();
			} catch {
				// best-effort
			}
			this.running.delete(key);
		}
	}

	/** Per-server status snapshot for /mcp status. */
	/**
	 * Resources as loadable context docs: list what's available across connected
	 * servers, or read one into plain text (resources → context injection).
	 */
	async listResources(
		serverKey?: string,
	): Promise<Array<{ serverKey: string; uri: string; name: string; description: string }>> {
		const out: Array<{ serverKey: string; uri: string; name: string; description: string }> = [];
		for (const [key, running] of this.running) {
			if (running.health !== "connected") continue;
			if (serverKey && key !== serverKey) continue;
			try {
				const resources = await running.backend.listResources();
				for (const resource of resources) {
					const info = mapResourceInfo(resource);
					if (info)
						out.push({ serverKey: key, uri: resource.uri, name: info.name, description: info.description ?? "" });
				}
			} catch {
				// Server may not support resources — skip.
			}
		}
		return out;
	}

	/** Read one resource into plain text (for context injection). */
	async readResource(
		serverKey: string,
		uri: string,
	): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
		const running = this.running.get(serverKey);
		if (!running || running.health !== "connected")
			return { ok: false, error: `MCP server "${serverKey}" is not connected.` };
		try {
			const contents = await running.backend.readResource(uri);
			const text = mapResourceReadText(contents as never);
			return text ? { ok: true, text } : { ok: false, error: "resource returned no text content" };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	/** All MCP prompts across connected servers (for slash-command registration). */
	listPromptNames(): Array<{ serverKey: string; name: string }> {
		const out: Array<{ serverKey: string; name: string }> = [];
		for (const [serverKey, running] of this.running) {
			if (running.health !== "connected") continue;
			for (const name of running.promptNames) out.push({ serverKey, name });
		}
		return out;
	}

	/** Resolve an MCP prompt to its rendered text (for slash-command execution). */
	async getPrompt(
		serverKey: string,
		promptName: string,
		args: Record<string, unknown> = {},
	): Promise<{ text: string } | { error: string }> {
		const running = this.running.get(serverKey);
		if (!running || running.health !== "connected") return { error: `MCP server "${serverKey}" is not connected.` };
		try {
			const messages = await running.backend.getPrompt(promptName, args);
			const text = mapPromptMessages(messages)
				.map((message) => message.content.text)
				.filter(Boolean)
				.join("\n\n");
			return { text };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}

	getStatus(): McpServerStatus[] {
		const status: McpServerStatus[] = [];
		if (this.loaded) {
			for (const server of this.loaded.servers) {
				const running = this.running.get(server.serverKey);
				status.push({
					serverKey: server.serverKey,
					scope: server.scope,
					enabled: server.enabled,
					health: !server.enabled ? "disabled" : running ? running.health : "failed",
					toolCount: running?.toolNames.length ?? 0,
					resourceCount: running?.resourceUris.length ?? 0,
					promptCount: running?.promptNames.length ?? 0,
					error: running?.error,
					approvedHash: this.approvalStore.getApprovedHash(server.serverKey),
					transport: server.type,
					oauthState: running?.oauthState ?? (server.type === "http" ? this.oauthStateFor(server) : undefined),
					authNote:
						running?.health === "auth_required"
							? "Interactive browser OAuth (RFC 7591 DCR + PKCE) is live on the local callback port. Run `/mcp auth <server>` to start the flow, then complete it in your browser."
							: undefined,
				});
			}
		}
		return status;
	}

	/** The content hash a server is currently approved under (for rug-pull awareness). */
	getApprovedHash(serverKey: string): string | undefined {
		return this.approvalStore.getApprovedHash(serverKey);
	}

	/**
	 * Synthesize a Porcupine ToolDefinition from an MCP tool listing.
	 * Returns undefined when the schema is unsupported (fail-on-unsupported-schema).
	 */
	private synthesizeTool(resolved: ResolvedMcpServer, mcpTool: McpToolInfo): ToolDefinition | undefined {
		const agentToolName = `${resolved.serverKey}_${mcpTool.name}`;
		let parameters: TSchema;
		try {
			parameters = translateSchema(mcpTool.inputSchema);
		} catch (err) {
			if (err instanceof UnsupportedSchemaError) {
				// Recorded via status error; skip registering this tool.
				return undefined;
			}
			throw err;
		}

		const description = sanitizeToolDescription(mcpTool.description);
		const serverKey = resolved.serverKey;
		const mcpToolName = mcpTool.name;
		const backendRef: { backend?: McpBackend } = { backend: this.running.get(serverKey)?.backend };

		return defineTool({
			name: agentToolName,
			label: mcpTool.name,
			description,
			promptSnippet: `${agentToolName} — MCP tool from server "${serverKey}". ${mcpTool.description?.slice(0, 120) ?? ""}`,
			parameters,
			executionMode: "sequential" as ToolExecutionMode,
			execute: async (
				_toolCallId: string,
				params,
				_signal,
				_onUpdate,
				_ctx: ExtensionContext,
			): Promise<AgentToolResult<unknown>> => {
				const backend = this.running.get(serverKey)?.backend ?? backendRef.backend;
				if (!backend) {
					return {
						content: [{ type: "text", text: `MCP server "${serverKey}" is not connected.` }],
						details: { serverKey, error: "server not connected" },
					};
				}

				// Fail-closed security gate before any execution.
				const decision = await this.guard.guard({
					mode: this.options.getMode(),
					server: resolved,
					mcpToolName,
					agentToolName,
					arguments: params as Record<string, unknown>,
				});
				if (!decision.approved) {
					return {
						content: [{ type: "text", text: decision.message ?? "MCP call denied." }],
						details: { serverKey, tool: mcpToolName, denied: true, via: decision.via },
					};
				}

				let result: Awaited<ReturnType<typeof backend.callTool>>;
				try {
					result = await backend.callTool(mcpToolName, params as Record<string, unknown>);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: `MCP tool "${agentToolName}" failed: ${message}` }],
						details: { serverKey, tool: mcpToolName, error: message },
					};
				}
				return mapResult(result, serverKey, mcpToolName);
			},
		});
	}
}

function mapResult(
	result: { content?: unknown[]; isError?: boolean; structuredContent?: unknown },
	serverKey: string,
	tool: string,
): AgentToolResult<unknown> {
	const details = { serverKey, tool };
	if (result.isError) {
		const text = (result.content ?? [])
			.map((b: unknown) =>
				b && typeof b === "object" && "text" in (b as object) ? String((b as { text?: unknown }).text) : String(b),
			)
			.join("\n");
		return {
			content: [{ type: "text", text: text || `MCP tool "${tool}" reported an error.` }],
			details: { ...details, isError: true },
		} as AgentToolResult<unknown>;
	}
	// Lightweight content mapping compatible with AgentToolResult.
	const text = (result.content ?? [])
		.map((b: unknown) => {
			if (!b || typeof b !== "object") return String(b);
			const block = b as { type?: string; text?: string };
			return block.type === "text" ? (block.text ?? "") : JSON.stringify(b);
		})
		.join("\n");
	return {
		content: [
			{
				type: "text",
				text: text || JSON.stringify(result.structuredContent ?? null) || "[MCP tool returned no content]",
			},
		],
		details,
	} as AgentToolResult<unknown>;
}
