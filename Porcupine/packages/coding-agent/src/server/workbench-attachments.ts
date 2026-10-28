import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageContent, TextContent } from "@porcupineai/ai/compat";
import { processImage } from "../utils/image-process.ts";
import { detectSupportedImageMimeType } from "../utils/mime.ts";
import { WorkbenchError } from "./workbench-context-files.ts";

export interface WorkbenchAttachment {
	name: string;
	data: string;
}
export const CHAT_ATTACHMENT_LIMIT = 12 * 1024 * 1024;

/** Validate the entire batch before writing files or starting the agent. */
export function validateWorkbenchAttachments(value: unknown): WorkbenchAttachment[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 8) throw new WorkbenchError(400, "Attach up to 8 files");
	let total = 0;
	return value.map((item: unknown) => {
		if (
			!item ||
			typeof item !== "object" ||
			!("name" in item) ||
			!("data" in item) ||
			typeof item.name !== "string" ||
			!item.name.trim() ||
			Buffer.byteLength(item.name) > 180 ||
			/[\\/\x00-\x1f]/.test(item.name) ||
			item.name === "." ||
			item.name === ".." ||
			typeof item.data !== "string" ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)
		)
			throw new WorkbenchError(400, "Invalid attachment name or base64 data");
		total += Buffer.byteLength(item.data, "base64");
		if (total > CHAT_ATTACHMENT_LIMIT) throw new WorkbenchError(413, "Attachments exceed the 12 MiB total limit");
		return { name: item.name, data: item.data };
	});
}

/** Uploaded documents remain readable by ordinary agent tools; photos also enter vision input. */
export async function prepareWorkbenchAttachments(
	root: string,
	sessionId: string,
	text: string,
	attachments: WorkbenchAttachment[],
): Promise<(TextContent | ImageContent)[]> {
	const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
	const dir = join(root, "attachments", createHash("sha256").update(sessionId).digest("hex"));
	const prepared = await Promise.all(
		attachments.map(async (attachment) => {
			const bytes = Buffer.from(attachment.data, "base64");
			const mime = detectSupportedImageMimeType(bytes);
			const image = mime ? await processImage(bytes, mime) : null;
			if (image && !image.ok) throw new WorkbenchError(400, `${attachment.name}: ${image.message}`);
			return { attachment, bytes, image };
		}),
	);
	if (prepared.length) await mkdir(dir, { recursive: true, mode: 0o700 });
	for (const { attachment, bytes, image } of prepared) {
		const path = join(dir, `${randomUUID()}-${attachment.name}`);
		await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
		content.push({ type: "text", text: `Attached file: ${attachment.name}\nPath: ${path}` });
		if (image?.ok) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
	}
	return content;
}
