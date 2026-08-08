/**
 * Local type declarations for highlight.js subpath imports.
 *
 * highlight.js ships ambient declarations for its subpaths in its own
 * types/index.d.ts, but the bundler-style module resolution used by this
 * package does not always pick them up for `lib/core` / `lib/languages/*`.
 * These declarations mirror the package's own (lib/core re-exports the API;
 * each language file exports a single LanguageFn).
 */
declare module "highlight.js/lib/core" {
	import hljs from "highlight.js";
	export default hljs;
}

declare module "highlight.js/lib/languages/*" {
	/** LanguageFn shape: (hljs?) => Language (not exported from the package types). */
	const languageFn: (hljs?: unknown) => unknown;
	export = languageFn;
}
