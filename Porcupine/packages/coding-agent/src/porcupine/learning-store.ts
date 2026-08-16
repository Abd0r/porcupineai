import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ArtifactChange, describeArtifactChange, UserPatternLearningLoop } from "@porcupineai/agent-core";
import { createNodeUserPatternLearningAdapters } from "@porcupineai/agent-core/node";
import { lockDirSync } from "../core/sync-lock.ts";
import { inferLearningStack } from "./capability-learning.ts";
import { checkRollback, recordSkillUse } from "./evidence-counter.ts";
import { extractUserPatternsHeuristic, memoryPath, mutateMemory, readMemoryFile } from "./memory-store.ts";
import { createUserWriteGuard } from "./memory-write-guard.ts";

export type LearningProposalKind = "memory" | "skill" | "tool";
export type LearningProposalStatus = "proposed" | "activated" | "rejected" | "archived";
export type LearningOrigin = "porcupine-crafted" | "user-authored" | "user-edited";
/** A = mechanical/benchmark-verified, B = single-run, C = trajectory, D = unverified. */
export type LearningGrade = "A" | "B" | "C" | "D";
export type LearningRiskTier = "low" | "medium" | "high";

export interface LearningToolEvidence {
	name: string;
	isError: boolean;
}

export interface PostTurnLearningObservation {
	userText: string;
	tools: LearningToolEvidence[];
	sessionId?: string;
}

export interface LearningProposal {
	id: string;
	kind: LearningProposalKind;
	status: LearningProposalStatus;
	createdAt: string;
	updatedAt: string;
	summary: string;
	evidence: string[];
	sessionId?: string;
	stack?: string;
	draftContent?: string;
	/** Who authored the target artifact — user-authored is never silently edited. */
	origin?: LearningOrigin;
	/** Evidence grade deciding whether the change may auto-apply. */
	verificationGrade?: LearningGrade;
	/** Risk tier: low create/append, medium edit existing crafted, high tool/user-authored. */
	riskTier?: LearningRiskTier;
	/** Snapshot id captured before the edit, used for auto-rollback. */
	snapshotRef?: string;
	/** Measured before/after results (filled by the evaluator, Phase E). */
	evalResults?: Array<{
		task: string;
		passBefore?: boolean;
		passAfter?: boolean;
		tokensBefore?: number;
		tokensAfter?: number;
	}>;
	/** Set when this record is the rollback of another proposal. */
	rollbackOf?: string;
}

export interface LearningOutcome {
	userPatternChange?: ArtifactChange;
	/** Durable audit records created during this settled turn. */
	records: LearningProposal[];
	/** Concrete user-visible artifacts activated without a review queue. */
	activated: LearningMutationResult[];
}

export interface LearningMutationResult {
	proposal: LearningProposal;
	artifactChange?: ArtifactChange;
}

export interface LearningGraph {
	startedAt?: string;
	totalRecords: number;
	activatedRecords: number;
	userPatternUpdates: number;
	nodes: LearningProposal[];
}

export interface LearningEvent {
	at: string;
	type: string;
	recordId?: string;
	kind?: string;
}

/** One line of the self-improvement activity feed shown in the UI. */
export interface LearningFeedEntry {
	at: string;
	action: "created" | "edited" | "rolled-back" | "memory" | "rejected";
	file?: string;
	linesAdded?: number;
	linesRemoved?: number;
	summary: string;
	proposalId?: string;
	kind?: LearningProposalKind;
}

/** Snapshot of an artifact before an autonomous edit (for auto-rollback). */
export interface ArtifactSnapshot {
	id: string;
	artifactPath: string;
	content: string;
	createdAt: string;
	reason?: string;
	/** Success rate of the artifact captured at edit time (rollback baseline). */
	baselineRate?: number;
	/**
	 * Hash of the on-disk artifact content the edit left behind. On revert we
	 * refuse to clobber if the current content no longer matches, protecting
	 * against overwriting a later (independent) edit.
	 */
	expectedContentHash?: string;
}

