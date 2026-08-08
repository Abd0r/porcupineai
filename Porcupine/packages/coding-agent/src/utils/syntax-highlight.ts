import { createRequire } from "node:module";
import hljs from "highlight.js/lib/core.js";

// ESM build: sync require() is not available; createRequire provides it.
const nodeRequire = createRequire(import.meta.url);

import { decodeHtmlEntityAt } from "./html.ts";

// Register ONLY the languages the agent can actually highlight (see
// getLanguageFromPath in the theme). The full highlight.js bundle is ~1MB and
// cost ~40ms at startup; the core build plus these grammars is a fraction of
// that. Languages not listed here fall back to plain rendering.
const HIGHLIGHT_LANGUAGES = [
	"typescript",
	"javascript",
	"python",
	"ruby",
	"rust",
	"go",
	"java",
	"kotlin",
	"swift",
	"c",
	"cpp",
	"csharp",
	"php",
	"bash",
	"fish",
	"powershell",
	"sql",
	"xml", // xml grammar also covers html/xhtml via aliases
	"css",
	"scss",
	"sass",
	"less",
	"json",
	"yaml",
	"toml",
	"markdown",
	"dockerfile",
	"makefile",
	"cmake",
	"lua",
	"perl",
	"r",
	"scala",
	"clojure",
	"elixir",
	"erlang",
	"haskell",
	"ocaml",
	"vim",
	"graphql",
	"protobuf",
	"hcl",
] as const;

let languagesRegistered = false;
function ensureLanguagesRegistered(): void {
	if (languagesRegistered) return;
	languagesRegistered = true;
	for (const name of HIGHLIGHT_LANGUAGES) {
		try {
			const mod = nodeRequire(`highlight.js/lib/languages/${name}.js`) as {
				default?: unknown;
			};
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const languageFn = (mod.default ?? mod) as any;
			if (languageFn) hljs.registerLanguage(name, languageFn);
		} catch {
			// Unknown/unavailable grammar: skip silently (plain rendering).
		}
	}
}

export type HighlightFormatter = (text: string) => string;
export type HighlightTheme = Partial<Record<string, HighlightFormatter>>;

export interface HighlightOptions {
	language?: string;
	ignoreIllegals?: boolean;
	languageSubset?: string[];
	theme?: HighlightTheme;
}

const SPAN_CLOSE = "</span>";
const HIGHLIGHT_CLASS_PREFIX = "hljs-";

function getScopeFromSpanTag(tag: string): string | undefined {
	const match = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
	const classValue = match?.[1] ?? match?.[2];
	if (!classValue) {
		return undefined;
	}

	for (const className of classValue.split(/\s+/)) {
		if (className.startsWith(HIGHLIGHT_CLASS_PREFIX)) {
			return className.slice(HIGHLIGHT_CLASS_PREFIX.length);
		}
	}

	return undefined;
}

function getScopeFormatter(scope: string, theme: HighlightTheme): HighlightFormatter | undefined {
	const exact = theme[scope];
	if (exact) {
		return exact;
	}

	const dotIndex = scope.indexOf(".");
	if (dotIndex !== -1) {
		const prefixFormatter = theme[scope.slice(0, dotIndex)];
		if (prefixFormatter) {
			return prefixFormatter;
		}
	}

	const dashIndex = scope.indexOf("-");
	if (dashIndex !== -1) {
		const prefixFormatter = theme[scope.slice(0, dashIndex)];
		if (prefixFormatter) {
			return prefixFormatter;
		}
	}

	return undefined;
}

function getActiveFormatter(scopes: Array<string | undefined>, theme: HighlightTheme): HighlightFormatter | undefined {
	for (let i = scopes.length - 1; i >= 0; i--) {
		const scope = scopes[i];
		if (!scope) {
			continue;
		}
		const formatter = getScopeFormatter(scope, theme);
		if (formatter) {
			return formatter;
		}
	}
	return theme.default;
}

function isSpanOpenTagStart(html: string, index: number): boolean {
	if (!html.startsWith("<span", index)) {
		return false;
	}
	const nextChar = html[index + "<span".length];
	return nextChar === ">" || nextChar === " " || nextChar === "\t" || nextChar === "\n" || nextChar === "\r";
}

export function renderHighlightedHtml(html: string, theme: HighlightTheme = {}): string {
	let output = "";
	let textBuffer = "";
	const scopes: Array<string | undefined> = [];

	const flushText = () => {
		if (!textBuffer) {
			return;
		}
		const formatter = getActiveFormatter(scopes, theme);
		output += formatter ? formatter(textBuffer) : textBuffer;
		textBuffer = "";
	};

	let index = 0;
	while (index < html.length) {
		if (isSpanOpenTagStart(html, index)) {
			const tagEndIndex = html.indexOf(">", index + 5);
			if (tagEndIndex !== -1) {
				flushText();
				const tag = html.slice(index, tagEndIndex + 1);
				const scope = getScopeFromSpanTag(tag);
				scopes.push(scope);
				index = tagEndIndex + 1;
				continue;
			}
		}

		if (html.startsWith(SPAN_CLOSE, index)) {
			flushText();
			if (scopes.length > 0) {
				scopes.pop();
			}
			index += SPAN_CLOSE.length;
			continue;
		}

		if (html[index] === "&") {
			const decoded = decodeHtmlEntityAt(html, index);
			if (decoded) {
				textBuffer += decoded.text;
				index += decoded.length;
				continue;
			}
		}

		textBuffer += html[index];
		index++;
	}

	flushText();
	return output;
}

export function highlight(code: string, options: HighlightOptions = {}): string {
	ensureLanguagesRegistered();
	const html = options.language
		? hljs.highlight(code, {
				language: options.language,
				ignoreIllegals: options.ignoreIllegals,
			}).value
		: hljs.highlightAuto(code, options.languageSubset).value;
	return renderHighlightedHtml(html, options.theme);
}

export function supportsLanguage(name: string): boolean {
	ensureLanguagesRegistered();
	return hljs.getLanguage(name) !== undefined;
}
