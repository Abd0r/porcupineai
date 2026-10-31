import { describe, expect, it } from "vitest";
import { normalizeToolParameters } from "../src/api/normalize-tool-parameters.ts";

// Regression guard for a provider rejection seen in real use:
//   Invalid schema for function 'visualize': [{"minimum":-20,"maximum":20,"type":"number"}, ...]
//   is not of types "boolean", "object"
// TypeBox emits draft-07 tuples as `items: [a, b]`; OpenAI-compatible validators require `items` to be a
// boolean or an object, so the array form has to become `prefixItems` with `items: false`.

function collectItems(node: unknown, found: unknown[] = []): unknown[] {
	if (!node || typeof node !== "object") return found;
	if (Array.isArray(node)) {
		for (const entry of node) collectItems(entry, found);
		return found;
	}
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		if (key === "items") found.push(value);
		collectItems(value, found);
	}
	return found;
}

describe("normalizeToolParameters", () => {
	it("converts a draft-07 tuple into prefixItems with a boolean items", () => {
		const normalized = normalizeToolParameters({
			type: "object",
			properties: {
				position: {
					type: "array",
					items: [
						{ type: "number", minimum: -20, maximum: 20 },
						{ type: "number", minimum: -20, maximum: 20 },
					],
				},
			},
			required: ["position"],
		});
		const position = (normalized.properties as Record<string, Record<string, unknown>>).position;
		expect(position.items).toBe(false);
		expect(position.prefixItems).toEqual([
			{ type: "number", minimum: -20, maximum: 20 },
			{ type: "number", minimum: -20, maximum: 20 },
		]);
		// nothing may be left in the array form anywhere in the schema
		expect(collectItems(normalized).some(Array.isArray)).toBe(false);
	});

	it("leaves a homogeneous array untouched", () => {
		const normalized = normalizeToolParameters({
			type: "object",
			properties: { names: { type: "array", items: { type: "string" } } },
		});
		const names = (normalized.properties as Record<string, Record<string, unknown>>).names;
		expect(names.items).toEqual({ type: "string" });
		expect(names.prefixItems).toBeUndefined();
	});

	it("normalises tuples nested inside a union", () => {
		const normalized = normalizeToolParameters({
			anyOf: [
				{
					type: "object",
					properties: { point: { type: "array", items: [{ type: "number" }, { type: "number" }] } },
				},
				{ type: "object", properties: { label: { type: "string" } } },
			],
		});
		expect(collectItems(normalized).some(Array.isArray)).toBe(false);
	});

	it("declares an explicit object type for a union of object members", () => {
		const normalized = normalizeToolParameters({
			anyOf: [
				{ type: "object", properties: {} },
				{ type: "object", properties: {} },
			],
		});
		expect(normalized.type).toBe("object");
	});

	it("returns a usable empty object schema for rubbish input", () => {
		expect(normalizeToolParameters(null)).toEqual({ type: "object", properties: {} });
		expect(normalizeToolParameters([1, 2])).toEqual({ type: "object", properties: {} });
	});
});
