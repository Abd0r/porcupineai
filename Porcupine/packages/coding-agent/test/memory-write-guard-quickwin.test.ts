import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	markSnapshotContent,
	readSnapshot,
	revertFromSnapshot,
	snapshotArtifact,
} from "../src/porcupine/learning-store.ts";
import { readSnapshotBefore, wrapWriteWithSnapshot } from "../src/porcupine/memory-write-guard.ts";

function hashOf(value: string): string {
	return createHash("sha1").update(value).digest("hex");
}

describe("memory-write guard: autonomous user-pattern snapshot + rollback", () => {
	it("wraps an autonomous write and creates a restorable snapshot", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-guard-"));
		const userFile = join(agentDir, "USER.md");
		writeFileSync(userFile, "# USER\n\n- [preference:one] initial\n", "utf8");

		const snapshotId = wrapWriteWithSnapshot(
			agentDir,
			userFile,
			"# USER\n\n- [preference:one] initial\n- [preference:two] added\n",
		);

		expect(readFileSync(userFile, "utf8")).toContain("[preference:two] added");
		// A restorable snapshot exists capturing the pre-write content.
		const snapshot = readSnapshot(agentDir, snapshotId);
		expect(snapshot).toBeDefined();
		expect(snapshot!.artifactPath).toBe(userFile);
		expect(snapshot!.content).toContain("[preference:one] initial");
		expect(snapshot!.content).not.toContain("[preference:two]");

		// Reverting restores the pre-write content.
		revertFromSnapshot(agentDir, snapshotId);
		expect(readFileSync(userFile, "utf8")).toContain("[preference:one] initial");
		expect(readFileSync(userFile, "utf8")).not.toContain("[preference:two]");
	});

	it("rollback refuses to clobber a later independent edit", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-guard-clobber-"));
		const userFile = join(agentDir, "USER.md");
		writeFileSync(userFile, "# USER\n\n- [preference:one] v1\n", "utf8");

		// Simulate a wrapped autonomous write (snapshot before, mark post-edit hash).
		const snapshotId = wrapWriteWithSnapshot(agentDir, userFile, "# USER\n\n- [preference:one] v2\n");
		expect(readFileSync(userFile, "utf8")).toContain("v2");

		// A later independent edit changes the file hash.
		writeFileSync(userFile, "# USER\n\n- [preference:one] v3 independent\n", "utf8");

		expect(() => revertFromSnapshot(agentDir, snapshotId)).toThrow(/re-edited since snapshot/);
		// The independent edit is left intact.
		expect(readFileSync(userFile, "utf8")).toContain("v3 independent");
	});

	it("records a content hash equal to sha1 of the post-write content", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-guard-hash-"));
		const userFile = join(agentDir, "USER.md");
		writeFileSync(userFile, "# USER\n", "utf8");
		const written = "# USER\n\n- [context:key] fact\n";
		const snapshotId = wrapWriteWithSnapshot(agentDir, userFile, written);
		markSnapshotContent(agentDir, snapshotId, written);
		const snapshot = readSnapshot(agentDir, snapshotId);
		expect(snapshot!.expectedContentHash).toBe(hashOf(written));
	});

	it("reads the planned snapshot before a write", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "porcupine-memory-guard-before-"));
		const userFile = join(agentDir, "USER.md");
		writeFileSync(userFile, "# USER\n\n- [preference:one] before\n", "utf8");
		const artifacts = snapshotArtifact(agentDir, userFile, { reason: "probe" });
		expect(readSnapshotBefore(agentDir, artifacts.id)).toBe("# USER\n\n- [preference:one] before\n");
	});
});
