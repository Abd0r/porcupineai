import { validateToolArguments } from "@porcupineai/ai";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolDefinition } from "../extensions/types.ts";
import { adaptiveIssue, adaptiveSchemas } from "./adaptive-schema.ts";
import { prepareDiagramInput } from "./diagram-input.ts";
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
			{ minItems: 1, maxItems: 6 },
		),
	}),
	strict({
		...common,
		kind: Type.Literal("question"),
		question: text(2000),
		options: Type.Array(text(200), { maxItems: 12 }),
		multiple: Type.Optional(Type.Boolean()),
	}),
	strict({ ...common, kind: Type.Literal("diagram"), objects: Type.Array(object, { minItems: 1, maxItems: 80 }) }),
	strict({
		...common,
		kind: Type.Literal("chart"),
		chartType: Type.Union([Type.Literal("line"), Type.Literal("scatter"), Type.Literal("bar")]),
		xLabel: text(60),
		yLabel: text(60),
		series: Type.Array(strict({ name: text(60), color, points: Type.Array(point, { minItems: 1, maxItems: 200 }) }), {
			minItems: 1,
			maxItems: 8,
		}),
	}),
]);
export type VisualParameters = Static<typeof schema>;
export interface VisualDetails {
	visualization: VisualParameters & { version: 2 };
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
			"Interactive workspaces: form collects typed fields; table supports editing/filtering/selection; graph expands node details; timeline steps through explanations; comparison weights supplied scores; flashcards schedules review; evidence links claims to sources; progress displays evidence and decisions; code compares text; motion animates bounded keyframes. simulation supports linear (slope/intercept), projectile (speed/angle/gravity) and oscillator (amplitude/frequency). Use those exact parameter names. State units and assumptions. These are illustrative calculators, not general scientific solvers. Finish your turn for user interaction.",
			"For a scored quiz use kind quiz with 1–6 questions. Each question needs options, zero-based correctAnswers and an explanation; hint is optional. Multiple correctAnswers enable multiple selection. Answers and explanations are shown only after submission; finish your turn to let the user respond.",
			"Supply componentId to give a visual a stable identity. Reuse that ID to update it in place. Question responses include that ID and the question revision so earlier answers remain attached to the correct question.",
			"Use visuals when they clarify the conversation, especially teaching and science. Explain what the visual demonstrates in the description and accompanying answer.",
			"Use labelled arrows, shapes and text for conceptual diagrams; coordinates span -20 to 20, with positive y pointing up. Use line charts for ordered samples, scatter for relationships, and bars for discrete values. Points are drawn in supplied order.",
			"Chart only supplied or explicitly illustrative/synthetic data. Put units in axis labels. error is an absolute symmetric y uncertainty, not a percentage; never invent measurements or uncertainty. Use point labels for categories/annotations and series names for the legend.",
			"No HTML, executable expressions, scripts, URLs, meshes or assets. Max 80 diagram objects, 8 chart series and 200 points per series. Existing visualize_3d handles spatial explanations.",
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
				lines.push(`Interactive ${params.kind} workspace created.`, JSON.stringify(params));
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
					lines.push(
						series.name,
						...series.points.map(
							(p) =>
								`(${p.x}, ${p.y})${p.error === undefined ? "" : ` ± ${p.error} y`}${p.label ? `: ${p.label}` : ""}`,
						),
					);
				}
			} else {
				for (const item of params.objects) {
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
				details: { visualization: { version: 2, ...params } },
			};
		},
	};
}
export function createVisualizeTool() {
	return wrapToolDefinition(createVisualizeToolDefinition());
}
