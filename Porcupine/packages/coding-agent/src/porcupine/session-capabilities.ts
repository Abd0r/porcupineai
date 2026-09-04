import {
	type ArtifactChange,
	type CapabilityDescriptor,
	CapabilityTree,
	describeArtifactChange,
} from "@porcupineai/agent-core";
import {
	describeSkillCapability,
	describeToolCapability,
	formatCapabilityProjection,
	formatStacksOverview,
	searchStacks,
} from "./stacks.ts";

export interface CatalogTool {
	name: string;
	description?: string;
	promptSnippet?: string;
	available?: boolean;
}

export interface CatalogSkill {
	name: string;
	description?: string;
	filePath?: string;
	/** Optional explicit stack id (frontmatter stack: / metadata.porcupine.stack). */
	stack?: string;
	tags?: string[];
	available?: boolean;
}

/**
 * Build the session capability tree with stable stack paths:
 *   stacks/<stack>/<lane>/<name>
 */
export function buildCapabilityTreeFromSession(options: {
	tools: CatalogTool[];
	skills?: CatalogSkill[];
}): CapabilityTree {
	const capabilities: CapabilityDescriptor[] = [];

	for (const tool of options.tools) {
		capabilities.push(
			describeToolCapability({
				name: tool.name,
				description: tool.description,
				promptSnippet: tool.promptSnippet,
				available: tool.available,
			}),
		);
	}

	for (const skill of options.skills ?? []) {
		capabilities.push(
			describeSkillCapability({
				name: skill.name,
				description: skill.description,
				stack: skill.stack,
				tags: skill.tags,
				filePath: skill.filePath,
				available: skill.available,
			}),
		);
	}

	return new CapabilityTree(capabilities);
}

/** Pretty stack overview for /stacks and prompt context. */
export function renderStacksCatalog(tree: CapabilityTree): string {
	const overview = formatStacksOverview(tree);
	const projection = formatCapabilityProjection(tree.project(), { maxDepth: 6 });
	return `${overview}\n\n── search tree ──\n${projection}`;
}

export { searchStacks, formatStacksOverview, formatCapabilityProjection };

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Derive a structured artifact change from edit/write tool call args. */
export function artifactChangeFromToolCall(
	toolName: string,
	args: unknown,
	isError: boolean,
): ArtifactChange | undefined {
	if (isError) return undefined;
	const record = asRecord(args);
	if (!record) return undefined;

	if (toolName === "write") {
		const path = stringField(record.path);
		const content = stringField(record.content);
		if (!path || content === undefined) return undefined;
		return describeArtifactChange(path, "", content, "write");
	}

	if (toolName === "edit") {
		const path = stringField(record.path);
		if (!path) return undefined;

		const edits = Array.isArray(record.edits) ? record.edits : undefined;
		if (edits && edits.length > 0) {
			let previous = "";
			let next = "";
			for (const raw of edits) {
				const edit = asRecord(raw);
				const oldText = stringField(edit?.oldText) ?? "";
				const newText = stringField(edit?.newText) ?? "";
				previous += `${oldText}\n`;
				next += `${newText}\n`;
			}
			return describeArtifactChange(path, previous, next, "edit");
		}

		const oldText = stringField(record.oldText);
		const newText = stringField(record.newText);
		if (oldText === undefined || newText === undefined) return undefined;
		return describeArtifactChange(path, oldText, newText, "edit");
	}

	return undefined;
}
