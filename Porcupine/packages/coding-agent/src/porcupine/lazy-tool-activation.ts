/**
 * Lazy tool activation: seat a registered-but-inactive tool the moment the
 * model tries to call it, instead of failing with "not found".
 *
 * Policy (fail-closed throughout):
 * - Exact match first, then the last dot-segment (`default.plan` → `plan`).
 *   No fuzzy matching: near-misses stay errors so real mistakes stay visible.
 * - Names outside the session registry (unknown or user-disabled) resolve to
 *   undefined, preserving the generic not-found error.
 * - Safe tier seats silently in every mode.
 * - Sensitive tier (host control, outbound sends) requires approval: manual
 *   confirmation in Ask/Normal, the fail-closed LLM gate in Auto.
 * - The caller seats the tool for future turns and executes this call with
 *   validated arguments; validation still applies, so a guessed call with
 *   bad arguments fails normally and the model retries with the real schema.
 */

import type { AgentTool, UnknownToolResolution } from "@porcupineai/agent-core";
import type { Model } from "@porcupineai/ai";
import type { ModelRuntime } from "../core/model-runtime.ts";
import { classifyWithSessionModel } from "./llm-classify.ts";

/** Tools whose activation is itself a privileged action. */
export const SENSITIVE_LAZY_TOOLS: ReadonlySet<string> = new Set(["computer_use", "email_send", "x_post", "x_reply"]);

export function isSensitiveLazyTool(name: string): boolean {
	return SENSITIVE_LAZY_TOOLS.has(name);
}

/**
 * Candidate registry names for a requested tool name, in priority order:
 * exact, lowercase-exact, last dot-segment, lowercase last dot-segment.
 */
export function lazyToolNameCandidates(requested: string): string[] {
	const trimmed = (requested ?? "").trim();
	if (!trimmed) return [];
	const candidates = [trimmed];
	const lower = trimmed.toLowerCase();
	if (lower !== trimmed) candidates.push(lower);
	const dot = trimmed.lastIndexOf(".");
	if (dot >= 0 && dot < trimmed.length - 1) {
		const segment = trimmed.slice(dot + 1).trim();
		if (segment && !candidates.includes(segment)) candidates.push(segment);
		const lowerSegment = segment.toLowerCase();
		if (lowerSegment !== segment && !candidates.includes(lowerSegment)) candidates.push(lowerSegment);
	}
	return candidates;
}

