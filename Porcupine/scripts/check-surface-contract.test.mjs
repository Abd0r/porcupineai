import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BUILTIN_SLASH_COMMANDS } from "../packages/coding-agent/src/core/slash-commands.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = "scripts/check-surface-contract.mjs";
const tui = "packages/coding-agent/src/modes/interactive/interactive-mode.ts";
const contract = "packages/coding-agent/src/core/surface-contract.ts";
const catalog = "packages/coding-agent/src/core/slash-commands.ts";
const doc = "packages/coding-agent/docs/gui-parity.md";

function fixture(action) {
	const directory = mkdtempSync(join(tmpdir(), "porcupine-surface-contract-"));
	try {
		writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
		for (const path of [script, tui, contract, doc]) {
			mkdirSync(dirname(join(directory, path)), { recursive: true });
			copyFileSync(join(root, path), join(directory, path));
		}
		const audit = join(directory, script);
		writeFileSync(audit, readFileSync(audit, "utf8").replace('from "typescript"', `from ${JSON.stringify(import.meta.resolve("typescript"))}`));
		writeFileSync(join(directory, catalog), `export const BUILTIN_SLASH_COMMANDS = ${JSON.stringify(BUILTIN_SLASH_COMMANDS)};`);
		action(directory);
	} finally { rmSync(directory, { recursive: true, force: true }); }
}

function check(directory) {
	return spawnSync(process.execPath, [join(directory, script), "--check"], { encoding: "utf8", cwd: directory });
}

test("surface audit accepts the actual catalog, dispatch and generated matrix", () => {
	const result = check(root);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /parity not complete/);
});

test("strict parity gate rejects the actual unfinished capability set", () => {
	const result = spawnSync(process.execPath, [join(root, script), "--check", "--require-parity"], { encoding: "utf8", cwd: root });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Full TUI\/GUI parity is not complete/);
});

test("surface audit rejects a new catalog command without a GUI requirement", () => {
	fixture((directory) => {
		writeFileSync(join(directory, catalog), `export const BUILTIN_SLASH_COMMANDS = ${JSON.stringify([...BUILTIN_SLASH_COMMANDS, { name: "unclassified-command", description: "New feature" }])};`);
		const result = check(directory);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /unclassified-command needs exactly one surface requirement/);
	});
});

test("surface audit catches a hidden TUI dispatch addition and stale generated documentation", () => {
	fixture((directory) => {
		const path = join(directory, tui);
		writeFileSync(path, readFileSync(path, "utf8").replace('text = text.trim();', 'if (text === "/hidden-new-feature") return; text = text.trim();'));
		const result = check(directory);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /hidden-new-feature needs exactly one surface requirement/);
	});
	fixture((directory) => {
		const path = join(directory, doc);
		writeFileSync(path, readFileSync(path, "utf8").replace("<!-- surface-contract:start -->", "<!-- surface-contract:start -->\n\nUnexpected documentation drift."));
		const result = check(directory);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Surface parity documentation is stale/);
	});
});
