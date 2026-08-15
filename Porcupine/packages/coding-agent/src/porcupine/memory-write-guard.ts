/**
 * Snapshot + content-hash rollback guard for autonomous memory writes.
 *
 * The skill refiner snapshots before every autonomous edit and records the
 * post-edit content hash so a rollback refuses to clobber a later independent
 * edit (see learning-store: snapshotArtifact / markSnapshotContent /
 * revertFromSnapshot). Autonomous user-pattern writes to USER.md go through
 * the node adapters' `writeUserFile`, which previously wrote without any
 * snapshot. This module routes those writes through the same protection.
 */

import { writeFileSync } from "node:fs";
import { markSnapshotContent, readSnapshot, snapshotArtifact } from "./learning-store.ts";

export type { ArtifactSnapshot } from "./learning-store.ts";
export { markSnapshotContent, readSnapshot, revertFromSnapshot, snapshotArtifact } from "./learning-store.ts";

/** Read the content captured before a write from a stored snapshot. */
export function readSnapshotBefore(agentDir: string, snapshotId: string): string | undefined {
	return readSnapshot(agentDir, snapshotId)?.content;
}

/**
 * Snapshot an artifact before an autonomous write, then persist the post-write
 * content so a rollback refuses to clobber a later independent edit.
 *
 * @returns the snapshot id captured before the write.
 */
export function wrapWriteWithSnapshot(
	agentDir: string,
	artifactPath: string,
	content: string,
	reason = "autonomous memory write",
): string {
	const snapshot = snapshotArtifact(agentDir, artifactPath, { reason });
	writeFileSync(artifactPath, content, "utf8");
	markSnapshotContent(agentDir, snapshot.id, content);
	return snapshot.id;
}

/**
 * Build a `writeUserFile` wrapper that snapshots an artifact before an
 * autonomous write and records the post-write content hash for rollback
 * safety. `resolvePath` maps the relative USER.md path to an absolute path
 * under the agent dir.
 */
export function createUserWriteGuard(
	agentDir: string,
	resolvePath: (relativePath: string) => string,
): {
	wrapUserWrite: (
		write: (path: string, content: string) => Promise<void>,
	) => (path: string, content: string) => Promise<void>;
} {
	return {
		wrapUserWrite(write) {
			return async (path, content) => {
				const absolute = resolvePath(path);
				const snapshot = snapshotArtifact(agentDir, absolute, {
					reason: "autonomous user-pattern write",
				});
				await write(path, content);
				markSnapshotContent(agentDir, snapshot.id, content);
			};
		},
	};
}
