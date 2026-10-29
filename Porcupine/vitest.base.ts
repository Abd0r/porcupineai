import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const workspaceSourcePaths = {
	aiIndex: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url)),
	aiCompat: fileURLToPath(new URL("./packages/ai/src/compat.ts", import.meta.url)),
	aiOAuth: fileURLToPath(new URL("./packages/ai/src/oauth.ts", import.meta.url)),
	aiProviders: fileURLToPath(new URL("./packages/ai/src/providers", import.meta.url)),
	agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
	codingAgentIndex: fileURLToPath(new URL("./packages/coding-agent/src/index.ts", import.meta.url)),
	tuiIndex: fileURLToPath(new URL("./packages/tui/src/index.ts", import.meta.url)),
} as const;

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@porcupineai\/ai$/, replacement: workspaceSourcePaths.aiIndex },
			{ find: /^@porcupineai\/ai\/compat$/, replacement: workspaceSourcePaths.aiCompat },
			{ find: /^@porcupineai\/ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
			{
				find: /^@porcupineai\/ai\/providers\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
			},
			{ find: /^@porcupineai\/agent-core$/, replacement: workspaceSourcePaths.agentIndex },
			{
				find: /^@porcupineai\/agent-core\/node$/,
				replacement: fileURLToPath(new URL("./packages/agent/src/node.ts", import.meta.url)),
			},
			{ find: /^@porcupineai\/tui$/, replacement: workspaceSourcePaths.tuiIndex },
			{ find: /^@earendil-works\/porcupine-ai$/, replacement: workspaceSourcePaths.aiIndex },
			{ find: /^@earendil-works\/porcupine-ai\/compat$/, replacement: workspaceSourcePaths.aiCompat },
			{ find: /^@earendil-works\/porcupine-ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
			{
				find: /^@earendil-works\/porcupine-ai\/providers\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
			},
			{ find: /^@earendil-works\/porcupine-agent-core$/, replacement: workspaceSourcePaths.agentIndex },
			{ find: /^@earendil-works\/porcupine-tui$/, replacement: workspaceSourcePaths.tuiIndex },
		],
	},
});
