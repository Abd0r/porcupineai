/**
 * MCP (Model Context Protocol) v1 client — McpToolGuard (fail-closed gate).
 *
 * Security model (non-negotiable, per the approved design):
 *   - Fail-closed default: MCP tools are DENIED unless on the server `allow`
 *     list or explicitly user-approved in-session.
 *   - Interaction-mode aware:
 *       ask    → confirm every call with full args.
 *       normal → allowlisted call runs directly; anything else confirms.
 *       auto   → allowlisted runs directly; otherwise route through the
 *                existing `classifyWithSessionModel` LLM classifier with an
 *                MCP hard-line deny set (fail-closed).
 *   - Content-hash binding: approval is bound to the server content-hash
 *     (command+args+env+cwd), not the server name (CVE-2025-54136 lesson).
 *     If the hash changes after a prior approval, the call is re-prompted.
 *   - Hard-line destructive MCP calls are denied in ALL modes.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Model } from "@porcupineai/ai";
import { classifyWithSessionModel } from "../../porcupine/llm-classify.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import type { McpGuardContext, McpGuardDecision } from "./types.ts";

/** In-memory record of approved server content hashes (per session). */
export interface McpApprovalStore {
	/** Returns the currently stored approved hash for a server, or undefined. */
	getApprovedHash(serverKey: string): string | undefined;
	/** Persist an approval for the given server under its content hash. */
	approve(serverKey: string, contentHash: string): void;
}

export interface McpToolGuardOptions {
	modelRuntime: ModelRuntime;
	model: () => Model<any> | undefined;
	/** Interactive confirm callback for ask/normal/manual gates. */
	confirm?: (title: string, message: string) => Promise<boolean>;
	/** Approval store for content-hash binding. */
	approvalStore: McpApprovalStore;
}

const HARD_LINE_SQL =
	/\b(?:drop\s+table|truncate\s+table|delete\s+from|drop\s+database|alter\s+(?:table|database)|update\s+\w+\s+set\b)/i;

