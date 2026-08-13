#!/usr/bin/env node
import { registerBunOAuthFlows } from "@porcupineai/ai/bun-oauth";
import { APP_NAME } from "../config.ts";

process.title = APP_NAME;
// Filter only the known-noisy runtime warning classes; forward everything else.
{
	const realEmitWarning = process.emitWarning.bind(process);
	process.emitWarning = ((warning, ...args: Array<unknown>) => {
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

registerBunOAuthFlows();

import { restoreSandboxEnv } from "./restore-sandbox-env.ts";

restoreSandboxEnv();

await import("./register-bedrock.ts");
await import("../cli.ts");