const LEARNING_DIR = "learning";
const PROPOSALS_DIR = "proposals";
const EVENTS_FILE = "events.jsonl";
const SNAPSHOT_DIR = "snapshots";
const SENSITIVE_PATTERN = /\b(password|api[_-]?key|token|secret|ssn|credit\s*card)\b/i;

function learningRoot(agentDir: string): string {
	return join(agentDir, LEARNING_DIR);
}

function proposalsRoot(agentDir: string): string {
	return join(learningRoot(agentDir), PROPOSALS_DIR);
}

function proposalPath(agentDir: string, id: string): string {
	return join(proposalsRoot(agentDir), `${id}.json`);
}

function eventsPath(agentDir: string): string {
	return join(learningRoot(agentDir), EVENTS_FILE);
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try {
			rmSync(temporary, { force: true });
		} catch {
			// Best effort cleanup. The atomic rename already completed when it matters.
		}
	}
}

function writeProposal(agentDir: string, proposal: LearningProposal): void {
	atomicWrite(proposalPath(agentDir, proposal.id), `${JSON.stringify(proposal, null, 2)}\n`);
}

function appendEvent(agentDir: string, event: Record<string, unknown>): void {
	const path = eventsPath(agentDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, {
		encoding: "utf8",
		mode: 0o600,
		flag: "a",
	});
}

// ---------------------------------------------------------------------------
// Learning-activity feed + artifact snapshots (Phase B — autonomous + transparent)
// ---------------------------------------------------------------------------

/** Append a self-improvement activity entry to the append-only audit log. */
function emitFeedEvent(agentDir: string, entry: Omit<LearningFeedEntry, "at">): void {
	appendEvent(agentDir, { type: "learning-feed", ...entry });
}

/** Public feed-event publisher (used by the refiner and other modules). */
export function publishFeedEntry(agentDir: string, entry: Omit<LearningFeedEntry, "at">): void {
	emitFeedEvent(agentDir, entry);
}

/** Most recent self-improvement feed entries (newest first). */
export function listLearningFeed(agentDir: string, limit = 20): LearningFeedEntry[] {
	try {
		return readFileSync(eventsPath(agentDir), "utf8")
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					const parsed = JSON.parse(line) as LearningFeedEntry & { type?: string };
					return parsed.type === "learning-feed" ? [{ ...parsed }] : [];
				} catch {
					return [];
				}
			})
			.slice(-limit)
			.reverse();
	} catch {
		return [];
	}
}

function snapshotPath(agentDir: string, id: string): string {
	return join(learningRoot(agentDir), SNAPSHOT_DIR, `${id}.json`);
}

/**
 * Capture an artifact's content BEFORE an autonomous edit so the change can be
 * reverted if evidence shows it regressed. Returns the snapshot id.
 */
function contentHash(value: string): string {
	return createHash("sha1").update(value).digest("hex");
}

/**
 * Record the post-edit content hash on a snapshot so `revertFromSnapshot` can
 * refuse to clobber an artifact that was re-edited after this autonomous edit.
 */
