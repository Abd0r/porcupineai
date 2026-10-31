import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { BUILTIN_SLASH_COMMANDS } from "../packages/coding-agent/src/core/slash-commands.ts";
import { COMMAND_SURFACE_REQUIREMENTS, getSurfaceParityReport } from "../packages/coding-agent/src/core/surface-contract.ts";

const doc = new URL("../packages/coding-agent/docs/gui-parity.md", import.meta.url);
const tuiPath = new URL("../packages/coding-agent/src/modes/interactive/interactive-mode.ts", import.meta.url);
const source = ts.createSourceFile(tuiPath.pathname, readFileSync(tuiPath, "utf8"), ts.ScriptTarget.Latest, true);
const required = new Set([...BUILTIN_SLASH_COMMANDS.map((command) => command.name), "commands", "help", "parity"]);
let foundDispatch = false;
function visit(node) {
	if (ts.isMethodDeclaration(node) && node.name.getText(source) === "setupEditorSubmitHandler") {
		foundDispatch = true;
		const inspect = (child) => {
			let value;
			if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && child.left.getText(source) === "text" && ts.isStringLiteral(child.right)) value = child.right.text;
			if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.expression.getText(source) === "text" && child.expression.name.text === "startsWith" && child.arguments[0] && ts.isStringLiteral(child.arguments[0])) value = child.arguments[0].text;
			const match = /^\/([a-z][a-z0-9-]*)/.exec(value || "");
			if (match) required.add(match[1]);
			ts.forEachChild(child, inspect);
		};
		ts.forEachChild(node, inspect);
		return;
	}
	ts.forEachChild(node, visit);
}
visit(source);
const errors = [];
if (!foundDispatch) errors.push("TUI dispatch moved: update the contract audit instead of silently skipping it.");
for (const name of required) {
	if (COMMAND_SURFACE_REQUIREMENTS.filter((rule) => rule.name === name).length !== 1) errors.push(`/${name} needs exactly one surface requirement.`);
}
for (const rule of COMMAND_SURFACE_REQUIREMENTS) {
	if (!required.has(rule.name)) errors.push(`Stale command requirement: /${rule.name}.`);
	if (rule.acceptance.trim().length < 20) errors.push(`Missing acceptance criteria: /${rule.name}.`);
	if (rule.parity !== "implemented" && !rule.gap) errors.push(`Missing gap description: /${rule.name}.`);
}
if (errors.length) throw new Error(errors.join("\n"));

const report = getSurfaceParityReport();
if (process.argv.includes("--require-parity") && !report.ready)
	throw new Error(`Full TUI/GUI parity is not complete. Unfinished requirements: ${report.gaps.map((gap) => gap.id).join(", ")}`);
const cell = (value) => String(value || "").replaceAll("|", "\\|").replaceAll("\n", " ");
const matrix = [
	`Contract v${report.version}: **${report.commands.length} commands**, **${report.runtime.length} runtime requirements**. Full implementation parity: **${report.ready ? "complete" : "not complete"}**.`,
	"",
	"| Command | GUI status | Delivery | Acceptance criteria | Remaining work |",
	"| --- | --- | --- | --- | --- |",
	...report.commands.map((rule) => `| /${rule.name} | ${rule.parity} | ${rule.implementation} | ${cell(rule.acceptance)} | ${cell(rule.gap)} |`),
	"",
	"| Runtime capability | GUI status | Acceptance criteria | Remaining work |",
	"| --- | --- | --- | --- |",
	...report.runtime.map((rule) => `| ${rule.id} | ${rule.parity} | ${cell(rule.acceptance)} | ${cell(rule.gap)} |`),
].join("\n");
const opening = "<!-- surface-contract:start -->";
const closing = "<!-- surface-contract:end -->";
const document = readFileSync(doc, "utf8");
const start = document.indexOf(opening), end = document.indexOf(closing);
if (start < 0 || end <= start) throw new Error("Missing surface contract documentation markers.");
const expected = document.slice(0, start + opening.length) + `\n\n${matrix}\n\n` + document.slice(end);
if (process.argv.includes("--write")) writeFileSync(doc, expected);
else if (process.argv.includes("--check")) {
	if (expected !== document) throw new Error("Surface parity documentation is stale. Run node scripts/check-surface-contract.mjs --write.");
	console.log(`Surface contract covers ${required.size} commands and ${report.runtime.length} runtime requirements; parity ${report.ready ? "implemented" : "not complete"}.`);
} else if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else console.log(matrix);
