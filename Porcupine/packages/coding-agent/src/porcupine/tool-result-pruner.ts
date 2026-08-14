/**
 * Deterministic tool-result pruner (dsh tool-result-pruner pattern).
 *
 * Keeps oversized tool results out of the model window by replacing long text
 * content with a bounded head/middle/tail slice plus a marker. Pure and
 * deterministic: same input, same output, so replay and tests are stable.
 * This is a hygiene pass, not a policy: it never marks results as errors and
 * never touches non-text content blocks.
 */

import type { TextContent } from "@porcupineai/ai";

/** Default budget (chars of text retained before pruning kicks in). */
export const DEFAULT_PRUNE_THRESHOLD_CHARS = 16_000;
/** Default head/tail budget in chars. */
export const DEFAULT_PRUNE_HEAD_CHARS = 8_000;
export const DEFAULT_PRUNE_TAIL_CHARS = 2_000;

export interface PruneResult {
	/** True when at least one text block was truncated. */
	pruned: boolean;
	/** Total characters removed across pruned blocks. */
	removedChars: number;
	/** Marker text appended at the cut point. */
	marker: string;
}

function isTextBlock(block: unknown): block is TextContent {
	return block !== null && typeof block === "object" && (block as { type?: unknown }).type === "text";
}

/**
 * Prune text content blocks of a tool-result message in place when the total
 * text length exceeds the threshold. Returns what was pruned.
 *
 * Single text block: head + marker + tail. Multiple blocks: the first
 * `headChars` across the leading blocks, a marker, then the last `tailChars`
 * across the trailing blocks; intermediate text is dropped. Non-text blocks
 * (images, audio, tool calls) are never modified.
 */
export function pruneToolResultContent(
	content: unknown[],
	options?: { thresholdChars?: number; headChars?: number; tailChars?: number },
): PruneResult {
	const threshold = options?.thresholdChars ?? DEFAULT_PRUNE_THRESHOLD_CHARS;
	const headChars = options?.headChars ?? DEFAULT_PRUNE_HEAD_CHARS;
	const tailChars = options?.tailChars ?? DEFAULT_PRUNE_TAIL_CHARS;
	const result: PruneResult = { pruned: false, removedChars: 0, marker: "" };

	const textBlocks: TextContent[] = [];
	let totalChars = 0;
	for (const block of content) {
		if (isTextBlock(block)) {
			textBlocks.push(block);
			totalChars += block.text.length;
		}
	}

	if (textBlocks.length === 0 || totalChars <= threshold) {
		return result;
	}

	const marker = `\n… [truncated: ${Math.max(0, totalChars - headChars - tailChars)} chars]`;
	result.marker = marker;

	if (textBlocks.length === 1) {
		const block = textBlocks[0];
		const removed = totalChars - headChars - tailChars;
		block.text = `${block.text.slice(0, headChars)}${marker}\n${block.text.slice(Math.max(0, totalChars - tailChars))}`;
		result.pruned = true;
		result.removedChars = Math.max(0, removed);
		return result;
	}

	// Multi-block: walk from the front accumulating headChars, then from the
	// back accumulating tailChars. Blocks fully between the two cuts are
	// emptied; the boundary blocks are sliced. The marker becomes a new text
	// block inserted after the head boundary.
	let headRemaining = headChars;
	let headEndIndex = -1;
	let headEndOffset = 0;
	for (let i = 0; i < textBlocks.length; i++) {
		const len = textBlocks[i].text.length;
		if (len >= headRemaining) {
			headEndIndex = i;
			headEndOffset = headRemaining;
			break;
		}
		headRemaining -= len;
	}
	// Degenerate config (headChars >= total): the whole result fits the head
	// window; treat the last block as the boundary so the overlap branch below
	// still removes the excess.
	if (headEndIndex === -1) {
		headEndIndex = textBlocks.length - 1;
		headEndOffset = textBlocks[headEndIndex].text.length;
	}

	let tailRemaining = tailChars;
	let tailStartIndex = textBlocks.length;
	let tailStartOffset = 0;
	for (let i = textBlocks.length - 1; i >= 0; i--) {
		const len = textBlocks[i].text.length;
		if (len >= tailRemaining) {
			tailStartIndex = i;
			tailStartOffset = len - tailRemaining;
			break;
		}
		tailRemaining -= len;
	}

	// If the head and tail windows overlap (tiny result just over threshold),
	// truncating both would duplicate content; keep the head window only.
	if (headEndIndex > tailStartIndex || (headEndIndex === tailStartIndex && headEndOffset > tailStartOffset)) {
		let removed = 0;
		for (let i = 0; i < textBlocks.length; i++) {
			const block = textBlocks[i];
			if (i < headEndIndex) continue; // head window: keep
			if (i > headEndIndex) {
				removed += block.text.length;
				block.text = "";
				continue;
			}
			removed += block.text.length - headEndOffset;
			block.text = block.text.slice(0, headEndOffset);
		}
		textBlocks[headEndIndex].text += marker;
		result.pruned = true;
		result.removedChars = removed;
		return result;
	}

	// Standard head + marker + tail.
	for (let i = 0; i < textBlocks.length; i++) {
		const block = textBlocks[i];
		if (i < headEndIndex) continue; // full head block: keep
		if (i === headEndIndex) {
			block.text = block.text.slice(0, headEndOffset) + marker;
			continue;
		}
		if (i > headEndIndex && i < tailStartIndex) {
			result.removedChars += block.text.length;
			block.text = "";
			continue;
		}
		if (i === tailStartIndex) {
			block.text = block.text.slice(tailStartOffset);
		}
		// i > tailStartIndex: full tail block: keep
	}

	// Keep the marker inside the head block (already appended above), so no
	// separate block insertion is needed.
	result.pruned = true;
	return result;
}
