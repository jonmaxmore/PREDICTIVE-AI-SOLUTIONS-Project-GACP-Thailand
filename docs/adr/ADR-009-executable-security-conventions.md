# ADR-009: Enforce Executable Security Conventions for IP and Randomness

- Status: Accepted
- Date: 2026-02-22

## Context

Security hardening work fixed critical issues (`req.ip` handling and unsafe runtime randomness), but these patterns can regress over time during feature delivery.

Manual code review alone is insufficient to guarantee consistency across all backend routes/services.

## Decision

Adopt machine-enforced repository rules:

1. Add `scripts/ci/check-security-conventions.js` to fail CI when:
   - runtime backend code uses direct `req.ip` (except explicit compatibility allowlist)
   - runtime backend code uses `Math.random()`
2. Integrate this script into `gate:auth-hardening` so it runs before tests/lint.
3. Publish team-facing rule document:
   - `docs/standards/security-runtime-conventions.md`

## Consequences

### Positive

- Prevents silent reintroduction of known security anti-patterns.
- Makes conventions explicit for both humans (docs) and automation (gate script).
- Keeps preview/deploy standards aligned with ADR-008 gate discipline.

### Trade-offs

- New valid exceptions require allowlist updates and justification in PR.
- Gate maintenance is required if directory structure or intentional boundaries change.
