export const workspaceExamples = [
	{
		kind: "form",
		fields: [
			{ label: "Name", type: "text", required: true },
			{ label: "Budget", type: "number", min: 0, max: 10 },
			{ label: "Theme", type: "choice", options: ["Dark", "Light"] },
		],
	},
	{
		kind: "table",
		columns: ["Name", "Value"],
		rows: [
			["Beta", 2],
			["Alpha", 1],
		],
		editable: true,
	},
	{
		kind: "simulation",
		model: "linear",
		parameters: [
			{ name: "slope", label: "Slope", min: -5, max: 5, value: 1, step: 0.1 },
			{ name: "intercept", label: "Intercept", min: -5, max: 5, value: 0, step: 0.1 },
		],
	},
	{
		kind: "graph",
		nodes: [
			{ id: "a", label: "Input", detail: "Input data" },
			{ id: "b", label: "Output", detail: "Output result" },
		],
		edges: [{ from: "a", to: "b", label: "Produces" }],
	},
	{
		kind: "timeline",
		steps: [
			{ label: "Start", detail: "First step" },
			{ label: "Finish", detail: "Second step" },
		],
	},
	{
		kind: "comparison",
		criteria: ["Speed", "Cost"],
		options: [
			{ name: "A", scores: [9, 2], detail: "Fast" },
			{ name: "B", scores: [2, 9], detail: "Affordable" },
		],
	},
	{ kind: "flashcards", cards: [{ front: "Force equation?", back: "$F=ma$" }] },
	{
		kind: "evidence",
		claims: [
			{
				claim: "Example claim",
				evidence: "Supporting observation",
				source: "Example",
				url: "https://example.com",
				confidence: "low",
			},
		],
	},
	{
		kind: "progress",
		milestones: [{ label: "Verify", status: "active", evidence: "Checks pending" }],
		decisions: ["Proceed", "Revise"],
	},
	{ kind: "code", filename: "example.ts", language: "ts", before: "let x = 1;", after: "let x = 2;" },
	{
		kind: "motion",
		duration: 2,
		objects: [
			{
				type: "circle",
				label: "Particle",
				color: "#88aaee",
				keyframes: [
					{ time: 0, x: 10, y: 50, scale: 1, opacity: 1, rotation: 0 },
					{ time: 2, x: 90, y: 50, scale: 1, opacity: 1, rotation: 0 },
				],
			},
		],
	},
];
