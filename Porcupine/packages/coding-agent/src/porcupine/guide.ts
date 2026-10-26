export interface GuideTopic {
	id: string;
	title: string;
	summary: string;
	steps: readonly string[];
	docs: readonly string[];
}

const GUIDE_TOPICS: readonly GuideTopic[] = [
	{
		id: "start",
		title: "Start Here",
		summary: "Get Porcupine running, authenticated, and useful in one project.",
		steps: [
			"Run porcupine inside the project you want to work on.",
			"Use /login to configure a provider, then /model if you need to select one.",
			"Describe the result you want. Porcupine reads, plans when useful, acts, and verifies.",
		],
		docs: ["docs/quickstart.md", "docs/usage.md", "docs/providers.md"],
	},
	{
		id: "workflow",
		title: "Everyday Workflow",
		summary: "Use plain language for work. Porcupine routes tools and skills for clear requests.",
		steps: [
			"Ask for a concrete result, such as a fix, review, test run, or explanation.",
			"For larger work, ask for a plan first or use /plan <objective>.",
			"Inspect available capabilities with /stacks [query] when you want to see the route.",
		],
		docs: ["docs/usage.md", "docs/skills.md"],
	},
	{
		id: "modes",
		title: "Interaction Modes",
		summary: "Modes choose how tool actions are approved. Reasoning settings remain separate.",
		steps: [
			"Run /modes to choose Ask, Normal, or Auto.",
			"Ask confirms bash and file mutations. Normal confirms flagged operations.",
			"Auto is still fail-closed for flagged bash. It never makes destructive actions unrestricted.",
		],
		docs: ["docs/usage.md", "docs/security.md"],
	},
	{
		id: "subagent",
		title: "Sub-agents",
		summary: "Delegate focused work to an isolated worker with its own context and budgets.",
		steps: [
			"Use the subagent tool for self-contained work: long research, refactors, audits, drafts.",
			"Give an exact task: input paths, the deliverable, and where to put it. Add notes for constraints.",
			"The sub-agent shares your cwd + permission policy, cannot ask the user questions, and stops at its budget.",
		],
		docs: ["docs/usage.md", "docs/settings.md"],
	},
	{
		id: "planning",
		title: "Plans, Goals, Tasks, and Cron",
		summary: "These commands solve different problems. Choose the smallest one that fits.",
		steps: [
			"Use /plan <objective> for an inspection-only implementation plan saved as Markdown.",
			"The agent declares its own goal with the goal tool and tracks each step to evidence; there is no /goal command.",
			"Use /task for durable local work items. Use /cron only for an open, idle session, never as a daemon.",
		],
		docs: ["docs/usage.md", "docs/sessions.md"],
	},
	{
		id: "research",
		title: "Research and Documentation",
		summary: "Search first, then inspect a concrete source. Keep claims grounded.",
		steps: [
			"Use web_search to locate current information, then web_extract on chosen pages.",
			"Use /stacks web or /stacks docs to inspect the available research and writing capabilities.",
			"For questions about Porcupine itself, read the relevant docs/ file before relying on recollection.",
		],
		docs: ["docs/usage.md", "docs/index.md"],
	},
	{
		id: "computer",
		title: "Computer Use and Isolation",
		summary: "Native GUI work is deliberate, observable, and confirmation-gated.",
		steps: [
			"Prefer a structured API, browser CDP, shell, or file tool before native GUI input.",
			"For GUI work, check status, observe, make one confirmed small action, then observe again.",
			"Porcupine has no built-in process sandbox. Use a container, VM, or equivalent for isolation.",
		],
		docs: ["docs/security.md", "docs/containerization.md"],
	},
	{
		id: "learning",
		title: "Memory and Learning",
		summary: "Porcupine retains only durable, evidence-backed knowledge and recovery skills.",
		steps: [
			"Use memory for stable preferences and technical facts, never transient work or secrets.",
			"Use session_search when earlier conversation context matters.",
			"Use /learning to inspect learning evidence and activation history.",
		],
		docs: ["docs/usage.md", "docs/skills.md"],
	},
	{
		id: "sessions",
		title: "Sessions and Context",
		summary: "Sessions preserve work. Branching and compaction manage history without losing the active goal.",
		steps: [
			"Use /resume to continue another session, /tree to navigate branches, and /fork or /clone to explore alternatives.",
			"Use /compact when the context needs a deliberate summary.",
			"Use /export to save a session outside Porcupine.",
		],
		docs: ["docs/sessions.md", "docs/compaction.md", "docs/session-format.md"],
	},
	{
		id: "customize",
		title: "Customize Porcupine",
		summary: "Extend the agent at the edges with settings, skills, prompts, themes, packages, and extensions.",
		steps: [
			"Use /settings for interactive preferences and /refresh to rebuild Porcupine and resume this session (modes, thinking).",
			"Use skills for reusable procedures and extensions for tools, commands, events, or custom UI.",
			"Read package and security documentation before installing third-party capabilities.",
		],
		docs: ["docs/settings.md", "docs/skills.md", "docs/extensions.md", "docs/packages.md"],
	},
] as const;

const TOPIC_BY_ID = new Map(GUIDE_TOPICS.map((topic) => [topic.id, topic]));

function formatTopicList(): string {
	return GUIDE_TOPICS.map((topic) => `  /guide ${topic.id.padEnd(9)} ${topic.summary}`).join("\n");
}

function formatTopic(topic: GuideTopic): string {
	return [
		topic.title,
		topic.summary,
		"",
		"Try:",
		...topic.steps.map((step, index) => `  ${index + 1}. ${step}`),
		"",
		`Read: ${topic.docs.join(", ")}`,
	].join("\n");
}

export function getGuideTopics(): readonly GuideTopic[] {
	return GUIDE_TOPICS;
}

export function formatGuideCommandOutput(text: string): string {
	const topicId = text
		.replace(/^\/guide\b/i, "")
		.trim()
		.toLowerCase();
	if (!topicId || topicId === "help") {
		return [
			"Porcupine Guide",
			"Use /guide <topic> for a short workflow and the docs to read next.",
			"",
			"Topics:",
			formatTopicList(),
			"",
			"Start with /guide start or /guide workflow.",
		].join("\n");
	}

	const topic = TOPIC_BY_ID.get(topicId);
	if (topic) return formatTopic(topic);

	return [`Unknown guide topic: ${topicId}`, "", "Topics:", formatTopicList()].join("\n");
}
