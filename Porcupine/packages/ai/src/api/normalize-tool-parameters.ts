/**
 * Normalise a tool parameter schema into a shape OpenAI-compatible providers accept.
 *
 * TypeBox emits draft-07 JSON Schema, where a tuple is `{ type: "array", items: [a, b] }`. Some providers
 * validate `items` against "boolean or object" and reject the array form outright:
 *
 *   Invalid schema for function 'visualize': [{"minimum":-20,"maximum":20,"type":"number"}, ...]
 *   is not of types "boolean", "object"
 *
 * Use a single item schema instead of positional keywords: in draft-07, `items: false` with an
 * ignored `prefixItems` rejects every nonempty array. Homogeneous tuples keep their item constraints
 * exactly; heterogeneous tuples advertise the union, while local tool validation still checks positions.
 *
 * The coercion to `type: "object"` for a union of object members is separate: some validators require an
 * explicit type even when every branch already declares one.
 */
export function normalizeToolParameters(schema: unknown): Record<string, unknown> {
	const normalizeNode = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(normalizeNode);
		if (!node || typeof node !== "object") return node;

		const source = node as Record<string, unknown>;
		const output: Record<string, unknown> = { ...source };

		if (Array.isArray(source.items)) {
			const items = source.items.map(normalizeNode);
			if (source.additionalItems === false) {
				output.maxItems =
					typeof source.maxItems === "number" ? Math.min(source.maxItems, items.length) : items.length;
			} else if (typeof source.maxItems !== "number" || source.maxItems > items.length) {
				items.push(normalizeNode(source.additionalItems ?? true));
			}
			delete output.additionalItems;
			const alternatives = [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
			output.items = alternatives.includes(true)
				? {}
				: alternatives.length <= 1
					? (alternatives[0] ?? false)
					: { anyOf: alternatives };
		} else if (source.items !== undefined) {
			output.items = normalizeNode(source.items);
		}
		if (Array.isArray(source.prefixItems)) {
			output.prefixItems = (source.prefixItems as unknown[]).map(normalizeNode);
		}

		for (const key of ["anyOf", "oneOf", "allOf"]) {
			const members = source[key];
			if (Array.isArray(members)) output[key] = members.map(normalizeNode);
		}

		if (source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)) {
			const properties: Record<string, unknown> = {};
			for (const [name, value] of Object.entries(source.properties as Record<string, unknown>)) {
				properties[name] = normalizeNode(value);
			}
			output.properties = properties;
		}

		if (source.additionalProperties && typeof source.additionalProperties === "object") {
			output.additionalProperties = normalizeNode(source.additionalProperties);
		}

		const union = (output.anyOf ?? output.oneOf) as Record<string, unknown>[] | undefined;
		if (
			output.type === undefined &&
			Array.isArray(union) &&
			union.length > 0 &&
			union.every((member) => member && typeof member === "object" && member.type === "object")
		) {
			output.type = "object";
		}

		return output;
	};

	const normalized = normalizeNode(schema);
	if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
		return { type: "object", properties: {} };
	}
	return normalized as Record<string, unknown>;
}
