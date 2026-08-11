---
name: seo-and-deployment
description: Audit a web page's SEO metadata, indexing surface, and deployment hygiene — title/meta/OG/canonical/structured data, robots.txt and sitemap.xml, security response headers, and observability/rollback readiness — without publishing anything. Use when asked to check "is this page/seo/release-ready?"
stack: webdev
---

# SEO & Deployment

Pre-release readiness audit for a web deployment: the discoverability layer (metadata + indexed surface) and the deploy hygiene layer (security headers, observability, rollback plan). Uses existing shell/web/browser tooling only — reads HTTP responses and rendered `head` — and never pushes code or triggers a deploy.

## When to Use

- Before a release/launch to confirm the page is indexable, correctly labeled, and safe to put in front of users.
- Investigating "why isn't my page showing up in search" or a bot-blocked/canonical-misconfigured page.
- Verifying security response headers and TLS/HTTPS enforcement on an endpoint.
- Confirming you can observe and roll back a deployment before/after shipping.
- NOT for: functional QA (use `browser-qa`), or perf metrics (use `web-performance`).

## Procedure

### A. SEO metadata & index surface

1. **Rendered `head`.** Navigate the page with the browser tools, then use `browser_evaluate` to read the `<head>` (title, canonical, robots meta, description, OG/Twitter tags) and the first few heading levels. Note missing/duplicate/empty values.

2. **Metadata checklist.** Verify:
   - A descriptive, unique `<title>` that matches the page purpose. Do not enforce folklore character counts as a correctness rule.
   - An accurate meta description where search snippets matter; no duplicate or misleading text.
   - A non-conflicting canonical URL when duplicate/alternate URLs exist.
   - Relevant social metadata (`og:title`, `og:description`, `og:image`, and any platform-specific tags) with resolvable absolute URLs.
   - Any JSON-LD parses and validates for the schema type actually represented. Do not add structured data the visible page does not support.

3. **Semantic structure.** Confirm a clear primary heading and logical document landmarks. This improves machine understanding and accessibility without treating heading shape as a guaranteed ranking factor.

4. **Indexing surface.** Check `robots.txt`, robots meta / `X-Robots-Tag`, and `sitemap.xml` when the site uses one:
   - Intended public resources are crawlable. Remember that `robots.txt` controls crawling, not guaranteed de-indexing.
   - Canonical public URLs appear in the sitemap when sitemap coverage is part of the site's strategy.
   - Pages intended for search do not carry `noindex`; pages intentionally private or duplicate do.

5. **Bare-URL HTTP probe.** Use `curl`/`web_extract` to confirm the non-www→www and http→https redirects behave and the canonical host is the one you crawled.

### B. Deployment hygiene (without publishing)

1. **Security response headers.** For the production URL, read final HTTPS response headers and assess what the application needs:
   - `Content-Security-Policy`, including `frame-ancestors` when framing must be controlled.
   - `Strict-Transport-Security` with a deliberate scope and duration; only add `includeSubDomains` when every subdomain is HTTPS-ready.
   - `X-Content-Type-Options: nosniff`, an appropriate `Referrer-Policy`, and a least-privilege `Permissions-Policy` where supported.
   - `Cache-Control` suitable for personalized HTML versus content-addressed immutable assets.
   - Report missing or overly broad policy with its concrete risk. Do not make every optional header an automatic blocker.

2. **TLS/HTTPS.** Confirm the endpoint serves HTTPS (with a valid cert) and redirects plain HTTP; note any mixed-content flagged earlier in `browser-qa`.

3. **Observability.** Confirm the stack exposes, for the page: request logs/APIs (status, latency), error tracking (runtime JS + server 5xx), and at least one health/readiness endpoint. If the user has monitoring/alerts configured, verify the page/host is covered.

4. **Rollback readiness.** Establish the deploy/rollback mechanism from the team's practice (CI/CD pipeline, image tag/commit SHA pinned, DB schema compatible forward/backward, feature flags). You **do not** run a deploy or rollback — you verify that a rollback is *possible* and *fast*: can they redeploy the previous artifact, and does the current release carry enough (logs/metrics, feature flags, DB migration plan) to detect and recover a bad one?

5. **Report.** Give a checklist table: item → status (pass/warn/fail) → evidence (header/value/selector/URL). Group into SEO & Index and Deployment Hygiene. Explicitly separate "verified now" from "assumed/pre-existing config" for anything like CDN rules you cannot read from this origin.

## Pitfalls

- **Editing/publishing.** This skill *never* opens a PR, deploys, or writes to a repo unless the user explicitly and separately asks. Its job is audit.
- **Crawling the wrong host.** A canonical/`robots` check on `www` when search uses the bare domain (or vice versa) gives a false pass. Crawl the canonical host and confirm redirects.
- **Judging SEO on the dev/staging tier.** `noindex` or a restrictive staging `robots.txt` may be intentional; state the tier and compare it with that environment's policy.
- **Headers read over HTTP vs. production.** `curl -sI` over plaintext may return a redirect instead of headers; follow to HTTPS (`-L`) and read the final response.
- **Confusing "has a header" with "good policy."** Present-but-broad CSP or `max-age=0` HSTS is still a warn, not a pass.
- **JSON-LD that parses but isn't schema-valid.** Syntax-valid JSON can still fail rich-result validation; cross-check required fields per schema type.

## Verification

- Every checklist item has an observed evidence value (the actual header, tag, `robots.txt` line, or sitemap entry), not an assumption.
- You state which environment (prod/staging/dev) and canonical host were tested.
- Missing or malformed SEO metadata, `robots`/`sitemap` misconfigurations, and absent security headers are surfaced as explicit warns/blocks.
- The observability and rollback sections describe existing mechanisms and their coverage — and confirm no deploy/publish was performed.
- You can name the exact commands used (`curl -sI`, `browser_evaluate`, `web_extract`) so the audit is reproducible.

## References

- Google Search technical requirements and crawling/indexing guidance: https://developers.google.com/search/docs/essentials/technical
- Google robots.txt guidance: https://developers.google.com/search/docs/crawling-indexing/robots/intro
- MDN HTTP security guidance: https://developer.mozilla.org/en-US/docs/Web/Security
- MDN Content Security Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP
