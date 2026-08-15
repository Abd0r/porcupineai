import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedMcpServer } from "../src/core/mcp/types.ts";

let lastAutoUserPrompt: string | undefined;

vi.mock("../src/porcupine/llm-classify.ts", () => ({
	classifyWithSessionModel: async (options: { user: string }) => {
		lastAutoUserPrompt = options.user;
		return "APPROVE";
	},
}));

import { createMcpToolGuard, FileMcpApprovalStore, type McpApprovalStore } from "../src/core/mcp/security.ts";

function hashOf(value: string): string {
	return createHash("sha1").update(value).digest("hex");
}

function tempStorePath(): string {
	const dir = mkdtempSync(join(tmpdir(), "porcupine-mcp-approvals-"));
	return join(dir, "mcp-approvals.json");
}

function server(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
	return {
		serverKey: "filesystem",
		scope: "global",
		baseDir: "/tmp",
		type: "stdio",
		url: "",
		command: "npx",
		args: ["server.js"],
		env: {},
		headers: {},
		cwd: "/tmp",
		enabled: true,
		allow: new Set<string>(),
		timeoutMs: 60000,
		contentHash: hashOf("cfg"),
		...overrides,
	};
}

const ctx = (
	s: ResolvedMcpServer,
	name: string,
	mode: "ask" | "normal" | "auto",
	args: Record<string, unknown> = {},
) => ({
	mode,
	server: s,
	mcpToolName: name,
	agentToolName: `${s.serverKey}_${name}`,
	arguments: args,
});

beforeEach(() => {
	lastAutoUserPrompt = undefined;
});

describe("FileMcpApprovalStore: durable MCP approvals", () => {
	let file: string;

	beforeEach(() => {
		file = tempStorePath();
	});

	it("persists an approval across a store reload (same file)", () => {
		const storeA: McpApprovalStore = new FileMcpApprovalStore(file);
		storeA.approve("filesystem", hashOf("server-config-a"));

		const storeB: McpApprovalStore = new FileMcpApprovalStore(file);
		expect(storeB.getApprovedHash("filesystem")).toBe(hashOf("server-config-a"));
	});

	it("returns undefined for an unapproved or unknown server", () => {
		const store: McpApprovalStore = new FileMcpApprovalStore(file);
		expect(store.getApprovedHash("unknown")).toBeUndefined();
	});

	it("does not leak an approval across a different content hash (rug-pull survives restart)", () => {
		const storeA: McpApprovalStore = new FileMcpApprovalStore(file);
		storeA.approve("filesystem", hashOf("server-config-a"));

		const storeB: McpApprovalStore = new FileMcpApprovalStore(file);
		const stored = storeB.getApprovedHash("filesystem");
		expect(stored).toBe(hashOf("server-config-a"));
		expect(stored).not.toBe(hashOf("server-config-evil"));
	});

	it("overwrites an approval when a new hash is approved", () => {
		const store: McpApprovalStore = new FileMcpApprovalStore(file);
		store.approve("filesystem", hashOf("v1"));
		store.approve("filesystem", hashOf("v2"));
		const reloaded: McpApprovalStore = new FileMcpApprovalStore(file);
		expect(reloaded.getApprovedHash("filesystem")).toBe(hashOf("v2"));
	});

	it("recovers as empty when the backing file is absent or corrupt", () => {
		const store: McpApprovalStore = new FileMcpApprovalStore(join(tmpdir(), `${randomUUID()}.missing.json`));
		expect(store.getApprovedHash("filesystem")).toBeUndefined();

		const corruptFile = join(dirname(file), "corrupt.json");
		writeFileSync(corruptFile, "not json{", "utf8");
		const corrupt: McpApprovalStore = new FileMcpApprovalStore(corruptFile);
		expect(corrupt.getApprovedHash("filesystem")).toBeUndefined();
	});
});

describe("MCP auto-classify reply contract", () => {
	it("instructs the classifier to reply exactly APPROVE (no APPOVE typo)", async () => {
		const store: McpApprovalStore = new FileMcpApprovalStore(tempStorePath());
		const guard = createMcpToolGuard({
			modelRuntime: {} as never,
			model: () => ({}) as never,
			confirm: async () => true,
			approvalStore: store,
		});
		const decision = await guard.guard(ctx(server(), "read_db", "auto"));
		// The auto-classifier returned APPROVE, so the call is approved.
		expect(decision.approved).toBe(true);
		expect(decision.via).toBe("auto");
		// The reply contract told the model to reply exactly the correct word.
		expect(lastAutoUserPrompt).toBeDefined();
		expect(lastAutoUserPrompt).not.toContain("APPOVE");
		expect(lastAutoUserPrompt).toContain("APPROVE");
	});
});
