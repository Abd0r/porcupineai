/**
 * Native per-command sandbox: an OS-level write-fence for shell execution.
 *
 * Unlike Gondolin (micro-VM) or Docker (whole-process container), this is a
 * lightweight, native-first confinement: the child process keeps read/exec
 * access but its file writes are fenced by the operating system.
 *
 * - macOS   -> Seatbelt via `sandbox-exec` (implemented + verified).
 * - Linux   -> bwrap / bubblewrap (implemented; requires the `bwrap` binary).
 * - Windows -> restricted token via an optional `porcupine-sandbox.exe` helper.
 *
 * Unsupported platforms, or hosts missing the required binary, fall back to the
 * ordinary local shell (never breaks execution), with a one-time warning.
 */

import type { BashOperations } from "../tools/bash.ts";
import { createLocalBashOperations } from "../tools/bash.ts";
import { createBwrapBashOperations } from "./bwrap.ts";
import { createSeatbeltBashOperations, type SandboxWriteMode } from "./seatbelt.ts";
import { createWindowsSandboxBashOperations } from "./windows.ts";

export type { SandboxWriteMode };
export { buildBwrapArgs, isBwrapAvailable } from "./bwrap.ts";
export { buildSeatbeltProfile, defaultWritableStateDirs, isSeatbeltSupported } from "./seatbelt.ts";
export { buildWindowsHelperArgs, isWindowsHelperAvailable } from "./windows.ts";

let warnOnce = false;

/**
 * Bash operations with an optional native write-fence, dispatched by platform.
 *
 * @param mode "off" (default) | "read-only" (deny all writes) | "workspace-write" (writes only in workspace + temp + home state dirs)
 * @param workspace directory the fence treats as writable (default: process.cwd())
 */
export function createSandboxedBashOperations(options?: {
	mode?: SandboxWriteMode;
	workspace?: string;
	shellPath?: string;
}): BashOperations {
	const mode = options?.mode ?? "off";
	if (mode === "off") {
		return createLocalBashOperations({ shellPath: options?.shellPath });
	}
	if (process.platform === "darwin") {
		return createSeatbeltBashOperations(options);
	}
	if (process.platform === "linux") {
		return createBwrapBashOperations(options);
	}
	if (process.platform === "win32") {
		return createWindowsSandboxBashOperations(options);
	}
	if (!warnOnce) {
		warnOnce = true;
		console.warn(
			"[porcupine] native per-command sandbox is not yet supported on this platform; using unsandboxed local shell.",
		);
	}
	return createLocalBashOperations({ shellPath: options?.shellPath });
}
