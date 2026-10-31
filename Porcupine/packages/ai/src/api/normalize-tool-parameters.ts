/**
 * Normalise a tool parameter schema into a shape OpenAI-compatible providers accept.
 *
 * TypeBox emits draft-07 JSON Schema, where a tuple is `{ type: "array", items: [a, b] }`. Some providers
 * validate `items` against "boolean or object" and reject the array form outright:
 *
 *   Invalid schema for function 'visualize': [{"minimum":-20,"maximum":20,"type":"number"}, ...]
 *   is not of types "boolean", "object"
 *
 * The 2020-12 spelling of the same constraint is `prefixItems: [a, b]` with `items: false`, which is also
 * valid draft-07 (`items` may be a boolean there) and is ignored rather than rejected by validators that do
 * not know the keyword. Converting one into the other keeps the tuple's meaning and satisfies both.
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
			// draft-07 positional tuple: items becomes prefixItems, and items may then only be a boolean
			output.prefixItems = (source.items as unknown[]).map(normalizeNode);
			output.items = false;
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