export function markSnapshotContent(agentDir: string, snapshotId: string, content: string): void {
	const snapshot = readSnapshot(agentDir, snapshotId);
	if (!snapshot) return;
	snapshot.expectedContentHash = contentHash(content);
	atomicWrite(snapshotPath(agentDir, snapshotId), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function snapshotArtifact(
	agentDir: string,
	artifactPath: string,
	options: { reason?: string; baselineRate?: number } = {},
): ArtifactSnapshot {
	const id = `${slugify(
		artifactPath
			.split("/")
			.pop()
			?.replace(/\.(md|jsonl|txt)$/i, "") ?? "artifact",
	)}-${Date.now().toString(36)}`;
	const snapshot: ArtifactSnapshot = {
		id,
		artifactPath,
		content: existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : "",
		createdAt: new Date().toISOString(),
		reason: options.reason,
		baselineRate: options.baselineRate,
	};
	atomicWrite(snapshotPath(agentDir, id), `${JSON.stringify(snapshot, null, 2)}\n`);
	return snapshot;
}

/** Read a stored snapshot without applying it. */
export function readSnapshot(agentDir: string, id: string): ArtifactSnapshot | undefined {
	if (!safeProposalId(id)) return undefined;
	try {
		return JSON.parse(readFileSync(snapshotPath(agentDir, id), "utf8")) as ArtifactSnapshot;
	} catch {
		return undefined;
	}
}

/** Restore an artifact from a snapshot (auto-rollback). Returns the snapshot restored. */
export function revertFromSnapshot(agentDir: string, id: string): ArtifactSnapshot {
	const snapshot = readSnapshot(agentDir, id);
	if (!snapshot) throw new Error(`Snapshot not found: ${id}`);
	const current = existsSync(snapshot.artifactPath) ? readFileSync(snapshot.artifactPath, "utf8") : "";
	if (snapshot.expectedContentHash && contentHash(current) !== snapshot.expectedContentHash) {
		throw new Error(`Refusing to clobber artifact re-edited since snapshot: ${snapshot.artifactPath}`);
	}
	atomicWrite(snapshot.artifactPath, snapshot.content);
	return snapshot;
}

/**
 * The stable evidence-counter key attached to an artifact: for a skill the key
 * is the skill folder name (basename of the dir containing SKILL.md); for other
 * artifacts (e.g. MEMORY.md) there is no per-skill counter, so no key exists.
 */
function evidenceKeyForArtifact(artifactPath: string): string | undefined {
	const segments = artifactPath.split("/");
	if (segments[segments.length - 1] === "SKILL.md") {
		return segments[segments.length - 2];
	}
	return undefined;
}

/**
 * Auto-rollback sweep: for every activated proposal with a snapshot, check the
 * evidence counter for regression and revert if the success rate dropped.
 * Runs after a settled turn (transparent — each revert emits a feed entry).
 */
export function checkAndRollbackRegressions(agentDir: string): LearningProposal[] {
	const rolledBack: LearningProposal[] = [];
	for (const proposal of listLearningProposals(agentDir)) {
		if (proposal.status !== "activated" || !proposal.snapshotRef) continue;
		const snapshot = readSnapshot(agentDir, proposal.snapshotRef);
		if (!snapshot) continue;
		// Rollback evidence is keyed by the stable skill NAME (folder), matching
		// recordSkillUse and the refiner's baseline — NOT the timestamped id.
		const key = evidenceKeyForArtifact(snapshot.artifactPath);
		if (!key) continue;
		const check = checkRollback(agentDir, key, snapshot.baselineRate);
		if (!check.shouldRollback) continue;
		try {
			revertFromSnapshot(agentDir, proposal.snapshotRef);
			proposal.status = "archived";
			proposal.updatedAt = new Date().toISOString();
			writeProposal(agentDir, proposal);
			appendEvent(agentDir, {
				type: "proposal-rolled-back",
				proposalId: proposal.id,
				kind: proposal.kind,
				reasons: check.reasons,
			});
			emitFeedEvent(agentDir, {
				action: "rolled-back",
				file: snapshot.artifactPath,
				summary: `auto-rolled back ${proposal.id}: ${check.reasons.join("; ")}`,
				proposalId: proposal.id,
				kind: proposal.kind,
			});
			rolledBack.push(proposal);
		} catch {
			// Snapshot missing/corrupt — leave the artifact as-is, log and continue.
			appendEvent(agentDir, {
				type: "rollback-failed",
				proposalId: proposal.id,
				snapshotRef: proposal.snapshotRef,
			});
		}
	}
	return rolledBack;
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 42);
}

function safeProposalId(value: string): boolean {
	return /^[a-z0-9][a-z0-9-]{2,80}$/.test(value) && !value.includes("..");
}

const LEARNINGS_FILE = "Learnings.md";

/**
 * Append a dated learning entry to a Learnings.md kept next to a skill's
 * SKILL.md (the durable, human-readable companion to the JSON proposal record).
 * Matches the existing loop's append-only feed pattern; preserves the file if
 * it already has content. Returns the file that was touched, or undefined when
 * the entry is already present.
 */
export function appendSkillLearningEntry(
	agentDir: string,
	options: { id: string; stack: string; kind?: LearningProposalKind; summary: string },
): string | undefined {
	const dir = join(agentDir, "skills", options.stack, options.id);
	const path = join(dir, LEARNINGS_FILE);
	const line = `- ${new Date().toISOString().slice(0, 10)}: [${options.kind ?? "skill"}/${options.stack}] ${options.summary}`;
	// Serialize the read-modify-write with a directory lock so concurrent
	// sessions/processes appending to the same Learnings.md can't lose each
	// other's entries (last-writer-wins on the full-file rewrite).
	mkdirSync(dir, { recursive: true });
	const release = lockDirSync(dir, {
		lockfilePath: join(dir, ".learning.lock"),
		realpath: false,
		stale: 30_000,
	});
	try {
		const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
		if (existing.includes(line)) return undefined;
		const header = existing.trim() ? `${existing.trimEnd()}\n\n` : "# Learnings\n\n";
		atomicWrite(path, `${header}${line}\n`);
		return path;
	} finally {
		release();
	}
}

function buildSkillDraft(id: string, toolName: string, evidence: string[], stack: string): string {
	const evidenceLines = evidence.map((item) => `- ${item}`).join("\n");
	return `---
name: ${id}
description: Recover safely when ${toolName} fails.
stack: ${stack}
version: 0.1.0
created_by: porcupine-learning
---

# ${id}

Autonomously learned from verified execution evidence. Refine it only after a better verified recovery is available.

## When to Use

Use when \`${toolName}\` fails in a comparable task and the failure evidence below remains relevant.

## Evidence

${evidenceLines}

## Procedure

1. Inspect the tool error and the exact inputs that produced it.
2. Check whether an existing capability already solves the underlying task.
3. Use the smallest safe recovery path.
4. Verify the outcome with a concrete read-back, test, or artifact check.

## Safety

- Do not expose credentials or secrets from tool output.
- Do not overwrite user-authored skills.
- This learned skill never overwrites a user-authored skill.
`;
}

function readProposal(agentDir: string, id: string): LearningProposal | undefined {
	if (!safeProposalId(id)) return undefined;
	try {
		const raw = JSON.parse(readFileSync(proposalPath(agentDir, id), "utf8")) as LearningProposal;
		if (!raw || raw.id !== id || !raw.kind || !raw.status) return undefined;
		return raw;
	} catch {
		return undefined;
	}
}

export function listLearningProposals(agentDir: string): LearningProposal[] {
	const dir = proposalsRoot(agentDir);
	if (!existsSync(dir)) return [];
	const results: LearningProposal[] = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".json")) continue;
		const proposal = readProposal(agentDir, name.slice(0, -5));
		if (proposal) results.push(proposal);
	}
	return results.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Most recent learning events (newest first), from the append-only audit log. */
