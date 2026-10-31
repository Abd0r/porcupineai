/** Bounded arithmetic parser shared with the GUI. Never evaluates JavaScript. */
export function compileMathExpression(source: string, variables: string[]): (values: Record<string, number>) => number {
	if (typeof source !== "string" || source.length > 1024) throw new Error("Invalid mathematical expression");
	const tokens: string[] = [];
	const lexer =
		/\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|([+\-*/^(),]))/gy;
	let offset = 0;
	while (offset < source.trimEnd().length) {
		lexer.lastIndex = offset;
		const match = lexer.exec(source);
		if (!match) throw new Error("Unsupported expression syntax");
		tokens.push(match[1] || match[2] || match[3]);
		offset = lexer.lastIndex;
		if (tokens.length > 512) throw new Error("Expression is too complex");
	}
	const functions: Record<string, { arity: number; call: (...args: number[]) => number }> = {
		sin: { arity: 1, call: Math.sin },
		cos: { arity: 1, call: Math.cos },
		tan: { arity: 1, call: Math.tan },
		asin: { arity: 1, call: Math.asin },
		acos: { arity: 1, call: Math.acos },
		atan: { arity: 1, call: Math.atan },
		atan2: { arity: 2, call: Math.atan2 },
		exp: { arity: 1, call: Math.exp },
		log: { arity: 1, call: Math.log },
		log10: { arity: 1, call: Math.log10 },
		sqrt: { arity: 1, call: Math.sqrt },
		abs: { arity: 1, call: Math.abs },
		floor: { arity: 1, call: Math.floor },
		ceil: { arity: 1, call: Math.ceil },
		min: { arity: 2, call: Math.min },
		max: { arity: 2, call: Math.max },
		pow: { arity: 2, call: Math.pow },
		sinh: { arity: 1, call: Math.sinh },
		cosh: { arity: 1, call: Math.cosh },
		tanh: { arity: 1, call: Math.tanh },
	};
	type Node = (values: Record<string, number>) => number;
	let cursor = 0,
		depth = 0;
	function expression(minimum = 0): Node {
		if (++depth > 32) throw new Error("Expression is too deeply nested");
		const token = tokens[cursor++];
		let left: Node;
		if (token === "+" || token === "-") {
			const right = expression(3);
			left = (values) => (token === "-" ? -right(values) : right(values));
		} else if (token === "(") {
			left = expression();
			if (tokens[cursor++] !== ")") throw new Error("Unclosed expression");
		} else if (token !== undefined && /^(?:\d|\.)/.test(token)) {
			const number = Number(token);
			if (!Number.isFinite(number)) throw new Error("Invalid number");
			left = () => number;
		} else if (token === "pi" || token === "e") {
			left = () => (token === "pi" ? Math.PI : Math.E);
		} else if (token && Object.hasOwn(functions, token) && tokens[cursor] === "(") {
			cursor++;
			const args: Node[] = [expression()];
			while (tokens[cursor] === ",") {
				cursor++;
				args.push(expression());
			}
			if (tokens[cursor++] !== ")" || args.length !== functions[token].arity)
				throw new Error("Invalid function arguments");
			left = (values) => functions[token].call(...args.map((arg) => arg(values)));
		} else if (token && variables.includes(token)) {
			left = (values) => (Object.hasOwn(values, token) ? values[token] : NaN);
		} else throw new Error(`Unknown mathematical name: ${String(token)}`);
		const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
		while (cursor < tokens.length) {
			const op = tokens[cursor],
				rank = precedence[op];
			if (!rank || rank < minimum) break;
			cursor++;
			const a = left,
				b = expression(op === "^" ? rank : rank + 1);
			left = (values) => {
				const x = a(values),
					y = b(values);
				return op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : x ** y;
			};
		}
		depth--;
		return left;
	}
	const root = expression();
	if (cursor !== tokens.length) throw new Error("Unexpected expression token");
	return (values) => {
		const result = root(values);
		if (!Number.isFinite(result) || Math.abs(result) > 1e12)
			throw new Error("Expression is outside its finite plotting domain");
		return result;
	};
}
