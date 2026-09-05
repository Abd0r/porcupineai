# Stacks: Porcupine's Capability Tree

The **stacks system** is how Porcupine organizes everything it can do — tools,
skills, commands, playbooks — into one stable, hierarchical capability tree.
It is the backbone of the agent loop: every tool call and every skill lives at
a predictable path, the tree is injected into the model's context, and search
(`capability_search`) walks the same tree the UI shows in `/stacks`.

This page is the canonical reference. If docs elsewhere disagree with it, this
is the source of truth.

## The idea

Everything the agent can use hangs under a stable path:

```
stacks/<stack>/<lane>/<name>
```

For example:

- `stacks/web/search/web_search` — the web search tool
- `stacks/vcs/playbook/git-basics` — a git skill
- `stacks/safety/auto-mode` — the Auto Mode skill
- `stacks/meta/subagent` — the sub-agent tool

`stack` is one of 18 top-level capability domains, `lane` is a sub-category
(tool / skill / playbook / …), and `name` is the individual capability. The
path is provider-independent: the same tree works whether you run Porcupine
with Anthropic, OpenAI, DeepSeek, or a local Ollama model.

## The 18 stacks

| Stack | Focus |
| --- | --- |
| `filesystem` | read/write local files |
| `discovery` | list, find, search the codebase |
| `coding` | plan, implement, test, review |
| `shell` | shell/bash, builds, git, package managers |
| `web` | internet search + page extraction |
| `webdev` | build, inspect, test, secure, and ship web applications |
| `computer` | observe and operate the local GUI |
| `vcs` | git workflows, branches, diffs, PRs |
| `build` | compile, test, lint, typecheck, CI loops |
| `debug` | diagnose failures, logs, stack traces |
| `reasoning` | thinking depth, adaptive effort |
| `safety` | Auto Mode gate, destructive-command caution |
| `docs` | README, guides, comments, release notes |
| `data` | JSON/CSV/YAML, parsing, transforms |
| `sci` | literature review, experiments, research writing, fair evals |
| `ml` | models, training, evals, datasets |
| `orchestration` | multi-step plans, capability routing |
| `meta` | agent self-config, skills authoring, stack inspection |

Each stack has an id, label, description, tags, and an ordering. The full
definition lives in `src/porcupine/stacks.ts`; the tree builder is
`src/porcupine/session-bridge.ts`. `web` is for researching the public internet;
`webdev` is for engineering and validating web applications.

## How it reaches the model

- A **compact stack table** is injected into the system prompt every turn, so
  the model always knows what capability domains exist and how to ask for more.
- `capability_search` (and `/stacks`) search the **same tree** — what the model
  finds is exactly what `/stacks` would show you.
- Skills are **progressively disclosed**: only their descriptions are always in
  context; the full `SKILL.md` loads on demand (read the skill, or `/skill:name`).
  That keeps the context small while keeping the long tail available.

## Why it's powerful

1. **One namespace, no guesswork.** The model never has to guess a tool or
   skill name — it resolves `stacks/<stack>/<lane>/<name>` the same way the UI
   does. Search is hierarchical (`stack:web` → everything web).
2. **Provider-independent routing.** Swap the model and the capability tree
   stays identical. Porcupine's ~40-provider freedom is possible *because* the
   loop is defined over the tree, not over one vendor's tool format.
3. **Capability-aware planning.** `/plan` pre-routes a capability graph from
   the tree; ordinary turns build one live from actual tool calls (the dynamic
   task tracker in the footer).
4. **Honest discovery.** `capability_search` is deliberately read-only —
   searching identifies a capability, it never mutates the session toolset.
   If the model then calls a registered-but-inactive tool, the loop seats it
   on the spot (safe tools silently; sensitive tools through the Ask/Normal
   confirm or the Auto fail-closed gate) and executes with validated
   arguments — discovery without a path to availability would only produce
   `default.*`-style namespace guesses.
5. **A foundation for learning.** The autonomous learning system records which
   tree paths solved which tasks, so skill improvements land at stable paths
   and can be replayed.

## Working with stacks

- `/stacks` — show the tree or search it: `/stacks stack:webdev`, `/stacks git`.
- `capability_search` — the agent-facing catalog (action `list` / `search` /
  `view`; filter `kind` `tool` | `skill` | `all`).
- Skill frontmatter may declare an explicit stack (`stack: vcs`); otherwise the
  skill's directory under `skills/<stack>/…` places it.
- Tools and skills both live in the tree (`src/porcupine/tool-policy.ts`
  registers tools at their stack paths).

## Extending the tree

Add a new stack by editing `PORCUPINE_STACKS` in `src/porcupine/stacks.ts`
(id, label, description, tags, order). Add a skill by dropping a `SKILL.md`
under `skills/<stack>/<lane>/<name>/` (it is discovered, validated, and placed
in the tree automatically — no registration needed). Extensions register tools
through the normal extension API, and the tree picks them up on reload.
