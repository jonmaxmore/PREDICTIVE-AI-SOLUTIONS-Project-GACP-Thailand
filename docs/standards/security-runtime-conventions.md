# Security Runtime Conventions

Effective date: `2026-02-22`  
Scope: backend runtime code (`apps/backend/**`) and release gates

## Goal

Keep critical security behavior consistent and enforceable without relying on manual review only.

## 1) Client IP Extraction Rule

- Do not read `req.ip` directly in runtime code.
- Always use `getRequestIp(req)` from `apps/backend/utils/client-ip.js`.
- Exception (allowed): compatibility handling inside `client-ip.js` and related unit test.

Reason:
- Direct `req.ip` is proxy-dependent and easier to spoof in misconfigured chains.

## 2) Randomness Rule

- Do not use `Math.random()` in backend runtime code.
- Use `crypto` APIs (`crypto.randomInt`, `crypto.randomBytes`) for generated IDs/tokens/codes.

Reason:
- `Math.random()` is not suitable for security-sensitive identifiers and recovery artifacts.

## 3) Enforcement Gate

Machine check:

```bash
npm run check:security-conventions
```

This runs:

- `scripts/ci/check-security-conventions.js`

CI/preview gate integration:

- `gate:auth-hardening` runs this check before auth hardening tests and lint.

## 4) Change Policy

- If a new legitimate exception is required, document the reason and update:
  - `scripts/ci/check-security-conventions.js` allowlist
  - related ADR/scope note in the same PR
