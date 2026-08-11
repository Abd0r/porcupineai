---
name: http-api-design
description: Design a coherent HTTP/REST API surface — method semantics, correct status-code classes, explicit versioning, idempotency, and an OpenAPI contract. Use when designing or reviewing any HTTP API's routes, status codes, or request/response shape.
stack: webdev
---

# HTTP API Design

A good HTTP API is self-documenting: correct method semantics and status codes let clients branch reliably without parsing error bodies. Design the contract up front, describe it in OpenAPI, and keep the inventory explicit. (Foundations align with RFC 9110 for HTTP semantics, MDN for status-code classes, and the OpenAPI Specification for the contract.)

## When to Use

- Designing routes, verbs, status codes, or versioning for a new or existing HTTP API.
- Reviewing an API where clients must branch on error behavior or where responses change silently.
- Introducing an OpenAPI contract or the first versioned endpoint.

## Procedure

1. **Map methods to resource semantics per RFC 9110.** `GET` read/safe/cacheable; `POST` create or invoke an action (non-idempotent); `PUT` full replace (idempotent); `PATCH` partial update; `DELETE` remove (idempotent). Reject verbs a resource does not support with `405 Method Not Allowed`.
2. **Pick the status-code class, then the exact code.** Use `200 OK`, `201 Created` after a POST that created a resource, `202 Accepted` for async/no-immediate result, `204 No Content` for successful DELETE/void, `400 Bad Request` for malformed/undecodable input, `401` (semantically *unauthenticated*), `403` (authenticated but unauthorized), `404 Not Found`, `409 Conflict` (state conflict), `413 Content Too Large`, `415 Unsupported Media Type`, `422 Unprocessable Content` (well-formed but semantic error). If both `400` and `422` could apply, pick one team-wide convention and document it — standards do not mandate a single mapping.
3. **Design for idempotency and retries** on `PUT`/`DELETE`. Where freshness matters, use conditional requests (`ETag`/`If-None-Match`, `412 Precondition Failed`, `304 Not Modified`).
4. **Version explicitly and keep an inventory.** Prefer a date- or `/v1`-style version segment. Track all public endpoints and their versions (OWASP API9: Improper Inventory Management); document deprecation and schedule removal so stale/debug endpoints do not linger.
5. **Describe the contract in OpenAPI (v3.1).** Define paths, methods, parameters, and each response's body and status codes, language-agnostically. Validate requests and responses against the spec so the document is the source of truth — not a stale side note.
6. **Add hypermedia (HATEOAS) only if consumers will use it.** Do not over-engineer; standard verbs plus status codes already make most APIs self-documenting.

## Pitfalls

- Returning `200` with an error body instead of the correct 4xx/5xx — clients cannot branch reliably.
- Using `401` for authorization failures (should be `403` once identity is known).
- Mutating an unversioned API in place; deleting or changing responses silently.
- Inventing non-standard `200`/`302` semantics for delete or search flows.
- No `405`/`413`/`415` handling → ambiguous client errors.

## Verification

- Every public route's method maps to a clear resource semantic; verbs a resource does not support return `405`.
- Status codes are class-correct (4xx for client error, 5xx for server error), with `401`/`403` semantics respected and a single documented `400`-vs-`422` convention.
- The API is versioned, and an endpoint inventory exists with deprecation scheduled for any obsolete version.
- An OpenAPI document describes every route/parameter/response; a CI linter fails on undocumented endpoints or missing response codes.
