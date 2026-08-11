---
name: web-accessibility
description: Build and audit toward WCAG 2.2 A/AA with semantic HTML, keyboard and focus behavior, ARIA only when needed, semantic browser snapshots, and automated axe checks. Use for accessible pages, forms, and dynamic widgets.
stack: webdev
---

# Web Accessibility

Accessibility done right: **semantic HTML first, ARIA as a last resort**, verified by automated scan plus keyboard review. Framework-neutral; apply at the rendered-DOM level regardless of authoring framework. Covers WCAG 2.2 A/AA targets per the W3C WAI standard.

## When to Use

- Auditing existing UI for WCAG/A11y issues.
- Adding interactive widgets (menus, dialogs, tabs, carousels, progress indicators) that need proper semantics and keyboard support.
- Any form, nav, or dynamic-content component that must serve keyboard and screen-reader users.
- Accessibility review as a gate before shipping any UI change.

## Procedure

1. **HTML-first audit** (`grep`/`read`): prefer native elements with built-in semantics and keyboard behavior (`button`, `input`, `nav`, `progress`, landmarks). Unnecessary ARIA duplicates on native elements count as errors.
2. **Confirm text labels** — every form control has a `<label for>` or `aria-labelledby`; images have `alt` or are marked `aria-hidden` if decorative.
3. **Check keyboard operability** — every interactive widget is reachable and operable by keyboard; custom widgets have correct key handling. Manage focus for menus, dialogs, and modals (trap + restore).
4. **ARIA only where no native element exists** — e.g. `role="tablist"` on custom tabs or a live region for dynamic updates (`aria-live`); keep roles/states updated via JS.
5. **Run an automated axe scan** targeting the WCAG 2.0/2.1/2.2 A+AA ruleset (use `bash`/test runner with `axe-core`). Note axe does NOT catch everything — treat remaining cases as manual.
6. **Inspect the rendered semantic tree** with `browser_snapshot`, then perform keyboard and, where required, screen-reader review for what automation cannot prove (reading order, announcements, focus behavior, target usability).

## Pitfalls

- **"No ARIA is better than bad ARIA"** — MDN cites WebAIM's 1M-homepage survey finding pages *with* ARIA had ~41% *more* errors than pages without. Don't sprinkle ARIA where native elements already work.
- Depending on automated tools for 100% coverage — axe explicitly doesn't catch everything.
- Duplicating semantics that native elements already imply (landmarks, `<progress>`, `<button>`).
- Misusing `aria-hidden` on focusable content, or leaving a modal focusable behind a dialog barrier.
- Styling `:valid`/`:invalid` before the user interacts (punishes mid-typing) — use `:user-valid`/`:user-invalid`.

## Verification

- The project's configured axe runner (for example `@axe-core/playwright`) reports no unexplained violations. Do not call `axe.run()` unless the page/test harness actually loaded axe.
- Every form control has an associated visible label.
- Keyboard-only pass: Tab through the page — every interactive element reachable, focus visibly indicated, modals trap focus and restore on close, nothing focusable inside `aria-hidden`.
- No `role=` added to elements that already have native semantics; no native element wrapped in redundant ARIA.
- Dynamic updates use appropriate live regions; status messages announced.
- `browser_snapshot` confirms expected roles, names, states, landmarks, and heading structure in the rendered page.

## References

- W3C WAI — WCAG 2 Overview (guidelines, principles, A/AA/AAA, backward compatible): https://www.w3.org/WAI/standards-guidelines/wcag/
- MDN — ARIA (native-HTML-first, precedence, WebAIM 41% stat): https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA
- MDN — Using ARIA: roles, states, and properties: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Techniques
- Deque — Axe-core (WCAG 2.0/2.1/2.2, Section 508, zero-false-positive intent): https://www.deque.com/axe/axe-core/
- W3C WAI — Axe-core ACT implementation (conformance with WCAG 2.1 A/AA/AAA + WAI-ARIA 1.2): https://www.w3.org/WAI/standards-guidelines/act/implementations/axe-core/
