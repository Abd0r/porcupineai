---
name: memory-hygiene
description: Decide what belongs in USER.md vs MEMORY.md, when to write, and how to keep both files clean. Load this before any memory mutation, or when unsure whether a fact deserves to persist.
stack: meta
---

# Memory & User Modeling Hygiene

Memory is **agent-decided**. Nothing is auto-saved. You are the curator of
`USER.md` (who the user is) and `MEMORY.md` (agent environment notes). Bad
curation fills files with junk that is injected into every future turn — that
costs tokens and degrades every session. Be strict.

## The one test

**"Will this matter in a new session next week?"** No → do not store it.

| Category | USER.md | MEMORY.md | Nowhere |
|---|---|---|---|
| Identity, who they are | ✅ | | |
| Stable preferences | ✅ | | |
| Explicit user corrections | ✅ | | |
| Long-term goals | ✅ | | |
| Verified environment facts (paths, ports, rigs) | | ✅ | |
| Durable technical facts (repo layout, conventions) | | ✅ | |
| Task TODOs / current task progress | | | ✅ (tasks tool owns this) |
| One-off instructions ("do X today", "fix Y now") | | | ✅ |
| Session-specific state / results | | | ✅ |
| Secrets, keys, passwords | | | ❌ never |
| Emotional venting / sensitive inferences | | | ❌ never |

## Decision procedure

1. **Read first.** The injected `<porcupine_memory>` block has the current
   state. Run `memory list` when unsure.
2. **Qualify.** Explicit user statement or verified evidence only. Never infer
   preferences from a single interaction. Never store something the user said
   in passing unless it is a clear correction or preference.
3. **Dedupe.** Same key already present? `replace` it, don't stack a duplicate.
4. **Contradictions.** A newer explicit correction replaces the older entry —
   archive the conflict, don't keep both (contradictory pairs confuse the model).
5. **Write minimal.** One line per fact. No essays. `[category:key]` prefix on
   user facts helps grouping.

## Growth & compaction

- Storage limits: USER.md 12,000 chars, MEMORY.md 16,000. Prompt injection is
  budgeted (6k/8k) with a truncation marker — so a bloated file silently hides
  older entries from the model. Keep files lean.
- Near the limit: merge same-key entries, shorten wording, drop superseded
  facts, then re-add. `remove`/`replace` always work even over the limit;
  only `add` enforces it.

## session_search

- Use for "what did we decide about X?" or resuming prior work — NOT as a
  substitute for durable memory. Things found there repeatedly are candidates
  for MEMORY.md.