export function listLearningEvents(agentDir: string, limit = 20): LearningEvent[] {
	try {
		return readFileSync(eventsPath(agentDir), "utf8")
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					return [JSON.parse(line) as LearningEvent];
				} catch {
					return [];
				}
			})
			.slice(-limit)
			.reverse();
	} catch {
		return [];
	}
}

/** Evidence-backed learning topology for `/learning`; no synthetic scores. */
export function buildLearningGraph(agentDir: string): LearningGraph {
	const nodes = listLearningProposals(agentDir);
	let userPatternUpdates = 0;
	let startedAt: string | undefined;
	try {
		const events = readFileSync(eventsPath(agentDir), "utf8")
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					return [JSON.parse(line) as { at?: string; type?: string }];
				} catch {
					return [];
				}
			});
		startedAt = events[0]?.at;
		userPatternUpdates = events.filter((event) => event.type === "user-pattern-updated").length;
	} catch {
		// No learning history has been recorded yet.
	}
	return {
		startedAt,
		totalRecords: nodes.length,
		activatedRecords: nodes.filter((node) => node.status === "activated").length,
		userPatternUpdates,
		nodes,
	};
}

function hasOpenProposal(agentDir: string, toolName: string): boolean {
	return listLearningProposals(agentDir).some(
		(proposal) =>
			proposal.status === "proposed" && proposal.evidence.some((line) => line.includes(`tool ${toolName} failed`)),
	);
}

