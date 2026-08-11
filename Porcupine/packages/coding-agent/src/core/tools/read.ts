import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import type { AgentTool } from "@porcupineai/agent-core";
import type { Api, AudioContent, ImageContent, Model, TextContent } from "@porcupineai/ai";
import { Text } from "@porcupineai/tui";
import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile, stat as fsStat } from "fs/promises";
import { type Static, Type } from "typebox";
import { getReadmePath } from "../../config.ts";
import { keyHint, keyText } from "../../modes/interactive/components/keybinding-hints.ts";
import { getLanguageFromPath, highlightCode, type Theme } from "../../modes/interactive/theme/theme.ts";
import { processImage } from "../../utils/image-process.ts";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.ts";
import { formatPathRelativeToCwdOrAbsolute } from "../../utils/paths.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { parseNotebook, renderNotebook } from "./notebook-read.ts";
import {
	isBlockedDevicePath,
	resolveReadPathAsync,
	resolveToCwd,
	resolveWithFilenameNormalization,
} from "./path-utils.ts";
import { getReadLedger } from "./read-ledger.ts";
import { getTextOutput, renderToolPath, replaceTabs, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateHead } from "./truncate.ts";

function looksLikeBinaryBuffer(buffer: Buffer, absolutePath: string): boolean {
	// Explicitly-textual formats always decode fine.
	if (/\.(svg|ipynb|json|toml|ya?ml|xml|html?|css|scss|less|md|txt)$/i.test(absolutePath)) return false;
	// Sniff known binary magic bytes first — a PDF/ZIP/gzip/ELF/PNG/GIF/JPEG is
	// binary even when its sample is short enough to be pure ASCII.
	const magic = buffer.subarray(0, 4);
	if (magic.equals(Buffer.from("%PDF"))) return true;
	if (magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return true; // ZIP
	if (buffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) return true; // gzip
	if (magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true; // ELF
	if (magic.equals(Buffer.from("\x89PNG"))) return true;
	if (buffer.subarray(0, 3).equals(Buffer.from("GIF"))) return true;
	if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) return true; // JPEG
	// Fallback: NUL byte in the first 8KB, or a high ratio of non-text bytes.
	const sample = buffer.subarray(0, 8192);
	if (sample.includes(0)) return true;
	let nonText = 0;
	for (let i = 0; i < sample.length; i++) {
		const b = sample[i];
		// Allow printable ASCII, tab, LF, CR and utf-8 continuation bytes.
		if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f) || b >= 0x80) continue;
		nonText++;
	}
	return nonText > sample.length * 0.05;
}

/** Return a short one-line note naming the format and its recovery. */
function binaryFileNote(buffer: Buffer, absolutePath: string): string {
	if (/\.pdf$/i.test(absolutePath)) {
		return `[Binary file: PDF (${formatSize(buffer.length)}). Use bash: pdftotext ${absolutePath} - to extract text.]`;
	}
	// Sniff common magic bytes for a precise mime note.
	let kind = "binary";
	if (buffer.subarray(0, 4).equals(Buffer.from("%PDF"))) kind = "PDF";
	else if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) kind = "ZIP archive";
	else if (buffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) kind = "gzip";
	else if (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) kind = "ELF binary";
	else if (buffer.subarray(0, 4).equals(Buffer.from("\x89PNG"))) kind = "PNG image";
	else if (buffer.subarray(0, 3).equals(Buffer.from("GIF"))) kind = "GIF image";
	else if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) kind = "JPEG image";
	return `[Binary file: ${kind} (${formatSize(buffer.length)}). Content is not shown as text.]`;
}

/**
 * Coerce a line-number input (model may send "2000" as a string). Number() only
 * — "2abc" becomes NaN and is rejected, never silently read as 2; fractional
 * offsets are rejected, never floored. A silently wrong window is worse than an error.
 */
function coerceLineNumber(value: unknown, name: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	const n = typeof value === "string" ? Number(value) : (value as number);
	if (typeof n !== "number" || !Number.isFinite(n)) {
		throw new Error(`Invalid ${name}: "${String(value)}" is not a valid line number.`);
	}
	if (!Number.isInteger(n)) {
		throw new Error(`Invalid ${name}: ${n} is fractional — line numbers must be whole numbers.`);
	}
	return n;
}

/** Path aliases the model may send instead of "path". */
const PATH_ALIASES = ["path", "file_path", "filePath", "absolutePath", "target_file", "filename"] as const;

