/**
 * Notebook (`.ipynb`) parsing + rendering for the read tool.
 *
 * A raw notebook cell is JSON soup: multi-line source and outputs are stored as
 * arrays of per-character/per-line strings, and plots live as base64 blobs inside
 * mime bundles. This module turns that into a tagged, "document-like" view:
 *
 *   - cells are numbered and labelled (code / markdown / raw),
 *   - text outputs are shown inline,
 *   - image outputs (png/jpeg) are collected SEPARATELY as `images: string[]`
 *     (the read tool attaches them as vision-capable image blocks),
 *   - any single cell output over `maxCellOutputChars` (default 10000) collapses
 *     to a `jq` pointer so one dataframe dump cannot eat the whole read budget.
 *
 * The module is self-contained: pure functions + a small renderer. It owns no
 * tool definition — the read tool wires the exports in.
 */

/** A single notebook cell, normalised from the ipynb source form. */
export interface NotebookCell {
	/** 1-based order in the notebook. */
	index: number;
	kind: "code" | "markdown" | "raw";
	/** Joined source (the ipynb keeps it as an array of strings — we join). */
	source: string;
	/** Only code cells carry outputs. */
	outputs?: NotebookOutput[];
}

/** A normalised cell output. */
export interface NotebookOutput {
	kind: "text" | "image" | "error";
	/** Human readable text for `text`/`error` outputs (jq pointer for huge ones). */
	text?: string;
	/** data: URL for `image` outputs (png/jpeg). */
	dataUrl?: string;
}

/** The normalised notebook document. */
export interface NotebookRender {
	cells: NotebookCell[];
}

/** The rendered result handed back to the read tool. */
export interface NotebookRenderResult {
	/** The tagged, document-style text view. */
	text: string;
	/** Image data URLs, collected separately so the parent can attach them. */
	images: string[];
}

/** Default cap for any single cell output, in characters. */
export const DEFAULT_MAX_CELL_OUTPUT_CHARS = 10_000;

/** Cap on lines of source shown per cell. */
const MAX_SOURCE_LINES = 200;

/**
 * Join an ipynb string/array-of-strings field into a plain string.
 * The notebook format represents multi-line values either as a single string or
 * as an array of lines without newline terminators — join handles both.
 */
function joinField(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : "")).join("");
	return "";
}

/**
 * Parse a raw ipynb buffer into a normalised {@link NotebookRender}.
 * Returns `null` when the buffer is not a valid notebook (bad JSON, not a
 * dictionary, or no cells array). Throws for no other reason.
 */
export function parseNotebook(buffer: Buffer): NotebookRender | null {
	let root: unknown;
	try {
		root = JSON.parse(buffer.toString("utf-8"));
	} catch {
		// Not valid JSON — not a notebook.
		return null;
	}
	if (root === null || typeof root !== "object" || Array.isArray(root)) return null;
	const obj = root as Record<string, unknown>;
	const rawCells = obj.cells;
	if (!Array.isArray(rawCells)) return null;

	const cells: NotebookCell[] = rawCells.map((rawCell, idx) => {
		if (rawCell === null || typeof rawCell !== "object" || Array.isArray(rawCell)) {
			return { index: idx + 1, kind: "markdown", source: "" };
		}
		const cell = rawCell as Record<string, unknown>;
		const kindRaw = cell.cell_type;
		const kind: NotebookCell["kind"] = kindRaw === "code" || kindRaw === "raw" ? kindRaw : "markdown";
		const source = joinField(cell.source);

		const cellData: NotebookCell = { index: idx + 1, kind, source };

		const outputs = cell.outputs;
		if (Array.isArray(outputs) && outputs.length > 0) {
			const normalised: NotebookOutput[] = [];
			for (const rawOut of outputs) {
				const parsed = parseOutput(rawOut);
				if (parsed) normalised.push(parsed);
			}
			if (normalised.length > 0) cellData.outputs = normalised;
		}
		return cellData;
	});

	return { cells };
}

/** Pick the plain-text view of a mime bundle (falls back to first entry). */
function textFromMimeBundle(data: unknown): string {
	if (data === null || typeof data !== "object" || Array.isArray(data)) return "";
	const bundle = data as Record<string, unknown>;
	// Plain text is the safest representation; a populated `text/plain` wins.
	for (const preferred of ["text/plain", "text/markdown", "text"]) {
		const entry = bundle[preferred];
		if (entry !== undefined) {
			const value = joinField(entry);
			if (value !== "") return value;
		}
	}
	for (const key of Object.keys(bundle)) {
		const value = joinField(bundle[key]);
		if (value !== "") return value;
	}
	return "";
}

