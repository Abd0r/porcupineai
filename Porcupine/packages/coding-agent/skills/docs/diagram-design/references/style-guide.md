# Style Guide — the visual system

One system across every diagram so a project's graphics read as one family.
These are tokens, not suggestions. Pick them and stay consistent within a
single deliverable.

## Palette

Use 2-3 semantic colors + neutrals. Color must mean something:

| Token | Hex | Meaning |
|---|---|---|
| `accent` | `#2f6fed` | the thing being explained (primary component / flow) |
| `success` | `#188a4e` | OK, completed, internal |
| `warn` | `#b26a00` | external, third-party, needs attention |
| `danger` | `#c53030` | failure, blocking, deprecated |
| `neutral-900` | `#111827` | text, borders on light bg |
| `neutral-500` | `#6b7280` | secondary text, muted edges |
| `neutral-100` | `#f3f4f6` | fills, backgrounds |

Rules:
- No more than one accent + one semantic color per diagram unless the data
  itself demands more (e.g. a legend).
- Same color = same meaning everywhere in the diagram.
- Grayscale-only is always acceptable and often clearer.

## Contrast (WCAG AA)

- Body text `#111827` on `#ffffff` or `#f3f4f6` — passes.
- `#6b7280` gray is for large/secondary text only; do not use for body labels.
- On a colored fill, use white text (`#ffffff`) if the fill is dark
  (`accent`, `danger`), and `#111827` on light fills.
- Never render `#9ca3af` or lighter gray on white.

## Spacing & layout

- One flow direction (top-down or left-right). Never mix within one diagram.
- Consistent padding around node labels (roughly 8px/0.5em visual).
- Align nodes on a grid where possible; avoid diagonal spaghetti.
- Keep edge crossings to a minimum; reorder nodes before adding bend points.

## Typography

- One font, one scale. For SVG, use the system stack
  (`system-ui, -apple-system, sans-serif`).
- Node label = noun/verb phrase, sentence case, no trailing period.
- Edge label = the relationship/action in lower case.

## Labels

- Every node labeled. Every edge either labeled or self-evident from direction
  + a legend.
- Prefer domain names over implementation names ("Auth Service" not
  "auth-svc-3").
- No unexplained acronyms; expand on first use or add a legend.

## Legends

If color or shape carries meaning, add a small legend. A diagram with a
meaning-coded color and no legend is a puzzle.
