import { validateToolArguments } from "@porcupineai/ai";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolDefinition } from "../extensions/types.ts";
import { adaptiveIssue, adaptiveSchemas } from "./adaptive-schema.ts";
import { prepareDiagramInput } from "./diagram-input.ts";
import { compileMathExpression } from "./math-expression.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { prepareVisualArguments } from "./visual-arguments.ts";

const strict = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
const coordinate = Type.Number({ minimum: -20, maximum: 20 });
const position = Type.Tuple([coordinate, coordinate]);
const dimension = Type.Number({ minimum: 0.05, maximum: 20 });
const color = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" });
const label = Type.Optional(Type.String({ maxLength: 60 }));
const common = {
	title: text(100),
	description: Type.Optional(Type.String({ maxLength: 300 })),
	componentId: Type.Optional(text(80)),
};
const object = Type.Union([
	strict({ type: Type.Literal("rectangle"), position, size: Type.Tuple([dimension, dimension]), color, label }),
	strict({
		type: Type.Literal("circle"),
		position,
		radius: Type.Number({ minimum: 0.05, maximum: 10 }),
		color,
		label,
	}),
	strict({
		type: Type.Union([Type.Literal("arrow"), Type.Literal("line")]),
		from: position,
		to: position,
		color,
		label,
	}),
	strict({ type: Type.Literal("text"), position, text: text(120), color }),
]);
const number = Type.Number({ minimum: -1e12, maximum: 1e12 });
const point = strict({ x: number, y: number, error: Type.Optional(Type.Number({ minimum: 0, maximum: 1e12 })), label });
const schema = Type.Union([
	...adaptiveSchemas,
	strict({
		...common,
		kind: Type.Literal("quiz"),
		questions: Type.Array(
			strict({
				question: text(300),
				options: Type.Array(text(120), { minItems: 2, maxItems: 6 }),
				correctAnswers: Type.Array(Type.Integer({ minimum: 0, maximum: 5 }), {
					minItems: 1,
					maxItems: 6,
					uniqueItems: true,
				}),
				hint: Type.Optional(text(300)),
				explanation: text(1000),
			}),
			{ minItems: 1, maxItems: 100 },
		),
	}),
	strict({
		...common,
		kind: Type.Literal("question"),
		question: text(2000),
		options: Type.Array(text(200), { maxItems: 12 }),
		multiple: Type.Optional(Type.Boolean()),
	}),
	strict({ ...common, kind: Type.Literal("diagram"), objects: Type.Array(object, { minItems: 1, maxItems: 1000 }) }),
	strict({
		...common,
		kind: Type.Literal("chart"),
		chartType: Type.Union([Type.Literal("line"), Type.Literal("scatter"), Type.Literal("bar")]),
		xLabel: text(60),
		yLabel: text(60),
		series: Type.Array(
			Type.Union([
				strict({ name: text(60), color, points: Type.Array(point, { minItems: 1, maxItems: 10000 }) }),
				strict({
					name: text(60),
					color,
					expression: text(1024),
					domain: Type.Tuple([number, number]),
					samples: Type.Integer({ minimum: 2, maximum: 10000 }),
				}),
			]),
			{
				minItems: 1,
				maxItems: 16,
			},
		),
	}),
]);
export type VisualParameters = Static<typeof schema>;
export interface VisualDetails {
	visualization: (
		| Exclude<VisualParameters, { kind: "chart" }>
		| (Omit<Extract<VisualParameters, { kind: "chart" }>, "series"> & {
				series: Array<{ name: string; color: string; points: Static<typeof point>[] }>;
		  })
	) & { version: 2 };
}

