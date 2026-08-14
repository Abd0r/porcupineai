# Skill Crafting

Porcupine can turn a document or a research topic into a real, reusable capability. Two commands drive this, plus two agent tools.

- `/extract-stack <path> [--name <n>] [--stack <s>] [--tool]` - distill an existing document into a skill.
- `/craft-stack <name> --desc <description> [--stack <s>] [--tool]` - deep-research a topic, then build a skill.
- `extract_skill` / `craft_skill` - the equivalent agent tools.

## Skill vs Tool

Both commands can produce two kinds of output:

- **Skill** (default): a `SKILL.md` the agent follows - a procedure, checklist, or reference.
- **Tool**: a callable shell entry persisted to `user-tools.json`, registered as a tool next session.

For `extract-stack`, the kind is auto-detected: command/runbook-oriented documents default to a Tool, otherwise a Skill. Override with the `--tool` flag (or `--skill` to force a Skill). For `craft-stack`, pass `--tool` to make a Tool.

## Where skills are written

- **Skills** go to `agentDir/skills/<stack>/<name>/SKILL.md` (e.g. `~/.porcupine/agent/skills/web/my-search/SKILL.md`). They are discovered at startup and listed in `<available_skills>`; a direct Skill can be invoked instantly via `/skill:<name>`.
- **Tools** go to `agentDir/user-tools.json`. Records are mapped to `ToolDefinition`s at session bootstrap and registered through `customTools`, so they become callable next session.

Generated capabilities follow the standard frontmatter: `name`, `description`, `stack`. Names and stacks must be lowercase `a-z`, `0-9`, and hyphens only. An existing user skill is never overwritten unless you pass `--force`.

## Examples

```bash
/extract-stack runbook.md --stack shell --name deploy --tool
/craft-stack vite-build --desc "How to configure a production Vite build" --stack build
```

## Details

- Extraction reads `.md`/`.txt` natively and `.pdf` via `pdftotext` (install poppler: `brew install poppler`).
- Crafting uses the free web search cascade (SearXNG → Websurfx → DDGS → Brave → DuckDuckGo → Wikipedia → Mojeek) and extracts top hits into source notes before writing. Pre-gathered research can be passed instead of re-searching.
- See `skills/meta/skill-crafting/SKILL.md` for the procedure the agent follows (it is itself a discoverable skill).
