/**
 * Surface-aware context.
 *
 * Porcupine runs in two clients: the terminal (TUI) and the browser workbench
 * (GUI). They do not render the same things, so the model must know which one is
 * in front of the user before choosing how to answer. This block is appended to
 * the system prompt, is short by design, and states only capabilities that exist.
 */

export type ClientSurface = "tui" | "web" | "none";

export const SURFACE_CONTEXT_HEADER = "## Active surface";

const SHARED = [
	"Tools, sessions, approvals and interruption behave identically on both surfaces. Never claim a capability the active surface does not have.",
	"`goal` (your tracked objective with steps) and `plan` (your checklist) are available on both. The client renders them; it never proves them for you.",
];

const TUI: readonly string[] = [
	"You are running in the terminal client (TUI).",
	"Text and ANSI styling only: no images, canvas, charts or interactive 3D. Do not call `visualize` or `visualize_3d` here; describe the relationship in prose, a compact table, or an ASCII sketch instead.",
	"Tables render as plain monospace text. Keep them narrow enough for a typical 100-column terminal.",
	"Long output scrolls in the terminal; prefer short answers with a clear next action.",
	"Goal and plan state are shown in the footer and status line, not in a side panel.",
];

const WEB: readonly string[] = [
	"You are running in the browser workbench (GUI).",
	"Visual expression is available: call `visualize` for bounded 2D diagrams or line/scatter/bar charts with axes, units, point labels and optional symmetric y uncertainty, and `visualize_3d` for interactive spatial scenes. Charts also render a full-precision accessible data table.",
	"Use a visual when it clarifies rather than decorates. State whether data is measured or illustrative, and never invent uncertainty.",
	"The sidebar shows your tracked goal and its steps, a Plan-fence indicator, live Skills and Tools, and Project documents. The composer shows the model, reasoning mode and autonomy mode.",
	"Users can edit allowlisted context files, upload documents to a Project, and choose a theme. None of these change your permissions, and edits to context apply to future turns.",
	"Code blocks and formulas are rendered as text; do not assume typeset LaTeX or a math renderer yet.",
];

const NONE: readonly string[] = [
	"No interactive client is attached right now. The session may still be driven over the API.",
	"Write output that survives being logged: complete sentences, no reliance on colour, layout or interaction.",
	"Do not call `visualize` or `visualize_3d` with nobody attached; they cost tokens and render nowhere.",
];

/**
 * Prompt block describing the active client. Deterministic so prompt caching
 * stays effective and the same surface always produces the same wording.
 */
export function buildSurfaceContext(surface: ClientSurface): string {
	const body = surface === "web" ? WEB : surface === "none" ? NONE : TUI;
	const lines = [
		SURFACE_CONTEXT_HEADER,
		"",
		...body,
		"",
		"The user can switch clients at any time, even while you work. When that happens you receive a [Surface switch] notice stating which client is now active; re-read the capabilities above before answering.",
		"",
		"Shared:",
		...SHARED.map((line) => `- ${line}`),
	];
	return lines.join("\n");
}