function resolvePathInput(raw: Record<string, unknown>): string | undefined {
	for (const key of PATH_ALIASES) {
		if (typeof raw[key] === "string" && (raw[key] as string).length > 0) return raw[key] as string;
	}
	return undefined;
}

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
	truncation?: TruncationResult;
}

interface CompactReadClassification {
	kind: "docs" | "resource" | "skill";
	label: string;
}

const COMPACT_RESOURCE_FILE_NAMES = new Set(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);

/**
 * Pluggable operations for the read tool.
 * Override these to delegate file reading to remote systems (for example SSH).
 */
export interface ReadOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Check if file is readable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
	/** Detect image MIME type, return null or undefined for non-images */
	detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
	/** Stat a file (for the read dedup cache). Default: fs stat */
	stat?: (absolutePath: string) => Promise<{ mtimeMs: number; size: number }>;
}

const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

const READ_DEDUP_KILL_SWITCH = process.env.PORCUPINE_READ_DEDUP === "0";

interface DedupKey {
	path: string;
	mtimeMs: number;
	size: number;
	offset: number | undefined;
	limit: number | undefined;
}

/**
 * Self-expiring dedup cache for read results (lesson: a cache whose stale hit
 * is catastrophic expires itself on use). A hit CONSUMES the record, so a stub
 * that outlives the earlier content (e.g. compaction ate it) costs at most one
 * wasted turn, never an unbounded loop. Bounded size, mtime+size checked.
 */
class ReadDedupCache {
	private readonly entries = new Map<string, DedupKey>();
	private static readonly MAX_ENTRIES = 256;

	keyFor(k: DedupKey): string {
		return `${k.path}|${k.mtimeMs}|${k.size}|${k.offset ?? ""}|${k.limit ?? ""}`;
	}

	/** Returns true (and consumes the record) when this exact window was already delivered. */
	consume(k: DedupKey): boolean {
		const key = this.keyFor(k);
		if (!this.entries.has(key)) return false;
		this.entries.delete(key); // consume on use — self-expiring
		return true;
	}

	record(k: DedupKey): void {
		const key = this.keyFor(k);
		this.entries.delete(key);
		this.entries.set(key, k);
		if (this.entries.size > ReadDedupCache.MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) this.entries.delete(oldest);
		}
	}

	clear(): void {
		this.entries.clear();
	}
}

export interface ReadToolOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
	/** Custom operations for file reading. Default: local filesystem */
	operations?: ReadOperations;
}

type ReadRenderArgs = { path?: string; file_path?: string; offset?: number; limit?: number };

function formatReadLineRange(args: ReadRenderArgs | undefined, theme: Theme): string {
	if (args?.offset === undefined && args?.limit === undefined) return "";
	const startLine = args.offset ?? 1;
	const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
	return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}

function formatReadCall(args: ReadRenderArgs | undefined, theme: Theme, cwd: string): string {
	const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
	return `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}${formatReadLineRange(args, theme)}`;
}

/**
 * Prefix every line with its 1-indexed number, right-aligned (" 12| text"),
 * so the model, the editor and stack traces agree on what "line 412" means.
 * The edit tool strips these prefixes from oldText (edit-diff.ts).
 */
function prefixLineNumbers(content: string, startLine: number): string {
	if (content.length === 0) return content;
	const lines = content.split("\n");
	const width = String(startLine + lines.length).length;
	return lines.map((line, i) => `${String(startLine + i).padStart(width)}| ${line}`).join("\n");
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}

function getNonVisionImageNote(model: Model<Api> | undefined): string | undefined {
	if (!model || model.input.includes("image")) {
		return undefined;
	}
	return "[Current model does not support images. The image will be omitted from this request.]";
}

function toPosixPath(filePath: string): string {
	return filePath.split(sep).join("/");
}

function getPorcupineDocsClassification(absolutePath: string): CompactReadClassification | undefined {
	const packageRoot = dirname(getReadmePath());
	const relativePath = relative(resolvePath(packageRoot), resolvePath(absolutePath));
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return undefined;
	}

	const label = toPosixPath(relativePath);
	if (label === "README.md" || label.startsWith("docs/") || label.startsWith("examples/")) {
		return { kind: "docs", label };
	}
	return undefined;
}

