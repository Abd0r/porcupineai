import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRollback, recordSkillUse, trailingSuccessRate } from "../src/porcupine/evidence-counter.ts";
import {
	checkAndRollbackRegressions,
	listLearningFeed,
	processPostTurnLearning,
	revertFromSnapshot,
	snapshotArtifact,
} from "../src/porcupine/learning-store.ts";

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

describe("evidence counter (Phase B)", () => {
	it("records uses and computes trailing success rate", () => {
		const dir = tempDir("porcupine-evidence-");
		recordSkillUse(dir, "skills/web/learned-http-timeouts", true);
		recordSkillUse(dir, "skills/web/learned-http-timeouts", true);
		recordSkillUse(dir, "skills/web/learned-http-timeouts", false);
		expect(trailingSuccessRate(dir, "skills/web/learned-http-timeouts")).toBeCloseTo(2 / 3);
	});

	it("flags a rollback when the success rate drops >= 20% below baseline", () => {
		const dir = tempDir("porcupine-evidence-rollback-");
		const skill = "skills/debug/learned-repro-fix";
		// Baseline at edit time: 10 successes (rate 1.0).
		for (let i = 0; i < 10; i++) recordSkillUse(dir, skill, true);
		const baseline = 1.0;
		// After the edit the skill regresses hard: 10/18 ~ 0.56 (drop 1.0 -> 0.56 >= 0.2).
		for (let i = 0; i < 8; i++) recordSkillUse(dir, skill, false);
		const check = checkRollback(dir, skill, baseline);
		expect(check.shouldRollback).toBe(true);
		expect(check.reasons.some((r) => r.includes("success rate dropped"))).toBe(true);
	});

	it("flags a rollback after consecutive failures even when the rate looks ok", () => {
		const dir = tempDir("porcupine-evidence-consec-");
		const skill = "skills/coding/learned-tdd";
		for (let i = 0; i < 10; i++) recordSkillUse(dir, skill, true);
		recordSkillUse(dir, skill, false);
		recordSkillUse(dir, skill, false);
		const check = checkRollback(dir, skill, 0.9);
		expect(check.shouldRollback).toBe(true);
		expect(check.reasons.some((r) => r.includes("consecutive failures"))).toBe(true);
	});
});

describe("learning store Phase B (autonomous + transparent)", () => {
	it("tags new proposals with origin/grade/risk and emits feed entries on activation", async () => {
		const dir = tempDir("porcupine-phase2-");
		const result = await processPostTurnLearning(
			dir,
			{
				userText: "Please remember that this repository uses pnpm workspaces.",
				tools: [{ name: "bash", isError: true }],
				sessionId: "s1",
			},
			{ enableCapabilityLearning: true },
		);

		const memory = result.records.find((r) => r.kind === "memory");
		expect(memory?.origin).toBe("porcupine-crafted");
		expect(memory?.verificationGrade).toBe("B");
		expect(memory?.riskTier).toBe("low");
		// Memory edits are snapshotted before activation (rollback capability).
		expect(memory?.snapshotRef).toBeTruthy();

		const skill = result.records.find((r) => r.kind === "skill");
		expect(skill?.origin).toBe("porcupine-crafted");
		expect(skill?.verificationGrade).toBe("C");
		expect(skill?.riskTier).toBe("low");

		const feed = listLearningFeed(dir, 10);
		expect(feed.length).toBeGreaterThanOrEqual(2);
		expect(feed.some((e) => e.action === "memory" && e.linesAdded !== undefined && e.linesAdded! > 0)).toBe(true);
		expect(feed.some((e) => e.action === "created" && e.file?.endsWith("SKILL.md"))).toBe(true);
	});

	it("snapshots and reverts an artifact", () => {
		const dir = tempDir("porcupine-snapshot-");
		const artifact = join(dir, "MEMORY.md");
		writeFileSync(artifact, "line one\nline two\n", "utf8");
		const snapshot = snapshotArtifact(dir, artifact, { reason: "test" });
		expect(existsSync(snapshot.id.length > 0 ? join(dir, "learning", "snapshots", `${snapshot.id}.json`) : "")).toBe(
			true,
		);
		writeFileSync(artifact, "mutated\n", "utf8");
		revertFromSnapshot(dir, snapshot.id);
		expect(readFileSync(artifact, "utf8")).toBe("line one\nline two\n");
	});

	it("auto-rolls back a regressed activated skill", async () => {
		const dir = tempDir("porcupine-auto-rollback-");
		const result = await processPostTurnLearning(
			dir,
			{
				userText: "Fix the build.",
				tools: [{ name: "bash", isError: true }],
				sessionId: "s2",
			},
			{ enableCapabilityLearning: true },
		);
		const skill = result.records.find((r) => r.kind === "skill");
		expect(skill?.status).toBe("activated");
		const skillFile = join(dir, "skills", skill!.stack!, skill!.id, "SKILL.md");
		expect(existsSync(skillFile)).toBe(true);

		// Give the activated skill a snapshot baseline on disk (as the refiner
		// would before an edit) so the rollback check has a reference point.
		const snapshot = snapshotArtifact(dir, skillFile, {
			baselineRate: 1.0,
			reason: "baseline before usage",
		});
		const proposalPath = join(dir, "learning", "proposals", `${skill!.id}.json`);
		const persisted = JSON.parse(readFileSync(proposalPath, "utf8"));
		persisted.snapshotRef = snapshot.id;
		writeFileSync(proposalPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

		// The skill then regresses hard in the evidence counter.
		for (let i = 0; i < 8; i++) recordSkillUse(dir, skill!.id, false);

		const rolledBack = checkAndRollbackRegressions(dir);
		expect(rolledBack.map((p) => p.id)).toContain(skill!.id);
		const feed = listLearningFeed(dir, 5);
		expect(feed.some((e) => e.action === "rolled-back" && e.proposalId === skill!.id)).toBe(true);
	});
});
