---
name: web-request-validation
description: Validate all untrusted HTTP request input at the API boundary — allow-list validation, strict JSON Schema and content-type checks, and mass-assignment protection. Use when parsing or accepting any external request body, query, header, or parameter.
stack: webdev
---

# Web Request Validation

Untrusted input enters at the HTTP boundary and must be rejected before it flows into your logic or database. Validate early, by allow-list, against a strict schema, and never map a body wholesale onto a model. (Foundations align with OWASP Input Validation and REST Security, plus OWASP API3 Object Property Level Authorization.)

## When to Use

- Parsing a request body, query string, header, cookie, or path parameter from any external caller.
- Adding a route that accepts JSON, form, XML, or file uploads.
- Reviewing endpoints for injection, schema drift, or mass-assignment risk.

## Procedure

1. **Validate as early as possible**, at the API boundary, before any untrusted input reaches business logic or the database. Treat partner/vendor feeds and intra-service calls as untrusted too — not just browser clients.
2. **Prefer allow-list validation.** Enforce expected type, length, range, format, and multiplicity instead of relying on a deny-list. Decode exactly once using the protocol/framework parser, then validate the representation the application will actually consume; avoid ad hoc repeated normalization.
3. **Validate content types explicitly.** Check the request `Content-Type` and reject mismatched or unexpected media types with `415 Unsupported Media Type`. Do not guess or coerce content types loosely, and do not trust the header blindly.
4. **Validate JSON bodies against a strict JSON Schema.** Whitelist allowed values and field types before accepting input; verify every request/response body has a schema and that `additionalProperties` behavior is decided (reject or strip — but explicitly, not by accident).
5. **Reject, do not partially sanitize.** On validation failure, reject the input cleanly. Silently munging it hides defects and shifts responsibility downstream.
6. **Guard against mass assignment.** Never map an untrusted request body wholesale onto a model or ORM entity. Explicitly pick the writable fields; else an attacker can set `admin=true` or `role` by adding fields to the payload (OWASP API3).
7. **Observe validation failures safely.** Record bounded, structured failure categories without echoing secrets or full hostile payloads. Alert or rate-limit on meaningful abuse patterns rather than assuming every malformed client is an attack.

## Pitfalls

- Only validating client-side, or skipping "trusted" intra-service inputs entirely.
- Accepting `application/json` when the body is really form/XML, or trusting `Content-Type` without verifying it.
- Mapping request JSON directly onto an ORM entity → mass assignment / object-property auth bypass.
- Validating one representation and consuming another because decoding/normalization order differs.
- Mutating or truncating invalid input instead of rejecting it, hiding defects from the caller.

## Verification

- Every external input passes through centralized boundary validation after the framework's single protocol decode.
- Content types are validated, not just read; mismatches return `415`.
- Every JSON request/response body has a strict schema with `additionalProperties` behavior decided; a schema lint/CI check enforces it.
- A mass-assignment test asserts that extra/unexpected fields in a body are not persisted.

## References

- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- OWASP API Security Top 10: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
