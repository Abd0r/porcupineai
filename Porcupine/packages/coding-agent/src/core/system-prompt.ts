/**
 * System prompt construction and project context loading
 */

import { getAgentDir, getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { AUTO_MODE_AUTONOMY_DIRECTIVE } from "../porcupine/auto-mode.ts";
import { formatMemoryForPrompt } from "../porcupine/memory-store.ts";
import { PORCUPINE_PERSONALITY_GUIDELINES } from "../porcupine/personality.ts";
import { formatStacksCompact } from "../porcupine/stacks.ts";
import { formatSkillsForPrompt, formatSkillsStubForPrompt, type Skill } from "./skills.ts";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/**
	 * When false, inject a short skills stub instead of the full catalog.
	 * Used after context compaction to reclaim tokens. Default true.
	 */
	includeSkillsCatalog?: boolean;
	/** Agent home for MEMORY.md / USER.md injection. Defaults to getAgentDir(). */
	agentDir?: string;
	/** Skip durable memory injection (tests). */
	skipMemory?: boolean;
	/** When true, inject Auto Mode autonomy directive. */
	autoMode?: boolean;
}

function formatPersonalityGuidelines(): string {
	return PORCUPINE_PERSONALITY_GUIDELINES.map((g) => `- ${g}`).join("\n");
}

function memorySection(options: BuildSystemPromptOptions): string {
	if (options.skipMemory) return "";
	try {
		return formatMemoryForPrompt(options.agentDir ?? getAgentDir());
	} catch {
		return "";
	}
}

/**
 * Local date/time line for session start (system prompt) and compaction only.
 * Not injected into every user turn — that polluted chat history and the UI.
 */
export function formatCurrentDateTimeContext(now: Date = new Date()): string {
	try {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
		const formatted = new Intl.DateTimeFormat("en-US", {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: tz,
		}).format(now);
		return `Current date/time: ${formatted} (${tz})`;
	} catch {
		return `Current date/time: ${now.toISOString()}`;
	}
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = options;
	const promptCwd = cwd.replace(/\\/g, "/");

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";
	const memoryBlock = memorySection(options);

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	const personalityBlock = `\n\n<porcupine_personality>\n${formatPersonalityGuidelines()}\n</porcupine_personality>`;

	if (customPrompt) {
		let prompt = customPrompt;

		// Custom SYSTEM.md replaces the default body, but personality rules still apply
		// unless the file already embeds the same block.
		if (!prompt.includes("<porcupine_personality>") && !prompt.includes("Model-led")) {
			prompt += personalityBlock;
		}

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n<project_context>\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
			}
			prompt += "</project_context>\n";
		}

		// Append skills section (only if read tool is available)
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead) {
			if (options.includeSkillsCatalog === false) {
				prompt += formatSkillsStubForPrompt();
			} else if (skills.length > 0) {
				prompt += formatSkillsForPrompt(skills);
			}
		}

		prompt += memoryBlock;
		prompt += `\n\n<porcupine_stacks>\n${formatStacksCompact()}\n</porcupine_stacks>`;
		// Session-start context (like AGENTS.md) — not repeated on every user turn.
		prompt += `\n${formatCurrentDateTimeContext()}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// Get absolute paths to documentation and examples
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools || ["read", "bash", "edit", "write"];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	// Model-led planning / skill / tool personality (not a pre-turn classifier)
	for (const guideline of PORCUPINE_PERSONALITY_GUIDELINES) {
		addGuideline(guideline);
	}

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are an expert assistant operating inside Porcupine, a Safe Autonomous AI Agent. Coding is one faculty. You help users by reading files, executing commands, editing files, and writing new ones.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Porcupine documentation (read only when the user asks about Porcupine itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When reading product docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on product topics, read the docs and examples, and follow .md cross-references before implementing
- Always read product .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n<project_context>\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}

	// Append skills section (only if read tool is available)
	if (hasRead) {
		if (options.includeSkillsCatalog === false) {
			prompt += formatSkillsStubForPrompt();
		} else if (skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}
	}

	prompt += memoryBlock;
	prompt += `\n\n<porcupine_stacks>\n${formatStacksCompact()}\n</porcupine_stacks>`;
	// Session-start context (like AGENTS.md) — not repeated on every user turn.
	prompt += `\n${formatCurrentDateTimeContext()}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;
	if (options.autoMode) {
		prompt += `\n\n${AUTO_MODE_AUTONOMY_DIRECTIVE}`;
	}

	return prompt;
}