function extractExplicitTechnicalMemoryFact(userText: string): string | undefined {
	const match = /\b(?:remember|note)\s+(?:that\s+)?(.+)/i.exec(userText);
	const fact = match?.[1]?.trim().replace(/[.]+$/, "");
	if (!fact || fact.length < 12 || fact.length > 240) return undefined;
	if (
		!/\b(project|repo(?:sitory)?|codebase|machine|environment|runtime|tool(?:chain)?|build|test|workspace|uses?|configured|runs?)\b/i.test(
			fact,
		)
	) {
		return undefined;
	}
	if (SENSITIVE_PATTERN.test(fact)) return undefined;
	return fact;
}

export interface PostTurnLearningOptions {
	/** Enable autonomous USER.md user-pattern writes. Defaults to false (memory is agent-decided only). */
	enableUserPatterns?: boolean;
	/** Enable autonomous capability learning (durable MEMORY.md technical facts + recovery skills). Defaults to false. */
	enableCapabilityLearning?: boolean;
}

export async function processPostTurnLearning(
	agentDir: string,
	observation: PostTurnLearningObservation,
	options: PostTurnLearningOptions = {},
): Promise<LearningOutcome> {
	const enableUserPatterns = options.enableUserPatterns ?? false;
	const enableCapabilityLearning = options.enableCapabilityLearning ?? false;
	const output: LearningOutcome = { records: [], activated: [] };
	const activate = (record: LearningProposal) => {
		try {
			const result = applyLearningProposal(agentDir, record.id);
			output.records.push(result.proposal);
			output.activated.push(result);
			appendEvent(agentDir, {
				type: "learning-activated",
				recordId: result.proposal.id,
				kind: result.proposal.kind,
				sessionId: observation.sessionId,
			});
		} catch (error) {
			record.status = "archived";
			record.updatedAt = new Date().toISOString();
			writeProposal(agentDir, record);
			appendEvent(agentDir, {
				type: "learning-activation-blocked",
				recordId: record.id,
				kind: record.kind,
				sessionId: observation.sessionId,
				reason: error instanceof Error ? error.message : String(error),
			});
			output.records.push(record);
		}
	};
	const userText = observation.userText.trim();
	if (userText && enableUserPatterns) {
		const userAdapters = createNodeUserPatternLearningAdapters({
			rootDir: agentDir,
			async extract(message) {
				return extractUserPatternsHeuristic(message);
			},
		});
		// Snapshot + content-hash guard USER.md before autonomous user-pattern writes
		// so a rollback refuses to clobber a later independent edit.
		const userWriteGuard = createUserWriteGuard(agentDir, (relative) => join(agentDir, relative));
		const userLearner = new UserPatternLearningLoop(
			{
				...userAdapters,
				writeUserFile: userWriteGuard.wrapUserWrite(userAdapters.writeUserFile.bind(userAdapters)),
			},
			{ minimumConfidence: 0.85 },
		);
		const result = await userLearner.learn(userText);
		if (result.fileChange) {
			output.userPatternChange = result.fileChange;
			appendEvent(agentDir, {
				type: "user-pattern-updated",
				sessionId: observation.sessionId,
				accepted: result.accepted,
			});
		}
	}

	if (userText && enableCapabilityLearning) {
		const memoryFact = extractExplicitTechnicalMemoryFact(userText);
		if (memoryFact) {
			const id = `memory-${slugify(memoryFact)}`;
			const existing = readProposal(agentDir, id);
			if (!existing) {
				const now = new Date().toISOString();
				const proposal: LearningProposal = {
					id,
					kind: "memory",
					status: "proposed",
					createdAt: now,
					updatedAt: now,
					summary: `Autonomously learned durable project memory: ${memoryFact}`,
					evidence: ["explicit user request after a completed response", memoryFact],
					sessionId: observation.sessionId,
					draftContent: memoryFact,
					// Phase B: origin/grade/risk — explicit user request, low risk append.
					origin: "porcupine-crafted",
					verificationGrade: "B",
					riskTier: "low",
				};
				writeProposal(agentDir, proposal);
				appendEvent(agentDir, {
					type: "learning-observed",
					recordId: proposal.id,
					kind: proposal.kind,
					sessionId: observation.sessionId,
				});
				activate(proposal);
			}
		}
	}

	for (const tool of enableCapabilityLearning ? observation.tools : []) {
		// Wire tool outcomes into the evidence counter BEFORE failure handling so
		// the counter is populated even for the create path. The key is the same
		// learned-skill id used by the proposal/skill folder (and thus by the
		// refiner's baseline + auto-rollback), matching capability-learning.
		if (tool.name) {
			recordSkillUse(agentDir, `learned-${slugify(`recover-${tool.name}`)}`, !tool.isError);
		}
		if (!tool.isError || !tool.name || hasOpenProposal(agentDir, tool.name)) continue;
		const evidence = [`tool ${tool.name} failed after the model response path began`];
		if (SENSITIVE_PATTERN.test(evidence.join("\n"))) continue;
		const stack = inferLearningStack({
			type: "execution-failure",
			description: `Recover from ${tool.name} failures`,
			evidence,
			capabilityId: `tool:${tool.name}`,
		});
		const id = `learned-${slugify(`recover-${tool.name}`)}`;
		const existing = readProposal(agentDir, id);
		if (existing) continue;
		const now = new Date().toISOString();
		const proposal: LearningProposal = {
			id,
			kind: "skill",
			status: "proposed",
			createdAt: now,
			updatedAt: now,
			summary: `Autonomously learned recovery guidance for failed ${tool.name} calls.`,
			evidence,
			sessionId: observation.sessionId,
			stack,
			draftContent: buildSkillDraft(id, tool.name, evidence, stack),
			// Phase B: single-trajectory evidence → grade C, low risk create.
			origin: "porcupine-crafted",
			verificationGrade: "C",
			riskTier: "low",
		};
		writeProposal(agentDir, proposal);
		appendEvent(agentDir, {
			type: "learning-observed",
			recordId: proposal.id,
			kind: proposal.kind,
			sessionId: observation.sessionId,
		});
		activate(proposal);
	}
	return output;
}

