import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { normalizeToolParameters } from "../src/api/normalize-tool-parameters.ts";

// Regression guard for a provider rejection seen in real use:
//   Invalid schema for function 'visualize': [{"minimum":-20,"maximum":20,"type":"number"}, ...]
//   is not of types "boolean", "object"
// Some provider schema validators require `items` to be a boolean or an object.

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
	it("accepts valid coordinates without draft-2020-12 tuple keywords", () => {
		const normalized = normalizeToolParameters({
			type: "object",
			properties: {
				position: Type.Tuple([
					Type.Number({ minimum: -20, maximum: 20 }),
					Type.Number({ minimum: -20, maximum: 20 }),
				]),
			},
			required: ["position"],
		});
		const position = (normalized.properties as Record<string, Record<string, unknown>>).position;
		const schema = Type.Unsafe(normalized);
		expect(Value.Check(schema, { position: [0, 1] })).toBe(true);
		expect(Value.Check(schema, { position: [0, 21] })).toBe(false);
		expect(Value.Check(schema, { position: [0] })).toBe(false);
		expect(Value.Check(schema, { position: [0, 1, 2] })).toBe(false);
		expect(position.items).toEqual({ type: "number", minimum: -20, maximum: 20 });
		expect(position.prefixItems).toBeUndefined();
		// nothing may be left in the array form anywhere in the schema
		expect(collectItems(normalized).some(Array.isArray)).toBe(false);
	});

	it("advertises both types for heterogeneous tuples and preserves their length", () => {
		const original = Type.Tuple([Type.Number(), Type.String()]);
		const schema = Type.Unsafe(normalizeToolParameters(original));
		expect(Value.Check(schema, [2, "label"])).toBe(true);
		expect(Value.Check(schema, [2, false])).toBe(false);
		expect(Value.Check(schema, [2, "label", 3])).toBe(false);
		expect(Value.Check(original, ["label", 2])).toBe(false);
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
