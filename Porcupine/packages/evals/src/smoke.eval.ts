import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createPorcupineCodingAgentHarness } from "./porcupine-harness.ts";

const porcupineCodingAgentHarness = createPorcupineCodingAgentHarness({ noTools: "all" });

const SMOKE_PROVIDER = process.env.PORCUPINE_PROVIDER ?? process.env.PI_PROVIDER;
const SMOKE_MODEL = process.env.PORCUPINE_MODEL ?? process.env.PI_MODEL;

describeEval("Porcupine Coding Agent smoke", { harness: porcupineCodingAgentHarness }, (it) => {
	it("runs a basic prompt end to end", async ({ run }) => {
		const result = await run("What's the capital of France? Respond with only the city name.");

		expect(result.output.trim()).toBe("Paris");
		expect(result.errors).toEqual([]);
		expect(result.usage.provider).toBe(SMOKE_PROVIDER);
		expect(result.usage.model).toBe(SMOKE_MODEL);
		expect(result.usage.totalTokens).toBeGreaterThan(0);
	});
});
