/** Public activity descriptions contain no raw commands, logs or tool argument objects. */
export function describeWorkbenchActivity(tool: string, args: unknown): { kind: string; summary: string } {
	const input = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
	const path = input.path ?? input.file_path;
	const file = typeof path === "string" ? path.replaceAll("\\", "/").split("/").pop()?.slice(0, 80) : undefined;
	const query = input.query ?? input.pattern;
	const topic = typeof query === "string" ? query.replace(/\s+/g, " ").trim().slice(0, 80) : "";
	const code =
		/\.(?:[cm]?[jt]sx?|py|rs|go|c|h|cpp|hpp|cc|java|kt|swift|rb|php|sh|sql|css|scss|html|vue|svelte)$/i.test(
			file || "",
		);
	if (tool === "read")
		return file === "SKILL.md"
			? { kind: "skill", summary: "Reading a skill" }
			: { kind: "reading", summary: file ? `Reading ${file}` : "Reading a file" };
	if (tool === "write")
		return { kind: code ? "coding" : "writing", summary: file ? `Writing ${file}` : "Writing a file" };
	if (tool === "edit")
		return { kind: code ? "coding" : "editing", summary: file ? `Editing ${file}` : "Editing a file" };
	if (tool === "web_search") return { kind: "web", summary: topic ? `Searching ${topic}` : "Searching the web" };
	if (tool === "web_extract") return { kind: "reading", summary: "Reading a web page" };
	if (tool === "grep" || tool === "find" || tool === "ls")
		return { kind: "searching", summary: topic ? `Searching ${topic}` : "Exploring the workspace" };
	if (tool === "capability_search") return { kind: "searching", summary: "Finding tools and skills" };
	if (tool === "craft_skill" || tool === "extract_skill") return { kind: "skill", summary: "Preparing a skill" };
	if (tool === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|check|lint)\b/.test(command))
			return { kind: "terminal", summary: "Running checks" };
		if (/\bgit\s+diff\b/.test(command)) return { kind: "terminal", summary: "Reviewing changes" };
		return { kind: "terminal", summary: "Running a command" };
	}
	if (tool === "plan" || tool === "goal")
		return { kind: "planning", summary: tool === "plan" ? "Updating the plan" : "Updating the goal" };
	if (tool.startsWith("browser_")) return { kind: "web", summary: "Working in the browser" };
	if (tool === "visualize" || tool === "visualize_3d")
		return { kind: "writing", summary: "Creating a visual explanation" };
	if (tool === "subagent") return { kind: "spawn", summary: "Starting a subagent" };
	if (tool === "send_to_subagent" || tool === "send_message") return { kind: "sending", summary: "Sending a message" };
	if (tool === "check_messages") return { kind: "receiving", summary: "Checking messages" };
	if (tool === "stop_subagent") return { kind: "stopping", summary: "Stopping subagents" };
	return { kind: "tool", summary: "Using a tool" };
}

export const ACTIVITY_DESCRIPTION_SCRIPT = `const describeWorkbenchActivity=${describeWorkbenchActivity.toString()};`;
