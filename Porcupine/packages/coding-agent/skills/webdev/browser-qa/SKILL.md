---
name: browser-qa
description: Smoke-test a live web page end-to-end with the native browser tools — navigate, capture console/network/runtime errors, inspect accessibility and semantics, and screenshot across viewports. Use to answer "is this page healthy and does it work?"
stack: webdev
---

# Browser QA

Structured "is the page healthy?" verification for a deployed or local page, using the native `browser_*` tools only. Catches runtime JS errors, failed requests, empty/inaccessible regions, and responsive-breakpoint breaks before real users do. Complements `web-performance` (budgets/metrics) and `seo-and-deployment` (metadata/robots/headers).

## When to Use

- Before/after a deploy or feature merge to confirm a page still loads and behaves.
- When a user reports something broken, blank, or "half-loaded" on a specific URL.
- Verifying a form, button, nav, modal, or multi-step flow actually works in a real browser.
- Checking that key content and interactive regions are present and semantically exposed (heads-up for the accessibility tree).
- NOT for: scraping (use `web_extract`), performance scoring (use `web-performance`), or SEO tag checks (use `seo-and-deployment`).

## Procedure

1. **Establish a baseline (first load).** `browser_navigate` the target URL. Note the returned title and that it did not hang or error.

2. **Check runtime and network failures.** Call `browser_diagnostics` after navigation. It reports bounded console messages, uncaught page errors, failed requests, and HTTP responses at 400+ while stripping request query strings and credentials. Treat each distinct root cause as one issue, not every repeat. For request timing or transfer-size analysis, use `browser_evaluate` over `performance.getEntriesByType("resource")` and hand off to `web-performance`.

3. **Verify semantics & accessibility surface.** Capture the accessibility/semantics snapshot and confirm the page has, at minimum: one `main`/landmark, a unique `h1`, form controls with accessible labels, nav/links that are reachable. `innerText` (`browser_extract`) alone hides this structure — prefer the semantic snapshot.

4. **Exercise key interactions.** For each critical task (submit a form, open a menu, click a CTA):
   - `browser_click` the trigger.
   - `browser_wait` for a meaningful post-condition, then `browser_snapshot` / `browser_extract` to confirm the result.
   - Re-run `browser_diagnostics` to ensure the interaction did not raise errors.

5. **Responsive smoke.** `browser_resize` to a mobile (≈390px) and tablet (≈768px) width, then re-extract key elements. Confirm no horizontal overflow, no clipped/hidden primary CTA, and that responsive UI toggled correctly. Return viewport to desktop before finishing.

6. **Screenshot evidence.** `browser_screenshot` at desktop and (optionally) mobile. Attach these as evidence for how rendering looked.

7. **Report.** Summarize: works / blocked, distinct runtime errors with root causes, failed requests, a11y surface findings, and viewport-specific issues. Label each finding with the exact selector/URL/status that produced it.

## Pitfalls

- **Reading diagnostics too early.** `browser_diagnostics` captures from the latest navigation, but async work may still be running. Wait for the app's meaningful ready selector before the final check.
- **innerText hides structure.** A page can look "fine" in text but lack landmarks/labels. Always check the semantics snapshot, not just extracted text.
- **Timers/hydration races.** Submit-then-immediately-read can miss async updates. Use `browser_wait` for expected selectors between act and assert.
- **Shared state during one navigation.** Diagnostics accumulate across interactions until the next navigation. Read them after each critical action when attribution matters.
- **Treating the error's message as the cause.** A `pageerror` often identifies the symptom module. Correlate it with failed requests and resource timing before assigning a root cause.
- **Test-only URLs / auth walls.** If a page needs login, note it and either test the logged-in variant separately or state the gap rather than faking a session.

## Verification

- `browser_navigate` returns a real title/URL (no hang, no SSRF guard for a public/internal target you're allowed to test).
- `browser_diagnostics` shows zero unexpected errors/failed requests, or each remaining one is explicitly explained.
- The semantics snapshot shows at least one landmark, a unique `h1`, and labeled interactive controls.
- Every critical interaction's post-state was observed (not just assumed) via snapshot/extract.
- A successful desktop and at least one mobile viewport check, each with a screenshot, are in the report.
