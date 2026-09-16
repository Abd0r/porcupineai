/**
 * Porcupine Pet bridge.
 *
 * Gives the agent a desktop pet: a small AppKit app that walks the screen and reports live
 * session state in a pixel think box. This extension controls it, and can install and build
 * it on a machine that has never had it.
 *
 * User-facing commands:
 *   /pet            status
 *   /pet start      install and build if needed, then spawn it (default species: porcupine)
 *   /pet install    copy the sources and art into the agent dir and build the app
 *   /pet spawn      launch it (builds first if it is missing)
 *   /pet quit       stop it
 *   /pet say | rest | curl | freeze | unfreeze
 *
 * Tools: pet_status, pet_say, pet_rest, pet_curl, pet_freeze
 *
 * The pet talks to this extension through small files it polls, so there is no socket, no
 * daemon, and quitting the pet leaves nothing running.
 */

import type { ExtensionAPI } from "@porcupineai/coding-agent";
import { Type } from "typebox";
import { execFileSync, execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const INSTALL_DIR = join(homedir(), ".porcupine", "agent", "pet");
const APP = join(INSTALL_DIR, "Pet.app");
const BINARY = join(APP, "Contents", "MacOS", "Pet");

/** What the pet needs in order to build: sources plus art. */
const SOURCE_FILES = ["main.swift", "thinkbox.swift", "pet-status.py", "hedgehog.png"];
// Shipped layout: resources/pet/<species>/ holds each species' clips, and the macaw's
// flight frames sit alongside its clip folders.
const SOURCE_DIRS = ["resources"];

function installed(): boolean {
	return existsSync(BINARY);
}
function running(): boolean {
	try {
		execSync(`pgrep -f ${JSON.stringify(BINARY)} >/dev/null`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Where the shipped sources live. Tried in order: an explicit env override, a `packages/pet`
 * folder found by walking up from this file (works for a repo checkout and for the bundled
 * npm package), then the development location.
 */
function findSource(): string | null {
	const candidates: string[] = [];
	const env = process.env.PORCUPINE_PET_SRC;
	if (env) candidates.push(env);
	let dir = dirname(new URL(import.meta.url).pathname);
	for (let i = 0; i < 8; i++) {
		candidates.push(join(dir, "packages", "pet"));
		candidates.push(join(dir, "pet"));
		dir = dirname(dir);
	}
	candidates.push(join(homedir(), "wallpaper-lab", "pet"));
	for (const c of candidates) {
		try {
			if (existsSync(join(c, "main.swift")) && existsSync(join(c, "resources", "pet", "porcupine"))) return c;
		} catch {
			/* keep looking */
		}
	}
	return null;
}

function build(): string {
	const src = findSource();
	if (!src) {
		return "I cannot find the pet's sources. Set PORCUPINE_PET_SRC to the folder holding main.swift and porc/.";
	}
	mkdirSync(INSTALL_DIR, { recursive: true });
	for (const f of SOURCE_FILES) {
		const from = join(src, f);
		if (existsSync(from)) cpSync(from, join(INSTALL_DIR, f));
	}
	for (const d of SOURCE_DIRS) {
		const from = join(src, d);
		if (existsSync(from)) cpSync(from, join(INSTALL_DIR, d), { recursive: true });
	}
	if (!existsSync(join(INSTALL_DIR, "species.txt"))) writeFileSync(join(INSTALL_DIR, "species.txt"), "porcupine\n");

	const binDir = join(APP, "Contents", "MacOS");
	mkdirSync(binDir, { recursive: true });
	const tmp = process.env.TMPDIR ?? "/tmp";
	try {
		execFileSync("swiftc", [
			"-O",
			"-module-cache-path", join(homedir(), "wallpaper-lab", "mcache"),
			"-o", join(binDir, "Pet"),
			"main.swift", "thinkbox.swift",
		], { cwd: INSTALL_DIR, env: { ...process.env, TMPDIR: tmp }, stdio: "pipe", timeout: 300_000 });
	} catch (err) {
		const e = err as { stderr?: Buffer; message?: string };
		const detail = e.stderr ? e.stderr.toString().split("\n").slice(0, 4).join(" | ") : e.message;
		return `The build failed (is Xcode Command Line Tools installed?): ${detail}`;
	}
	// a minimal bundle so macOS treats it as an app rather than a bare executable
	const info = join(APP, "Contents", "Info.plist");
	if (!existsSync(info)) {
		writeFileSync(info, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Porcupine Pet</string>
  <key>CFBundleIdentifier</key><string>glass.porcupine.pet</string>
  <key>CFBundleExecutable</key><string>Pet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><false/>
</dict></plist>
`);
	}
	return `Built the pet in ${INSTALL_DIR}.`;
}

function spawn(): string {
	if (!installed()) {
		const built = build();
		if (!installed()) return built;
	}
	try {
		execSync(`open -g ${JSON.stringify(APP)}`);
		return "The pet is on screen. Default species is the porcupine (/pet species to check).";
	} catch (err) {
		return `Could not start the pet: ${(err as Error).message}`;
	}
}

// ---- the pet's control channels: files it polls four times a second ----
function signal(channel: string): boolean {
	if (!running()) return false;
	try {
		writeFileSync(join(INSTALL_DIR, channel), `${Date.now()}\n`);
		return true;
	} catch {
		return false;
	}
}

function species(): string {
	try {
		return readFileSync(join(INSTALL_DIR, "species.txt"), "utf8").trim() || "porcupine";
	} catch {
		return "porcupine";
	}
}

function summary(): string {
	if (!installed()) return `The pet is not installed yet (looked for ${BINARY}). /pet install will build it.`;
	const lines = [`installed: yes (${INSTALL_DIR})`, `running: ${running() ? "yes" : "no"}`, `species: ${species()}`];
	lines.push(`frozen: ${existsSync(join(INSTALL_DIR, "motion-freeze")) ? "yes" : "no"}`);
	try {
		const report = readFileSync(join(INSTALL_DIR, "pet-screen.txt"), "utf8").trim();
		if (report) lines.push(report);
	} catch {
		/* not launched yet */
	}
	return lines.join("\n");
}

export default function (porcupine: ExtensionAPI) {
	porcupine.registerTool({
		name: "pet_status",
		label: "Pet status",
		description: "Report whether the desktop pet is installed, running, which species, and what it knows about the screen.",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: summary() }], details: {} };
		},
	});

	porcupine.registerTool({
		name: "pet_say",
		label: "Pet say",
		description: "Make the desktop pet speak: it opens its pixel think box showing live session status. No-op if the pet is not running.",
		parameters: Type.Object({}),
		async execute() {
			if (!running()) return { content: [{ type: "text", text: "The pet is not running. /pet start will build and launch it." }], details: { spoke: false } };
			const ok = signal("speak-request");
			return { content: [{ type: "text", text: ok ? "The pet is speaking." : "Could not reach the pet." }], details: { spoke: ok } };
		},
	});

	porcupine.registerTool({
		name: "pet_rest",
		label: "Pet rest",
		description: "Send the pet to rest: the porcupine walks to a corner, curls into a ball and eats; the macaw perches on a plank it materialises.",
		parameters: Type.Object({}),
		async execute() {
			if (!running()) return { content: [{ type: "text", text: "The pet is not running." }], details: { rested: false } };
			const ok = signal("rest-request");
			return { content: [{ type: "text", text: ok ? "The pet is heading off to rest." : "Could not reach the pet." }], details: { rested: ok } };
		},
	});

	porcupine.registerTool({
		name: "pet_curl",
		label: "Pet curl",
		description: "Startle the pet: the porcupine curls up, the macaw ruffles. Useful when something the agent did failed or was blocked.",
		parameters: Type.Object({}),
		async execute() {
			if (!running()) return { content: [{ type: "text", text: "The pet is not running." }], details: { curled: false } };
			const ok = signal("curl-request");
			return { content: [{ type: "text", text: ok ? "The pet is startled." : "Could not reach the pet." }], details: { curled: ok } };
		},
	});

	porcupine.registerTool({
		name: "pet_freeze",
		label: "Pet freeze",
		description: "Park the pet where it is, or let it roam again. Useful before screenshots or when it is in the way.",
		parameters: Type.Object({ frozen: Type.Boolean({ description: "true parks the pet, false lets it move again" }) }),
		async execute(_id, params) {
			if (!installed()) return { content: [{ type: "text", text: "The pet is not installed." }], details: { frozen: params.frozen } };
			if (params.frozen) signal("motion-freeze");
			else rmSync(join(INSTALL_DIR, "motion-freeze"), { force: true });
			return { content: [{ type: "text", text: `The pet is now ${params.frozen ? "parked" : "roaming"}.` }], details: { frozen: params.frozen } };
		},
	});

	porcupine.registerCommand("pet", {
		description: "Desktop pet: /pet [status|start|install|spawn|quit|say|rest|curl|freeze|unfreeze]",
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase() || "status";
			switch (sub) {
				case "status":
					ctx.ui.notify(summary().replace(/\n/g, "  |  "), "info");
					return;
				case "start": {
					if (!installed()) ctx.ui.notify(build(), "info");
					ctx.ui.notify(spawn(), "info");
					return;
				}
				case "install":
					ctx.ui.notify(build(), "info");
					return;
				case "spawn":
					ctx.ui.notify(spawn(), "info");
					return;
				case "quit": {
					try {
						execSync(`pkill -f ${JSON.stringify(BINARY)}`);
						ctx.ui.notify("The pet is stopped.", "info");
					} catch {
						ctx.ui.notify("The pet was not running.", "info");
					}
					return;
				}
				case "say":
					if (!signal("speak-request")) { ctx.ui.notify("The pet is not running. /pet start will launch it.", "warning"); return; }
					ctx.ui.notify("The pet is speaking.", "info");
					return;
				case "rest":
					if (!signal("rest-request")) { ctx.ui.notify("The pet is not running.", "warning"); return; }
					ctx.ui.notify("The pet is going to rest.", "info");
					return;
				case "curl":
					if (!signal("curl-request")) { ctx.ui.notify("The pet is not running.", "warning"); return; }
					ctx.ui.notify("The pet is startled.", "info");
					return;
				case "freeze":
					signal("motion-freeze");
					ctx.ui.notify("The pet is parked.", "info");
					return;
				case "unfreeze":
					rmSync(join(INSTALL_DIR, "motion-freeze"), { force: true });
					ctx.ui.notify("The pet is moving again.", "info");
					return;
				default:
					ctx.ui.notify(`Unknown subcommand: ${sub}. Try status, start, install, spawn, quit, say, rest, curl, freeze, unfreeze.`, "warning");
			}
		},
	});
}
