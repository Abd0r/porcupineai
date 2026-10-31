import { type Static, Type } from "typebox";
import { compileMathExpression } from "./math-expression.ts";
import { createQuantumSimulation } from "./quantum-simulation.ts";

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
		model: Type.Union([
			Type.Literal("linear"),
			Type.Literal("projectile"),
			Type.Literal("oscillator"),
			Type.Literal("expression"),
			Type.Literal("quantum1d"),
		]),
		quantum: Type.Optional(
			object({
				domain: Type.Tuple([
					Type.Number({ minimum: -20, maximum: 20 }),
					Type.Number({ minimum: -20, maximum: 20 }),
				]),
				grid: Type.Integer({ minimum: 64, maximum: 256 }),
				timeStep: Type.Number({ minimum: 0.0001, maximum: 0.02 }),
				duration: Type.Number({ minimum: 0.01, maximum: 10 }),
				potential: text(1024),
			}),
		),
		expression: Type.Optional(
			object({
				x: text(1024),
				y: text(1024),
				duration: Type.Number({ minimum: 0.01, maximum: 3600 }),
				samples: Type.Integer({ minimum: 2, maximum: 2000 }),
			}),
		),
		parameters: Type.Array(
			object({
				name: text(40),
				label: text(80),
				min: num,
				max: num,
				value: num,
				step: Type.Number({ exclusiveMinimum: 0, maximum: 1e6 }),
			}),
			{ minItems: 0, maxItems: 12 },
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
		cards: list(object({ front: text(2000), back: text(3000) }), 500),
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
export function adaptiveIssue(
	spec: AdaptiveSpec,
	compileExpression = compileMathExpression,
	quantumSimulation = createQuantumSimulation,
): string | undefined {
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
		if (spec.model === "quantum1d") {
			const q = spec.quantum,
				names = spec.parameters.map((p) => p.name),
				p = Object.fromEntries(spec.parameters.map((p) => [p.name, p.value]));
			if (!q || q.domain[0] >= q.domain[1] || Math.ceil(q.duration / q.timeStep) > 4000 || spec.expression)
				return "Quantum models need a valid domain and at most 4000 time steps";
			if (
				names.some((name) => !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || ["x", "pi", "e"].includes(name)) ||
				["mass", "hbar", "width"].some((name) => !spec.parameters.some((p) => p.name === name && p.min > 0))
			)
				return "Quantum mass, hbar and width must stay positive";
			try {
				const potential = compileExpression(q.potential, ["x", ...names]);
				quantumSimulation({
					...q,
					mass: p.mass,
					hbar: p.hbar,
					center: p.center,
					width: p.width,
					momentum: p.momentum,
					potential: (x) => potential({ ...p, x }),
				});
			} catch (error) {
				return error instanceof Error ? error.message : "Invalid quantum model";
			}
		} else if (spec.quantum) return "Quantum settings require model quantum1d";
		if (spec.model === "expression") {
			if (!spec.expression) return "Expression simulations require x, y, duration and samples";
			const names = spec.parameters.map((p) => p.name);
			if (names.some((name) => !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || ["t", "pi", "e"].includes(name)))
				return "Invalid expression parameter name";
			try {
				compileExpression(spec.expression.x, ["t", ...names]);
				compileExpression(spec.expression.y, ["t", ...names]);
			} catch (error) {
				return error instanceof Error ? error.message : "Invalid expression";
			}
		} else if (spec.expression) return "Expressions require the expression model";
		const required =
			spec.model === "quantum1d"
				? ["mass", "hbar", "center", "width", "momentum"]
				: spec.model === "expression"
					? []
					: spec.model === "linear"
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
