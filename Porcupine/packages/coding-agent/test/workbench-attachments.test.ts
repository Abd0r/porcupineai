import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareWorkbenchAttachments, validateWorkbenchAttachments } from "../src/server/workbench-attachments.ts";

describe("chat attachments", () => {
	it("rejects malformed data, path names, excessive counts and oversized files", () => {
		for (const value of [
			{},
			[{ name: "../secret", data: "YQ==" }],
			[{ name: "a", data: "!" }],
			Array.from({ length: 9 }, () => ({ name: "a", data: "YQ==" })),
			[{ name: "big", data: Buffer.alloc(12 * 1024 * 1024 + 1).toString("base64") }],
		]) {
			expect(() => validateWorkbenchAttachments(value)).toThrow();
		}
	});
	it("saves files under an isolated session directory and sends real image blocks", async () => {
		const root = mkdtempSync(join(tmpdir(), "porcupine-attachments-"));
		try {
			const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
			const parts = await prepareWorkbenchAttachments(
				root,
				"session",
				"Inspect these",
				validateWorkbenchAttachments([
					{ name: "notes.txt", data: Buffer.from("file evidence").toString("base64") },
					{ name: "photo.png", data: png },
				]),
			);
			expect(parts[0]).toEqual({ type: "text", text: expect.stringContaining("Inspect these") });
			const text = parts
				.filter((p) => p.type === "text")
				.map((p) => p.text)
				.join("\n");
			const path = text.match(/Attached file: notes.txt\nPath: (.+)/)?.[1];
			expect(path).toBeTruthy();
			expect(readFileSync(path!, "utf8")).toBe("file evidence");
			expect(parts.some((p) => p.type === "image" && p.mimeType === "image/png" && p.data.length > 0)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
