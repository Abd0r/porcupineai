---
name: web-observability
description: Build production web observability with correlated traces, metrics, structured logs, safe error contracts, resource limits, and cache visibility. Use when instrumenting services, diagnosing production gaps, or defining operational readiness.
stack: webdev
---

# Web Observability

Make failures explainable before they happen. Instrument request boundaries and dependencies while keeping client errors safe and telemetry free of secrets.

## When to Use

- Adding or reviewing logging, metrics, tracing, health checks, or error handling.
- Preparing a web service for production or diagnosing incidents with missing evidence.
- Adding caching, rate limits, timeouts, queues, or upstream dependencies.

## Procedure

1. Define the service's critical user journeys and service-level signals: request rate, errors, latency, saturation, queue depth, and dependency health. Avoid collecting metrics with no decision attached.
2. Propagate one request/trace identifier across HTTP boundaries, background work, database calls, and logs. Prefer OpenTelemetry-compatible instrumentation over vendor-locked call sites.
3. Emit structured logs with event name, severity, timestamp, trace/request id, route template, status, and duration. Never log credentials, session tokens, raw authorization headers, or unnecessary personal data.
4. Centralize the error boundary. Return stable, documented client error codes and correct HTTP status without stack traces or internals; record trusted-side detail with correlation ids.
5. Bound every resource: request/body size, concurrency, upstream timeout, retry count with backoff/jitter, queue length, and per-client rate. Return `413`, `429` plus `Retry-After`, or a bounded timeout when appropriate.
6. Make cache behavior observable. Verify `Cache-Control`, `Vary`, validators, hit/miss signals, and that personalized responses are `private` or `no-store`.
7. Add readiness/liveness checks that prove only what their name promises. Readiness should fail when the instance cannot serve; liveness must not flap because an optional dependency is slow.
8. Test operational failure paths: dependency timeout, malformed request, rate-limit exhaustion, cache bypass, queue saturation, and telemetry exporter failure.

## Pitfalls

- High-cardinality metric labels such as user ids or raw URLs can overwhelm the backend.
- Logging the same exception at every layer creates noise, not evidence.
- Retrying non-idempotent operations can duplicate writes.
- Returning internal stack traces or SQL/provider errors to clients.
- Cookies do not make a response private in shared caches.
- Health checks that perform expensive real work can become an outage source.

## Verification

- One test request can be followed across ingress, dependencies, background work, and logs by a correlation id.
- Error responses match the documented contract and contain no internals or secrets.
- Timeout, retry, rate-limit, payload-limit, and queue bounds have behavioral tests.
- Personalized responses cannot enter shared caches; cache decisions are visible.
- Telemetry failures degrade safely and never break the request path.

## References

- OpenTelemetry instrumentation concepts: https://opentelemetry.io/docs/concepts/instrumentation/
- MDN HTTP caching: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- OWASP API Security Top 10: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
