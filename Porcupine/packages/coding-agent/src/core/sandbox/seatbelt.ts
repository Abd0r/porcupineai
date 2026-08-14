/**
 * macOS Seatbelt (sandbox-exec) write-fence for per-command sandboxing.
 *
 * Lightweight native confinement: the child shell keeps default read / exec /
 * network access, but file WRITES are fenced to the workspace + temp directory
 * (or denied entirely in read-only mode). This is the OS-level "write fence"
 * under Auto Mode — no VM, no Docker, no process-wide isolation.
 *
 * Verified on macOS 26.5.2 (arm64): /usr/bin/sandbox-exec is present and the
 * profile below correctly denies writes outside the allowed subpaths while
 * leaving reads and execution untouched.
 */

import { spawn } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { waitForChildProcess } from "../../utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.ts";
import type { BashOperations } from "../tools/bash.ts";

export type SandboxWriteMode = "off" | "read-only" | "workspace-write";

function canonicalPath(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
}

/**
 * Build a Seatbelt (SBPL) profile that fences file writes. Ordered rules:
 * default-allow everything, then deny all writes, then re-allow the few
 * writable locations. Returns null when mode is "off" (no sandbox).
 *
 * Paths are canonicalized because /tmp is a symlink to /private/tmp on macOS
 * and SBPL `subpath` filters match canonical paths.
 */
export function buildSeatbeltProfile(
	mode: SandboxWriteMode,
	workspace: string,
	tmp: string,
	extraWritable: readonly string[] = [],
): string | null {
	if (mode === "off") return null;
	const lines: string[] = [
		"(version 1)",
		"(allow default)",
		"(deny file-write*)",
		// Shells/tools commonly touch these devices; keep them writable so the
		// fence does not break otherwise-innocuous commands.
		'(allow file-write* (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
	];
	if (mode === "workspace-write") {
		const allow = [workspace, tmp, ...extraWritable].map(canonicalPath);
		lines.push(`(allow file-write* ${allow.map((p) => `(subpath "${p}")`).join(" ")})`);
	}
	return lines.join("\n");
}

/**
 * Home directories that build/test/install tooling legitimately writes to
 * (package managers, caches, ssh, git). Allowed under workspace-write so the
 * fence denies arbitrary writes without breaking normal development.
 */
export function defaultWritableStateDirs(home: string = homedir()): string[] {
	return [
		join(home, ".npm"),
		join(home, ".cache"),
		join(home, ".config"),
		join(home, ".local"),
		join(home, ".ssh"),
		join(home, ".gitconfig"),
		join(home, ".git-credentials"),
		join(home, "Library", "Caches"),
		join(home, "Library", "Application Support"),
	];
}

export function isSeatbeltSupported(): boolean {
	return process.platform === "darwin";
}

/**
 * BashOperations that wrap the local shell in `sandbox-exec` with a write-fence
 * profile. Falls back to the ordinary local shell when sandboxing is off or the
 * host is not macOS.
 */
export function createSeatbeltBashOperations(options?: {
	mode?: SandboxWriteMode;
	workspace?: string;
	shellPath?: string;
}): BashOperations {
	const mode = options?.mode ?? "off";
	const profile = buildSeatbeltProfile(
		mode,
		options?.workspace ?? process.cwd(),
		tmpdir(),
		defaultWritableStateDirs(),
	);

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
			const sandboxed = profile !== null && isSeatbeltSupported();
			const child = sandboxed
				? spawn("sandbox-exec", ["-p", profile, shellConfig.shell, ...shellArgs], {
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
