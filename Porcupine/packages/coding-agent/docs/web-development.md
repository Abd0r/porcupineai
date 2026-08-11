# Web Development Stack

The `webdev` stack is Porcupine's production web-application capability domain. It is separate from `web`: `web` researches the public internet, while `webdev` designs, builds, inspects, tests, secures, and ships web applications.

Discover it with:

```text
/stacks stack:webdev
```

Skills are progressively disclosed. Use `capability_search` or `/skill:<name>` to load the procedure that matches the task.

## Skills

| Skill | Focus |
| --- | --- |
| `frontend-development` | Semantic HTML, modern CSS, component structure, and frontend correctness |
| `ui-design-systems` | Design tokens, CSS custom properties, reusable components, and theming |
| `responsive-design` | Fluid/mobile-first layouts and multi-viewport verification |
| `web-accessibility` | WCAG 2.2, semantic HTML, keyboard/focus behavior, ARIA, and axe checks |
| `http-api-design` | HTTP method/status semantics, idempotency, versioning, and OpenAPI |
| `web-request-validation` | Boundary schemas, content types, allowlists, and mass-assignment protection |
| `web-auth-and-sessions` | Cookie/session lifecycle, JWT validation, CSRF, and object authorization |
| `database-migrations` | Immutable migrations, expand-and-contract changes, backfills, and recovery |
| `web-observability` | Traces, metrics, structured logs, safe errors, limits, caching, and health checks |
| `browser-qa` | Real-browser functional, semantic, responsive, runtime, and visual checks |
| `web-performance` | Lighthouse, resource timing, Core Web Vitals, and CI budgets |
| `seo-and-deployment` | Metadata, robots/sitemaps, response headers, rollout, observability, and rollback readiness |

The skills are framework-neutral. They inspect and follow the project's existing framework, package manager, test runner, lint rules, deployment platform, and database migration system rather than replacing them.

## Native browser tools

The Playwright browser tools are routed under `stacks/webdev/browser/...`:

- `browser_navigate`
- `browser_snapshot`
- `browser_click`
- `browser_type`
- `browser_wait`
- `browser_extract`
- `browser_resize`
- `browser_diagnostics`
- `browser_screenshot`
- `browser_evaluate`

A reliable browser workflow is:

1. Navigate.
2. Inspect with `browser_snapshot` and prefer its ARIA refs for interaction.
3. Act with click/type.
4. Wait for a meaningful selector, never an arbitrary sleep.
5. Assert with snapshot/extract.
6. Resize and capture mobile plus desktop states.
7. Check `browser_diagnostics` for console, page, request, and HTTP failures.
8. Save screenshots when visual evidence matters.

See [Browser use](browser.md) for setup, arguments, examples, and safety constraints.

## End-to-end development loop

1. **Discover:** inspect the repository's architecture, scripts, conventions, and existing UI/API patterns.
2. **Choose skills:** load only the relevant `webdev` procedures; use existing `coding`, `build`, `debug`, and `safety` skills for cross-cutting work.
3. **Build a vertical slice:** make the smallest complete UI-to-API-to-data change instead of disconnected layers.
4. **Run repository-native checks:** formatting, typecheck, unit/component/integration tests, and configured web linters.
5. **Use a real browser:** verify semantics, interactions, async states, responsive layouts, diagnostics, and screenshots.
6. **Check production qualities:** accessibility, security boundaries, performance, metadata, observability, migration safety, and rollback readiness as applicable.
7. **Report evidence:** name commands, tests, URLs/viewports, diagnostics, and remaining gaps. Never claim browser or deployment verification that was not performed.

## Local development servers

The browser blocks loopback and private hosts by default as an SSRF defense. For a trusted local project, start Porcupine with:

```bash
PORCUPINE_BROWSER_ALLOW_INTERNAL=1 porcupine
```

This disables the internal-host protection for that session. Do not use it while browsing untrusted URLs or acting on untrusted page content.

## Tool boundaries

- Lighthouse, axe, HTML/CSS linters, and framework test runners remain repository-aware shell procedures. Porcupine does not install them into a project unless the task requires it and the dependency change is intentional.
- `browser_diagnostics` stores bounded messages and strips credentials/query strings from failed-request URLs. It does not replace a full network trace.
- ARIA snapshots and automated accessibility scanners do not prove WCAG conformance. Keyboard, focus, content, and assistive-technology behavior still need targeted review.
- Deployment and publishing remain explicit user-approved actions. The stack can prepare and verify a release without silently publishing it.
