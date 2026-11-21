import type { TextContent } from "@porcupineai/ai";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { prepareVisualArguments } from "./visual-arguments.ts";

const CoordinateSchema = Type.Number({ minimum: -20, maximum: 20 });
const PositionSchema = Type.Tuple([CoordinateSchema, CoordinateSchema, CoordinateSchema], {
	description: "World-space x, y, z coordinates in a bounded range from -20 to 20.",
});
const SizeSchema = Type.Tuple(
	[
		Type.Number({ minimum: 0.05, maximum: 20 }),
		Type.Number({ minimum: 0.05, maximum: 20 }),
		Type.Number({ minimum: 0.05, maximum: 20 }),
	],
	{ description: "Positive box dimensions along x, y, z." },
);
const ColorSchema = Type.String({ pattern: "^#[0-9A-Fa-f]{6}$", description: "Solid color as #RRGGBB." });
const LabelSchema = Type.Optional(Type.String({ maxLength: 60 }));
const StrictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

const BoxSchema = StrictObject({
	type: Type.Literal("box"),
	position: PositionSchema,
	size: SizeSchema,
	color: ColorSchema,
	label: LabelSchema,
});
const SphereSchema = StrictObject({
	type: Type.Literal("sphere"),
	position: PositionSchema,
	radius: Type.Number({ minimum: 0.05, maximum: 10 }),
	color: ColorSchema,
	label: LabelSchema,
});
const ArrowSchema = StrictObject({
	type: Type.Literal("arrow"),
	from: PositionSchema,
	to: PositionSchema,
	color: ColorSchema,
	label: LabelSchema,
});
const BondSchema = StrictObject({
	type: Type.Literal("bond"),
	from: PositionSchema,
	to: PositionSchema,
	radius: Type.Number({ minimum: 0.02, maximum: 2 }),
	color: ColorSchema,
	label: LabelSchema,
});
const ObjectSchema = Type.Union([BoxSchema, SphereSchema, ArrowSchema, BondSchema]);

const VisualizationParametersSchema = StrictObject({
	title: Type.String({ minLength: 1, maxLength: 100 }),
	description: Type.Optional(Type.String({ maxLength: 300 })),
	objects: Type.Array(ObjectSchema, { minItems: 1, maxItems: 2000 }),
});

export type VisualizationObject = Static<typeof ObjectSchema>;
export type VisualizationParameters = Static<typeof VisualizationParametersSchema>;
export interface VisualizationDetails {
	visualization?: {
		version: 1;
		title: string;
		description?: string;
		objects: VisualizationObject[];
	};
}

export function createVisualize3DToolDefinition(): ToolDefinition<
	typeof VisualizationParametersSchema,
	VisualizationDetails
> {
	return {
		name: "visualize_3d",
		label: "3D visualization",
		description:
			"Present an interactive 3D diagram using bounded boxes, spheres, arrows, and molecular bonds. Use this when spatial structure clarifies the answer; prefer text or a chart for non-spatial information. This tool renders a declarative scene and cannot run code or load external assets.",
		promptSnippet: "Present a safe interactive 3D scene when spatial structure helps",
		promptGuidelines: [
			"Call visualize_3d only when a 3D spatial view materially improves understanding; do not add decorative scenes.",
			"Use a concise title, explain the important relationship, and keep the scene to the fewest clear objects. Up to 2000 objects are supported for dense molecular scenes: atoms are spheres; bonds use {type:bond,from:[x,y,z],to:[x,y,z],radius:0.02–2,color:#RRGGBB}. Use verified coordinates, name the source and units; the tool does not infer chemical geometry. Avoid labelling every atom in a dense scene.",
			"Coordinates and box dimensions are bounded to 20 units; colors must be #RRGGBB. No meshes, scripts, URLs, or external assets are supported.",
		],
		parameters: VisualizationParametersSchema,
		prepareArguments: (input) => prepareVisualArguments(input) as VisualizationParameters,
		async execute(_toolCallId, params): Promise<{ content: TextContent[]; details: VisualizationDetails }> {
			if (!Value.Check(VisualizationParametersSchema, params) || !params.title.trim()) {
				throw new Error("Invalid or unsupported 3D scene");
			}
			const visualization = {
				version: 1 as const,
				title: params.title.trim(),
				...(params.description?.trim() ? { description: params.description.trim() } : {}),
				objects: params.objects,
			};
			return {
				content: [{ type: "text", text: `Validated 3D scene specification: ${visualization.title}` }],
				details: { visualization },
			};
		},
	};
}

export function createVisualize3DTool() {
	return wrapToolDefinition(createVisualize3DToolDefinition());
}
