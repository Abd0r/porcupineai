/**
 * Tool-policy registry (Phase F) — `tools.porcupine.json`.
 *
 * The safe surface where the harness can own TOOLS, not just skills. A
 * "composed tool" is a declarative wrapper around an allowlisted read-only
 * command (argv form, no shell — no injection surface). The refiner can
 * autonomously add/refine these (snapshot + auto-rollback, feed-visible);
 * user-authored entries are never silently overwritten.
 *
 * Raw TypeScript tool code stays hard-blocked (`learning-store.ts` tool
 * proposals require code review) — this registry is the reviewed alternative.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "../core/extensions/types.ts";
import { publishFeedEntry } from "./learning-store.ts";

export const TOOL_POLICY_FILE = "tools.porcupine.json";
export const COMPOSED_MAX_OUTPUT = 4_000;

/**
 * Allowlisted base binaries for composed tools. Read-only inspection commands
 * only — anything that writes/executes arbitrarily is out of the registry.
 */
const ALLOWED_BINARIES = new Set([
	"git",
	"ls",
	"find",
	"grep",
	"rg",
	"cat",
	"head",
	"tail",
	"wc",
	"date",
	"pwd",
	"which",
	"file",
	"stat",
	"du",
	"df",
	"echo",
]);

/**
 * Read-only git subcommands. Anything mutating/state-changing (push, reset,
 * clean, checkout, branch, merge, rebase, revert, cherry-pick, tag, rm, stash,
 * init, commit, add, fetch, ...) is refused for the bare `git` binary.
 */
const READONLY_GIT_SUBCOMMANDS = new Set([
	"log",
	"status",
	"diff",
	"show",
	"grep",
	"ls-files",
	"rev-parse",
	"describe",
	"blame",
	"help",
	"version",
	"config",
]);

/** Denied single-argument tokens (checked per-arg). */
const DENIED_ARG_TOKENS = /\b(rm|dd|mkfs|fdisk|parted|shutdown|reboot|halt|poweroff|kill|killall|pkill)\b/;

export interface ToolPolicyEntry {
	/** Safe slug (lowercase + hyphens). */
	name: string;
	/** One-line description (what it does, not instructions to the model). */
	description: string;
	kind: "composed";
	/** argv-form command: [binary, ...args]. No shell — no injection surface. */
	command: string[];
	/** Output truncation cap in chars (default COMPOSED_MAX_OUTPUT). */
	maxOutput?: number;
	/** Who authored this entry — porcupine entries are autonomously refinable. */
	source: "user" | "porcupine";
	createdAt: string;
	updatedAt: string;
	/** Snapshot taken before the last edit (auto-rollback). */
	snapshotRef?: string;
}

interface ToolPolicyFile {
	tools: Record<string, ToolPolicyEntry>;
}

function policyPath(agentDir: string): string {
	return join(agentDir, TOOL_POLICY_FILE);
}

function readFile(agentDir: string): ToolPolicyFile {
	try {
		const parsed = JSON.parse(readFileSync(policyPath(agentDir), "utf8")) as ToolPolicyFile;
		if (parsed && typeof parsed.tools === "object") return parsed;
	} catch {
		// Missing or corrupt — start fresh.
	}
	return { tools: {} };
}

function writeFile(agentDir: string, data: ToolPolicyFile): void {
	const path = policyPath(agentDir);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try {
			rmSync(temporary, { force: true });
		} catch {
			// Best-effort cleanup.
		}
	}
}

