import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServeApi } from "../src/server/http-api.ts";
import { readWorkbenchArtifact } from "../src/server/workbench-artifacts.ts";
import { workbenchArtifactPath } from "../src/server/workbench-artifacts-ui.ts";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function workspace() {
	const root = await mkdtemp(join(tmpdir(), "porcupine-artifacts-"));
	roots.push(root);
	return root;
}

describe("workspace artifacts", () => {
	it("returns image/PDF previews by file signature, text as text, and other formats as downloads", async () => {
		const root = await workspace();
		const examples = [
			["plot.png", Buffer.from("89504e470d0a1a0a", "hex"), "image"],
			["report.pdf", Buffer.from("%PDF-1.7\nreview"), "pdf"],
			["notes.md", Buffer.from("# Notes"), "text"],
			["page.html", Buffer.from("<script>alert(1)</script>"), "file"],
			["drawing.svg", Buffer.from('<svg onload="alert(1)"/>'), "file"],
			["archive.zip", Buffer.from("archive"), "file"],
			["fake.png", Buffer.from("<html>fake image</html>"), "file"],
		];
		for (const [name, bytes, kind] of examples) {
			await writeFile(join(root, name as string), bytes as Buffer);
			const artifact = await readWorkbenchArtifact(root, name as string);
			expect(artifact.kind).toBe(kind);
			expect(artifact.bytes).toEqual(bytes);
		}
	});
	it("confines paths to this workspace and rejects hidden files, symlinks, directories, missing and oversized files", async () => {
		const root = await workspace(),
			outside = await workspace();
		await writeFile(join(outside, "secret.txt"), "secret");
		await writeFile(join(root, ".env"), "secret");
		await mkdir(join(root, "dir"));
		await symlink(outside, join(root, "escape"));
		await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
		await writeFile(join(root, "big.bin"), "");
		await truncate(join(root, "big.bin"), 25 * 1024 * 1024 + 1);
		for (const path of [
			"../secret.txt",
			join(outside, "secret.txt"),
			".env",
			"escape/secret.txt",
			"link.txt",
			"dir",
			"missing.txt",
			"big.bin",
		])
			await expect(readWorkbenchArtifact(root, path), path).rejects.toThrow();
	});
	it("keeps downloads authenticated and session scoped, without putting bearer tokens in links", async () => {
		const root = await workspace();
		await writeFile(join(root, "report.pdf"), "%PDF-1.7\nreview");
		const handle = await startServeApi({
			port: 0,
			token: "test-secret",
			session: {
				id: "files",
				artifactRoot: root,
				sendUserMessage: async () => {},
				abort: async () => {},
				isStreaming: () => false,
				onEvent: () => () => {},
				onConfirm: () => () => {},
			},
		});
		try {
			const url = `http://127.0.0.1:${handle.port()}/session/files/artifact?path=report.pdf`;
			expect((await fetch(url)).status).toBe(401);
			const response = await fetch(url, { headers: { authorization: "Bearer test-secret" } });
			expect(response.status).toBe(200);
			expect(response.headers.get("x-porcupine-preview")).toBe("pdf");
			expect(response.headers.get("content-disposition")).toContain("attachment;");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(await response.text()).toContain("%PDF");
			expect(
				(await fetch(url.replace("/files/", "/other/"), { headers: { authorization: "Bearer test-secret" } }))
					.status,
			).toBe(404);
			expect(
				(await fetch(url, { headers: { authorization: "Bearer test-secret", origin: "http://other.invalid" } }))
					.status,
			).toBe(403);
		} finally {
			await handle.close();
		}
	});
	it("recognises local attachment links and rejects executable, remote and data URLs", () => {
		for (const path of [
			"report.pdf",
			"LICENSE",
			"./images/plot.png",
			"/workspace/report.pdf",
			"sandbox:/workspace/report.pdf",
		])
			expect(workbenchArtifactPath(path)).toBe(path.replace(/^sandbox:/, ""));
		for (const path of [
			"https://example.com/x.png",
			"javascript:alert(1)",
			"data:image/png;base64,abc",
			"//example.com/a.pdf",
			"#section",
		])
			expect(workbenchArtifactPath(path)).toBeNull();
		expect(workbenchArtifactPath("reports/My%20Report.pdf")).toBe("reports/My Report.pdf");
	});
});