/** True for the mime types we can hand to the read tool as images. */
function imageMime(key: string): boolean {
	return key === "image/png" || key === "image/jpeg";
}

/** Serialise a base64 image into a data URL the vision-capable read tool can attach. */
function imageDataUrl(mime: string, base64: unknown): string | null {
	const payload = joinField(base64).trim();
	if (payload === "") return null;
	return `data:${mime};base64,${payload}`;
}

/**
 * Normalise a single raw ipynb output into a {@link NotebookOutput}, or `null`
 * when it is not a representable output (e.g. an empty display_data).
 */
function parseOutput(rawOut: unknown): NotebookOutput | null {
	if (rawOut === null || typeof rawOut !== "object" || Array.isArray(rawOut)) return null;
	const out = rawOut as Record<string, unknown>;
	const outputType = out.output_type;

	// Streams (stdout/stderr) carry text in `text`.
	if (outputType === "stream") {
		const text = joinField(out.text);
		return text !== "" ? { kind: "text", text } : null;
	}

	// Errors carry a name, a value and a traceback.
	if (outputType === "error") {
		const ename = joinField(out.ename);
		const evalue = joinField(out.evalue);
		const traceback = joinField(out.traceback);
		const text = [ename, evalue].filter((s) => s !== "").join(": ") || "error";
		const full = traceback !== "" ? `${text}\n${traceback}` : text;
		return { kind: "error", text: full };
	}

	// display_data / execute_result carry a mime bundle in `data`.
	const data = out.data;
	if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
	const bundle = data as Record<string, unknown>;

	// Prefer an image if present (png/jpeg) — collected separately.
	for (const key of Object.keys(bundle)) {
		if (imageMime(key)) {
			const dataUrl = imageDataUrl(key, bundle[key]);
			if (dataUrl) return { kind: "image", dataUrl };
		}
	}

	// Otherwise fall back to the textual representation, if any.
	const text = textFromMimeBundle(bundle);
	return text !== "" ? { kind: "text", text } : null;
}

/** Cap a source snippet to a fixed number of lines. */
function capLines(text: string, maxLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	return `${lines.slice(0, maxLines).join("\n")}\n[source truncated: ${lines.length} lines total]`;
}

/**
 * Render a normalised notebook to a tagged document.
 *
 * Cell outputs that exceed `maxCellOutputChars` collapse to a jq pointer naming
 * the exact path, so a single dataframe dump cannot consume the read budget.
 */
export function renderNotebook(nb: NotebookRender, opts?: { maxCellOutputChars?: number }): NotebookRenderResult {
	const maxCellOutputChars = opts?.maxCellOutputChars ?? DEFAULT_MAX_CELL_OUTPUT_CHARS;
	const images: string[] = [];
	const blocks: string[] = [];

	for (const cell of nb.cells) {
		const header = `[${cell.index} ${cell.kind}]`;
		blocks.push(`## ${header}`);
		blocks.push(capLines(cell.source, MAX_SOURCE_LINES));

		if (cell.outputs && cell.outputs.length > 0) {
			for (const out of cell.outputs) {
				if (out.kind === "image" && out.dataUrl) {
					images.push(out.dataUrl);
					// The read tool attaches the real image; keep an inline marker for
					// non-vision models or text-first renders.
					blocks.push("```");
					blocks.push("[plot: base64 image data follows]");
					blocks.push("```");
					continue;
				}

				const raw = out.text ?? "";
				if (raw.length > maxCellOutputChars) {
					// Find the output's position inside the cell so the jq pointer is exact.
					const j = (cell.outputs ?? []).indexOf(out);
					blocks.push(
						`[output truncated: ${raw.length} chars — use jq '.cells[${
							cell.index - 1
						}].outputs[${j}]' to inspect]`,
					);
					continue;
				}

				if (out.kind === "error") {
					blocks.push("```");
					blocks.push(raw);
					blocks.push("```");
				} else {
					blocks.push("```");
					blocks.push(raw);
					blocks.push("```");
				}
			}
		}
	}

	return { text: blocks.join("\n"), images };
}
