---
name: frontend-development
description: Build and fix frontend UI with correct semantic HTML and modern CSS (Flexbox/Grid) — document landmarks, heading hierarchy, lang/charset/viewport, responsive-by-default layout primitives, and framework-neutral structure. Use when writing, editing, or inspecting any markup/CSS/JS or TS frontend so the result works across viewports without framework assumptions.
stack: webdev
---

# Frontend Development

Foundation skill for any frontend work: semantic, mobile-friendly markup plus modern, responsive-by-default CSS layout. Framework-neutral — applies to vanilla HTML/CSS, or any component structure (React/Vue/etc.) at its root. This is the structural gate before design-system, responsive, and accessibility skills build on top.

## When to Use

- Creating or revising any page, view, component, or stylesheet.
- Inspecting an unknown codebase's markup/CSS to understand its structure.
- Any request to "build a UI", "fix layout", "make the frontend look right", or "turn these files into a web page".
- NOT for: pure backend/logic with no rendered UI.

## Procedure

1. **Inspect existing markup** (`read`/`grep`/`find`). Confirm the document shell: `<html lang>` set, `<meta charset>`, and `<meta name="viewport">` present. Verify landmark elements (`header`, `nav`, `main`, `footer`) and a sane single-`h1` heading hierarchy.
2. **Pick layout primitives by dimension** — Flexbox for one-dimensional (row/column) arrangements, CSS Grid for two-dimensional page/region layout. Prefer native layout over `float`/`table` hacks; modern methods are responsive by default.
3. **Use relative units** — `rem`, `fr`, and percentages; fluid images via `max-width:100%`; boundary calculations with `min()/max()/clamp()` where appropriate.
4. **Lint with the repository's configured commands.** Use its HTML/CSS checks or `npx --no-install html-validate` / `stylelint` only when those packages are already present. Do not add or download linters just to satisfy this procedure.
5. **Visual check** — load the page in the browser and capture a screenshot plus DOM/text checks (see Verification) before declaring done.

## Pitfalls

- Fixed-width full-page layouts force horizontal scrollbars on narrow devices — always let full-page layout contract (MDN responsive guide).
- Reaching for `float` where Flexbox/Grid is the modern, responsive-by-default answer.
- Forgetting `<meta name="viewport">`, which breaks mobile rendering entirely.
- Duplicate/invalid landmarks or skipped heading levels (`h1`→`h3`) that confuse both semantics and styling resets.

## Verification

- Markup and CSS pass the repository's configured validators/linters; if none exist, state the gap instead of inventing a pass.
- Document has `lang`, `charset`, and `viewport` meta; single `h1`; landmarks present and non-nested incorrectly.
- No fixed-width full-page layout: opening at a narrow viewport produces no horizontal scroll of whole content.
- **`browser_navigate`** to the page, then **`browser_screenshot`** for a visual record, and **`browser_evaluate`** to assert `document.scrollingElement.scrollWidth <= innerWidth`.

## References

- MDN — Responsive web design (modern layout tools; mobile-first): https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design
- MDN — Flexbox (one-dimensional layout): https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Flexbox
- MDN — CSS Grid layout (two-dimensional layout): https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout
