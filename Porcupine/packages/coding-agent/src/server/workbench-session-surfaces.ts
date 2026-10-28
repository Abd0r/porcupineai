import { lstatSync, readFileSync } from "node:fs";
import type { ThinkingLevel } from "@porcupineai/agent-core";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { AgentSession } from "../core/agent-session.ts";
import { WorkbenchError } from "./workbench-context-files.ts";

export type ReasoningMode = ThinkingLevel | "adaptive";
export type InteractionMode = "ask" | "normal" | "auto";
const controlPatchSchema = Type.Object(
	{
		interactionMode: Type.Optional(Type.Union([Type.Literal("ask"), Type.Literal("normal"), Type.Literal("auto")])),
		reasoningMode: Type.Optional(
			Type.Union([
				Type.Literal("off"),
				Type.Literal("minimal"),
				Type.Literal("low"),
				Type.Literal("medium"),
				Type.Literal("high"),
				Type.Literal("xhigh"),
				Type.Literal("max"),
				Type.Literal("adaptive"),
			]),
		),
	},
	{ additionalProperties: false, minProperties: 1, maxProperties: 1 },
);
export type ControlPatch = Static<typeof controlPatchSchema>;
export function parseControlPatch(value: unknown): ControlPatch {
	if (!Value.Check(controlPatchSchema, value))
		throw new WorkbenchError(400, "Change exactly one supported reasoning or interaction mode");
	return value;
}
export interface ContextStats {
	tokens: number;
	contextWindow: number;
	percent: number;
	compactAtPercent: number;
	reserveTokens: number | null;
	maxSubagents: number;
	cost?: number;
}
export interface SessionControls {
	interactionMode: InteractionMode;
	reasoningMode: ReasoningMode;
	availableReasoningModes: ReasoningMode[];
	busy: boolean;
	model: { id: string; name: string; provider: string } | null;
}
export type CatalogKind = "skills" | "tools";
export interface CatalogEntry {
	name: string;
	kind: CatalogKind;
	description: string;
	stack?: string;
	scope: string;
	availability: "active" | "available" | "manual-only";
}
export interface CatalogPage {
	skillsCount: number;
	toolsCount: number;
	entries: CatalogEntry[];
	total: number;
	offset: number;
}

/** Read live session state and known registry entries; never execute a tool to inspect it. */
function limitsOf(session: AgentSession): {
	compactAtPercent: number;
	reserveTokens: number | null;
	maxSubagents: number;
} {
	const window = session.model?.contextWindow ?? 0;
	const settings = session.settingsManager;
	const reserve = settings.getCompactionSettings().reserveTokens;
	const maxSubagents = settings.getSubagentSettings().maxConcurrent;
	const effectiveReserve = reserve ?? (window > 0 ? Math.round(window * 0.2) : 0);
	const compactAtPercent =
		window > 0 && effectiveReserve > 0
			? Math.max(1, Math.min(99, Math.round(((window - effectiveReserve) / window) * 100)))
			: 80;
	return { compactAtPercent, reserveTokens: reserve ?? null, maxSubagents };
}

