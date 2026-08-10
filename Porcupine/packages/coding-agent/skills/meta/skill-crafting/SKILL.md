---
name: skill-crafting
description: Build a discoverable, reusable capability from a document (/extract-stack) or from deep web research (/craft-stack). Covers when to produce a Skill (agent procedure) versus a Tool (callable shell command), the SKILL.md format, and the write path under the agent-home skills dir.
stack: meta
---

# Skill Crafting

Porcupine can turn a document or a research topic into a real, discoverable capability that auto-injects into context. Two commands drive this:

- `/extract-stack <path> [--name <n>] [--stack <s>] [--tool]` - distill an existing document.
- `/craft-stack <name> --desc <description> [--stack <s>] [--tool]` - deep-research, then build.

## When to Use

- **Extract** when the source material already exists: a runbook, a paper (PDF), an article, or a spec you want as a reusable procedure.
- **Craft** when you want a capability that is not yet written anywhere you have, and live research would improve it.

## Auto-Use (do not wait to be asked)

This skill is the DEFAULT path for capability creation — invoke it yourself when:

1. **A document with a repeatable procedure enters your context**: the user shares a runbook, paper, spec, article, or a notable log/report that describes steps the agent should follow again — extract it proactively (after confirming the document is worth keeping; do not extract one-off chatter).
2. **A tool or command fails with a reproducible pattern**: you hit the same error twice with a clear recovery path — craft a recovery skill so the next session skips the pain (complements the self-improvement loop's automatic learning; use extract/craft when the failure deserves a hand-written, documented skill).
3. **A research task produced a reusable procedure**: your deep-research or debugging session distilled steps that would help future sessions — craft it while the knowledge is fresh.
4. **The user asks to "remember how to X" or "make this a skill"** — that is an explicit extract/craft request.

When auto-triggered, follow the Procedure below; keep the skill lean (one real procedure, not a dump) and verify discoverability before finishing.
- **Skill vs Tool**:
  - Produce a **Skill** (a SKILL.md) when the outcome is guidance the agent follows - a procedure, checklist, or reference. This is the default.
  - Produce a **Tool** (a callable shell entry in `user-tools.json`) when the outcome is a command the agent should run, e.g. a runbook of terminal steps. Auto-detected for command-heavy documents; override with `--tool`/`--skill`.

## Procedure

1. **Decide the kind.** Command/runbook-oriented, description reads "run/execute/command" -> Tool. Otherwise -> Skill.
2. **Read the source.** For extract, read the document text (.md/.txt natively, .pdf via `pdftotext`). For craft, gather 3-6 source notes (title, url, key points) from web search + extraction.
3. **Choose a stack id** (lowercase a-z, 0-9, hyphens): `web`, `shell`, `coding`, `meta`, `vcs`, `docs`, `data`, `sci`, `build`, `debug`, `discovery`, `filesystem`, `reasoning`, `safety`, etc. When unsure, use `meta`.
4. **Choose a name** (lowercase a-z, 0-9, hyphens; no leading/trailing/double hyphens).
5. **Write the SKILL.md** to `agentDir/skills/<stack>/<name>/SKILL.md` with frontmatter `name`/`description`/`stack` and body sections `# Title`, `## When to Use`, `## Procedure`, `## Pitfalls`. For a Tool, write a record to `<agentDir>/user-tools.json`.
6. **Verify it is discoverable.** The next session loads it automatically into `<available_skills>`; a direct Skill can also be invoked via `/skill:<name>`.

## Pitfalls

- Never overwrite a user skill without an explicit force flag; refuse with a clear error.
- Never invent URLs, citations, search hits, or facts during research. Cite only sources you actually extracted.
- Keep names/stacks lowercase-hyphen only, or the skill will not validate/discover.
- A distilled Tool needs a real captured command, not just a placeholder echo, to be genuinely callable.
- Truncate oversized documents before distillation; do not blow up context.

## Verification

- The SKILL.md parses (has `name`/`description`/`stack` frontmatter and non-empty description).
- The file sits under `agentDir/skills/<stack>/<name>/SKILL.md` for skills, or in `user-tools.json` for tools.
- The capability is discoverable: it shows in `/stacks` and is listed in `<available_skills>`.
