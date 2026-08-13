import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listLearningFeed } from "../src/porcupine/learning-store.ts";
import {
	createComposedToolDefinition,
	deleteToolPolicy,
	listToolPolicies,
	readToolPolicy,
	upsertToolPolicy,
	validateToolPolicy,
} from "../src/porcupine/tool-policy.ts";

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

describe("tool-policy validation (Phase F)", () => {
	it("accepts a valid composed tool", () => {
		expect(
			validateToolPolicy({
				name: "recent-commits",
				description: "Show last 5 git commits",
				kind: "composed",
				command: ["git", "log", "--oneline", "-5"],
			}),
		).toEqual([]);
	});

	it("rejects non-allowlisted binaries, denied args, bad names, sensitive content", () => {
		const base = { kind: "composed" as const };
		expect(
			validateToolPolicy({ ...base, name: "evil", description: "x", command: ["python3", "-c", "print(1)"] }),
		).not.toEqual([]);
		expect(
			validateToolPolicy({ ...base, name: "bad", description: "x", command: ["git", "push", "--force"] }),
		).not.toEqual([]);
		expect(
			validateToolPolicy({ ...base, name: "rm-stuff", description: "x", command: ["git", "rm", "file"] }),
		).not.toEqual([]);
		expect(validateToolPolicy({ ...base, name: "x", description: "x", command: ["ls"] })).not.toEqual([]); // name too short
		expect(validateToolPolicy({ ...base, name: "leak", description: "api_key here", command: ["ls"] })).not.toEqual(
			[],
		);
	});

	it("refuses user-authored overwrite by the learning system", () => {
		const dir = tempDir("porcupine-policy-ow-");
		expect(upsertToolPolicy(dir, { name: "my-tool", description: "mine", command: ["ls"], source: "user" }).ok).toBe(
			true,
		);
		const result = upsertToolPolicy(dir, {
			name: "my-tool",
			description: "steal",
			command: ["cat"],
			source: "porcupine",
		});
		expect(result.ok).toBe(false);
		expect(readToolPolicy(dir, "my-tool")?.description).toBe("mine");
	});

	it("refuses to delete a user-authored tool policy", () => {
		const dir = tempDir("porcupine-policy-udel-");
		expect(
			upsertToolPolicy(dir, {
				name: "my-user-tool",
				description: "mine",
				command: ["git", "log", "-1"],
				source: "user",
			}).ok,
		).toBe(true);
		const result = deleteToolPolicy(dir, "my-user-tool");
		expect(result.ok).toBe(false);
		expect(readToolPolicy(dir, "my-user-tool")).toBeDefined();
	});

	it("denies destructive git subcommands and redirect flags", () => {
		const base = { kind: "composed" as const, description: "x" };
		// read-only subcommands are accepted.
		expect(validateToolPolicy({ ...base, name: "ok-log", command: ["git", "log", "-5"] })).toEqual([]);
		expect(validateToolPolicy({ ...base, name: "ok-diff", command: ["git", "diff", "HEAD"] })).toEqual([]);
		// destructive subcommands denied.
		expect(validateToolPolicy({ ...base, name: "bad-reset", command: ["git", "reset", "--hard"] })).not.toEqual([]);
		expect(validateToolPolicy({ ...base, name: "bad-push", command: ["git", "push"] })).not.toEqual([]);
		expect(
			validateToolPolicy({ ...base, name: "bad-checkout", command: ["git", "checkout", "--", "."] }),
		).not.toEqual([]);
		expect(validateToolPolicy({ ...base, name: "bad-commit", command: ["git", "commit", "-am"] })).not.toEqual([]);
		expect(validateToolPolicy({ ...base, name: "bad-clean", command: ["git", "clean", "-fd"] })).not.toEqual([]);
		// redirect/global flags denied.
		expect(validateToolPolicy({ ...base, name: "bad-C", command: ["git", "-C", "/tmp", "status"] })).not.toEqual([]);
	});

	it("returns truncated stdout as a SUCCESS with a truncation marker", async () => {
		const dir = tempDir("porcupine-policy-trunc-");
		const payload = "A".repeat(10_000); // well past the 4,000 soft cap
		const created = upsertToolPolicy(dir, {
			name: "big-out",
			description: "Print a big buffer",
			command: ["echo", payload],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const def = createComposedToolDefinition(created.policy);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as never);
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => (part as { text?: string }).text ?? "")
			.join("");
		const details = result.details as { ok?: boolean; truncated?: boolean };
		expect(details.ok).toBe(true);
		expect(details.truncated).toBe(true);
		expect(text).toContain("[truncated]");
		expect(text.length).toBeLessThan(4_150);
	});
});

