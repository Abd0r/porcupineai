/**
 * Windows restricted-token write-fence for per-command sandboxing.
 *
 * A true per-command write-fence on Windows requires a native helper that
 * creates a restricted token (CreateRestrictedToken + CreateProcessAsUser) and
 * grants write access only to the listed directories via a WRITE_RESTRICTED
 * token + ACL entries. Node cannot do this without P/Invoke.
 *
 * This backend invokes an optional helper `porcupine-sandbox.exe` on PATH with
 * a documented contract (see native/windows/porcupine-sandbox.c). When the
 * helper is absent, it falls back to the native shell (never breaks).
 */

import { spawn } from "node:child_process";
import { constants } from "node:fs";
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

const HELPER = "porcupine-sandbox.exe";

/**
 * Build the helper argv prefix for a write-fence. Returns null for mode "off".
 * Contract: porcupine-sandbox.exe [--read-only] --workspace <dir> [--write <dir>]... -- <command> [args...]
 */
export function buildWindowsHelperArgs(
	mode: SandboxWriteMode,
	workspace: string,
	tmp: string,
	extraWritable: readonly string[] = defaultWritableStateDirs(),
): string[] | null {
	if (mode === "off") return null;
	if (mode === "read-only") return ["--read-only", "--workspace", workspace];
	const args: string[] = ["--workspace", workspace];
	for (const dir of [tmp, ...extraWritable]) {
		if (dir) args.push("--write", dir);
	}
	return args;
}

let helperChecked = false;
let helperAvailable = false;

/** Probe whether the restricted-token helper is present and runnable. */
export async function isWindowsHelperAvailable(): Promise<boolean> {
	if (helperChecked) return helperAvailable;
	helperChecked = true;
	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(HELPER, ["--probe"], { stdio: "ignore", windowsHide: true });
			child.on("error", reject);
			child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`helper exit ${code}`))));
		});
		helperAvailable = true;
	} catch {
		helperAvailable = false;
	}
	return helperAvailable;
}

/**
 * BashOperations that wrap the local shell in the restricted-token helper.
 * Falls back to the ordinary local shell when the helper is unavailable.
 */
export function createWindowsSandboxBashOperations(options?: {
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
			const prefix = buildWindowsHelperArgs(mode, workspace, tmp);
			const sandboxed = prefix !== null && (await isWindowsHelperAvailable());

			const child = sandboxed
				? spawn(HELPER, [...prefix, "--", shellConfig.shell, ...shellArgs], {
						cwd,
						windowsHide: true,
						env: env ?? getShellEnv(),
						stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
					})
				: spawn(shellConfig.shell, shellArgs, {
						cwd,
						windowsHide: true,
						env: env ?? getShellEnv(),
						stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
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
