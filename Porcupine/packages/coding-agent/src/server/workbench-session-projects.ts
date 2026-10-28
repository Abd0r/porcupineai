import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SessionManager } from "../core/session-manager.ts";
import { WorkbenchError } from "./workbench-context-files.ts";

const PROJECT_ENTRY = "porcupine.project";

/** Organization lives with the session, never in a competing project document. */
export function getSessionProject(manager: SessionManager): string | null {
	for (const entry of manager.getEntries().reverse()) {
		if (entry.type !== "custom" || entry.customType !== PROJECT_ENTRY) continue;
		return typeof entry.data === "string" ? entry.data : null;
	}
	return null;
}

export function setSessionProject(manager: SessionManager, path: string | null): void {
	manager.appendCustomEntry(PROJECT_ENTRY, path);
	manager.forceFlushToDisk();
}

/** Keep deleted history recoverable and redirect late writes away from discovery. */
export function moveSessionToTrash(manager: SessionManager): { trashPath: string } {
	const path = manager.forceFlushToDisk();
	if (!path) throw new WorkbenchError(409, "This session cannot be archived to disk");
	if (!lstatSync(path).isFile() || realpathSync(path) !== path)
		throw new WorkbenchError(403, "Refusing an aliased session file");
	const trash = join(dirname(path), ".trash");
	mkdirSync(trash, { recursive: true, mode: 0o700 });
	if (realpathSync(trash) !== trash) throw new WorkbenchError(403, "Refusing an aliased trash directory");
	const trashPath = join(trash, `${randomUUID()}-${basename(path)}`);
	renameSync(path, trashPath);
	manager.setSessionFile(trashPath);
	return { trashPath };
}
