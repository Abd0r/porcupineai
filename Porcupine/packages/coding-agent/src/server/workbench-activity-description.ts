/** Public activity descriptions contain no raw commands, logs or tool argument objects. */
export function describeWorkbenchActivity(tool: string, args: unknown): { kind: string; summary: string } {
	const input = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
	const path = input.path ?? input.file_path;
	const file = typeof path === "string" ? path.replaceAll("\\", "/").split("/").pop()?.slice(0, 80) : undefined;
	const query = input.query ?? input.pattern;
	const topic = typeof query === "string" ? query.replace(/\s+/g, " ").trim().slice(0, 80) : "";
	if (tool === "read") return { kind: "reading", summary: file ? `Reading ${file}` : "Reading a file" };
	if (tool === "write") return { kind: "writing", summary: file ? `Writing ${file}` : "Writing a file" };
	if (tool === "edit") return { kind: "editing", summary: file ? `Editing ${file}` : "Editing a file" };
	if (tool === "web_search") return { kind: "web", summary: topic ? `Searching ${topic}` : "Searching the web" };
	if (tool === "web_extract") return { kind: "reading", summary: "Reading a web page" };
	if (tool === "grep" || tool === "find" || tool === "ls")
		return { kind: "reading", summary: topic ? `Searching ${topic}` : "Exploring the workspace" };
	if (tool === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|check|lint)\b/.test(command))
			return { kind: "terminal", summary: "Running checks" };
		if (/\bgit\s+diff\b/.test(command)) return { kind: "terminal", summary: "Reviewing changes" };
		return { kind: "terminal", summary: "Running a command" };
	}
	if (tool === "plan" || tool === "goal")
		return { kind: "editing", summary: tool === "plan" ? "Updating the plan" : "Updating the goal" };
	if (tool.startsWith("browser_")) return { kind: "web", summary: "Working in the browser" };
	if (tool === "visualize" || tool === "visualize_3d")
		return { kind: "writing", summary: "Creating a visual explanation" };
	if (tool === "subagent") return { kind: "dreaming", summary: "Delegating a task" };
	return { kind: "reasoning", summary: "Working on the task" };
}

export const ACTIVITY_DESCRIPTION_SCRIPT = `const describeWorkbenchActivity=${describeWorkbenchActivity.toString()};`;
