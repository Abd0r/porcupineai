---
name: anti-slop
description: Write code that does not look like AI output. Reject low-evidence and low-signal TypeScript patterns (chained assertions, unknown/object widening, Reflect, runtime typeof, module mocks) in favor of typed, boundary-checked code.
stack: coding
---

# Anti-Slop

Adapted from the MIT-licensed [anti-slop](https://github.com/dmmulroy/anti-slop) Oxlint rules by Dillon Mulroy. These are the mechanical rules that linters enforce; follow them as discipline in any code you write, and prefer mechanical enforcement (oxlint + the anti-slop plugin) where the target repo supports it.

## Core principle

Code must carry its own evidence. A type assertion, `unknown`, `object`, `{}`, or a runtime `typeof` check is a confession that the boundary is untyped. Fix the boundary instead of asserting over it.

## The rules (what to reject, what to do instead)

| Pattern | Reject | Instead |
|---|---|---|
| Chained type assertions | `const user = input as object as User;` | Parse and validate at the boundary once, then trust the typed value |
| Conditional empty-object spread | `...(timeout !== undefined ? { timeout } : {})` | Build the object explicitly or use a typed helper |
| Known-value widening | `const handlers: Record<string, Handler> = { start: startHandler };` | Preserve inference, or `satisfies Record<string, Handler>` |
| Module mocking | `vi.mock("./user-store")` | Real dependency seams: inject the dependency, do not mock the module |
| Broad `object` parameter | `function save(value: object) {}` | A real interface describing the shape |
| `Reflect.apply` / `Reflect.get` | `Reflect.apply(op, owner, args)` / `Reflect.get(owner, key)` | Typed function calls and typed property access; parse at the boundary when the data is genuinely dynamic |
| Runtime `typeof` narrowing | `if (typeof value === "string")` deep inside logic | Narrow at the boundary (parser, config, wire, file) so typed values flow inward |
| `unknown` in the signature | `function run(input: unknown)` | A concrete input contract; `unknown` only as an explicit `cause`-style convention |
| `unknown` / `Promise<unknown>` returns | `function load(): Promise<unknown>` | A real return type |
| Type aliases hiding `unknown` | `type Payload = unknown` | The actual shape |
| Unsafe dictionary values | `Record<string, unknown>` / `Record<string, object>` / `Record<string, {}>` | A typed value contract; parse at the boundary |
| Widen-then-assert flows | Widen a known value, assert it back later | Keep the narrow type from the source |
| Bare type assertions without a comment | `value as User` | `value as User // checked: ...` documenting the verified invariant, or boundary parsing |

## When to apply

- Any TypeScript/JavaScript you write or review, in any repository.
- Especially at module boundaries: parsers, config loaders, wire/API handlers, file readers, worker payloads.
- When you catch yourself about to write `as`, `unknown`, `object`, `Reflect`, or a `typeof` check: ask whether the boundary should be typed instead.

## Verification

- If the target repo has oxlint: wire the anti-slop plugin and let the linter enforce it mechanically.
- Otherwise: re-read the changed files against the table above before finishing. A review pass for slop is part of "verify the work".
