import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, FileError, Result } from "@porcupineai/agent-core";
import { afterEach, describe, expect, it } from "vitest";
import {
	createNodeSqliteFactory,
	createSqliteSessionSearch,
	SqliteSessionRepository,
	type SqliteSessionRepositoryEnv,
} from "../src/index.ts";
import type { SqliteSessionSearchOptions } from "../src/sqlite/search-backend.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = join(tmpdir(), `porcupine-sqlite-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()!;
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	}
});

function createUserMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function createEnv(root: string): SqliteSessionRepositoryEnv {
	const ok = <T>(value: T): Result<T, FileError> => ({ ok: true, value });
	if (!existsSync(root)) mkdirSync(root, { recursive: true });
	return {
		async absolutePath(path: string): Promise<Result<string, FileError>> {
			return ok(join(root, path));
		},
		async createDir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>> {
			mkdirSync(path, { recursive: options?.recursive ?? false });
			return ok(undefined);
		},
		async exists(path: string): Promise<Result<boolean, FileError>> {
			return ok(existsSync(path));
		},
	};
}

function createFixture(root: string, databasePath: string, searchOptions?: Partial<SqliteSessionSearchOptions>) {
	const sqlite = createNodeSqliteFactory();
	const env = createEnv(root);
	const options = { env, sqlite, databasePath };
	const repository = new SqliteSessionRepository(options);
	const search = createSqliteSessionSearch({ env, sqlite, databasePath, ...searchOptions });
	return { repository, search };
}

async function dispose(repository: SqliteSessionRepository): Promise<void> {
	await repository[Symbol.asyncDispose]();
}

describe("SqliteSessionSearch durability", () => {
	it("finds entries written by a previous store instance reopened at the same path (restart durability)", async () => {
		const root = createTempDir();
		const databasePath = join(root, "sessions.sqlite");

		// First "process": create a session, write an entry, verify search finds it, then shut down.
		{
			const { repository, search } = createFixture(root, databasePath);
			const session = await repository.create({ cwd: root, id: "persistent-session" });
			await session.appendMessage(createUserMessage("remember the durable search token"));
			const hits = await search.search({ text: "durable" });
			expect(hits).toHaveLength(1);
			expect(hits[0]!.metadata.id).toBe("persistent-session");
			await dispose(repository);
		}

		// Second "process": a brand-new store instance reading the same on-disk index.
		{
			const { repository, search } = createFixture(root, databasePath);
			const hits = await search.search({ text: "durable" });
			expect(hits).toHaveLength(1);
			expect(hits[0]!.metadata.id).toBe("persistent-session");
			await dispose(repository);
		}
	});

	it("applies the FTS schema idempotently across reopens (migration path)", async () => {
		const root = createTempDir();
		const databasePath = join(root, "sessions.sqlite");

		{
			const { repository, search } = createFixture(root, databasePath);
			const session = await repository.create({ cwd: root, id: "migrate-session" });
			await session.appendMessage(createUserMessage("migration sensitive text"));
			// Force schema create + FTS init on first searches.
			await expect(search.search({ text: "migration" })).resolves.toHaveLength(1);
			await expect(search.search({ text: "migration" })).resolves.toHaveLength(1);
			await dispose(repository);
		}

		// Reopening at the same path must not error on `CREATE ... IF NOT EXISTS` / trigger re-creation.
		{
			const { repository, search } = createFixture(root, databasePath);
			await expect(search.search({ text: "migration" })).resolves.toHaveLength(1);
			await dispose(repository);
		}
	});
});

describe("SqliteSessionSearch bounds", () => {
	it("bounds results to the configured default limit", async () => {
		const root = createTempDir();
		const databasePath = join(root, "sessions.sqlite");
		const limit = 3;
		const { repository, search } = createFixture(root, databasePath, { defaultLimit: limit });
		const session = await repository.create({ cwd: root, id: "bounded-session" });
		for (let i = 0; i < 10; i += 1) {
			await session.appendMessage(createUserMessage(`shared token number ${i}`));
		}
		const hits = await search.search({ text: "shared" });
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.length).toBeLessThanOrEqual(limit);
		await dispose(repository);
	});

	it("orders results by relevance score (ascending bm25)", async () => {
		const root = createTempDir();
		const databasePath = join(root, "sessions.sqlite");
		const { repository, search } = createFixture(root, databasePath, { defaultLimit: 100 });
		const session = await repository.create({ cwd: root, id: "ordered-session" });
		await session.appendMessage(createUserMessage("alpha token"));
		await session.appendMessage(createUserMessage("beta token alpha token"));
		const hits = await search.search({ text: "token" });
		expect(hits.length).toBeGreaterThan(1);
		const scores = hits.map((hit) => hit.score);
		for (let i = 1; i < scores.length; i += 1) {
			expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!);
		}
		await dispose(repository);
	});
});
