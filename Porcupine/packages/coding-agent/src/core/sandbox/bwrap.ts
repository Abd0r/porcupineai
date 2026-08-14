/**
 * Linux bwrap (bubblewrap) write-fence for per-command sandboxing.
 *
 * Lightweight native confinement: the child shell sees a read-only root (`/`
 * ro-bound), with only the workspace, temp, and standard home state/cache dirs
 * remounted writable (workspace-write) — or nothing writable (read-only). Reads,
 * execution, and network stay intact. This is the Linux counterpart to the
 * macOS Seatbelt fence.
 *
 * Requires the `bwrap` binary (package `bubblewrap` on most distros). When
 * bwrap is missing, callers fall back to the native shell (never breaks).
 */

import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { tmpdir } from "node:os";
import { waitForChildProcess } from "../../utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.ts";
import type { BashOperations } from "../tools/bash.ts";
import { defaultWritableStateDirs, type SandboxWriteMode } from "./seatbelt.ts";

/**
 * Build the `bwrap` argv prefix for a write-fence. Returns null for mode "off".
 * Order matters: `--ro-bind / /` first, then writable `--bind` mounts override
 * their subtrees.
 */
export function buildBwrapArgs(
	mode: SandboxWriteMode,
	workspace: string,
	tmp: string,
	extraWritable: readonly string[] = defaultWritableStateDirs(),
): string[] | null {
	if (mode === "off") return null;
	const args: string[] = ["--ro-bind", "/", "/"];
	if (mode === "workspace-write") {
		for (const dir of [workspace, tmp, ...extraWritable]) {
			// Only bind dirs that exist; bwrap errors on missing sources.
			if (dir && existsSync(dir)) {
				args.push("--bind", dir, dir);
			}
		}
	}
	args.push("--dev", "/dev", "--proc", "/proc", "--die-with-parent");
	return args;
}

let bwrapChecked = false;
let bwrapAvailable = false;

/** Probe whether the `bwrap` binary is present and runnable. */
export async function isBwrapAvailable(): Promise<boolean> {
	if (bwrapChecked) return bwrapAvailable;
	bwrapChecked = true;
	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn("bwrap", ["--version"], { stdio: "ignore" });
			child.on("error", reject);
			child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`bwrap exit ${code}`))));
		});
		bwrapAvailable = true;
	} catch {
		bwrapAvailable = false;
	}
	return bwrapAvailable;
}

/**
 * BashOperations that wrap the local shell in `bwrap` with a write-fence.
 * Falls back to the ordinary local shell when bwrap is unavailable.
 */
export function createBwrapBashOperations(options?: {
	mode?: SandboxWriteMode;
	workspace?: string;
	shellPath?: string;
}): BashOperations {
	const mode = options?.mode ?? "off";
	const workspace = options?.workspace ?? process.cwd();
	const tmp = tmpdir();

	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			const timeoutMs = timeout && timeout > 0 ? timeout * 1000 : undefined;
			if (signal?.aborted) throw new Error("aborted");

			const shellConfig = getShellConfig(options?.shellPath);
			try {
				await fsAccess(cwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}

			const commandFromStdin = shellConfig.commandTransport === "stdin";
			const shellArgs = commandFromStdin ? shellConfig.args : [...shellConfig.args, command];
			const prefix = buildBwrapArgs(mode, workspace, tmp);
			const sandboxed = prefix !== null && (await isBwrapAvailable());

			const child = sandboxed
				? spawn("bwrap", [...prefix, shellConfig.shell, ...shellArgs], {
						cwd,
						detached: process.platform !== "win32",
						env: env ?? getShellEnv(),
						stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
						windowsHide: true,
					})
				: spawn(shellConfig.shell, shellArgs, {
						cwd,
						detached: process.platform !== "win32",
						env: env ?? getShellEnv(),
						stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
						windowsHide: true,
					});

			if (commandFromStdin) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(command);
			}
			if (child.pid) trackDetachedChildPid(child.pid);

			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			try {
				if (timeoutMs !== undefined) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeoutMs);
				}
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				const exitCode = await waitForChildProcess(child);
				if (timedOut) throw new Error(`timeout:${timeout}`);
				if (signal?.aborted) throw new Error("aborted");
				return { exitCode };
			} finally {
				if (child.pid) untrackDetachedChildPid(child.pid);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}
