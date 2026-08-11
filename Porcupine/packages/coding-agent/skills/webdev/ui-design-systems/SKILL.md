---
name: ui-design-systems
description: Establish and enforce a coherent UI design system — design tokens → CSS custom properties → reusable components — so appearance stays consistent and themeable without hard-coded magic values. Use when building a component library, theming (light/dark), or auditing a UI for token drift.
stack: webdev
---

# UI Design Systems

Drive visual consistency and themability through a token pipeline: **design tokens → CSS custom properties → components that consume only tokens**. Framework-neutral: the token layer is CSS variables regardless of whether components are vanilla HTML, web components, or any framework.

## When to Use

- Building a reusable component set or design-system layer from scratch.
- Enabling themes (light/dark/custom) that swap without touching components.
- Auditing existing UI for hard-coded values and token drift.
- Any request to "keep the UI consistent", "add theming", or "extract a design system".

## Procedure

1. **Audit for hard-coded values** (`grep` for `px`, hex colors like `#3b82f6`, raw spacing/radius numbers). These are token violations to be replaced.
2. **Define tokens as CSS custom properties** on `:root` — `--color-*`, `--space-*`, `--radius-*`, `--font-*`, `--shadow-*` — with semantic aliases (e.g. `--color-background`, `--color-text`) so a theme only redefines tokens.
3. **Compose components that consume tokens only** — never raw units or colors inline in component styles.
4. **Enable themes** by overriding the custom properties at a scoping root (`[data-theme="dark"]`, `@media (prefers-color-scheme: dark)`) — components stay untouched.
5. **Audit for correctness** — run a token check (`stylelint` custom-properties rule or a small script) for unused/undefined variables.

## Pitfalls

- Hard-coding a one-off `#3b82f6` or `8px` "just this once" — token drift quietly destroys consistency and themability.
- Putting theme logic in component props instead of swapping custom-property tokens.
- Defining tokens but then bypassing them in components anyway; the audit step exists to catch this.
- Naming tokens by raw value (`--blue-500`) instead of semantics (`--color-primary`) — semantics survive theme changes, raw values don't.

## Verification

- No hard-coded colors/spacing/radius/units outside the `:root` token definitions in component styles.
- Every component style resolves to a `var(--...)` reference.
- Theme toggle (e.g. `[data-theme="dark"]` or prefers-color-scheme) changes appearance by redefining tokens only, with no component styles touched.
- Token audit passes: no undefined or unused custom properties in scope.
- Cross-check visually with **`browser_screenshot`** at default and dark theme.

## References

- GitHub Primer — design system as tokens + coded components + patterns, presentation via CSS custom properties: https://primer.github.io/design/about/
- Nord Design System — web components expose CSS custom properties for presentation control: https://nordhealth.design/docs/developer/web-components
