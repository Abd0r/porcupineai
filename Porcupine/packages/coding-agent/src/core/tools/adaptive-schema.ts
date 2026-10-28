import { type Static, Type } from "typebox";

const object = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });
const text = (max = 1000) => Type.String({ minLength: 1, maxLength: max, pattern: "\\S" });
const list = <T extends Parameters<typeof Type.Array>[0]>(item: T, max = 20) =>
	Type.Array(item, { minItems: 1, maxItems: max });
const num = Type.Number({ minimum: -1e9, maximum: 1e9 });
const common = { title: text(100), description: Type.Optional(text(300)), componentId: Type.Optional(text(80)) };
const field = object({
	label: text(80),
	type: Type.Union([Type.Literal("text"), Type.Literal("number"), Type.Literal("choice"), Type.Literal("toggle")]),
	required: Type.Optional(Type.Boolean()),
	options: Type.Optional(list(text(120), 12)),
	min: Type.Optional(num),
	max: Type.Optional(num),
});
export const adaptiveSchemas = [
	object({ ...common, kind: Type.Literal("form"), fields: list(field, 12) }),
	object({
		...common,
		kind: Type.Literal("table"),
		columns: list(text(80), 8),
		rows: list(list(Type.Union([Type.String({ maxLength: 500 }), num]), 8), 100),
		editable: Type.Optional(Type.Boolean()),
	}),
	object({
		...common,
		kind: Type.Literal("simulation"),
		model: Type.Union([Type.Literal("linear"), Type.Literal("projectile"), Type.Literal("oscillator")]),
		parameters: list(
			object({
				name: text(40),
				label: text(80),
				min: num,
				max: num,
				value: num,
				step: Type.Number({ exclusiveMinimum: 0, maximum: 1e6 }),
			}),
			5,
		),
	}),
	object({
		...common,
		kind: Type.Literal("graph"),
		nodes: list(object({ id: text(40), label: text(100), detail: text(2000) }), 40),
		edges: Type.Array(object({ from: text(40), to: text(40), label: Type.Optional(text(100)) }), { maxItems: 80 }),
	}),
	object({
		...common,
		kind: Type.Literal("timeline"),
		steps: list(object({ label: text(100), detail: text(3000) }), 40),
	}),
	object({
		...common,
		kind: Type.Literal("comparison"),
		criteria: list(text(80), 8),
		options: list(
			object({ name: text(100), scores: list(Type.Number({ minimum: 0, maximum: 10 }), 8), detail: text(1000) }),
			12,
		),
	}),
	object({
		...common,
		kind: Type.Literal("flashcards"),
		cards: list(object({ front: text(2000), back: text(3000) }), 40),
	}),
	object({
		...common,
		kind: Type.Literal("evidence"),
		claims: list(
			object({
				claim: text(1000),
				evidence: text(3000),
				source: text(300),
				url: Type.String({ maxLength: 2000, pattern: "^https?://" }),
				confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
			}),
			30,
		),
	}),
	object({
		...common,
		kind: Type.Literal("progress"),
		milestones: list(
			object({
				label: text(200),
				status: Type.Union([
					Type.Literal("pending"),
					Type.Literal("active"),
					Type.Literal("verified"),
					Type.Literal("blocked"),
				]),
				evidence: text(1500),
			}),
			30,
		),
		decisions: Type.Optional(list(text(200), 8)),
	}),
	object({
		...common,
		kind: Type.Literal("code"),
		filename: text(300),
		language: text(40),
		before: Type.String({ maxLength: 30000 }),
		after: Type.String({ maxLength: 30000 }),
	}),
	object({
		...common,
		kind: Type.Literal("motion"),
		duration: Type.Number({ minimum: 1, maximum: 60 }),
		objects: list(
			object({
				type: Type.Union([Type.Literal("circle"), Type.Literal("rectangle"), Type.Literal("text")]),
				label: text(100),
				color: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
				keyframes: list(
					object({
						time: Type.Number({ minimum: 0, maximum: 60 }),
						x: Type.Number({ minimum: 0, maximum: 100 }),
						y: Type.Number({ minimum: 0, maximum: 100 }),
						scale: Type.Number({ minimum: 0.1, maximum: 5 }),
						opacity: Type.Number({ minimum: 0, maximum: 1 }),
						rotation: Type.Number({ minimum: -3600, maximum: 3600 }),
					}),
					20,
				),
			}),
			30,
		),
	}),
] as const;
export const adaptiveSchema = Type.Union([...adaptiveSchemas]);
export type AdaptiveSpec = Static<typeof adaptiveSchema>;

/** Relationships not expressible by the bounded field schemas. Also used by the browser. */
export function adaptiveIssue(spec: AdaptiveSpec): string | undefined {
	if (
		spec.kind === "form" &&
		spec.fields.some(
			(f) =>
				(f.type === "choice" && !f.options?.length) ||
				(f.min !== undefined && f.max !== undefined && f.min > f.max),
		)
	)
		return "Choice fields require options; minimum must not exceed maximum";
	if (spec.kind === "table" && spec.rows.some((row) => row.length !== spec.columns.length))
		return "Every row must match the columns";
	if (spec.kind === "comparison" && spec.options.some((o) => o.scores.length !== spec.criteria.length))
		return "Every option needs one score per criterion";
	if (spec.kind === "graph") {
		const ids = new Set(spec.nodes.map((n) => n.id));
		if (ids.size !== spec.nodes.length || spec.edges.some((e) => !ids.has(e.from) || !ids.has(e.to)))
			return "Graph nodes need unique IDs and edges must reference existing nodes";
	}
	if (spec.kind === "simulation") {
		const required =
			spec.model === "linear"
				? ["slope", "intercept"]
				: spec.model === "projectile"
					? ["speed", "angle", "gravity"]
					: ["amplitude", "frequency"];
		if (
			new Set(spec.parameters.map((p) => p.name)).size !== spec.parameters.length ||
			required.some((name) => !spec.parameters.some((p) => p.name === name)) ||
			spec.parameters.some(
				(p) =>
					p.min >= p.max ||
					p.value < p.min ||
					p.value > p.max ||
					(spec.model === "projectile" && p.name === "gravity" && p.min <= 0),
			)
		)
			return "Invalid simulation parameters: supply named parameters and valid ranges; gravity must be positive";
	}
	if (
		spec.kind === "motion" &&
		spec.objects.some((o) =>
			o.keyframes.some((k, i) => k.time > spec.duration || (i > 0 && k.time <= o.keyframes[i - 1].time)),
		)
	)
		return "Keyframe times must increase and fit the duration";
	return undefined;
}
