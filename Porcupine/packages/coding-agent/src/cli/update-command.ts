/**
 * CLI subcommands: `porcupine update [--yes]` and `porcupine sync [--force]`.
 * Handled before arg parsing (like `config` / credential commands).
 */

import chalk from "chalk";
import { APP_NAME, VERSION } from "../config.ts";
import { execCommand } from "../core/exec.ts";
import { syncStockAgentFiles } from "../porcupine/stock-sync.ts";
import { checkForNewPorcupineVersion, getInstalledPackageName } from "../utils/version-check.ts";

/** `porcupine update [--yes]` — check npm/GitHub for a newer release and optionally install it. */
export async function runUpdateCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "update") return false;
	const yes = args.includes("--yes");

	console.log(`${APP_NAME} v${VERSION} — checking for updates…`);
	const latest = await checkForNewPorcupineVersion(VERSION, { cacheTtlMs: 0 });
	if (!latest) {
		console.log(chalk.green(`Up to date — ${APP_NAME} v${VERSION}.`));
		return true;
	}

	const pkg = latest.packageName ?? getInstalledPackageName() ?? "@porcupineai/coding-agent";
	console.log(`Current: ${VERSION}`);
	console.log(`Latest:  ${chalk.yellow(latest.version)}`);
	if (latest.note) {
		console.log(`Notes:   ${latest.note.slice(0, 300)}`);
	}

	if (!yes) {
		console.log(
			`\nRun \`${APP_NAME} update --yes\` to install: npm install -g --ignore-scripts ${pkg}@${latest.version}`,
		);
		return true;
	}

	console.log(`\nInstalling ${pkg}@${latest.version} …`);
	const result = await execCommand(
		"npm",
		["install", "-g", "--ignore-scripts", `${pkg}@${latest.version}`],
		process.cwd(),
	);
	if (result.stdout) console.log(result.stdout);
	if (result.code !== 0) {
		console.error(chalk.red(result.stderr || "npm install failed."));
		process.exitCode = 1;
		return true;
	}
	console.log(chalk.green(`Updated to ${latest.version}. Restart ${APP_NAME} to load it.`));
	return true;
}

/** `porcupine sync [--force]` — sync the shipped agent-home files into ~/.porcupine/agent without clobbering edits. */
export async function runSyncCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "sync") return false;
	const force = args.includes("--force");

	const report = syncStockAgentFiles({ force });
	const lines: string[] = [];
	if (report.added.length > 0) lines.push(`Added:   ${report.added.join(", ")}`);
	if (report.updated.length > 0) lines.push(`Updated: ${report.updated.join(", ")}`);
	if (report.forced.length > 0) lines.push(`Forced:  ${report.forced.join(", ")}`);
	if (report.skipped.length > 0) {
		lines.push(`Skipped (edited by you — use --force to overwrite): ${report.skipped.join(", ")}`);
	}
	if (lines.length === 0) {
		console.log("All stock files are in sync.");
	} else {
		console.log(lines.join("\n"));
	}
	return true;
}