/** Validate a composed-tool entry. Returns a list of problems (empty = valid). */
export function validateToolPolicy(entry: Partial<ToolPolicyEntry>): string[] {
	const errors: string[] = [];
	const name = entry.name ?? "";
	if (!/^[a-z][a-z0-9-]{2,47}$/.test(name)) errors.push("invalid name (lowercase+hyphens, >=3 chars)");
	if (!entry.description?.trim()) errors.push("missing description");
	if (entry.kind !== "composed") errors.push("only kind: composed is supported");
	if (!Array.isArray(entry.command) || entry.command.length === 0 || typeof entry.command[0] !== "string") {
		errors.push("command must be a non-empty argv array");
	} else {
		const binary = entry.command[0]!.trim();
		if (!ALLOWED_BINARIES.has(binary)) errors.push(`binary not allowlisted: ${binary}`);
		// Per-arg patterns (single-argument tokens).
		for (const arg of entry.command.slice(1)) {
			if (DENIED_ARG_TOKENS.test(arg)) {
				errors.push(`denied arg pattern: ${arg}`);
			}
		}
		// git: allow only read-only subcommands and refuse redirect/force variants.
		if (binary === "git") {
			const gitArgs = entry.command.slice(1);
			// Global flags that can redirect or mutate configuration.
			for (const arg of gitArgs) {
				if (arg === "-c" || arg === "-C" || arg === "--git-dir" || arg === "--exec-path") {
					errors.push(`denied: git redirect/global flag ${arg}`);
				}
			}
			const subcommand = gitArgs.find((arg) => !arg.startsWith("-"));
			if (subcommand && !READONLY_GIT_SUBCOMMANDS.has(subcommand)) {
				errors.push(`denied git subcommand: ${subcommand}`);
			}
			// `config` is only read-only; write forms are refused.
			if (subcommand === "config") {
				if (gitArgs.filter((a) => !a.startsWith("-")).length >= 2) errors.push("denied: git config write");
				for (const arg of gitArgs) {
					if (
						arg.includes("=") ||
						arg === "--add" ||
						arg === "--unset" ||
						arg === "--replace-all" ||
						arg === "--remove-section"
					) {
						errors.push(`denied: git config write: ${arg}`);
					}
				}
			}
		}
		// Cross-arg patterns against the joined command (e.g. "push --force").
		// Note: no leading \b on --tokens — there is no word boundary before "--".
		const joined = entry.command.join(" ");
		if (/\bpush\b.*--force|--force.*\bpush\b/.test(joined)) errors.push("denied: force push");
		if (/\brm\b.*(-r|-rf|--recursive)/.test(joined)) errors.push("denied: recursive rm");
	}
	if (
		/\b(password|api[_-]?key|token|secret|ssn|credit\s*card)\b/i.test(
			`${entry.description ?? ""} ${entry.command ?? []}`,
		)
	) {
		errors.push("sensitive-looking content");
	}
	return errors;
}

/** All registered tool policies (name → entry). */
export function listToolPolicies(agentDir: string): ToolPolicyEntry[] {
	return Object.values(readFile(agentDir).tools).sort((a, b) => a.name.localeCompare(b.name));
}

/** One registered policy, or undefined. */
export function readToolPolicy(agentDir: string, name: string): ToolPolicyEntry | undefined {
	return readFile(agentDir).tools[name];
}

