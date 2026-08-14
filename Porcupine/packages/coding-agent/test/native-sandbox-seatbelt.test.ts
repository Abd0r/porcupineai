import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildSeatbeltProfile, createSandboxedBashOperations, isSeatbeltSupported } from "../src/core/sandbox/index.ts";

const hasSandboxExec = (() => {
	try {
		execFileSync("sandbox-exec", ["-p", "(version 1)\n(allow default)", "/bin/sh", "-c", "true"], {
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
})();

const scratch: string[] = [];

function makeScratch(prefix: string): string {
	const dir = mkdtempSync(join("/private/tmp", prefix));
	scratch.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of scratch) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
});

describe("seatbelt write-fence profile", () => {
	it("builds an ordered default-allow profile with a write fence", () => {
		const profile = buildSeatbeltProfile("workspace-write", "/ws", "/tmp")!;
		expect(profile).toContain("(allow default)");
		expect(profile).toContain("(deny file-write*)");
		expect(profile).toContain("(allow file-write*");
	});

	it("canonicalizes /tmp symlinks (/tmp -> /private/tmp)", () => {
		const dir = makeScratch("ws-link-");
		const profile = buildSeatbeltProfile("workspace-write", dir, "/tmp")!;
		expect(profile).toContain(realpathSync(dir));
	});

	it("returns null for mode off", () => {
		expect(buildSeatbeltProfile("off", "/ws", "/tmp")).toBeNull();
	});

	it("read-only mode has no workspace subpath allowance", () => {
		const profile = buildSeatbeltProfile("read-only", "/ws", "/tmp")!;
		expect(profile).not.toContain("subpath");
	});
});

describe("seatbelt write-fence execution", () => {
	it.skipIf(!isSeatbeltSupported() || !hasSandboxExec)(
		"allows writes inside the workspace and denies writes outside it",
		async () => {
			const workspace = makeScratch("porcupine-ws-");
			const outside = makeScratch("porcupine-out-");
			const ops = createSandboxedBashOperations({ mode: "workspace-write", workspace });

			let out = "";
			const allowed = await ops.exec(`echo ok > "${workspace}/a.txt" && cat "${workspace}/a.txt"`, workspace, {
				onData: (b) => {
					out += b.toString();
				},
			});
			expect(allowed.exitCode).toBe(0);
			expect(out).toContain("ok");
			expect(existsSync(join(workspace, "a.txt"))).toBe(true);

			const denied = await ops.exec(`echo nope > "${outside}/b.txt"`, workspace, {
				onData: (b) => {
					out += b.toString();
				},
			});
			expect(denied.exitCode).not.toBe(0);
			expect(existsSync(join(outside, "b.txt"))).toBe(false);
		},
	);

	it.skipIf(!isSeatbeltSupported() || !hasSandboxExec)(
		"read-only mode denies writes even inside the workspace",
		async () => {
			const workspace = makeScratch("porcupine-ro-");
			const ops = createSandboxedBashOperations({ mode: "read-only", workspace });

			const denied = await ops.exec(`echo nope > "${workspace}/c.txt"`, workspace, {
				onData: () => {},
			});
			expect(denied.exitCode).not.toBe(0);
			expect(existsSync(join(workspace, "c.txt"))).toBe(false);
		},
	);
});

describe("platform fallback", () => {
	it("mode off returns local operations without warning", () => {
		const ops = createSandboxedBashOperations({ mode: "off" });
		expect(typeof ops.exec).toBe("function");
	});

	it("tmpdir is used for the temp allowance", () => {
		const profile = buildSeatbeltProfile("workspace-write", "/ws", tmpdir())!;
		expect(profile).toContain("/var/folders");
	});
});
