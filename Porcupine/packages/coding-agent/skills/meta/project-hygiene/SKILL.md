---
name: project-hygiene
description: Create a durable, evidence-backed project workspace.
stack: meta
---

# Project Hygiene

Use this skill to give a substantial project one canonical home for its purpose, verified state, decisions, evidence, and next work. The canonical location is `Project/<project-name>/` relative to the current repository or explicitly chosen workspace.

The goal is continuity, not paperwork. Keep documents short, factual, and current. Do not create empty ceremony files for a trivial task.

## When to Use

- Starting a project expected to span more than one session.
- Beginning a research effort, prototype, migration, benchmark, paper, dataset, or feature with multiple milestones.
- Taking over a project whose purpose, verified state, or next action is unclear.
- The user asks to organize project notes, progress, status, plans, or evidence.

Do not use this for a one-file fix, a disposable experiment, or a task whose existing repository documentation is already the canonical project home.

## Canonical Layout

Create this minimum structure:

```text
Project/
└── <project-name>/
    ├── README.md
    └── STATUS.md
```

Add these files only when their contents exist and will remain useful:

```text
    ├── PLAN.md          # Multi-step implementation or research plan.
    ├── TASKS.md         # Small actionable checklist across sessions.
    ├── DECISIONS.md     # Non-obvious choices, alternatives, and rationale.
    ├── EVIDENCE.md      # Measurements, sources, experiments, and validation.
    └── CHANGELOG.md     # Meaningful project milestones, not every edit.
```

Use a lowercase, hyphenated directory name such as `Project/sparse-attention/`. Preserve the human-readable project title inside `README.md`.

## Procedure

### 1. Establish the project boundary

1. Use `read` and `grep` to inspect existing README files, plans, experiment logs, task notes, and source entry points.
2. Decide whether this is a new project or an existing project that needs a canonical workspace.
3. Select one concise project name. Do not create duplicate folders for aliases or phases.
4. Confirm the root is `Project/<project-name>/` unless the user explicitly selects another root.

Completion criterion: the project has one unambiguous directory and no competing status document is introduced.

### 2. Create the required living documents

Create `README.md` with:

```markdown
# <Project Title>

## Objective
One measurable purpose.

## Scope
- In scope:
- Out of scope:

## Current approach
The current technical or research direction.

## Success criteria
- Observable gate 1
- Observable gate 2

## Workspace map
- `path/`: why it matters

## Related material
- Links to repository paths, papers, issues, or external sources.
```

Create `STATUS.md` with:

```markdown
# Status: <Project Title>

## State
`planning` | `active` | `blocked` | `paused` | `complete`

## Last verified
- Date or commit:
- What was executed or inspected:
- Result:

## Current position
A short factual snapshot. No aspirational claims.

## Blockers and risks
- Blocker or `None`.

## Next verified action
One concrete action, including the command, test, or artifact that will prove it.
```

Completion criterion: `README.md` explains why the project exists, and `STATUS.md` gives another session enough context to take the next action without guessing.

### 3. Add only useful supporting documents

- Create `PLAN.md` when the work has multiple dependent steps. Each step names its files, verification command, and completion gate.
- Create `TASKS.md` for small, movable tasks. Keep only current work there; completed tasks belong in `CHANGELOG.md` only if they changed a milestone.
- Create `DECISIONS.md` when a choice would otherwise be rediscovered. Record date, decision, alternatives, evidence, and consequence.
- Create `EVIDENCE.md` for measurements, reproducible experiment results, source citations, dataset provenance, or evaluation output. Separate observations from interpretations.
- Create `CHANGELOG.md` only for milestones such as a validated prototype, completed dataset version, accepted design, or released artifact.

Completion criterion: every supporting document answers a real future question. Delete or avoid placeholder documents that do not.

### 4. Keep the workspace truthful

After a meaningful project action:

1. Run the relevant verification before updating project state.
2. Update `STATUS.md` with the actual result, blocker, and one next verified action.
3. Add evidence or a decision only when it changes what should happen next.
4. Update `WORKFLOW.md` when a procedure changes (a new flag, a different gate, a new recovery step) so the recorded workflow never silently diverges from reality.
5. Keep claims traceable to a command, file path, measured result, or cited source.

Do not put credentials, tokens, private session transcripts, speculative benchmark numbers, or copied tool output dumps in project documents.

Completion criterion: `STATUS.md` never claims a milestone without its evidence being available in the repository, test output, or `EVIDENCE.md`.

## Status Writing Rules

- State what is true now, not what would be impressive.
- Use dates, commits, paths, commands, and measured outputs where available.
- Mark unknowns as unknown.
- Move stale next steps out rather than leaving contradictory plans behind.
- A blocked project is healthy when the blocker is explicit and actionable.

## Common Pitfalls

- Creating `Project/` for every minor code edit.
- Treating `STATUS.md` as a marketing update instead of a handoff record.
- Maintaining two competing plans in the repository root and project folder.
- Copying raw logs or secrets into Markdown instead of recording a concise result and source path.
- Recording a task as complete before its verification command has run.
- Letting an old “next action” survive after the direction changed.

## Verification

Before finishing a project-hygiene pass, verify:

- `Project/<project-name>/README.md` and `STATUS.md` exist.
- The objective, scope, success criteria, current state, blocker, and next action are all explicit.
- Every claimed result has a source, path, command, or evidence record.
- Optional Markdown files contain useful content rather than templates alone.
- No secrets, personal runtime state, or unrelated project files were added.

## Cross-references

- Use `planning-and-task-breakdown` for implementation plans with file-level verification.
- Use `source-driven-development` before documenting behavior that depends on existing code.
- Use `test-loop` when a project milestone requires a repeatable test or build gate.
- Use `memory-hygiene` for durable user preferences rather than project-progress notes.