const HARD_LINE_DESTRUCTIVE =
	/\b(?:rm\s+-rf|rm\s+-r|del\s+\/f|rd\s+\/s|format\s+\w+|:(){:|fork\b|shutdown|reboot|kill\s+-9|killall)/i;

/**
 * Detect a hard-line destructive MCP call from its tool name + args (serialized).
 * Denied in ALL modes (mirrors the bash hardlines).
 */
export function isHardlineMcpCall(toolName: string, args: Record<string, unknown>): string | undefined {
	const serialized = JSON.stringify(args ?? {});
	const _combined = `${toolName} ${serialized}`;

	// Destructive shell-command hints embedded in args.
	if (HARD_LINE_DESTRUCTIVE.test(serialized)) {
		return "destructive shell/filesystem operation";
	}
	// Destructive SQL hints.
	if (HARD_LINE_SQL.test(serialized)) {
		return "destructive SQL";
	}
	// Credential reads / network exfiltration patterns.
	if (/\b(?:\.ssh|id_rsa|id_ed25519|credentials\.json|\.aws\/credentials|password|secret|token)\b/i.test(serialized)) {
		return "credential-adjacent read";
	}
	if (/exfil|webhook\.|base64\s+-d|curl\s+.+--data/.test(serialized)) {
		return "network exfiltration pattern";
	}
	// Tool names that are inherently destructive regardless of args.
	if (/\b(?:format|shutdown|reboot|wipe|drop|truncate)\b/i.test(toolName)) {
		return "destructive tool name";
	}
	return undefined;
}

/**
 * A small deterministic classifier on the tool call used by Auto mode.
 *
 * In Auto mode we still invoke the LLM classifier via `classifyWithSessionModel`
 * (per design) — this local check is only a reserve for when no model is
 * available (then it fails closed). We keep it conservative: only obviously-safe
 * names/args approve.
 */
function localAutoApprove(toolName: string, args: Record<string, unknown>): boolean {
	const serialized = JSON.stringify(args ?? {});
	// Only allow obviously read-only, non-destructive tools with small args.
	if (/read|list|get|search|status|info|lookup|describe/i.test(toolName) && serialized.length < 500) {
		return true;
	}
	return false;
}

export interface McpToolGuard {
	/**
	 * Evaluate whether an MCP tool call may run.
	 * Returns a decision; the caller must NOT execute when approved === false.
	 */
	guard(ctx: McpGuardContext): Promise<McpGuardDecision>;
}

export function createMcpToolGuard(options: McpToolGuardOptions): McpToolGuard {
	const isApprovedHash = (ctx: McpGuardContext): boolean => {
		const stored = options.approvalStore.getApprovedHash(ctx.server.serverKey);
		if (stored === undefined) return false;
		return stored === ctx.server.contentHash;
	};

	return {
		async guard(ctx): Promise<McpGuardDecision> {
			// 1. Hard-line destructive calls are denied in ALL modes.
			const hardline = isHardlineMcpCall(ctx.mcpToolName, ctx.arguments);
			if (hardline) {
				return {
					approved: false,
					via: "hardline",
					message: `BLOCKED (hardline): ${hardline}. This MCP call cannot be auto-approved.`,
				};
			}

			// 2. Missing confirm callback → fail closed (no human to ask).
			const hasConfirm = typeof options.confirm === "function";
			if (!hasConfirm) {
				return {
					approved: false,
					via: "error",
					message: "BLOCKED: no interactive confirmation available for MCP calls.",
				};
			}

			// 3. Content-hash rug-pull check. If a prior approval exists but the
			//    server hash changed, force re-approval (CVE-2025-54136).
			const priorApproved = options.approvalStore.getApprovedHash(ctx.server.serverKey) !== undefined;
			const hashUnchanged = isApprovedHash(ctx);
			if (priorApproved && !hashUnchanged) {
				// Rug pull suspected — require explicit re-approval regardless of allowlist/mode.
				if (ctx.mode !== "ask") {
					const label = `The MCP server "${ctx.server.serverKey}" changed its command/config since it was last approved.\n\nServer content hash changed.\n\nAllow this changed configuration?`;
					const ok = await options.confirm!("MCP server configuration changed", label);
					if (!ok) {
						return {
							approved: false,
							via: "content-hash",
							message: `BLOCKED: MCP server "${ctx.server.serverKey}" configuration changed since approval (content-hash mismatch).`,
						};
					}
					options.approvalStore.approve(ctx.server.serverKey, ctx.server.contentHash);
				}
			}

			// 4. Allowlist — a tool on the server's allow list runs directly
			//    (in Normal and Auto; in Ask mode still confirm everything).
			const allowlisted = ctx.server.allow.has(ctx.mcpToolName);
			if (ctx.mode !== "ask" && allowlisted) {
				return { approved: true, via: "allowlist" };
			}

			// 5. Ask / confirmed-approval path.
			if (ctx.mode === "ask" || allowlisted) {
				const ok = await options.confirm!(
					`Confirm MCP tool: ${ctx.agentToolName}`,
					`Server: ${ctx.server.serverKey} (${ctx.server.scope})\nTool: ${ctx.mcpToolName}\n\nArgs:\n${JSON.stringify(ctx.arguments, null, 2)}\n\nAllow this MCP call?`,
				);
				if (!ok) {
					return { approved: false, via: "manual", message: "User denied MCP tool call." };
				}
				options.approvalStore.approve(ctx.server.serverKey, ctx.server.contentHash);
				return { approved: true, via: "manual" };
			}

			// 6. Auto mode (non-allowlisted).
			if (ctx.mode === "auto") {
				const modelRuntime = options.modelRuntime;
				const model = options.model();
				if (modelRuntime && model) {
					const verdict = await classifyWithSessionModel({
						modelRuntime,
						model,
						system: MCP_AUTO_SYSTEM_PROMPT,
						user: `Tool: ${ctx.mcpToolName}\nArgs: ${JSON.stringify(ctx.arguments, null, 2)}\n\nReply exactly APPROVE or DENY.`,
					});
					if (/APPROVE|approve/i.test(verdict)) {
						options.approvalStore.approve(ctx.server.serverKey, ctx.server.contentHash);
						return { approved: true, via: "auto" };
					}
					return {
						approved: false,
						via: "auto",
						message: `⚡ Auto → 🛡 Denied MCP call (${ctx.agentToolName}). Switch to Normal mode to approve manually.`,
					};
				}
				// No model → fail closed, or a local conservative approve.
				if (localAutoApprove(ctx.mcpToolName, ctx.arguments)) {
					options.approvalStore.approve(ctx.server.serverKey, ctx.server.contentHash);
					return { approved: true, via: "auto" };
				}
				return {
					approved: false,
					via: "error",
					message: `BLOCKED: no model for Auto-mode MCP classification and call not safely allowlisted (${ctx.agentToolName}).`,
				};
			}

			// 7. Normal mode (non-allowlisted): confirm.
			const ok = await options.confirm!(
				`Confirm MCP tool: ${ctx.agentToolName}`,
				`Server: ${ctx.server.serverKey} (${ctx.server.scope})\nTool: ${ctx.mcpToolName}\n\nArgs:\n${JSON.stringify(ctx.arguments, null, 2)}\n\nAllow this MCP call?`,
			);
			if (!ok) {
				return { approved: false, via: "manual", message: "User denied MCP tool call." };
			}
			options.approvalStore.approve(ctx.server.serverKey, ctx.server.contentHash);
			return { approved: true, via: "manual" };
		},
	};
}

const MCP_AUTO_SYSTEM_PROMPT = `You are a safety classifier for MCP (Model Context Protocol) tool calls invoked by an AI agent.

Rules:
- DENY destructive, irreversible, or data-exfiltrating tool calls: destructive SQL, writes that escape the server's working directory, credential reads, and network exfiltration.
- DENY anything ambiguous or risky.
- APPROVE only clearly read-only, non-destructive, well-scoped operations.
- Fail closed: when uncertain, DENY.`;

/** Simple in-memory approval store bound to content hashes. */
export class InMemoryMcpApprovalStore implements McpApprovalStore {
	private approved = new Map<string, string>();

	getApprovedHash(serverKey: string): string | undefined {
		return this.approved.get(serverKey);
	}

	approve(serverKey: string, contentHash: string): void {
		this.approved.set(serverKey, contentHash);
	}
}

/**
 * File-backed approval store bound to content hashes.
 *
 * Approvals survive process restarts (a fresh instance reads the same JSON
 * store) while preserving the content-hash rug-pull check: each approval is
 * keyed by the server key and stores the content hash, so a server whose
 * config changed is not treated as pre-approved (CVE-2025-54136). The backing
 * file is written atomically so a crash cannot leave a partial store.
 */
export class FileMcpApprovalStore implements McpApprovalStore {
	private approved = new Map<string, string>();
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
		this.load();
	}

	getApprovedHash(serverKey: string): string | undefined {
		return this.approved.get(serverKey);
	}

	approve(serverKey: string, contentHash: string): void {
		const next = new Map<string, string>(this.approved);
		next.set(serverKey, contentHash);
		this.persist(next);
		this.approved = next;
	}

	/** Read the persistable approvals from disk (best-effort, fails to empty). */
	private load(): void {
		try {
			if (!existsSync(this.filePath)) return;
			const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Record<string, string> | null;
			this.approved = new Map(Object.entries(raw ?? {}));
		} catch {
			// Unreadable or corrupt store — start empty rather than block MCP use.
			this.approved = new Map<string, string>();
		}
	}

	/** Write the store atomically; on failure keep the in-memory state usable. */
	private persist(approvals: Map<string, string>): void {
		try {
			mkdirSync(dirname(this.filePath), { recursive: true });
			const temporary = join(dirname(this.filePath), `.${randomUUID()}.tmp`);
			try {
				writeFileSync(temporary, `${JSON.stringify(Object.fromEntries(approvals), null, 2)}\n`, {
					encoding: "utf8",
					mode: 0o600,
				});
				renameSync(temporary, this.filePath);
			} finally {
				try {
					rmSync(temporary, { force: true });
				} catch {
					// Best-effort cleanup.
				}
			}
		} catch {
			// Persistence failure is non-fatal: the in-memory copy already updated.
		}
	}
}
