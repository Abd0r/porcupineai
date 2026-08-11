---
name: web-auth-and-sessions
description: Secure authentication, sessions, and cookies — session-ID hygiene, correct cookie attributes, JWT integrity, lifecycle/timeouts, and object-level authorization (BOLA). Use when implementing or reviewing login, session, cookie, or token handling in a web app.
stack: webdev
---

# Web Auth and Sessions

Once an authenticated session is established, the session ID is temporarily equivalent to the strongest credential the user holds — so its disclosure, capture, prediction, brute force, or fixation means hijacking. Build sessions to be opaque, cookie-secure, lifecycle-disciplined, and always paired with object-level authorization. (Foundations align with OWASP Session Management and REST Security, plus OWASP API1/API2 for object-level authorization and authentication failures.)

## When to Use

- Implementing login, logout, session creation, cookies, or token (JWT/OAuth) handling.
- Adding a route that reads a user-scoped resource identified from the client.
- Reviewing an app for session fixation, cookie-attribute gaps, or horizontal/vertical privilege escalation.

## Procedure

1. **Use TLS for all authenticated traffic.** Transport-layer security protects the session ID and credentials in transit; secure cookies over HTTPS only.
2. **Keep session IDs opaque and unpredictable.** High entropy and sufficient length; do not embed meaningful personal data in the ID; treat it as untrusted user input everywhere it appears.
3. **Set deliberate cookie attributes.** Use `Secure` and `HttpOnly`; choose `SameSite=Strict`, `Lax`, or a narrowly justified `None; Secure` according to the real cross-site flow. Prefer `__Host-` when its host-only/`Path=/` constraints fit. Scope `Domain`, `Path`, and lifetime deliberately. SameSite is defense-in-depth, not a complete CSRF control; protect unsafe cookie-authenticated requests with the framework's vetted CSRF mechanism and origin checks.
4. **Renew and expire on a disciplined lifecycle.** Renew the session ID after login and privilege changes. Enforce idle and absolute timeouts; provide logout that invalidates server state and clears the cookie. Prevent authenticated pages with sensitive content from being restored from an inappropriate cache.
5. **Use context changes as anomaly signals, not brittle identity binding.** IP and user-agent may change legitimately. Risk-score suspicious reuse, revoke when warranted, and require recent authentication for sensitive operations.
6. **Enforce JWT integrity when tokens are used.** Require signature or MAC — never allow the unsecured `{"alg":"none"}` or a permissive `alg` allow-list. Validate algorithm, issuer, audience, and expiry; prefer signatures over MACs and short-lived tokens with refresh rotation.
7. **Centralize authentication; authorize locally per object.** Let an identity provider issue access tokens, but make the authorization decision at each endpoint on the resource (OWASP REST Security). Always check object-level authorization in addition to authentication — authorizing object IDs taken from the client is the #1 API risk (BOLA).

## Pitfalls

- Session fixation: failing to renew the session ID after login.
- Cookies missing `HttpOnly`/`Secure`, or a SameSite policy that does not match the flow, increase theft/CSRF exposure.
- Configuring `Domain` too broadly or `Path=/` on a cookie that should be tighter-scoped.
- Accepting JWTs with `"alg":"none"` or an overly permissive algorithm allow-list.
- Authenticating but skipping object-level authorization (BOLA) → horizontal privilege escalation.
- No absolute timeout → stolen tokens stay valid indefinitely.

## Verification

- Session IDs/refreshed after privilege changes; idle, absolute, and renewal timeouts enforce bounds; logout destroys the session server-side and clears cookies.
- Cookies carry deliberate `Secure`, `HttpOnly`, `SameSite`, path/domain, and lifetime settings; unsafe cookie-authenticated requests have tested CSRF protection.
- JWT validation rejects `alg:none` and algorithm-confusion payloads; issuer/audience/expiry are enforced.
- BOLA tests deny access to another user's objects and function-level authorization tests cover privileged operations.

## References

- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