export function createSessionSurfaces(session: AgentSession) {
	const getContext = (): ContextStats => {
		const usage = session.getContextUsage();
		const window = usage?.contextWindow ?? session.model?.contextWindow ?? 0;
		const tokens = usage?.tokens ?? 0;
		const limits = limitsOf(session);
		return {
			tokens,
			contextWindow: window,
			percent: window > 0 ? Math.min(100, Math.round((tokens / window) * 1000) / 10) : 0,
			compactAtPercent: limits.compactAtPercent,
			reserveTokens: limits.reserveTokens,
			maxSubagents: limits.maxSubagents,
		};
	};
	const getControls = (): SessionControls => ({
		interactionMode: session.interactionMode,
		reasoningMode: session.getReasoningMode(),
		availableReasoningModes: session.getAvailableReasoningModes(),
		busy: session.isStreaming || session.isCompacting,
		model: session.model
			? { id: session.model.id, name: session.model.name, provider: session.model.provider }
			: null,
	});
	return {
		async getModels() {
			const current = session.model ? { provider: session.model.provider, id: session.model.id } : null;
			const available = await session.modelRuntime.getAvailable();
			const models = available
				.map((model) => ({
					provider: model.provider,
					id: model.id,
					name: model.name,
					contextWindow: model.contextWindow ?? 0,
					reasoning: Boolean(model.reasoning),
				}))
				.sort((a, b) => `${a.provider}/${a.name}`.localeCompare(`${b.provider}/${b.name}`));
			return {
				current,
				subagentModel: session.settingsManager.getSubagentSettings().model ?? null,
				models,
			};
		},
		async setSessionModel(provider: string, id: string) {
			if (session.isStreaming)
				throw new WorkbenchError(409, "Wait for the current turn to settle before switching models");
			const model = session.modelRuntime.getModel(provider, id);
			if (!model) throw new WorkbenchError(404, "Unknown model");
			await session.setModel(model);
			return this.getModels();
		},
		setDefaultModel(provider: string, id: string) {
			session.settingsManager.setDefaultModelAndProvider(provider, id);
			return { provider, id };
		},
		setSubagentModel(provider: string, id: string) {
			session.settingsManager.setSubagentModel(`${provider}/${id}`);
			return { provider, id };
		},
		getContext,
		setLimits(patch: { compactAtPercent?: number; maxSubagents?: number }): ContextStats {
			const window = session.model?.contextWindow ?? 0;
			if (patch.compactAtPercent !== undefined) {
				if (!Number.isFinite(patch.compactAtPercent) || patch.compactAtPercent < 50 || patch.compactAtPercent > 95)
					throw new WorkbenchError(400, "Compaction threshold must be between 50% and 95%");
				if (window <= 0) throw new WorkbenchError(409, "No context window is known for this model yet");
				session.settingsManager.setCompactionReserveTokens(
					Math.round(window * ((100 - patch.compactAtPercent) / 100)),
				);
			}
			if (patch.maxSubagents !== undefined) session.settingsManager.setSubagentMaxConcurrent(patch.maxSubagents);
			return getContext();
		},
		getControls,
		configure(patch: ControlPatch): SessionControls {
			parseControlPatch(patch);
			const current = getControls();
			if (current.busy) throw new WorkbenchError(409, "Wait for the current turn to settle before changing modes");
			if (patch.reasoningMode && !current.availableReasoningModes.includes(patch.reasoningMode))
				throw new WorkbenchError(400, "That reasoning mode is not supported by the active model");
			if (patch.reasoningMode) session.setReasoningMode(patch.reasoningMode);
			if (patch.interactionMode) session.setInteractionMode(patch.interactionMode);
			return getControls();
		},
		getCatalog(kind?: CatalogKind, query = "", offset = 0, limit = 50): CatalogPage {
			const active = new Set(session.getActiveToolNames());
			const skills = session.resourceLoader.getSkills().skills;
			const tools = session.getAllTools();
			const entries: CatalogEntry[] =
				kind === "skills"
					? skills.map((skill) => ({
							name: skill.name,
							kind: "skills",
							description: skill.description,
							stack: skill.stack,
							scope: skill.sourceInfo.scope,
							availability: skill.disableModelInvocation ? "manual-only" : "available",
						}))
					: kind === "tools"
						? tools.map((tool) => ({
								name: tool.name,
								kind: "tools",
								description: tool.description,
								scope: tool.sourceInfo?.scope ?? "unspecified",
								availability: active.has(tool.name) ? "active" : "available",
							}))
						: [];
			const normalized = query.trim().toLowerCase();
			const matches = entries
				.filter(
					(entry) =>
						!normalized ||
						`${entry.name} ${entry.description} ${entry.stack ?? ""}`.toLowerCase().includes(normalized),
				)
				.sort((a, b) => a.name.localeCompare(b.name));
			return {
				skillsCount: skills.length,
				toolsCount: tools.length,
				entries: matches.slice(offset, offset + limit),
				total: matches.length,
				offset,
			};
		},
		inspectCatalog(kind: CatalogKind, name: string): { entry: CatalogEntry; content: string } {
			if (kind === "skills") {
				const skill = session.resourceLoader.getSkills().skills.find((item) => item.name === name);
				if (!skill) throw new WorkbenchError(404, "Unknown loaded skill");
				const stat = lstatSync(skill.filePath);
				if (stat.isSymbolicLink() || !stat.isFile())
					throw new WorkbenchError(
						403,
						"Skill metadata is available, but this source cannot be inspected as a regular file",
					);
				if (stat.size > 128 * 1024) throw new WorkbenchError(413, "Skill exceeds the source inspection size limit");
				return {
					entry: {
						name,
						kind,
						description: skill.description,
						stack: skill.stack,
						scope: skill.sourceInfo.scope,
						availability: skill.disableModelInvocation ? "manual-only" : "available",
					},
					content: readFileSync(skill.filePath, "utf8"),
				};
			}
			const tool = session.getAllTools().find((item) => item.name === name);
			if (!tool) throw new WorkbenchError(404, "Unknown configured tool");
			return {
				entry: {
					name,
					kind,
					description: tool.description,
					scope: tool.sourceInfo?.scope ?? "unspecified",
					availability: session.getActiveToolNames().includes(name) ? "active" : "available",
				},
				content: JSON.stringify(
					{ parameters: tool.parameters, promptGuidelines: tool.promptGuidelines ?? [] },
					null,
					2,
				),
			};
		},
	};
}
export type SessionSurfaces = ReturnType<typeof createSessionSurfaces>;

export interface SurfaceControl {
	setClientSurface?(surface: "tui" | "web" | "none"): void;
}

export interface ModelChoice {
	provider: string;
	id: string;
	name: string;
	contextWindow: number;
	reasoning: boolean;
}
export interface ModelsSurfaces {
	getModels?(): Promise<{
		current: { provider: string; id: string } | null;
		subagentModel: string | null;
		models: ModelChoice[];
	}>;
	setSessionModel?(
		provider: string,
		id: string,
	): Promise<{ current: { provider: string; id: string } | null; models: ModelChoice[] }>;
	setDefaultModel?(provider: string, id: string): { provider: string; id: string };
	setSubagentModel?(provider: string, id: string): { provider: string; id: string };
}
export interface ContextSurfaces {
	getContext?(): ContextStats;
	setLimits?(patch: { compactAtPercent?: number; maxSubagents?: number }): ContextStats;
}

export interface GoalPlanSurfaces {
	getGoalPlan(): unknown;
	onGoalPlanChange(listener: (view: unknown) => void): () => void;
}
