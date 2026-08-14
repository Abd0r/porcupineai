import { describe, expect, test } from "vitest";
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