export function createVisualizeToolDefinition(): ToolDefinition<typeof schema, VisualDetails> {
	return {
		name: "visualize",
		label: "Visual explanation",
		description:
			"Create an interactive workspace: form, editable table, simulation, linked graph, timeline, weighted comparison, flashcards, evidence, progress, code comparison, motion graphics, question, quiz, 2D diagram or chart. Supply declarative data; users send selections and edits back as session messages. Reuse componentId for updates. For spatial 3D use visualize_3d.",
		promptSnippet: "Explain with 2D diagrams or data-backed charts, including units and uncertainty",
		promptGuidelines: [
			"Use LaTeX delimiters in learning content, questions, explanations and descriptions: \\( ... \\) for inline math, \\[ ... \\] for display math. Write \\lim, \\to and \\frac{numerator}{denominator}, not ASCII lim_{h->0}. Flashcards and timelines accept a limited bare-formula fallback; explicit LaTeX is preferred.",
			"For diagrams prefer canonical primitives: {type:'rectangle',position:[0,0],size:[4,2],color:'#4a90d9',label:'Function'}. Compact boxes with id,x,y,w,h,fill and arrows using node IDs are also accepted; x/y denote centers. Supply a concise title. Do not guess other renderer APIs.",
			"Evidence URLs and confidence are supplied claims, not automatic source verification. Progress must reflect observed runtime evidence; never mark work verified without checks. Code Request apply sends a user request for normal tools and permission policy; the card itself does not write files. Flashcard review and all other workspace state become durable session history when the user presses Send to agent.",
			"Interactive workspaces: form collects typed fields; table supports editing/filtering/selection; graph expands node details; timeline steps through explanations; comparison weights supplied scores; flashcards schedules review; evidence links claims to sources; progress displays evidence and decisions; code compares text; motion animates bounded keyframes. simulation supports linear (slope/intercept), projectile (speed/angle/gravity), oscillator (amplitude/frequency), and expression: model expression with expression {x,y,duration,samples}, using variable t and up to 12 named slider parameters. Arithmetic + - * / ^, constants pi/e, sin/cos/tan, exp/log/sqrt/abs and standard bounded math functions are supported; no JavaScript. Example: x:t, y:exp(-a*t^2)*cos(t). Use those exact parameter names. State units and assumptions. For numerical 1D Schrodinger evolution use model quantum1d with quantum {domain:[-8,8],grid:128,timeStep:0.01,duration:4,potential:x^2/2} and named sliders mass/hbar/center/width/momentum; mass, hbar and width stay positive. Static real potential, Gaussian initial packet, zero endpoint boundaries, scaled units, 64–256 grid points, at most 4000 time steps. Explain assumptions and check convergence. These are bounded models, not a general PDE engine. Finish your turn for user interaction.",
			"For a scored quiz use kind quiz with 1–100 questions (displayed five per page). Flashcards accept up to 500 cards. Each question needs options, zero-based correctAnswers and an explanation; hint is optional. Multiple correctAnswers enable multiple selection. Answers and explanations are shown only after submission; finish your turn to let the user respond.",
			"Supply componentId to give a visual a stable identity. Reuse that ID to update it in place. Question responses include that ID and the question revision so earlier answers remain attached to the correct question.",
			"Use visuals when they clarify the conversation, especially teaching and science. Explain what the visual demonstrates in the description and accompanying answer.",
			"Use labelled arrows, shapes and text for conceptual diagrams; coordinates span -20 to 20, with positive y pointing up. Use line charts for ordered samples, scatter for relationships, and bars for discrete values. Points are drawn in supplied order.",
			"Chart only supplied or explicitly illustrative/synthetic data. Put units in axis labels. error is an absolute symmetric y uncertainty, not a percentage; never invent measurements or uncertainty. Use point labels for categories/annotations and series names for the legend.",
			"No HTML, scripts, URLs, meshes or assets. Max 1000 diagram objects, 16 chart series, 10000 points per series and 40000 total points. For a mathematical chart series supply name, color, expression (variable x), domain:[min,max], samples:2–10000 instead of points; expressions are safely sampled on the server. Singular/nonfinite domains are rejected. Chart tables are paginated with full-data CSV export. Existing visualize_3d supports dense spatial explanations and molecular bonds.",
		],
		parameters: schema,
		prepareArguments: (input) => {
			const args = prepareDiagramInput(prepareVisualArguments(input));
			if (args && typeof args === "object" && "kind" in args) {
				const selected = schema.anyOf.find((member) => member.properties.kind.const === args.kind);
				if (!selected)
					throw new Error(
						`visualize: unsupported kind. Choose ${schema.anyOf.map((member) => member.properties.kind.const).join(", ")}`,
					);
				return validateToolArguments(
					{
						name: `visualize ${String(args.kind)}`,
						description: "Validate selected visual kind",
						parameters: selected,
					},
					{ type: "toolCall", id: "visual-prepare", name: "visualize", arguments: args },
				) as VisualParameters;
			}
			return args as VisualParameters;
		},
		async execute(_id, params) {
			if (!Value.Check(schema, params)) throw new Error("Invalid or unsupported visualization");
			if (params.kind === "chart") {
				if (params.series.reduce((sum, s) => sum + ("points" in s ? s.points.length : s.samples), 0) > 40000)
					throw new Error("Invalid chart: maximum 40000 total samples");
				params = {
					...params,
					series: params.series.map((s) => {
						if ("points" in s) return s;
						if (s.domain[0] >= s.domain[1]) throw new Error("Invalid expression domain");
						const evaluate = compileMathExpression(s.expression, ["x"]);
						return {
							name: s.name,
							color: s.color,
							points: Array.from({ length: s.samples }, (_, i) => {
								const x = s.domain[0] + ((s.domain[1] - s.domain[0]) * i) / (s.samples - 1);
								return { x, y: evaluate({ x }) };
							}),
						};
					}),
				};
			}
			if (
				params.kind === "quiz" &&
				params.questions.some(
					(q) =>
						q.correctAnswers.some((index) => index >= q.options.length) ||
						new Set(q.options).size !== q.options.length,
				)
			)
				throw new Error("Invalid quiz answer key or duplicate options");
			const lines = [params.title, params.description || ""];
			if (
				params.kind !== "quiz" &&
				params.kind !== "question" &&
				params.kind !== "chart" &&
				params.kind !== "diagram"
			) {
				const issue = adaptiveIssue(params);
				if (issue) throw new Error(issue);
				lines.push(
					`Interactive ${params.kind} workspace created. Full specification saved for the GUI.`,
					JSON.stringify(params).slice(0, 4000),
				);
			} else if (params.kind === "quiz") {
				lines.push(
					...params.questions.map((q) => q.question),
					"Wait for the submitted quiz responses before discussing the answer key.",
				);
			} else if (params.kind === "question") {
				lines.push(params.question, ...params.options.map((option, index) => `${index + 1}. ${option}`));
				lines.push(
					"Wait for the user's submitted answer before evaluating it. Do not reveal quiz answers prematurely.",
				);
			} else if (params.kind === "chart") {
				lines.push(`${params.chartType} chart: x = ${params.xLabel}; y = ${params.yLabel}.`);
				for (const series of params.series) {
					if (!("points" in series)) throw new Error("Unresolved chart expression");
					lines.push(
						`${series.name} (${series.points.length} samples; full data in GUI)`,
						...series.points
							.slice(0, 20)
							.map(
								(p) =>
									`(${p.x}, ${p.y})${p.error === undefined ? "" : ` ± ${p.error} y`}${p.label ? `: ${p.label}` : ""}`,
							),
					);
				}
			} else {
				for (const item of params.objects.slice(0, 80)) {
					const name = item.type === "text" ? item.text : item.label || item.type;
					lines.push(
						"from" in item
							? `${name}: ${item.type} from (${item.from}) to (${item.to})`
							: `${name}: ${item.type} at (${item.position})`,
					);
				}
			}
			return {
				content: [{ type: "text", text: lines.filter(Boolean).join("\n") }],
				details: { visualization: { version: 2, ...params } as VisualDetails["visualization"] },
			};
		},
	};
}
export function createVisualizeTool() {
	return wrapToolDefinition(createVisualizeToolDefinition());
}
