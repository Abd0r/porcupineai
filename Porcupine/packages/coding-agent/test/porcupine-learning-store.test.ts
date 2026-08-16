import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { parseLearningCommand } from "../src/modes/interactive/learning-command.ts";
import { getSkillStats } from "../src/porcupine/evidence-counter.ts";
import {
	appendSkillLearningEntry,
	applyLearningProposal,
	buildLearningGraph,
	listLearningEvents,
	markSnapshotContent,
	processPostTurnLearning,
	revertFromSnapshot,
	snapshotArtifact,
} from "../src/porcupine/learning-store.ts";

describe("autonomous post-turn learning", () => {
	it("adds an explicit durable preference after the turn settles", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-post-turn-"));
		const result = await processPostTurnLearning(
			agentDir,
			{
				userText: "Please remember that I prefer pnpm over npm.",
				tools: [],
				sessionId: "s1",
			},
			{ enableUserPatterns: true },
		);
		expect(result.userPatternChange?.path).toBe("USER.md");
		expect(readFileSync(join(agentDir, "USER.md"), "utf8")).toContain("prefer pnpm over npm");
	});

	it("does NOT write USER.md when enableUserPatterns is off (agent-decided memory only)", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-no-user-flag-"));
		const result = await processPostTurnLearning(agentDir, {
			userText: "Please remember that I prefer pnpm over npm.",
			tools: [],
			sessionId: "s-off",
		});
		// Default (and interactive-mode's hardcoded) flag is off: no USER.md write.
		expect(result.userPatternChange).toBeUndefined();
		expect(existsSync(join(agentDir, "USER.md"))).toBe(false);
	});

	it("autonomously activates technical memory after an explicit request", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-learning-memory-"));
		const result = await processPostTurnLearning(
			agentDir,
			{
				userText: "Please remember that this repository uses pnpm workspace commands.",
				tools: [],
				sessionId: "s2",
			},
			{ enableCapabilityLearning: true },
		);
		expect(result.records).toHaveLength(1);
		expect(result.records[0]?.status).toBe("activated");
		expect(readFileSync(join(agentDir, "MEMORY.md"), "utf8")).toContain("repository uses pnpm workspace commands");
	});

	it("autonomously activates a non-overwriting recovery skill after a tool failure", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-learning-skill-"));
		const result = await processPostTurnLearning(
			agentDir,
			{
				userText: "Fix the build.",
				tools: [{ name: "bash", isError: true }],
				sessionId: "s3",
			},
			{ enableCapabilityLearning: true },
		);
		const record = result.records[0]!;
		expect(record.status).toBe("activated");
		expect(existsSync(join(agentDir, "skills", record.stack!, record.id, "SKILL.md"))).toBe(true);
		// The portable Learnings.md companion is appended next to the SKILL.md.
		expect(existsSync(join(agentDir, "skills", record.stack!, record.id, "Learnings.md"))).toBe(true);
		expect(readFileSync(join(agentDir, "skills", record.stack!, record.id, "Learnings.md"), "utf8")).toContain(
			"recovery guidance for failed bash calls",
		);

		const graph = buildLearningGraph(agentDir);
		expect(graph.activatedRecords).toBe(1);
		expect(graph.nodes[0]?.id).toBe(record.id);
	});

	it("deduplicates an already activated recovery skill", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-learning-dedupe-"));
		const observation = {
			userText: "Fix the build.",
			tools: [{ name: "bash", isError: true }],
		};
		await processPostTurnLearning(agentDir, observation, { enableCapabilityLearning: true });
		const repeated = await processPostTurnLearning(agentDir, observation, { enableCapabilityLearning: true });
		expect(repeated.records).toHaveLength(0);
		expect(buildLearningGraph(agentDir).totalRecords).toBe(1);
	});

	it("wires tool outcomes into the evidence counter (recordSkillUse in production)", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-record-use-"));
		await processPostTurnLearning(
			agentDir,
			{
				userText: "Fix the build.",
				tools: [
					{ name: "bash", isError: true },
					{ name: "grep", isError: false },
				],
				sessionId: "s-record",
			},
			{ enableCapabilityLearning: true },
		);
		// learned-${slugify("recover-bash")} = learned-recover-bash
		const failed = getSkillStats(agentDir, "learned-recover-bash");
		expect(failed).toBeDefined();
		expect(failed!.uses).toBe(1);
		expect(failed!.failures).toBe(1);
		expect(failed!.successes).toBe(0);
		// Success path also records.
		const ok = getSkillStats(agentDir, "learned-recover-grep");
		expect(ok).toBeDefined();
		expect(ok!.uses).toBe(1);
		expect(ok!.successes).toBe(1);
	});

	it("archives a memory proposal that dedupes to a no-op (already present)", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-noop-"));
		const fact = "this repository uses pnpm workspace commands";
		// Mirror learning-store's slugify (lowercase, hyphenate, slice to 42).
		const slug = fact
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 42);
		const id = `memory-${slug}`;
		// Seed MEMORY.md so the fact is already present, then create a PROPOSED
		// memory proposal whose draft content duplicates it.
		const seed = await processPostTurnLearning(
			agentDir,
			{
				userText: `Please remember that ${fact}.`,
				tools: [],
			},
			{ enableCapabilityLearning: true },
		);
		expect(seed.records[0]?.status).toBe("activated");

		// Reset the first proposal to "proposed" so applyLearningProposal re-runs it.
		const proposalPath = join(agentDir, "learning", "proposals", `${id}.json`);
		const persisted = JSON.parse(readFileSync(proposalPath, "utf8"));
		persisted.status = "proposed";
		persisted.snapshotRef = undefined;
		writeFileSync(proposalPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

		// Applying it now is a dedupe no-op → archived, not activated.
		const result = await applyLearningProposal(agentDir, id);
		expect(result.proposal.status).toBe("archived");
		expect(result.artifactChange).toBeUndefined();
		// No phantom "activated" record is counted for the no-op dedupe.
		const graph = buildLearningGraph(agentDir);
		expect(graph.activatedRecords).toBe(0);
		expect(graph.nodes.every((n) => n.status === "archived")).toBe(true);
	});

	it("refuses to clobber an artifact re-edited since the snapshot", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-clobber-"));
		const artifact = join(agentDir, "SKILL.md");
		writeFileSync(artifact, "before-edit\n", "utf8");
		const snapshot = snapshotArtifact(agentDir, artifact, { reason: "test" });
		// The edit leaves new content; record it as the expected on-disk state.
		markSnapshotContent(agentDir, snapshot.id, "after-edit\n");
		writeFileSync(artifact, "after-edit\n", "utf8");
		// No third-party edit → revert is allowed.
		expect(revertFromSnapshot(agentDir, snapshot.id).content).toBe("before-edit\n");

		// Re-edit after the autonomous edit → revert must refuse.
		writeFileSync(artifact, "after-edit\n", "utf8");
		const snapshot2 = snapshotArtifact(agentDir, artifact, { reason: "test2" });
		markSnapshotContent(agentDir, snapshot2.id, "after-edit\n");
		writeFileSync(artifact, "someone-else-edited\n", "utf8");
		expect(() => revertFromSnapshot(agentDir, snapshot2.id)).toThrow(/re-edited since snapshot/);
	});
});

