const arrayKeys = new Set([
	"objects",
	"series",
	"points",
	"position",
	"domain",
	"from",
	"to",
	"size",
	"options",
	"questions",
	"correctAnswers",
	"fields",
	"columns",
	"rows",
	"parameters",
	"nodes",
	"edges",
	"steps",
	"criteria",
	"scores",
	"cards",
	"claims",
	"milestones",
	"decisions",
	"keyframes",
]);

/** Some providers encode array-valued arguments as JSON strings. Decode only known array slots. */
export function prepareVisualArguments(input: unknown, depth = 0): unknown {
	if (depth > 8) return input;
	if (Array.isArray(input)) return input.map((value) => prepareVisualArguments(value, depth + 1));
	if (!input || typeof input !== "object") return input;
	return Object.fromEntries(
		Object.entries(input).map(([key, original]) => {
			let value: unknown = original;
			if (arrayKeys.has(key) && typeof value === "string" && value.length <= 8 * 1024 * 1024) {
				try {
					const decoded: unknown = JSON.parse(value);
					if (Array.isArray(decoded)) value = decoded;
				} catch {}
			}
			return [key, prepareVisualArguments(value, depth + 1)];
		}),
	);
}