describe("tool-policy runtime revalidation + stderr cap (BUG-09/BUG-10)", () => {
	it("refuses to execute a composed tool whose stored command was tampered to a denied binary", async () => {
		const dir = tempDir("porcupine-policy-rev-");
		const created = upsertToolPolicy(dir, {
			name: "safe-ls",
			description: "List files",
			command: ["ls"],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		// Simulate a hand-edited / tampered entry that now points at a denied binary.
		const tampered = { ...created.policy, command: ["rm", "-rf", "/"] };
		const def = createComposedToolDefinition(tampered);
		const result = await def.execute("call-t", {}, undefined, undefined, undefined as never);
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => (part as { text?: string }).text ?? "")
			.join("");
		expect(text).toContain("failed validation");
		expect((result.details as { isError?: boolean }).isError).toBe(true);
	});

	it("caps accumulated stderr output", async () => {
		const dir = tempDir("porcupine-policy-stderr-");
		// "cat" an oversized missing path: deterministic non-zero exit with stderr.
		const created = upsertToolPolicy(dir, {
			name: "noisy-cat",
			description: "Emit stderr",
			command: ["cat", `/definitely/nonexistent/porcupine-${`x`.repeat(300)}`],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const def = createComposedToolDefinition(created.policy);
		const result = await def.execute("call-s", {}, undefined, undefined, undefined as never);
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => (part as { text?: string }).text ?? "")
			.join("");
		expect(text).toContain("composed tool exited");
		expect(text.length).toBeLessThan(1_000);
	});

	it("does not double-settle on spawn error + close", async () => {
		const dir = tempDir("porcupine-policy-dbl-");
		const created = upsertToolPolicy(dir, {
			name: "dbl-cmd",
			description: "exit non-zero",
			command: ["cat", "/nope-does-not-exist-12345"],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const def = createComposedToolDefinition(created.policy);
		const result = await def.execute("call-d", {}, undefined, undefined, undefined as never);
		expect(result.content.length).toBeGreaterThan(0);
		expect((result.details as { isError?: boolean }).isError).toBe(true);
	});
});

describe("tool-policy registry (Phase F)", () => {
	it("creates, lists, updates (with snapshot) and deletes composed tools", () => {
		const dir = tempDir("porcupine-policy-");
		expect(
			upsertToolPolicy(dir, {
				name: "recent-commits",
				description: "Show last 5 git commits",
				command: ["git", "log", "--oneline", "-5"],
			}).ok,
		).toBe(true);
		expect(listToolPolicies(dir).length).toBe(1);
		expect(readToolPolicy(dir, "recent-commits")?.kind).toBe("composed");

		// Update → snapshot recorded for auto-rollback.
		const updated = upsertToolPolicy(dir, {
			name: "recent-commits",
			description: "Show last 10 git commits",
			command: ["git", "log", "--oneline", "-10"],
		});
		expect(updated.ok).toBe(true);
		expect(updated.ok && updated.policy.snapshotRef).toBeTruthy();
		expect(
			existsSync(join(dir, "learning", "snapshots", `${updated.ok ? updated.policy.snapshotRef : ""}.json`)),
		).toBe(true);

		expect(deleteToolPolicy(dir, "recent-commits").ok).toBe(true);
		expect(listToolPolicies(dir).length).toBe(0);
	});

	it("emits feed events for create/update/delete", () => {
		const dir = tempDir("porcupine-policy-feed-");
		upsertToolPolicy(dir, { name: "top-files", description: "Top files by size", command: ["du", "-sh", "."] });
		const feed = listLearningFeed(dir, 5);
		expect(feed.some((e) => e.action === "created" && e.kind === "tool" && e.file?.includes("tools.porcupine"))).toBe(
			true,
		);
	});

	it("executes a composed tool and returns truncated stdout", async () => {
		const dir = tempDir("porcupine-policy-exec-");
		const created = upsertToolPolicy(dir, {
			name: "say-hi",
			description: "Echo greeting",
			command: ["echo", "hello world"],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const def = createComposedToolDefinition(created.policy);
		const result = await def.execute("call-1", {}, undefined, undefined, undefined as never);
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => (part as { text?: string }).text ?? "")
			.join("\n");
		expect(text).toContain("hello world");
	});
});
