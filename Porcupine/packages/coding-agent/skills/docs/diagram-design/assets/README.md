# Assets — how to use the templates

These SVGs are starting points, not finished diagrams. Adapt them; don't ship
them as-is.

## Rules for adapting

1. **Replace every label** with the real domain names ("Auth Service", not a
   placeholder).
2. **Keep the palette** from `../references/style-guide.md` — same color =
   same meaning, `#111827` body text, white text on dark fills only.
3. **Recompute geometry.** Nodes are fixed-size; when a label gets longer,
   widen the rect and shift everything right. Keep one flow direction.
4. **Preserve accessibility** — keep `role="img"`, `<title>`, and `<desc>` and
   rewrite them to describe your diagram.
5. **Self-contained only** — no external fonts/images, system font stack, a
   single `viewBox`. It must render from one file.

## The templates

| File | Use for |
|---|---|
| `quadrant-2x2.svg` | Positioning charts (impact × effort, urgency × importance). Mermaid cannot do this — SVG is the only route. |
| `architecture-template.svg` | Left-to-right component diagrams with labelled edges + a legend. |

## Verification (before you call it done)

- Opens in a browser and fits one screen.
- Every node/edge labelled, every color explained by the legend.
- Contrast 4.5:1 (body text `#111827`, white on dark fills).
- `<title>`/`<desc>` rewritten for the actual content.
