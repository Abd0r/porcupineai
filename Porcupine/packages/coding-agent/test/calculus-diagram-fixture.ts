export const calculusDiagram = {
	description:
		"Conceptual map of calculus: a function f(x) connects to its derivative (rate of change / slope) via differentiation, and to its integral (accumulation / area) via integration. The Fundamental Theorem of Calculus ties them together as inverses.",
	kind: "diagram",
	objects: JSON.stringify([
		{ id: "f", type: "box", x: 0, y: 0, w: 4, h: 2, label: "f(x)\nfunction", fill: "#4a90d9" },
		{ id: "d", type: "box", x: -8, y: -6, w: 4, h: 2, label: "f'(x)\nderivative\n(slope / rate)", fill: "#e06c75" },
		{ id: "i", type: "box", x: 8, y: -6, w: 4, h: 2, label: "∫ f(x) dx\nintegral\n(area / total)", fill: "#98c379" },
		{ id: "lim", type: "box", x: 0, y: 6, w: 5, h: 2, label: "limits\n(approximation → exact)", fill: "#c678dd" },
		{ id: "arrow1", type: "arrow", from: "f", to: "d", label: "differentiate" },
		{ id: "arrow2", type: "arrow", from: "f", to: "i", label: "integrate" },
		{ id: "arrow3", type: "arrow", from: "d", to: "i", label: "FTC: inverse operations" },
		{ id: "arrow4", type: "arrow", from: "lim", to: "f", label: "foundation" },
	]),
};
