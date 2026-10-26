/**
 * LaTeX subset to MathML.
 *
 * Porcupine renders math natively as MathML Core, so there is no font bundle, no
 * external asset and no CSP change. Only an explicit subset is supported; any
 * unrecognised command is emitted as literal text instead of guessing, so a
 * formula is never silently wrong.
 */

export type MathNode =
	| { tag: "math"; display: boolean; children: MathNode[] }
	| { tag: "mi" | "mn" | "mo" | "mtext"; text: string }
	| { tag: "mrow" | "msqrt" | "mstyle"; children: MathNode[] }
	| { tag: "mfrac" | "msub" | "msup" | "mover" | "munder"; children: MathNode[] }
	| { tag: "mroot"; children: MathNode[] };

const GREEK: Record<string, string> = {
	alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
	zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
	lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
	varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ",
	varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
	Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
	Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const OPERATORS: Record<string, string> = {
	pm: "±", mp: "∓", times: "×", cdot: "⋅", div: "÷", ast: "∗", star: "⋆",
	le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈",
	equiv: "≡", sim: "∼", simeq: "≃", propto: "∝", ll: "≪", gg: "≫",
	to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐",
	leftrightarrow: "↔", mapsto: "↦", in: "∈", notin: "∉", subset: "⊂",
	supset: "⊃", cup: "∪", cap: "∩", forall: "∀", exists: "∃", neg: "¬",
	wedge: "∧", vee: "∨", oplus: "⊕", otimes: "⊗", perp: "⊥", parallel: "∥",
	infty: "∞", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫",
	oint: "∮", hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", angle: "∠", degree: "°",
	ldots: "…", cdots: "⋯", dots: "…", prime: "′", therefore: "∴", because: "∵",
};

const SPACES: Record<string, string> = { ",": "\u2009", ";": "\u2005", ":": "\u2004", "!": "", " ": " " };
const ACCENTS: Record<string, string> = { vec: "→", hat: "^", bar: "¯", overline: "¯", tilde: "~", dot: "˙" };

interface Cursor {
	text: string;
	index: number;
}

function peek(cursor: Cursor): string {
	return cursor.text[cursor.index] ?? "";
}

function skipSpace(cursor: Cursor): void {
	while (cursor.index < cursor.text.length && /\s/.test(cursor.text[cursor.index] as string)) cursor.index += 1;
}

function readGroup(cursor: Cursor): string {
	skipSpace(cursor);
	if (peek(cursor) !== "{") {
		const char = peek(cursor);
		if (!char) return "";
		cursor.index += 1;
		return char;
	}
	let depth = 0;
	const start = cursor.index + 1;
	for (let index = cursor.index; index < cursor.text.length; index += 1) {
		const char = cursor.text[index];
		if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				cursor.index = index + 1;
				return cursor.text.slice(start, index);
			}
		}
	}
	cursor.index = cursor.text.length;
	return cursor.text.slice(start);
}

function readCommand(cursor: Cursor): string {
	cursor.index += 1; // backslash
	let name = "";
	while (cursor.index < cursor.text.length && /[A-Za-z]/.test(cursor.text[cursor.index] as string)) {
		name += cursor.text[cursor.index];
		cursor.index += 1;
	}
	if (!name) {
		const char = peek(cursor);
		cursor.index += char ? 1 : 0;
		return char ?? "";
	}
	return name;
}

/** Parse a LaTeX fragment into a list of MathML nodes. */
export function parseLatex(tex: string): MathNode[] {
	const cursor: Cursor = { text: tex, index: 0 };
	return parseSequence(cursor, false);
}

