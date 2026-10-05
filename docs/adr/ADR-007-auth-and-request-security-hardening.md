# ADR-007: Auth and Request Security Hardening

- Status: Accepted (updated 2026-04-09)
- Date: 2026-02-22

## Context

Security review identified three high-risk patterns:

1. OAuth-like identity callback path could auto-create/link users without explicit operator policy.
2. Inconsistent direct use of `req.ip` across middleware/routes risks incorrect client attribution under proxy chains.
3. Security-sensitive random generation existed with `Math.random` in 2FA backup code generation.

## Decision

- Remove ThaID mock/OAuth integration entirely (feature removed in production hardening).
- Introduce centralized client IP utility (`apps/backend/utils/client-ip.js`) and use it for:
  - global/auth rate limiter key generation
  - auth audit logging
  - public trace request attribution
  - security middleware logging/rate controls
- Replace `Math.random` usage in 2FA backup code generation with cryptographically secure randomness (`crypto.randomBytes`).

## Consequences

- Eliminated attack surface from identity auto-linking.
- More consistent request attribution and rate limit behavior behind proxies.
- Stronger entropy for security recovery artifacts.
