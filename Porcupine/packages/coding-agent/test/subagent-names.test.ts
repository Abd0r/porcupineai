import { describe, expect, it } from "vitest";
import {
	buildAgentNamePool,
	DEFAULT_SUBAGENT_NAMES,
	formatAgentTag,
	isMainAgentRef,
	normalizeAgentName,
	SubagentNamePool,
	sanitizeAgentName,
} from "../src/core/subagent-names.ts";

describe("subagent names", () => {
	it("ships buck, fudgy, tinker, rivet, and gizmo as defaults", () => {
		expect([...DEFAULT_SUBAGENT_NAMES]).toEqual(["buck", "fudgy", "tinker", "rivet", "gizmo"]);
		expect(formatAgentTag("buck")).toBe("@buck");
	});

	it("normalizes tags and recognizes the main agent", () => {
		expect(normalizeAgentName("@Buck")).toBe("buck");
		expect(normalizeAgentName("  @FUDGY  ")).toBe("fudgy");
		expect(isMainAgentRef("@porcupine")).toBe(true);
		expect(isMainAgentRef("porcupine")).toBe(true);
		expect(isMainAgentRef("@main")).toBe(true);
		expect(isMainAgentRef("main")).toBe(true);
		expect(isMainAgentRef("@buck")).toBe(false);
	});

	it("rejects reserved, malformed, and non-string names", () => {
		expect(sanitizeAgentName("porcupine")).toBeUndefined();
		expect(sanitizeAgentName("@main")).toBeUndefined();
		expect(sanitizeAgentName("has space")).toBeUndefined();
		expect(sanitizeAgentName("")).toBeUndefined();
		expect(sanitizeAgentName(42)).toBeUndefined();
		expect(sanitizeAgentName("@Scout-7")).toBe("scout-7");
	});

	it("prefers configured names, dedupes, and backfills defaults", () => {
		expect(buildAgentNamePool(["Scout", "scout", "@main", "no good!"])).toEqual([
			"scout",
			"buck",
			"fudgy",
			"tinker",
			"rivet",
		]);
		expect(buildAgentNamePool(undefined)).toEqual(["buck", "fudgy", "tinker", "rivet", "gizmo"]);
		expect(buildAgentNamePool([])).toEqual(["buck", "fudgy", "tinker", "rivet", "gizmo"]);
	});
});

describe("SubagentNamePool", () => {
	it("claims pool names in order and frees them on release", () => {
		const pool = new SubagentNamePool(undefined);
		expect(pool.claim("sa-1")).toBe("buck");
		expect(pool.claim("sa-2")).toBe("fudgy");
		pool.release("sa-1");
		expect(pool.claim("sa-3")).toBe("buck");
		expect(pool.nameOf("sa-2")).toBe("fudgy");
	});

	it("honors an explicit request when free and valid", () => {
		const pool = new SubagentNamePool(undefined);
		expect(pool.claim("sa-1", "Scout")).toBe("scout");
		// Collision falls back to the pool instead of failing the spawn.
		expect(pool.claim("sa-2", "@scout")).toBe("buck");
		// Reserved requests fall back too.
		expect(pool.claim("sa-3", "porcupine")).toBe("fudgy");
	});

	it("resolves tags, bare names, and raw ids", () => {
		const pool = new SubagentNamePool(undefined);
		pool.claim("sa-abc123");
		expect(pool.resolveRef("@buck")).toBe("sa-abc123");
		expect(pool.resolveRef("buck")).toBe("sa-abc123");
		expect(pool.resolveRef("sa-abc123")).toBe("sa-abc123");
		expect(pool.resolveRef("@tinker")).toBeUndefined();
		expect(pool.resolveRef("  ")).toBeUndefined();
		pool.release("sa-abc123");
		expect(pool.resolveRef("@buck")).toBeUndefined();
	});

	it("lists live tags for status views", () => {
		const pool = new SubagentNamePool(undefined);
		pool.claim("sa-1");
		expect(pool.active()).toEqual([{ tag: "@buck", id: "sa-1" }]);
	});
});