function validateSkillProposal(proposal: LearningProposal): string[] {
	const errors: string[] = [];
	if (!safeProposalId(proposal.id)) errors.push("unsafe proposal id");
	if (!proposal.evidence.length) errors.push("missing evidence");
	if (!proposal.draftContent?.trim()) errors.push("missing draft content");
	if (SENSITIVE_PATTERN.test(`${proposal.summary}\n${proposal.evidence.join("\n")}\n${proposal.draftContent ?? ""}`)) {
		errors.push("proposal contains sensitive-looking content");
	}
	return errors;
}

export function applyLearningProposal(agentDir: string, id: string): LearningMutationResult {
	const proposal = readProposal(agentDir, id);
	if (!proposal) throw new Error(`Unknown learning proposal: ${id}`);
	if (proposal.status !== "proposed") throw new Error(`Proposal ${id} is ${proposal.status}, not proposed`);
	if (proposal.kind === "tool") {
		throw new Error("Tool proposals require an explicit code review and cannot be activated here");
	}
	const errors = validateSkillProposal(proposal);
	if (errors.length) throw new Error(`Proposal ${id} failed validation: ${errors.join("; ")}`);
	if (proposal.kind === "memory") {
		const previousContent = readMemoryFile(agentDir, "memory");
		// Snapshot before the edit when it actually changes, so the change can be
		// auto-rolled back. A dedupe no-op (fact already present) archives instead.
		const result = mutateMemory(agentDir, "add", "memory", {
			content: proposal.draftContent,
		});
		if (!result.ok) throw new Error(`Unable to update MEMORY.md: ${result.message}`);
		if (previousContent === result.content) {
			// The fact is already present — this is NOT an autonomous improvement.
			// Archive it rather than recording a phantom "activated" record.
			proposal.status = "archived";
			proposal.updatedAt = new Date().toISOString();
			writeProposal(agentDir, proposal);
			appendEvent(agentDir, {
				type: "proposal-archived",
				proposalId: proposal.id,
				kind: proposal.kind,
				reason: "already present (no change)",
			});
			return { proposal, artifactChange: undefined };
		}
		const snapshot = snapshotArtifact(agentDir, memoryPath(agentDir, "memory"), {
			reason: `auto-apply memory proposal ${proposal.id}`,
		});
		proposal.snapshotRef = snapshot.id;
		markSnapshotContent(agentDir, snapshot.id, result.content);
		proposal.status = "activated";
		proposal.updatedAt = new Date().toISOString();
		writeProposal(agentDir, proposal);
		appendEvent(agentDir, {
			type: "proposal-activated",
			proposalId: proposal.id,
			kind: proposal.kind,
		});
		const artifactChange = describeArtifactChange(
			result.file,
			previousContent,
			result.content,
			`Applied reviewed memory proposal ${proposal.id}.`,
		);
		emitFeedEvent(agentDir, {
			action: "memory",
			file: result.file,
			linesAdded: artifactChange?.linesAdded,
			linesRemoved: artifactChange?.linesRemoved,
			summary: proposal.summary,
			proposalId: proposal.id,
			kind: proposal.kind,
		});
		return { proposal, artifactChange };
	}
	const stack = proposal.stack && /^[a-z0-9-]+$/.test(proposal.stack) ? proposal.stack : "meta";
	const target = join(agentDir, "skills", stack, proposal.id, "SKILL.md");
	if (existsSync(target)) throw new Error(`Refusing to overwrite existing skill: ${target}`);
	const nextContent = proposal.draftContent!;
	atomicWrite(target, nextContent);
	// Portable companion record: a dated Learnings.md entry in the skill dir.
	appendSkillLearningEntry(agentDir, {
		id: proposal.id,
		stack,
		kind: proposal.kind,
		summary: proposal.summary,
	});
	if (proposal.snapshotRef) markSnapshotContent(agentDir, proposal.snapshotRef, nextContent);
	proposal.status = "activated";
	proposal.updatedAt = new Date().toISOString();
	writeProposal(agentDir, proposal);
	appendEvent(agentDir, {
		type: "proposal-activated",
		proposalId: proposal.id,
		kind: proposal.kind,
	});
	const artifactChange = describeArtifactChange(
		target,
		"",
		nextContent,
		`Activated reviewed learning proposal ${proposal.id}.`,
	);
	emitFeedEvent(agentDir, {
		action: "created",
		file: target,
		linesAdded: artifactChange.linesAdded,
		linesRemoved: artifactChange.linesRemoved,
		summary: proposal.summary,
		proposalId: proposal.id,
		kind: proposal.kind,
	});
	return { proposal, artifactChange };
}

export function rejectLearningProposal(agentDir: string, id: string): LearningMutationResult {
	const proposal = readProposal(agentDir, id);
	if (!proposal) throw new Error(`Unknown learning proposal: ${id}`);
	if (proposal.status !== "proposed") throw new Error(`Proposal ${id} is ${proposal.status}, not proposed`);
	proposal.status = "rejected";
	proposal.updatedAt = new Date().toISOString();
	writeProposal(agentDir, proposal);
	appendEvent(agentDir, {
		type: "proposal-rejected",
		proposalId: proposal.id,
		kind: proposal.kind,
	});
	return { proposal };
}

export function formatLearningStatus(agentDir: string, _includeClosed = false): string {
	const graph = buildLearningGraph(agentDir);
	if (!graph.totalRecords) return "Learning: no autonomous improvements recorded yet.";
	const lines = [`Learning: ${graph.activatedRecords}/${graph.totalRecords} autonomous improvements activated.`];
	for (const proposal of graph.nodes.slice(0, 12)) {
		lines.push(`- ${proposal.id} [${proposal.status}/${proposal.kind}] ${proposal.summary}`);
	}
	if (graph.nodes.length > 12) lines.push(`- … ${graph.nodes.length - 12} more`);
	return lines.join("\n");
}
