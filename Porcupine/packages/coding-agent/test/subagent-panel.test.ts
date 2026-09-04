import { describe, expect, it } from "vitest";
import type { SubagentRunInfo } from "../src/core/agent-session.ts";
import { formatLiveSubagentList } from "../src/modes/interactive/components/subagent-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function run(overrides: Partial<SubagentRunInfo> & { id: string }): SubagentRunInfo {
	return { name: "buck", task: "research", status: "running", steps: 0, ...overrides };
}

describe("formatLiveSubagentList", () => {
	it("returns undefined when nothing is live", () => {
		expect(formatLiveSubagentList([], 3)).toBeUndefined();
	});

	it("lists how many agents work with their tags", () => {
		initTheme("dark");
		const text = stripAnsi(
			formatLiveSubagentList(
				[
					run({ id: "sa-1", name: "buck", task: "Research harness", steps: 12, lastTool: "bash" }),
					run({ id: "sa-2", name: "tinker", task: "Write docs", steps: 4, status: "done" }),
				]!,
				3,
			)!,
		);
		expect(text).toContain("Live (1/3):");
		expect(text).toContain("@buck");
		expect(text).toContain("step 12 · bash");
		expect(text).toContain("Research harness");
		expect(text).toContain("@tinker");
		expect(text).toContain("done");
	});
});
