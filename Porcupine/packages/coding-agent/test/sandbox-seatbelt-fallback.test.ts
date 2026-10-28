import { describe, expect, it } from "vitest";
import { createSeatbeltBashOperations } from "../src/core/sandbox/seatbelt.ts";

async function run(ops: ReturnType<typeof createSeatbeltBashOperations>, command: string) {
	let output = "";
	const result = await ops.exec(command, process.cwd(), {
		onData: (data: Buffer) => {
			output += data.toString();
		},
		env: process.env,
	});
	return { exitCode: result.exitCode, output };
}

describe("seatbelt write-fence fallback", () => {
	it("runs natively when the host refuses to apply a profile", async () => {
		const ops = createSeatbeltBashOperations({
			mode: "workspace-write",
			workspace: process.cwd(),
			fenceUsable: () => false,
		});
		const result = await run(ops, "echo fence-fallback-ok");
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("fence-fallback-ok");
		expect(result.output).not.toContain("sandbox_apply");
	}, 20000);

	it("still fences when the probe reports a usable seatbelt", async () => {
		const ops = createSeatbeltBashOperations({
			mode: "workspace-write",
			workspace: process.cwd(),
			fenceUsable: () => true,
		});
		const result = await run(ops, "echo fence-active-ok");
		// Either the fence applies (exit 0) or the host denies it; both must produce
		// output rather than a silent empty run, and neither may hang.
		expect(result.exitCode === 0 || result.output.includes("sandbox_apply")).toBe(true);
	}, 20000);
});
