import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProjectNoteStore, projectNoteEvents } from "../src/server/workbench-project-notes.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "project-note-"));
	roots.push(root);
	return { root, store: new ProjectNoteStore(root) };
}
it("persists both authors across restarts without listing note storage as a resource", () => {
	const { root, store } = fixture();
	store.mutate("add", { title: "Remember", text: "![Plot](uploads/plot.png)", color: "blue" }, "agent");
	const reopened = new ProjectNoteStore(root);
	expect(reopened.list()).toMatchObject([{ author: "agent", text: "![Plot](uploads/plot.png)" }]);
	const note = reopened.list()[0];
	reopened.mutate(
		"update",
		{ title: "Verified", text: "[PDF](uploads/paper.pdf)", color: "amber" },
		"user",
		note.id,
		note.revision,
	);
	expect(new ProjectNoteStore(root).list()[0]).toMatchObject({ title: "Verified", author: "user" });
});
it("refuses symlinked or malformed notes without overwriting them", () => {
	const { root, store } = fixture(),
		outside = fixture();
	writeFileSync(join(outside.root, "secret.json"), "[]");
	symlinkSync(join(outside.root, "secret.json"), join(root, ".workbench-notes.json"));
	expect(() => store.list()).toThrow(/safely/);
	expect(() => store.mutate("add", { title: "No", text: "", color: "amber" }, "agent")).toThrow();
	rmSync(join(root, ".workbench-notes.json"));
	writeFileSync(join(root, ".workbench-notes.json"), "bad JSON");
	expect(() => store.mutate("add", { title: "No", text: "", color: "amber" }, "user")).toThrow(/invalid/);
});
it("does not let agent changes overwrite a newer user edit", () => {
	const { store } = fixture();
	store.mutate("add", { title: "First", text: "", color: "rose" }, "agent");
	const original = store.list()[0];
	store.mutate(
		"update",
		{ title: "User change", text: "Latest", color: "sage" },
		"user",
		original.id,
		original.revision,
	);
	expect(() => store.mutate("delete", null, "agent", original.id, original.revision)).toThrow(/changed/);
	expect(store.list()[0].title).toBe("User change");
});

it("recovers an abandoned mutation lock after a crashed writer", () => {
	const { root, store } = fixture(),
		lock = join(root, ".workbench-notes.lock");
	mkdirSync(lock);
	utimesSync(lock, new Date(0), new Date(0));
	expect(() => store.mutate("add", { title: "Recovered", text: "", color: "amber" }, "user")).not.toThrow();
	expect(store.list()[0].title).toBe("Recovered");
});

it("emits structured file-change evidence after persisting a note", () => {
	const { root, store } = fixture(),
		events: unknown[] = [];
	const unsubscribe = projectNoteEvents.on("artifact:changed", (event) => events.push(event));
	try {
		store.mutate("add", { title: "Verified", text: "Checked the units.", color: "blue" }, "agent");
		expect(events).toMatchObject([
			{
				type: "artifact:changed",
				change: {
					path: join(root, ".workbench-notes.json"),
					operation: "created",
					linesAdded: expect.any(Number),
					additions: expect.any(Array),
				},
			},
		]);
		expect(store.lastChange?.additions.join("\n")).toContain("Checked the units.");
	} finally {
		unsubscribe();
	}
});
