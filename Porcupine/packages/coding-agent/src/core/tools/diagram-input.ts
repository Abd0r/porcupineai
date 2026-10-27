type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function point(value: unknown): value is [number, number] {
	return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Convert the documented compact node notation to the renderer's bounded primitives. */
export function prepareDiagramInput(input: unknown): unknown {
	if (!record(input) || input.kind !== "diagram") return input;
	const result = { ...input };
	if (result.title === undefined)
		result.title =
			typeof result.description === "string"
				? result.description
						.split(/[\n:.!?]/)[0]
						.trim()
						.slice(0, 100) || "2D diagram"
				: "2D diagram";
	if (!Array.isArray(result.objects)) return result;
	const nodes = new Map<string, RecordValue>(),
		ids = new Set<string>();
	const objects = result.objects.map((value) => {
		if (!record(value)) return value;
		const item = { ...value };
		if ("id" in item) {
			if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 80 || ids.has(item.id))
				throw new Error("visualize diagram: object IDs must be nonempty and unique");
			ids.add(item.id);
		}
		if (item.type === "box" || (item.type === "rectangle" && item.position === undefined && "x" in item)) {
			item.type = "rectangle";
			if (item.position === undefined) {
				item.position = [item.x, item.y];
				delete item.x;
				delete item.y;
			}
			if (item.size === undefined) {
				item.size = [item.w, item.h];
				delete item.w;
				delete item.h;
			}
		}
		if (item.fill !== undefined) {
			if (item.color !== undefined && item.color !== item.fill)
				throw new Error("visualize diagram: fill and color conflict");
			item.color = item.fill;
			delete item.fill;
		}
		if (item.color === undefined && (item.type === "arrow" || item.type === "line")) item.color = "#75859b";
		if (typeof item.id === "string" && point(item.position)) nodes.set(item.id, item);
		delete item.id;
		return item;
	});
	function center(value: unknown): [number, number] | undefined {
		if (point(value)) return value;
		if (typeof value !== "string") return undefined;
		const node = nodes.get(value);
		if (!node || !point(node.position))
			throw new Error(`visualize diagram: unknown node ID "${value}"; use an existing node ID or [x,y] coordinates`);
		return node.position;
	}
	function endpoint(value: unknown, target: unknown): unknown {
		const origin = center(value),
			toward = center(target);
		if (typeof value !== "string" || !origin || !toward) return origin ?? value;
		const node = nodes.get(value)!,
			dx = toward[0] - origin[0],
			dy = toward[1] - origin[1];
		if (dx === 0 && dy === 0) return origin;
		let scale = 0;
		if (node.type === "rectangle" && point(node.size) && node.size.every((n) => n > 0))
			scale = 1 / Math.max(Math.abs(dx) / (node.size[0] / 2), Math.abs(dy) / (node.size[1] / 2));
		if (node.type === "circle" && typeof node.radius === "number" && Number.isFinite(node.radius) && node.radius > 0)
			scale = node.radius / Math.hypot(dx, dy);
		return [origin[0] + dx * scale, origin[1] + dy * scale];
	}
	result.objects = objects.map((item) =>
		record(item) && (item.type === "arrow" || item.type === "line")
			? { ...item, from: endpoint(item.from, item.to), to: endpoint(item.to, item.from) }
			: item,
	);
	return result;
}
