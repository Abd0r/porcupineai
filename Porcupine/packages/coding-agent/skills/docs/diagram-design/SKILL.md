---
name: diagram-design
description: >
  Produce clear, accessible diagrams and charts (architecture, flow, sequence,
  ER, state, org, Gantt, timeline) as Mermaid or polished self-contained SVG.
  Covers picking the right diagram type, a consistent visual system, and
  accessibility. Use whenever you need to explain a system, a flow, data, or a
  process in a README, doc, benchmark report, plan, or launch graphic.
stack: docs
---

# Diagram Design

Diagrams are how an explanation lands. A bad diagram (wrong type, inconsistent
style, unreadable contrast) makes even correct analysis look wrong. This skill
is the bar: choose the right type, apply one visual system, verify it renders
and is readable.

## When to use

- Explaining an architecture, a request flow, a state machine, or a data model.
- Documenting a benchmark pipeline, a release process, or a decision tree.
- Producing a graphic for a README, doc, plan, or launch post.
- The user asks to "draw", "visualize", "diagram", "chart", or "map" something.

Not for: a one-line ASCII sketch (just write it inline), or data you have not
verified yet.

## Pick the right type

The type is dictated by the *question*, not by what is easiest to draw.

| Question | Type | Mermaid |
|---|---|---|
| What are the parts and how do they connect? | Architecture / component | `flowchart` |
| What happens, in order, between actors? | Sequence | `sequenceDiagram` |
| What states and transitions exist? | State machine | `stateDiagram-v2` |
| How do entities relate (DB schema, domain model)? | ER / relationship | `erDiagram` |
| What are the steps in a process/decision? | Flowchart | `flowchart` |
| Who does what, in parallel lanes? | Swimlane | `flowchart` + subgraphs |
| What is the schedule/plan over time? | Gantt / timeline | `gantt` |
| Who reports to whom / hierarchy? | Org chart | `flowchart` (tree) |
| How do quantities compare? | Bar / line / pie | `pie` or SVG |
| A 2x2 positioning / priority? | Quadrant | SVG |

Rule of thumb: if the diagram answers a "what is it" question, draw the
structure. If it answers a "what happens" question, draw the flow/sequence. If
it answers a "how much" question, draw the chart.

## Visual system

One system across every diagram, so a repo's graphics look like they belong
together. Full tokens in `references/style-guide.md`.

- **Palette:** 2-3 semantic colors max + neutrals. Use color to mean something
  (component, external service, failure), never decoration.
- **Contrast:** text on any fill must pass 4.5:1 (WCAG AA). Never light gray on
  white.
- **Labels:** every node and edge is labeled. No unexplained boxes.
- **Direction:** pick a single flow direction (top-down or left-right) and
  stick to it. Don't mix.
- **Size:** a diagram should fit one screen without zooming. If it can't, it's
  two diagrams, not one bigger diagram.

## Output format: Mermaid vs SVG

| Format | Use when | Rendering |
|---|---|---|
| Mermaid | GitHub README, markdown docs, quick iteration | GitHub + most MD renderers natively |
| SVG | Custom/polished graphics, launch assets, 2x2/quadrant, precise layout | any browser, crisp at any size |

Prefer Mermaid by default (it renders in GitHub and is reviewable as text).
Escalate to SVG when the layout Mermaid can't express (quadrants, custom
placement, brand styling) or when the output is a launch/hero graphic. Syntax
details in `references/output-formats.md`.

## Procedure

1. **State the question.** Write one sentence the diagram must answer. If you
   can't, don't draw yet.
2. **Choose the type** from the table above.
3. **Draft** the structure (Mermaid or SVG skeleton) with all nodes/edges.
4. **Style** with the visual system: semantic colors, labeled edges, one
   direction, accessible contrast.
5. **Verify:** render it (or at minimum eyeball the syntax), confirm every node
   is reachable and every label is present, and check contrast. See
   `references/output-formats.md` for the checks.

## References

Load only the one you need (progressive disclosure):

- `references/style-guide.md` — palette, spacing, typography, contrast tokens.
- `references/type-guide.md` — per-type guidance + worked Mermaid examples.
- `references/output-formats.md` — Mermaid + SVG syntax, gotchas, verification.

## Pitfalls

- **Wrong type:** a flowchart where a sequence was needed (or vice versa) hides
  the actual answer. Pick by the question, not by habit.
- **Unlabeled edges:** arrows without meaning are decoration, not explanation.
- **Low contrast:** light gray text fails a11y and screenshots.
- **One giant diagram:** split it; a diagram is an answer, not a dump of
  everything you know.