describe("/learning", () => {
	it("opens the graph by default and supports history", () => {
		expect(parseLearningCommand("/learning")).toEqual({ kind: "graph" });
		expect(parseLearningCommand("/learning graph")).toEqual({ kind: "graph" });
		expect(parseLearningCommand("/learning history")).toEqual({
			kind: "history",
		});
		expect(parseLearningCommand("/learning apply learned-bash")).toEqual(
			expect.objectContaining({ kind: "invalid" }),
		);
	});

	it("lists the append-only learning events newest-first", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-learning-events-"));
		await processPostTurnLearning(
			agentDir,
			{
				userText: "Please remember that this repository uses pnpm workspace commands.",
				tools: [{ name: "bash", isError: true }],
				sessionId: "s-events",
			},
			{ enableCapabilityLearning: true },
		);
		const events = listLearningEvents(agentDir);
		expect(events.length).toBeGreaterThanOrEqual(2);
		expect(events[0]).toMatchObject({ type: "learning-activated" });
		expect(new Date(events[0]!.at).getTime()).toBeGreaterThanOrEqual(new Date(events.at(-1)!.at).getTime());
	});

	it("is advertised as a learning graph command", () => {
		expect(BUILTIN_SLASH_COMMANDS).toContainEqual({
			name: "learning",
			description: "Show autonomous learning evidence graph",
			argumentHint: "[graph|history]",
		});
	});
});

describe("appendSkillLearningEntry (Learnings.md companion)", () => {
	it("appends a dated entry in the skill directory without clobbering", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-learnings-"));
		const first = appendSkillLearningEntry(agentDir, {
			id: "learned-bash",
			stack: "shell",
			kind: "skill",
			summary: "Recover from bash failures.",
		});
		expect(first).toBe(join(agentDir, "skills/shell/learned-bash/Learnings.md"));
		const content = readFileSync(first!, "utf8");
		expect(content).toContain("# Learnings");
		expect(content).toMatch(/^- \d{4}-\d{2}-\d{2}: \[skill\/shell\] Recover from bash failures\.$/m);

		// Appending to an existing file preserves prior content and adds the header once.
		appendSkillLearningEntry(agentDir, {
			id: "learned-bash",
			stack: "shell",
			kind: "skill",
			summary: "A second bash recovery note.",
		});
		const updated = readFileSync(first!, "utf8");
		expect(updated).toContain("A second bash recovery note.");
		expect(updated.match(/# Learnings\n/g)).toHaveLength(1); // header added only once
	});

	it("returns undefined when the exact entry is already present", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-learnings-dedupe-"));
		const path = appendSkillLearningEntry(agentDir, {
			id: "learned-git",
			stack: "vcs",
			summary: "Recover git history.",
		});
		expect(path).toBeDefined();
		expect(
			appendSkillLearningEntry(agentDir, { id: "learned-git", stack: "vcs", summary: "Recover git history." }),
		).toBeUndefined();
	});
});
