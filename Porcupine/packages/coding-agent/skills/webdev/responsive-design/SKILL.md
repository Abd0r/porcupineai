---
name: responsive-design
description: Build and verify responsive/adaptive interfaces that work across device widths — fluid grids, relative-unit media queries, correct viewport meta, mobile-first breakpoints — and confirm no horizontal scroll, overflow, or unreadable scaling at target sizes. Use whenever a UI must look right on desktop, tablet, and mobile.
stack: webdev
---

# Responsive Design

Make UI adapt gracefully from phone to desktop using fluid layout plus media-query breakpoints. Framework-neutral (vanilla CSS, or any framework's styling). Builds directly on `frontend-development`'s responsive-by-default primitives and verifies in a real browser.

## When to Use

- Any UI expected on more than one viewport size (implicitly: essentially all production frontend).
- Fixing "it looks broken on mobile", overflow, or zoom-to-fit issues.
- Adding a new component that must hold up at narrow widths.
- Building toward multi-breakpoint layout, fluid typography, or a mobile-first rebuild.

## Procedure

1. **Confirm the foundations** (from `frontend-development`): `<meta name="viewport" content="width=device-width, initial-scale=1">`, fluid grid (Flexbox/Grid + `fr`/relative units), and fluid media (`max-width:100%`).
2. **Author mobile-first** — base styles target the narrowest viewport; use `min-width` media queries to layer up enhancements. Prefer relative-unit breakpoints where meaningful; avoid magic `px` breakpoints without rationale.
3. **Add breakpoints** only where layout needs to change (nav collapse, grid reflow, font scale) — not arbitrary device sizes.
4. **Verify at multiple widths** — evaluate the page at representative sizes (e.g. 360, 768, 1024, 1440) checking for horizontal scroll, clipped/overlapping content, and untap-able targets.
5. **Watch dynamic ranges** — fluid `clamp()`/container queries to reduce breakpoint count; reflow grid columns (`repeat(auto-fit, minmax(...))`) instead of stacking hard-coded columns.

## Pitfalls

- Fixed-width full pages/wide elements forcing horizontal scroll on small screens — the most common responsive failure (MDN).
- Missing viewport meta → mobile browsers render a zoomed-out desktop layout (MDN).
- Testing at only one width, or only "looks fine on my viewport" — verify the actual target range.
- Using a packed `px` breakpoint as a substitute for understanding that the layout should reflow continuously.
- Overflow from unconstrained content (long words, wide tables, large images without `max-width:100%`).

## Verification

- Viewport meta present and correct.
- At minimum 360/768/1024 widths (plus any project targets): `document.scrollingElement.scrollWidth <= innerWidth` for each — no horizontal scroll.
- No element overflows its container (evaluate `getBoundingClientRect` vs parent width on key blocks).
- Interactive targets ≥ ~44px at all supported widths.
- **Cross-check:** `browser_resize` to each target width, then `browser_screenshot` for a visual record and `browser_evaluate` for `scrollWidth`/overflow assertions.

## References

- MDN — Responsive web design (fluid, relative units, breakpoints, mobile-first): https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design
- MDN — Flexbox (fluid one-dimensional layout): https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Flexbox