function getCompactReadClassification(
	args: ReadRenderArgs | undefined,
	cwd: string,
): CompactReadClassification | undefined {
	const rawPath = str(args?.file_path ?? args?.path);
	if (!rawPath) return undefined;

	const absolutePath = resolveToCwd(rawPath, cwd);
	const fileName = basename(absolutePath);
	if (fileName === "SKILL.md") {
		return { kind: "skill", label: basename(dirname(absolutePath)) || fileName };
	}

	const docsClassification = getPorcupineDocsClassification(absolutePath);
	if (docsClassification) return docsClassification;

	if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
		return { kind: "resource", label: formatPathRelativeToCwdOrAbsolute(absolutePath, cwd) };
	}

	return undefined;
}

function formatCompactReadCall(
	classification: CompactReadClassification,
	args: ReadRenderArgs | undefined,
	theme: Theme,
): string {
	const expandHint = theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
	if (classification.kind === "skill") {
		return (
			theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
			theme.fg("customMessageText", classification.label) +
			formatReadLineRange(args, theme) +
			expandHint
		);
	}

	return (
		theme.fg("toolTitle", theme.bold(`read ${classification.kind}`)) +
		" " +
		theme.fg("accent", classification.label) +
		formatReadLineRange(args, theme) +
		expandHint
	);
}

function formatReadResult(
	args: ReadRenderArgs | undefined,
	result: { content: (TextContent | ImageContent | AudioContent)[]; details?: ReadToolDetails },
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
	_cwd: string,
	isError: boolean,
): string {
	if (!options.expanded && !isError) {
		// Skill reads stay visible in the transcript: show a compact preview of
		// the SKILL.md body so skill loading is never a blank tool call.
		const rawPath = str(args?.file_path ?? args?.path);
		if (rawPath && basename(rawPath) === "SKILL.md") {
			const output = getTextOutput(result, showImages);
			const lines = output.split("\n").filter((line) => line.trim().length > 0);
			const preview = lines
				.slice(0, 6)
				.map((line) => theme.fg("toolOutput", replaceTabs(line)))
				.join("\n");
			if (preview) {
				const more = lines.length - 6;
				return `\n${preview}${more > 0 ? theme.fg("muted", `\n... (${more} more lines, ${keyHint("app.tools.expand", "to expand")})`) : ""}`;
			}
		}
		return "";
	}

	const rawPath = str(args?.file_path ?? args?.path);
	const output = getTextOutput(result, showImages);
	const lang = !isError && rawPath ? getLanguageFromPath(rawPath) : undefined;
	const renderedLines = lang ? highlightCode(replaceTabs(output), lang) : output.split("\n");
	const lines = trimTrailingEmptyLines(renderedLines);
	const maxLines = options.expanded ? lines.length : 10;
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;
	let text = `\n${displayLines.map((line) => (lang ? replaceTabs(line) : theme.fg("toolOutput", replaceTabs(line)))).join("\n")}`;
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}

	const truncation = result.details?.truncation;
	if (truncation?.truncated) {
		if (truncation.firstLineExceedsLimit) {
			text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
		} else if (truncation.truncatedBy === "lines") {
			text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
		} else {
			text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
		}
	}
	return text;
}

