#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { main } from "./main.ts";
import { setProductEnvironment } from "./product-environment.ts";

process.title = APP_NAME;
setProductEnvironment("CODING_AGENT", "true");
// Filter only the known-noisy runtime warning classes (experimental/deprecation)
// instead of silently swallowing ALL Node warnings. Everything else (app and
// third-party warnings, unhandled diagnostics) is forwarded unchanged, so real
// signals are not hidden.
{
	const realEmitWarning = process.emitWarning.bind(process);
	process.emitWarning = ((warning, ...args: Array<unknown>) => {
		// Classify the warning so we only silence the genuinely noisy
		// experimental/deprecation classes (see BUG-16). Accept all three overload
		// shapes: (warning, name, ctor), (warning, {type,...}), (warning, Error).
		let typeName = "";
		if (typeof args[0] === "string") typeName = args[0];
		else if (args[0] && typeof args[0] === "object") {
			const opts = args[0] as { type?: unknown; name?: unknown };
			typeName = String(opts.type ?? opts.name ?? "");
		} else if (warning instanceof Error) {
			typeName = warning.name ?? "";
		}
		if (typeName === "DeprecationWarning" || typeName === "ExperimentalWarning") return;
		(realEmitWarning as (...w: unknown[]) => void)(warning, ...args);
	}) as typeof process.emitWarning;
}

// Never die silently on an unhandled rejection; surface a clean message and a
// non-zero exit so pipeline consumers and CI see the failure.
process.on("unhandledRejection", (reason) => {
	const message = reason instanceof Error ? reason.message : String(reason);
	// Avoid an em-dash in user-facing text.
	console.error(`Error: Unhandled rejection: ${message}`);
	process.exitCode = 1;
});

// Configure undici's global dispatcher before provider SDKs issue requests.
// Runtime settings are applied once SettingsManager has loaded global/project settings.
configureHttpDispatcher();

main(process.argv.slice(2)).catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Error: ${message}`);
	process.exitCode = 1;
});
