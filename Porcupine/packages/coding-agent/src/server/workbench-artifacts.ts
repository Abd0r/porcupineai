import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { WorkbenchError } from "./workbench-context-files.ts";

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

/** Read a regular workspace file. Active documents are downloads, never same-origin web content. */
export async function readWorkbenchArtifact(root: string, path: string) {
	if (!path || path.length > 4096 || /[\x00-\x1f]/.test(path)) throw new WorkbenchError(400, "Invalid file path");
	const canonicalRoot = await realpath(root),
		target = resolve(canonicalRoot, path),
		local = relative(canonicalRoot, target);
	if (
		!local ||
		local.startsWith(`..${sep}`) ||
		local === ".." ||
		isAbsolute(local) ||
		local.split(sep).some((part) => part.startsWith("."))
	)
		throw new WorkbenchError(403, "File must be inside the conversation workspace and outside hidden directories");
	try {
		let current = canonicalRoot;
		for (const part of local.split(sep)) {
			current = resolve(current, part);
			if ((await lstat(current)).isSymbolicLink())
				throw new WorkbenchError(403, "Symbolic-link files cannot be shared");
		}
		const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const stat = await handle.stat();
			if (!stat.isFile()) throw new WorkbenchError(403, "Only regular files can be shared");
			if (stat.size > MAX_ARTIFACT_BYTES) throw new WorkbenchError(413, "Files may be up to 25 MiB");
			const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_ARTIFACT_BYTES + 1));
			let length = 0;
			while (length < buffer.length) {
				const read = await handle.read(buffer, length, buffer.length - length, null);
				if (!read.bytesRead) break;
				length += read.bytesRead;
			}
			if (length > MAX_ARTIFACT_BYTES || length > stat.size)
				throw new WorkbenchError(413, "File changed while reading; try again");
			const bytes = buffer.subarray(0, length),
				extension = extname(path).toLowerCase();
			let mime = "application/octet-stream",
				kind = "file";
			if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
				mime = "image/png";
				kind = "image";
			} else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
				mime = "image/jpeg";
				kind = "image";
			} else if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) {
				mime = "image/gif";
				kind = "image";
			} else if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") {
				mime = "image/webp";
				kind = "image";
			} else if (extension === ".pdf" && bytes.subarray(0, 5).toString() === "%PDF-") {
				mime = "application/pdf";
				kind = "pdf";
			} else if (
				/^\.(txt|md|markdown|csv|tsv|json|log|py|js|ts|tsx|jsx|css|yaml|yml|toml|c|cpp|h|rs|go|sh)$/.test(
					extension,
				) &&
				!bytes.includes(0)
			) {
				mime = "text/plain; charset=utf-8";
				kind = "text";
			}
			return { name: basename(target), bytes, mime, kind };
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (error instanceof WorkbenchError) throw error;
		throw new WorkbenchError(404, "File is unavailable in this conversation workspace");
	}
}
