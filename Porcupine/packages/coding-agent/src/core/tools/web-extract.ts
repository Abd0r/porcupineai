/**
 * Free web page extract — plain HTTP fetch + lightweight HTML→text.
 * No paid APIs. Companion to web_search.
 */

import type { AgentTool } from "@porcupineai/agent-core";
import { Text } from "@porcupineai/tui";
import { type Static, Type } from "typebox";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { truncateBytePrefix } from "./truncate.ts";

/** Hard cap on the response body we will buffer, so a redirect/large endpoint can't exhaust memory (BUG-8). */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const webExtractSchema = Type.Object({
	url: Type.String({ description: "HTTP(S) URL to fetch" }),
	maxChars: Type.Optional(Type.Number({ description: "Max characters of extracted text (default 12000)" })),
});

export type WebExtractToolInput = Static<typeof webExtractSchema>;

export interface WebExtractToolDetails {
	url: string;
	status: number;
	contentType?: string;
	truncated: boolean;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

function htmlToText(html: string): string {
	let s = html;
	// drop scripts/styles
	s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
	s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
	s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
	// block breaks
	s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)[^>]*>/gi, "\n");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<[^>]+>/g, " ");
	s = decodeEntities(s);
	s = s
		.split("\n")
		.map((line) => line.replace(/[ \t]+/g, " ").trim())
		.filter(Boolean)
		.join("\n");
	return s.trim();
}

/**
 * Drain a fetch Response body into a string, stopping once `maxBytes` have been
 * buffered (BUG-8). Prevents unbounded memory from a huge/redirected endpoint.
 * Returns whatever was read as a UTF-8 string (may be a whole-codepoint prefix of
 * the full body).
 */
async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) {
		return await res.text();
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (total < maxBytes) {
		const { done, value } = await reader.read();
		if (done) break;
		const room = maxBytes - total;
		if (value && value.length > room) {
			chunks.push(value.subarray(0, room));
			total += room;
			break;
		}
		if (value) {
			chunks.push(value);
			total += value.length;
		}
	}
	// Clean up: cancel the underlying stream so we don't leak a reader.
	await reader.cancel().catch(() => {});
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let out = "";
	for (const c of chunks) {
		try {
			out += decoder.decode(c);
		} catch {
			// A chunk split mid-codepoint at the cap: stop — do not emit an invalid
			// partial character; the caller truncates further anyway.
			break;
		}
	}
	try {
		out += decoder.decode();
	} catch {
		// ignore trailing partial sequence
	}
	return out;
}

export async function extractUrl(
	url: string,
	maxChars = 12_000,
): Promise<{ text: string; details: WebExtractToolDetails }> {
	const u = url.trim();
	if (!/^https?:\/\//i.test(u)) {
		throw new Error("url must start with http:// or https://");
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	try {
		const res = await fetch(u, {
			signal: controller.signal,
			headers: {
				"User-Agent": "Porcupine/0.83 (+free-web-extract)",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
			},
			redirect: "follow",
		});
		const contentType = res.headers.get("content-type") || undefined;
		// Read the body with a hard byte cap (BUG-8) so a redirect or oversized
		// endpoint can't buffer unbounded data. `res.text()`/`arrayBuffer()` would
		// read the entire (unbounded) body, so we drain the stream ourselves.
		const raw = await readBodyCapped(res, MAX_BODY_BYTES);
		let text: string;
		if (contentType?.includes("html") || /<html[\s>]/i.test(raw.slice(0, 500))) {
			text = htmlToText(raw);
		} else {
			text = raw;
		}
		const limit = Number.isFinite(maxChars) ? Math.max(500, Math.min(100_000, Math.floor(maxChars))) : 12_000;
		const truncated = text.length > limit;
		// Truncate at a UTF-8-safe whole-codepoint boundary (BUG-8); slice(0,limit)
		// could split a multi-byte surrogate/codepoint producing invalid output.
		if (truncated) text = `${truncateBytePrefix(text, limit)}\n\n[truncated to ${limit} chars]`;
		return {
			text: text || "(empty page)",
			details: {
				url: res.url || u,
				status: res.status,
				contentType,
				truncated,
			},
		};
	} finally {
		clearTimeout(timer);
	}
}

export function createWebExtractToolDefinition(): ToolDefinition<
	typeof webExtractSchema,
	WebExtractToolDetails | undefined
> {
	return {
		name: "web_extract",
		label: "web_extract",
		description:
			"Fetch a public URL and return cleaned text (HTML stripped). Free, no API key. Use after web_search when you need page content.",
		promptSnippet: "Fetch URL → plain text (free)",
		promptGuidelines: [
			"Use web_extract on concrete URLs from search or the user. Prefer web_search first when looking something up.",
		],
		parameters: webExtractSchema,
		async execute(_toolCallId, { url, maxChars }) {
			const result = await extractUrl(url, maxChars);
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
			};
		},
		renderCall(args) {
			const url = String(args?.url ?? "...");
			return new Text(`${theme.fg("toolTitle", theme.bold("web_extract"))} ${theme.fg("toolOutput", url)}`, 0, 0);
		},
		renderResult(result, options) {
			const text = (result.content ?? [])
				.map((c) => (c.type === "text" ? c.text : ""))
				.join("")
				.trim();
			const preview = options.expanded ? text : text.split("\n").slice(0, 12).join("\n");
			return new Text(`\n${theme.fg("toolOutput", preview || "(empty)")}`, 0, 0);
		},
	};
}

export function createWebExtractTool(): AgentTool<typeof webExtractSchema> {
	return wrapToolDefinition(createWebExtractToolDefinition());
}
