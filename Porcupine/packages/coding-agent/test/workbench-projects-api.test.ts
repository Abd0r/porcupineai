import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServeApi } from "../src/server/http-api.ts";
import { WorkbenchProjectStore } from "../src/server/workbench-projects.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
	const cwd = mkdtempSync(join(tmpdir(), "project-api-"));
	cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
	const handle = await startServeApi({
		port: 0,
		token: "project-token",
		projects: new WorkbenchProjectStore(cwd),
		session: {
			id: "s",
			async sendUserMessage() {},
			async abort() {},
			isStreaming: () => false,
			onEvent: () => () => {},
			onConfirm: () => () => {},
		},
	});
	cleanups.push(() => handle.close());
	return { cwd, base: `http://127.0.0.1:${handle.port()}`, headers: { authorization: "Bearer project-token" } };
}
describe("project workspace API", () => {
	it("keeps complete Markdown descriptions beyond the old 360-character limit", async () => {
		const { base, headers } = await fixture(),
			description = `**Overview**\n\n${"Detail. ".repeat(70)}[Complete report](uploads/report.pdf)`;
		const response = await fetch(`${base}/workbench/projects`, {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "complete", description }),
		});
		expect(response.status).toBe(201);
		const details = await (await fetch(`${base}/workbench/projects/complete`, { headers })).json();
		expect(details.description).toBe(description);
	});

	it("shares rich sticky notes, enforces twenty, and rejects stale edits", async () => {
		const { base, headers } = await fixture();
		await fetch(`${base}/workbench/projects`, { method: "POST", headers, body: JSON.stringify({ name: "notes" }) });
		const endpoint = `${base}/workbench/projects/notes/notes`;
		const create = (text: string) =>
			fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ title: "Reminder", text, color: "blue" }) });
		const added = await create("**Check** ![Plot](uploads/plot.png) [Paper](uploads/paper.pdf)");
		expect(added.status).toBe(201);
		const note = await added.json();
		expect(note).toMatchObject({ title: "Reminder", color: "blue", author: "user" });
		const update = (revision: string) =>
			fetch(`${endpoint}/${note.id}`, {
				method: "PUT",
				headers,
				body: JSON.stringify({ revision, title: "Updated", text: "New draft", color: "rose" }),
			});
		expect((await update(note.revision)).status).toBe(200);
		expect((await update(note.revision)).status).toBe(409);
		for (let i = 1; i < 20; i++) expect((await create(`note ${i}`)).status).toBe(201);
		expect((await create("twenty first")).status).toBe(409);
		const notes = (await (await fetch(endpoint, { headers })).json()).notes;
		expect(notes).toHaveLength(20);
		expect(
			(
				await fetch(`${endpoint}/${notes[0].id}`, {
					method: "DELETE",
					headers,
					body: JSON.stringify({ revision: notes[0].revision }),
				})
			).status,
		).toBe(200);
		expect((await create("replacement")).status).toBe(201);
		expect((await fetch(endpoint)).status).toBe(401);
		expect(
			(
				await fetch(endpoint, {
					method: "POST",
					headers,
					body: JSON.stringify({ title: "x", text: "x", color: "script" }),
				})
			).status,
		).toBe(400);
	});

	it("returns project details and persists validated pins through authenticated HTTP", async () => {
		const { base, headers } = await fixture();
		await fetch(`${base}/workbench/projects`, {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "paper", title: "Paper", description: "Compare results." }),
		});
		const pin = (body: unknown) =>
			fetch(`${base}/workbench/projects/paper/pin`, { method: "PUT", headers, body: JSON.stringify(body) });
		expect((await pin({ pinned: true })).status).toBe(200);
		const details = await (await fetch(`${base}/workbench/projects/paper`, { headers })).json();
		expect(details).toMatchObject({
			title: "Paper",
			description: "Compare results.",
			pinned: true,
			files: expect.any(Array),
		});
		expect((await pin({ pinned: "yes" })).status).toBe(400);
		expect(
			(await fetch(`${base}/workbench/projects/paper/pin`, { method: "PUT", body: '{"pinned":false}' })).status,
		).toBe(401);
	});
	it("creates, uploads and reads a project document through authenticated HTTP", async () => {
		const { cwd, base, headers } = await fixture();
		const created = await fetch(`${base}/workbench/projects`, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body: JSON.stringify({ name: "Battery Aging", title: "Battery Aging" }),
		});
		expect(created.status).toBe(201);
		const uploaded = await fetch(`${base}/workbench/projects/battery-aging/files?name=notes.md`, {
			method: "POST",
			headers,
			body: "# Notes\nMeasured capacity fade.\n",
		});
		expect(uploaded.status).toBe(201);
		const raw = await fetch(`${base}/workbench/projects/battery-aging/files/uploads/notes.md?raw=1`, { headers });
		expect(raw.headers.get("x-porcupine-preview")).toBe("text");
		expect(await raw.text()).toContain("capacity fade");
		const document = await fetch(`${base}/workbench/projects/battery-aging/files/uploads/notes.md`, { headers });
		expect((await document.json()).content).toContain("capacity fade");
		expect(readFileSync(join(cwd, "Project", "battery-aging", "uploads", "notes.md"), "utf8")).toContain(
			"capacity fade",
		);
	});
	it("rejects unauthenticated and cross-origin project writes", async () => {
		const { base, headers } = await fixture();
		expect((await fetch(`${base}/workbench/projects`)).status).toBe(401);
		const cross = await fetch(`${base}/workbench/projects`, {
			method: "POST",
			headers: { ...headers, origin: "https://attacker.example", "content-type": "application/json" },
			body: JSON.stringify({ name: "bad" }),
		});
		expect(cross.status).toBe(403);
	});
	it("rejects traversal, unknown properties and disallowed document types", async () => {
		const { base, headers } = await fixture();
		const json = { ...headers, "content-type": "application/json" };
		await fetch(`${base}/workbench/projects`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ name: "safe" }),
		});
		expect(
			(
				await fetch(`${base}/workbench/projects`, {
					method: "POST",
					headers: json,
					body: JSON.stringify({ name: "x", script: "run()" }),
				})
			).status,
		).toBe(400);
		expect(
			(await fetch(`${base}/workbench/projects/safe/files?name=payload.exe`, { method: "POST", headers, body: "x" }))
				.status,
		).toBe(415);
		expect((await fetch(`${base}/workbench/projects/safe/files/..%2F..%2FREADME.md`, { headers })).status).toBe(403);
		expect((await fetch(`${base}/workbench/projects/safe/files`, { method: "DELETE", headers })).status).toBe(405);
	});
});
