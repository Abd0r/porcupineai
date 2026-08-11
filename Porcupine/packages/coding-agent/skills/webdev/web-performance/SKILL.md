---
name: web-performance
description: Measure and triage web performance with Lighthouse, field Core Web Vitals, browser resource timing, and explicit budgets. Use when asked to make a page faster, compare builds, or prevent performance regressions in CI.
stack: webdev
---

# Web Performance

Drive existing `bash` (+ optional Lighthouse/LHCI, if already configured) to turn "is it fast enough?" into a number and a plan. This skill does **not** add new dependencies blindly — it runs `npx lighthouse` / `lhci` only when present or your environment is ready, and otherwise relies on lightweight `curl` timing and the browser tools for signal.

## When to Use

- Before shipping a change that adds above-the-fold scripts, images, or third-party embeds.
- Comparing a PR/branch build against the current production build (perf regression gate).
- Triage when a page "feels slow" or Lighthouse / Web Vitals scores drop.
- Setting and asserting a performance budget in CI with Lighthouse CI (`lhci assert`).
- NOT for: functional breakage (use `browser-qa`), or SEO metadata/headers (use `seo-and-deployment`).

## Procedure

1. **Know if Lighthouse is available.** Check `which lighthouse` or `ls` for `package.json`/`npx` availability:
   - If a repo already wires Lighthouse/LHCI (`package.json` scripts, `lighthouserc.*`, a `.github/workflows` step), use that — it matches the team's own config/Chrome.
   - Otherwise, run once as a tool: `npx --yes lighthouse <url> --output=json --quiet --chrome-flags="--headless"`. This may download the Lighthouse package and still requires a compatible local Chrome/Chromium; disclose that network/runtime requirement before relying on it.
   - If you cannot run a headless Chrome (no network, restricted env), fall back to step 2's `curl` proxies and say Lighthouse was skipped.

2. **Cheap upfront signal (no Chrome needed).** Before/alongside Lighthouse:
   - **TTFB / header size:** time `curl -sI <url> -w '%{time_starttransfer} %{size_header} %{http_code}'` and `curl -s -o /dev/null -w '%{http_code} %{time_total} %{size_download}'`.
   - **Resource count & weight:** `browser_navigate`, wait for the app's ready selector, then use `browser_evaluate` on `performance.getEntriesByType("resource")` to calculate request count, transfer size, and the largest resources. Use `browser_diagnostics` separately for failed requests and HTTP 4xx/5xx.

3. **Run the scored audit.** With Lighthouse available, write JSON to a file and parse Performance, Accessibility, Best Practices, and SEO plus lab metrics such as **LCP**, **CLS**, **FCP**, **TBT**, Speed Index, and server-response timing. **INP is a field metric requiring real interactions and field/RUM or CrUX data; do not present a default Lighthouse lab run as measured INP.** Record Lighthouse version and desktop/mobile preset beside every score.

4. **Triage by the budget that hurts.** Order of attack (roughly by impact):
   - **LCP slow** → largest render-blocking resource: image size/`fetchpriority`/preload, render-blocking CSS/JS, slow server/TTFB.
   - **Field INP slow** (from RUM/CrUX, not a default lab run) → long tasks and heavy main-thread work: inspect big synchronous JS, re-render storms, and unthrottled handlers; use TBT only as a lab diagnostic proxy, not as INP.
   - **CLS > 0.1** → content shifting after paint: images/frames lacking reserved `width`/`height`, late-injected banners, font swap shifting text (preload + `font-display: swap`).
   - **TTFB high** → server/CDN/cache, cold start, missing cache headers, backend query cost.
   - FCP/TBT remain meaningful but are downstream of the above for most fixes.

5. **Wire a budget (when asked).** If the team uses Lighthouse CI, add or confirm explicit assertions in its existing config and a CI step running `lhci autorun` or `lhci collect` + `lhci assert`. Verify exact config keys against the installed LHCI version. Treat a CI performance regression like a failing test.

6. **Report.** State the URL/environment, preset, Lighthouse version, category scores, measured lab metrics, separately sourced field metrics, largest transfers, top 1–3 actions tied to evidence, and before/after results.

## Pitfalls

- **Nondeterministic variance.** A single Lighthouse run is noisy (cold Chrome, background load). For comparison, run 3 and take the median, or use `lhci mobile.assert` with budgets rather than eyeballing one number.
- **Comparing desktop vs. mobile scores.** Always the same preset, or the comparison is meaningless (FCP/INP behave very differently).
- **Background/test-only tiers distorting results.** Auth walls, dev-only bundles, or a seeded dev DB make scores non-representative of production. Test the production-shaped environment.
- **Chasing the score instead of the metric.** The Performance category weights change across Lighthouse versions; anchor on the Core Web Vital budgets, not the raw 0–100 that may drift.
- **Adding deps "to be safe".** Don't `npm i` Lighthouse into a repo that doesn't want it. Prefer `npx --yes lighthouse` (no package.json change) or the existing CI wiring.
- **Ignoring network/transfer.** A big waterfall of many small requests can be as costly as a single huge file; the HTTP tool layer captures this even when Lighthouse misbehaves.

## Verification

- You can state the exact tool used to measure (Lighthouse version via `lighthouse --version`, or the `curl`/network fallback) and the preset.
- Category scores and available lab metrics are recorded for a specific URL, preset, version, and environment; field INP is reported only when real field/RUM or CrUX evidence exists.
- Any budget or CI step you touch is described so the user can diff it; you did not modify repo files unless explicitly asked.
- Each recommended action maps to a specific metric you actually measured, not a generic "add a CDN" hand-wave.
- A before/after (or branch-vs-prod) comparison exists when the user asked to compare or optimize.
