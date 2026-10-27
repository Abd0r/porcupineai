import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const strict = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
const coordinate = Type.Number({ minimum: -20, maximum: 20 });
const position = Type.Tuple([coordinate, coordinate]);
const dimension = Type.Number({ minimum: 0.05, maximum: 20 });
const color = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" });
const label = Type.Optional(Type.String({ maxLength: 60 }));
const common = { title: text(100), description: Type.Optional(Type.String({ maxLength: 300 })) };
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
			"Present an interactive question, bounded 2D diagram or line/scatter/bar chart. For question cards supply question and options (empty for a written answer); multiple allows several choices. The user submits their answer as a normal conversation message after your turn. Supply declarative data, never scripts or external assets. For spatial 3D scenes use visualize_3d.",
		promptSnippet: "Explain with 2D diagrams or data-backed charts, including units and uncertainty",
		promptGuidelines: [
			"Use visuals when they clarify the conversation, especially teaching and science. Explain what the visual demonstrates in the description and accompanying answer.",
			"Use labelled arrows, shapes and text for conceptual diagrams; coordinates span -20 to 20, with positive y pointing up. Use line charts for ordered samples, scatter for relationships, and bars for discrete values. Points are drawn in supplied order.",
			"Chart only supplied or explicitly illustrative/synthetic data. Put units in axis labels. error is an absolute symmetric y uncertainty, not a percentage; never invent measurements or uncertainty. Use point labels for categories/annotations and series names for the legend.",
			"No HTML, executable expressions, scripts, URLs, meshes or assets. Max 80 diagram objects, 8 chart series and 200 points per series. Existing visualize_3d handles spatial explanations.",
		],
		parameters: schema,
		async execute(_id, params) {
			if (!Value.Check(schema, params)) throw new Error("Invalid or unsupported visualization");
			const lines = [params.title, params.description || ""];
			if (params.kind === "question") {
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