function parseSequence(cursor: Cursor, stopAtBrace: boolean): MathNode[] {
	const nodes: MathNode[] = [];
	let buffer = "";
	const flush = (): void => {
		if (!buffer) return;
		nodes.push({ tag: "mtext", text: buffer });
		buffer = "";
	};
	while (cursor.index < cursor.text.length) {
		const char = peek(cursor);
		if (char === "}" && stopAtBrace) break;
		if (char === "^" || char === "_") {
			flush();
			cursor.index += 1;
			const script = parseLatex(readGroup(cursor));
			const base = nodes.pop() ?? { tag: "mrow", children: [] };
			nodes.push({ tag: char === "^" ? "msup" : "msub", children: [base, { tag: "mrow", children: script }] });
			continue;
		}
		if (char === "{") {
			flush();
			const group = readGroup(cursor);
			nodes.push({ tag: "mrow", children: parseLatex(group) });
			continue;
		}
		if (char !== "\\") {
			buffer += char;
			cursor.index += 1;
			continue;
		}
		const name = readCommand(cursor);
		if (name === "," || name === ";" || name === ":" || name === "!" || name === " ") {
			flush();
			nodes.push({ tag: "mtext", text: SPACES[name] ?? " " });
			continue;
		}
		if (name in GREEK) {
			flush();
			nodes.push({ tag: "mi", text: GREEK[name] as string });
			continue;
		}
		if (name in OPERATORS) {
			flush();
			nodes.push({ tag: "mo", text: OPERATORS[name] as string });
			continue;
		}
		if (name === "frac" || name === "dfrac" || name === "tfrac") {
			flush();
			const numerator = readGroup(cursor);
			const denominator = readGroup(cursor);
			nodes.push({ tag: "mfrac", children: [{ tag: "mrow", children: parseLatex(numerator) }, { tag: "mrow", children: parseLatex(denominator) }] });
			continue;
		}
		if (name === "sqrt") {
			flush();
			const maybeIndex = skipOptional(cursor);
			const radicand = readGroup(cursor);
			if (maybeIndex !== undefined) {
				nodes.push({ tag: "mroot", children: [{ tag: "mrow", children: parseLatex(radicand) }, { tag: "mrow", children: parseLatex(maybeIndex) }] });
			} else {
				nodes.push({ tag: "msqrt", children: parseLatex(radicand) });
			}
			continue;
		}
		if (name in ACCENTS) {
			flush();
			const base = nodes.pop() ?? { tag: "mrow", children: parseLatex(readGroup(cursor)) };
			nodes.push({ tag: "mover", children: [base, { tag: "mo", text: ACCENTS[name] as string }] });
			continue;
		}
		if (name === "text" || name === "mathrm" || name === "operatorname") {
			flush();
			nodes.push({ tag: "mtext", text: readGroup(cursor) });
			continue;
		}
		if (name === "mathbf" || name === "mathit") {
			flush();
			nodes.push({ tag: "mstyle", children: parseLatex(readGroup(cursor)) });
			continue;
		}
		if (name === "left" || name === "right") {
			flush();
			const delimiter = peek(cursor) === "\\" ? (readCommand(cursor) ?? "") : (peek(cursor) ?? "");
			if (peek(cursor) === ".") cursor.index += 1;
			const glyph = delimiter === "{" ? "{" : delimiter === "}" ? "}" : delimiter === "|" ? "|" : delimiter;
			nodes.push({ tag: "mo", text: glyph || "" });
			continue;
		}
		if (name === "quad" || name === "qquad") {
			flush();
			nodes.push({ tag: "mtext", text: "\u2003" });
			continue;
		}
		flush();
		// Unknown command: keep it visible instead of pretending.
		nodes.push({ tag: "mtext", text: `\\${name}` });
	}
	flush();
	return nodes;
}

function skipOptional(cursor: Cursor): string | undefined {
	skipSpace(cursor);
	if (peek(cursor) !== "[") return undefined;
	const end = cursor.text.indexOf("]", cursor.index);
	if (end === -1) return undefined;
	const value = cursor.text.slice(cursor.index + 1, end);
	cursor.index = end + 1;
	return value;
}

/** Build a deterministic tree for `$...$` or `$$...$$` content. */
export function latexToMath(tex: string, display: boolean): MathNode {
	const body = tex.trim();
	if (!body) return { tag: "math", display, children: [{ tag: "mtext", text: tex }] };
	return { tag: "math", display, children: splitTextAndMath(body) };
}

/** Wrap plain characters as identifiers/numbers so MathML lays them out correctly. */
function splitTextAndMath(tex: string): MathNode[] {
	const nodes = parseLatex(tex);
	return nodes.map((node) => {
		if (node.tag !== "mtext") return node;
		const pieces: MathNode[] = [];
		for (const token of node.text.match(/\d+(?:\.\d+)?|[A-Za-z]+|\s+|./gu) ?? []) {
			if (/^\s+$/.test(token)) pieces.push({ tag: "mtext", text: token });
			else if (/^\d/.test(token)) pieces.push({ tag: "mn", text: token });
			else if (/^[A-Za-z]+$/.test(token) && token.length === 1) pieces.push({ tag: "mi", text: token });
			else if (/^[A-Za-z]+$/.test(token)) pieces.push({ tag: "mtext", text: token });
			else pieces.push({ tag: "mo", text: token });
		}
		return { tag: "mrow", children: pieces };
	});
}