/** Create or update a composed tool. Snapshot-before-edit when replacing an existing entry. */
export function upsertToolPolicy(
	agentDir: string,
	entry: Partial<ToolPolicyEntry> & { name: string; command: string[] },
): { ok: true; policy: ToolPolicyEntry } | { ok: false; error: string } {
	const problems = validateToolPolicy({ ...entry, kind: "composed" });
	if (problems.length > 0) return { ok: false, error: problems.join("; ") };
	const data = readFile(agentDir);
	const now = new Date().toISOString();
	const existing = data.tools[entry.name];
	// Never silently overwrite a user-authored policy.
	if (existing?.source === "user" && entry.source !== "user") {
		return { ok: false, error: `Refusing to overwrite user-authored tool policy: ${entry.name}` };
	}
	const policy: ToolPolicyEntry = {
		name: entry.name,
		description: entry.description!.trim().slice(0, 240),
		kind: "composed",
		command: entry.command.map((arg) => arg.trim()),
		maxOutput: entry.maxOutput ?? COMPOSED_MAX_OUTPUT,
		source: entry.source ?? existing?.source ?? "porcupine",
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	if (existing) {
		// Snapshot before edit so a regression can be auto-rolled back.
		const snapshot = JSON.stringify(existing, null, 2);
		policy.snapshotRef = `${existing.name}-${Date.now().toString(36)}`;
		mkdirSync(join(agentDir, "learning", "snapshots"), { recursive: true });
		writeFileSync(join(agentDir, "learning", "snapshots", `${policy.snapshotRef}.json`), `${snapshot}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
	}
	data.tools[entry.name] = policy;
	writeFile(agentDir, data);
	publishFeedEntry(agentDir, {
		action: existing ? "edited" : "created",
		file: TOOL_POLICY_FILE,
		linesAdded: policy.command.length,
		linesRemoved: 0,
		summary: existing
			? `Updated composed tool ${policy.name}: ${policy.command.join(" ")}`
			: `Created composed tool ${policy.name}: ${policy.command.join(" ")}`,
		kind: "tool",
	});
	return { ok: true, policy };
}

/** Delete a registered composed tool. User-authored entries are never removable. */
export function deleteToolPolicy(agentDir: string, name: string): { ok: boolean; error?: string } {
	const data = readFile(agentDir);
	const existing = data.tools[name];
	if (!existing) return { ok: false };
	// Mirror upsertToolPolicy's guard: never delete a user-authored entry.
	if (existing.source === "user") {
		return { ok: false, error: `Refusing to delete user-authored tool policy: ${name}` };
	}
	delete data.tools[name];
	writeFile(agentDir, data);
	publishFeedEntry(agentDir, {
		action: "rejected",
		file: TOOL_POLICY_FILE,
		summary: `Deleted composed tool ${name}`,
		kind: "tool",
	});
	return { ok: true };
}

/**
 * Build the agent-facing ToolDefinition for a composed tool.
 * The executor spawns the argv command directly (no shell — no injection
 * surface), truncates output, and reports errors as tool errors.
 */
export function createComposedToolDefinition(policy: ToolPolicyEntry): ToolDefinition {
	return {
		name: policy.name,
		label: policy.name,
		description: `${policy.description}\n\n<composed tool> Defined in ${TOOL_POLICY_FILE}; executes an allowlisted read-only command.`,
		parameters: Type.Object({}),
		async execute() {
			// Runtime re-validation: the stored policy is trusted only if it still
			// passes validation at execution time. A hand-edited or stale entry is
			// refused here rather than spawning a now-denied command.
			const problems = validateToolPolicy(policy);
			if (problems.length > 0) {
				return {
					content: [
						{ type: "text", text: `composed tool "${policy.name}" failed validation: ${problems.join("; ")}` },
					],
					details: { isError: true },
				};
			}
			return new Promise((resolve) => {
				const child = spawn(policy.command[0]!, policy.command.slice(1), {
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 30_000,
				});
				let stdout = "";
				let stderr = "";
				let truncated = false;
				let settled = false;
				const cap = policy.maxOutput ?? COMPOSED_MAX_OUTPUT;
				// Soft cap truncates-and-returns; a hard cap bounds memory without
				// turning a large *successful* output into an error.
				const hardCap = cap * 10;
				const childStdoutCap = hardCap;
				const childStderrCap = 4_000;
				// Guard against a double-settle (spawn "error" + "close" both fire on
				// spawn failure); only the first resolve is honored.
				const settle = (value: Parameters<typeof resolve>[0]) => {
					if (settled) return;
					settled = true;
					resolve(value);
				};
				child.stdout.on("data", (chunk: Buffer) => {
					if (stdout.length >= childStdoutCap) return; // stop accumulating, do not kill
					stdout += chunk.toString();
					if (stdout.length > cap) truncated = true;
				});
				child.stderr.on("data", (chunk: Buffer) => {
					if (stderr.length >= childStderrCap) return; // cap stderr like stdout
					stderr += chunk.toString();
				});
				child.on("error", (error) => {
					const err = error as NodeJS.ErrnoException;
					const timedOut = err.code === "ETIMEDOUT";
					settle({
						content: [
							{
								type: "text",
								text: timedOut ? "composed tool timed out" : `composed tool failed to start: ${error.message}`,
							},
						],
						details: { isError: true },
					});
				});
				child.on("close", (code) => {
					if (code !== 0) {
						settle({
							content: [
								{
									type: "text",
									text: `composed tool exited ${code ?? "non-zero"}${stderr ? `: ${stderr.slice(0, 400)}` : ""}`,
								},
							],
							details: { isError: true },
						});
						return;
					}
					const shown = truncated ? `${stdout.slice(0, cap)}\n[truncated]` : stdout.slice(0, cap);
					settle({
						content: [{ type: "text", text: shown }],
						details: { ok: true, truncated },
					});
				});
			});
		},
	};
}
