/**
 * Inspection-only fence for built-in /plan turns.
 *
 * While a plan draft turn is active, the model may inspect but must not
 * mutate. This classifier is fail-closed: only explicitly read-only tools
 * are allowed, bash must match a safe allowlist, and everything else is
 * denied. Harness-owned plan artifact writes use Node fs directly and do
 * not pass through this tool gate.
 */

const READONLY_TOOLS = new Set([
	"read",
	"ls",
	"find",
	"grep",
	"web_search",
	"web_extract",
	"capability_search",
	"session_search",
	"projects",
	"literature",
	"mcp_resources",
	"inspect_runtime",
	"show_markdown",
	"truncate",
	"ask_question",
	"browser_extract",
	"browser_snapshot",
]);

const ALWAYS_BLOCKED_TOOLS = new Set([
	"edit",
	"write",
	"subagent",
	"tasks",
	"email_send",
	"email_draft",
	"x_post",
	"x_reply",
	"x_draft",
	"computer_use",
	"browser_navigate",
	"browser_click",
	"browser_type",
	"browser_evaluate",
	"remind_me",
	"memory",
	"craft_skill",
	"extract_skill",
]);

const DESTRUCTIVE_BASH = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bkill\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\b(vim?|nano|emacs|code)\b/i,
];

const SAFE_BASH = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*grep\b/,
	/^\s*rg\b/,
	/^\s*find\b/,
	/^\s*fd\b/,
	/^\s*echo\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*date\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote)/i,
	/^\s*npm\s+(list|ls|view|outdated)/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
];

export function isPlanFenceSafeBash(command: unknown): boolean {
	if (typeof command !== "string" || !command.trim()) return false;
	if (DESTRUCTIVE_BASH.some((pattern) => pattern.test(command))) return false;
	return SAFE_BASH.some((pattern) => pattern.test(command));
}

export interface PlanFenceVerdict {
	allow: boolean;
	reason?: string;
}

/**
 * Classify a tool call during an inspection-only plan turn.
 * Fail-closed: unknown tools are denied.
 */
export function classifyPlanTurnTool(toolName: string, args?: unknown): PlanFenceVerdict {
	const name = (toolName || "").toLowerCase();
	if (ALWAYS_BLOCKED_TOOLS.has(name)) {
		return { allow: false, reason: `Plan turn: ${toolName} is disabled while drafting the plan.` };
	}
	if (name === "bash") {
		const command = (args as { command?: unknown } | null | undefined)?.command;
		if (isPlanFenceSafeBash(command)) return { allow: true };
		return {
			allow: false,
			reason: "Plan turn: only read-only bash commands are allowed while drafting the plan.",
		};
	}
	if (READONLY_TOOLS.has(name)) return { allow: true };
	return { allow: false, reason: `Plan turn: ${toolName} is not allowed while drafting the plan.` };
}
