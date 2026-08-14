import { describe, expect, test, vi } from "vitest";

// The default prompt embeds the shipped doc paths (getReadmePath/getDocsPath/
// getExamplesPath), which resolve to the package install location and differ
// per machine. Pin them so the committed fixtures replay byte-exact anywhere.
vi.mock("../../src/config.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/config.ts")>();
	return {
		...actual,
		getReadmePath: () => "/fixed/readme.md",
		getDocsPath: () => "/fixed/docs",
		getExamplesPath: () => "/fixed/examples",
	};
});

import {
	buildCasePrompt,
	installClockLifecycle,
	SNAPSHOT_CASES,
	savedSnapshot,
	updateSnapshotsEnabled,
	writeSnapshot,
} from "./replay-prompt.ts";

describe("system prompt keyless snapshot gate", () => {
	installClockLifecycle();

	for (const { name } of SNAPSHOT_CASES) {
		test(`replays "${name}" exactly against its committed snapshot`, () => {
			const rebuilt = buildCasePrompt(name);
			// Record mode (UPDATE_SNAPSHOT=1) intentionally (re)writes the fixture
			// from the current output so `test:snapshot:record` refreshes the gate.
			if (updateSnapshotsEnabled()) {
				writeSnapshot(name, rebuilt);
			}
			expect(rebuilt).toBe(savedSnapshot(name));
			expect(rebuilt.length).toBeLessThan(8 * 1024);
		});
	}
});