/** First candidate present in the registry, or undefined. No fuzzy matching. */
export function resolveLazyToolName(requested: string, has: (name: string) => boolean): string | undefined {
	try {
		for (const candidate of lazyToolNameCandidates(requested)) {
			if (has(candidate)) return candidate;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export type LazyActivationMode = "ask" | "normal" | "auto";

export interface LazyToolActivationDeps {
	hasTool: (name: string) => boolean;
	isActive: (name: string) => boolean;
	getTool: (name: string) => AgentTool | undefined;
	seat: (name: string) => void;
	mode: LazyActivationMode;
	confirm?: (title: string, message: string) => Promise<boolean>;
	classify?: () => Promise<"approve" | "deny">;
}

const LAZY_ACTIVATION_SYSTEM = [
	"You are a safety gate for activating a dormant agent tool.",
	"Reply with exactly one word: APPROVE or DENY.",
	"APPROVE only when activating the named tool for the stated purpose is routine and reversible.",
	"DENY host control, outbound sends, purchases, credential changes, or anything irreversible or unclear.",
	"Doubt, ambiguity, or missing information means DENY.",
].join(" ");

/** Fail-closed LLM gate for sensitive-tool activation in Auto mode. */
export async function classifyLazyToolActivation(options: {
	modelRuntime: ModelRuntime;
	model: Model<any> | undefined;
	toolName: string;
}): Promise<"approve" | "deny"> {
	try {
		const raw = await classifyWithSessionModel({
			modelRuntime: options.modelRuntime,
			model: options.model,
			system: LAZY_ACTIVATION_SYSTEM,
			user: `The agent tried to call the dormant tool "${options.toolName}". Should it be activated for this session?`,
			maxTokens: 16,
			timeoutMs: 8_000,
		});
		const answer = raw.trim().toUpperCase();
		if (answer.includes("APPROVE") && !answer.includes("DENY")) return "approve";
		return "deny";
	} catch {
		return "deny";
	}
}

/**
 * Tools a sub-agent may never lazily activate: worker-lifecycle and
 * agent-level state owned by the parent, plus the sensitive tier (workers
 * cannot ask, so anything needing approval stays unavailable).
 */
export const SUBAGENT_LAZY_EXCLUDED: ReadonlySet<string> = new Set([
	"subagent",
	"ask_question",
	"computer_use",
	"tasks",
	"projects",
	"send_to_subagent",
	"stop_subagent",
	"email_send",
	"x_post",
	"x_reply",
]);

/**
 * Dormant pool names for a worker: registry names minus active names minus
 * worker-excluded names. Pure helper so the policy is unit-testable; the
 * caller maps names back to tool instances.
 */
export function subagentLazyPoolNames(allNames: Iterable<string>, activeNames: Iterable<string>): string[] {
	const active = new Set(activeNames);
	const pool: string[] = [];
	for (const name of allNames) {
		if (!active.has(name) && !SUBAGENT_LAZY_EXCLUDED.has(name)) pool.push(name);
	}
	return pool;
}

/**
 * Resolve an attempted call to a registered-but-inactive tool.
 * Returns `{ tool }` (seated for future turns), `{ error }` guidance, or
 * undefined to keep the generic not-found error. Never throws.
 */
export async function resolveLazyToolActivation(
	requested: string,
	deps: LazyToolActivationDeps,
	signal?: AbortSignal,
): Promise<UnknownToolResolution | undefined> {
	try {
		if (signal?.aborted) return undefined;
		const canonical = resolveLazyToolName(requested, deps.hasTool);
		if (!canonical) return undefined;
		const tool = deps.getTool(canonical);
		if (!tool) return undefined;
		if (deps.isActive(canonical)) return { tool };

		if (isSensitiveLazyTool(canonical)) {
			const approved = await approveSensitiveActivation(canonical, deps, signal);
			if (!approved.ok) return { error: approved.message };
		}

		deps.seat(canonical);
		return { tool };
	} catch {
		return undefined;
	}
}

async function approveSensitiveActivation(
	canonical: string,
	deps: LazyToolActivationDeps,
	signal?: AbortSignal,
): Promise<{ ok: boolean; message?: string }> {
	if (signal?.aborted) {
		return { ok: false, message: `Tool "${canonical}" was not activated (operation aborted).` };
	}
	if (deps.mode === "auto") {
		if (!deps.classify) {
			return {
				ok: false,
				message: `Tool "${canonical}" exists but needs safety-gate approval, which is unavailable. Do not retry with a namespace prefix. Proceed without it or ask the user to enable it explicitly.`,
			};
		}
		try {
			const verdict = await deps.classify();
			if (verdict === "approve") return { ok: true };
			return {
				ok: false,
				message: `Tool "${canonical}" exists but automatic activation was denied by the safety gate. Do not retry with a namespace prefix. Proceed without it or ask the user to enable it explicitly.`,
			};
		} catch {
			return {
				ok: false,
				message: `Tool "${canonical}" exists but automatic activation failed closed. Do not retry with a namespace prefix. Proceed without it or ask the user to enable it explicitly.`,
			};
		}
	}
	if (!deps.confirm) {
		return {
			ok: false,
			message: `Tool "${canonical}" exists but requires user approval, which is unavailable. Do not retry with a namespace prefix. Proceed without it.`,
		};
	}
	try {
		const ok = await deps.confirm(
			`Enable tool ${canonical}?`,
			`The agent tried to call the dormant tool "${canonical}". Allow activating it for this session?`,
		);
		if (ok) return { ok: true };
		return {
			ok: false,
			message: `Tool "${canonical}" exists but was not enabled (declined). Do not retry with a namespace prefix. Proceed without it or ask the user via ask_question whether to enable it.`,
		};
	} catch {
		return {
			ok: false,
			message: `Tool "${canonical}" exists but approval failed closed. Do not retry with a namespace prefix. Proceed without it.`,
		};
	}
}