export function createReadToolDefinition(
	cwd: string,
	options?: ReadToolOptions,
): ToolDefinition<typeof readSchema, ReadToolDetails | undefined> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const ops = options?.operations ?? defaultReadOperations;
	const dedupCache = new ReadDedupCache();
	const opsStat =
		ops.stat ??
		(async (absolutePath: string) => {
			const st = await fsStat(absolutePath);
			return { mtimeMs: st.mtimeMs, size: st.size };
		});
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
		promptSnippet: "Read file contents",
		promptGuidelines: ["Use read to examine files instead of cat or sed."],
		parameters: readSchema,
		async execute(
			_toolCallId,
			rawInput: { path: string; offset?: number; limit?: number },
			signal?: AbortSignal,
			_onUpdate?,
			ctx?,
		) {
			// Repair inputs, don't bounce them: accept path aliases and coerce
			// numeric strings via Number() (never parseInt, never floor).
			const path = resolvePathInput(rawInput as unknown as Record<string, unknown>);
			if (!path) {
				throw new Error("Missing path: provide the file path as 'path' (or file_path/filePath).");
			}
			const offset = coerceLineNumber(rawInput.offset, "offset");
			const limit = coerceLineNumber(rawInput.limit, "limit");
			return new Promise<{
				content: (TextContent | ImageContent | AudioContent)[];
				details: ReadToolDetails | undefined;
			}>((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}
				let aborted = false;
				const onAbort = () => {
					aborted = true;
					reject(new Error("Operation aborted"));
				};
				signal?.addEventListener("abort", onAbort, { once: true });

				(async () => {
					try {
						// Resolve, retrying filename spellings the model cannot see as different
						// (NFD/NFC, narrow no-break space, curly quotes) — a repair that never
						// becomes an escape hatch (every candidate passes the boundary check).
						let absolutePath: string;
						try {
							absolutePath = await resolveReadPathAsync(path, cwd);
						} catch (primaryError) {
							absolutePath = await resolveWithFilenameNormalization(cwd, path, (p) =>
								resolveReadPathAsync(p, cwd),
							);
							if (!absolutePath) throw primaryError;
						}
						if (aborted) return;
						// Refuse special device paths before any I/O (reading /dev/zero would hang).
						if (isBlockedDevicePath(absolutePath)) {
							throw new Error(`Refusing to read special device path: ${absolutePath}`);
						}
						if (aborted) return;
						// Check if file exists and is readable.
						await ops.access(absolutePath);
						if (aborted) return;
						const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
						let content: (TextContent | ImageContent | AudioContent)[];
						let details: ReadToolDetails | undefined;
						const nonVisionImageNote = getNonVisionImageNote(ctx?.model);
						if (mimeType) {
							// Read image as binary.
							const buffer = await ops.readFile(absolutePath);
							const processed = await processImage(buffer, mimeType, { autoResizeImages });
							if (!processed.ok) {
								let textNote = `Read image file [${mimeType}]\n${processed.message}`;
								if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
								content = [{ type: "text", text: textNote }];
							} else {
								let textNote = `Read image file [${processed.mimeType}]`;
								if (processed.hints.length > 0) textNote += `\n${processed.hints.join("\n")}`;
								// Disclose the scale factor so click coordinates computed off the
								// attached image are not confidently wrong.
								const scale = (processed as { scaleFactor?: number }).scaleFactor;
								if (
									typeof scale === "number" &&
									scale !== 1 &&
									processed.originalWidth &&
									processed.attachedWidth
								) {
									textNote += `\n[Image scaled from ${processed.originalWidth}x${processed.originalHeight} to ${processed.attachedWidth}x${processed.attachedHeight} — multiply displayed coordinates by ${scale.toFixed(2)}.]`;
								}
								if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
								content = [
									{ type: "text", text: textNote },
									{ type: "image", data: processed.data, mimeType: processed.mimeType },
								];
							}
						} else {
							// Read text content.
							// Dedup: an unchanged file re-read at the SAME window returns a short
							// stub (the content is already in the conversation). Consume-on-use
							// keeps a stale hit at worst one wasted turn.
							const st = await opsStat(absolutePath);
							const dedupKey = {
								path: absolutePath,
								mtimeMs: st.mtimeMs,
								size: st.size,
								offset,
								limit,
							};
							const deliveredStart = (offset ? Math.max(0, offset - 1) : 0) + 1;
							if (!READ_DEDUP_KILL_SWITCH && dedupCache.consume(dedupKey)) {
								const endDisplay = limit !== undefined ? deliveredStart + limit - 1 : "";
								content = [
									{
										type: "text",
										text: `[Cached: ${
											endDisplay ? `lines ${deliveredStart}-${endDisplay}` : `lines ${deliveredStart}+`
										} of this unchanged file were already shown earlier in this conversation. Use a different offset/limit window to see more.]`,
									},
								];
							} else {
								const buffer = await ops.readFile(absolutePath);
								const isNotebook = /\.ipynb$/i.test(absolutePath);
								const notebook = isNotebook ? parseNotebook(buffer) : null;
								if (notebook) {
									// Notebooks render as documents: tagged cells, plots as images,
									// and huge outputs become a jq pointer (one dataframe dump cannot
									// eat the read budget).
									const rendered = renderNotebook(notebook);
									const imageParts: (TextContent | ImageContent | AudioContent)[] = [
										{ type: "text", text: rendered.text },
									];
									if (ctx?.model?.input.includes("image")) {
										for (const dataUrl of rendered.images) {
											imageParts.push({ type: "image", data: dataUrl, mimeType: "image/png" });
										}
									}
									content = imageParts;
								} else if (looksLikeBinaryBuffer(buffer, absolutePath)) {
									content = [{ type: "text", text: binaryFileNote(buffer, absolutePath) }];
								} else {
									let textContent = buffer.toString("utf-8");
									// Strip a UTF-8 BOM — invisible junk the model cannot see or reproduce.
									if (textContent.charCodeAt(0) === 0xfeff) {
										textContent = textContent.slice(1);
									}
									const allLines = textContent.split("\n");
									// A trailing newline yields a phantom empty line — pop it so line
									// counts match what cat -n shows (a 3-line file has 3 lines).
									if (textContent.endsWith("\n")) {
										allLines.pop();
									}
									const totalFileLines = allLines.length;
									// Apply offset if specified. Convert from 1-indexed input to 0-indexed array access.
									const startLine = offset ? Math.max(0, offset - 1) : 0;
									const startLineDisplay = startLine + 1;
									// Check if offset is out of bounds.
									if (startLine >= allLines.length) {
										// A zero-content file (empty, or only blank lines) has no valid offset
										// to retry with — name the recovery instead of a confusing count.
										const fileIsEmpty = allLines.every((line) => line === "");
										if (fileIsEmpty) {
											throw new Error(`Cannot read offset ${offset}: file is empty.`);
										}
										throw new Error(
											`Offset ${offset} is beyond end of file (${allLines.length} lines total). Use offset=${allLines.length} or a smaller offset.`,
										);
									}
									let selectedContent: string;
									let userLimitedLines: number | undefined;
									// If limit is specified by the user, honor it first. Otherwise truncateHead decides.
									if (limit !== undefined) {
										const endLine = Math.min(startLine + limit, allLines.length);
										selectedContent = allLines.slice(startLine, endLine).join("\n");
										userLimitedLines = endLine - startLine;
									} else {
										selectedContent = allLines.slice(startLine).join("\n");
									}
									// Apply truncation, respecting both line and byte limits.
									const truncation = truncateHead(selectedContent);
									let outputText: string;
									if (truncation.firstLineExceedsLimit) {
										// First line alone exceeds the byte limit. Point the model at a bash fallback.
										const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
										outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
										details = { truncation };
									} else if (truncation.truncated) {
										// Truncation occurred. Build an actionable continuation notice.
										const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
										const nextOffset = endLineDisplay + 1;
										outputText = prefixLineNumbers(truncation.content, startLineDisplay);
										if (truncation.truncatedBy === "lines") {
											outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
										} else {
											outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
										}
										details = { truncation };
									} else if (
										userLimitedLines !== undefined &&
										startLine + userLimitedLines < allLines.length
									) {
										// User-specified limit stopped early, but the file still has more content.
										const remaining = allLines.length - (startLine + userLimitedLines);
										const nextOffset = startLine + userLimitedLines + 1;
										outputText = `${prefixLineNumbers(truncation.content, startLineDisplay)}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
									} else {
										// No truncation and no remaining user-limited content.
										outputText = prefixLineNumbers(truncation.content, startLineDisplay);
									}
									content = [{ type: "text", text: outputText }];
									if (!READ_DEDUP_KILL_SWITCH) dedupCache.record(dedupKey);
									// Record the delivered window so the edit tool can refuse to
									// overwrite parts of the file the model has never seen.
									const deliveredCount = truncation
										? truncation.outputLines
										: (userLimitedLines ?? totalFileLines - startLine);
									getReadLedger().recordRead(absolutePath, {
										mtimeMs: st.mtimeMs,
										size: st.size,
										seenFromLine: startLineDisplay,
										seenToLine: startLineDisplay + Math.max(0, deliveredCount - 1),
										totalLines: totalFileLines,
									});
								}
							}
						}

						if (aborted) return;
						signal?.removeEventListener("abort", onAbort);
						resolve({ content, details });
					} catch (error: any) {
						signal?.removeEventListener("abort", onAbort);
						if (!aborted) reject(error);
					}
				})();
			});
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const classification = !context.expanded ? getCompactReadClassification(args, context.cwd) : undefined;
			text.setText(
				classification
					? formatCompactReadCall(classification, args, theme)
					: formatReadCall(args, theme, context.cwd),
			);
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				formatReadResult(context.args, result, options, theme, context.showImages, context.cwd, context.isError),
			);
			return text;
		},
	};
}

export function createReadTool(cwd: string, options?: ReadToolOptions): AgentTool<typeof readSchema> {
	return wrapToolDefinition(createReadToolDefinition(cwd, options));
}
