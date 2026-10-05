# Audit Integrity Hardening (Next Phase)

- Status: **Resolved (verified 2026-05-05)** — Phase A + Phase B completed in-place
- Owner: Backend/Security
- Priority: Medium (raise to High if audit volume increases or compliance scope tightens)
- Related ADR: `docs/adr/ADR-012-audit-log-canonical-write-path-and-phased-chain-verification.md`
- Review Checklist: `docs/backlog/audit-integrity-hardening-review-checklist.md`

## Resolution Note (2026-05-05)

The Phase A + Phase B work outlined below was already merged in earlier
hardening waves. Verified during the T-014/PR-02 follow-up audit:

- **Phase A** — `verifyChain()` in `apps/backend/middleware/audit-logger.js`
  (lines ~328–390) already recomputes `currentHash` from the persisted row
  fields via `generateHash(buildHashPayload(…))` and emits a
  `HASH_MISMATCH` corruption entry when the recomputed hash diverges from
  the stored value. It also emits `HASH_RECOMPUTE_ERROR` when `createdAt`
  cannot be normalized to ISO. The original gap (only checking
  `previousHash` link) is closed.
- **Phase B** — Test coverage for all four acceptance items lives in the
  audit unit suite:
  - `__tests__/unit/audit-logger.test.js:23` — retry success on
    `sequenceNumber` unique conflict
  - `__tests__/unit/audit-logger.test.js:67` — retry exhaustion returns
    `null` and preserves non-blocking behavior
  - `__tests__/unit/audit-logger.test.js:113` — `verifyChain` detects
    tampered `currentHash` even when `previousHash` link matches
  - `__tests__/unit/audit-logger.test.js:164` — `verifyChain` reports
    `HASH_RECOMPUTE_ERROR` when `createdAt` is invalid
  - `__tests__/unit/audit-trail.test.js:16` — legacy `audit-trail`
    adapter still routes through the canonical logger
  - `__tests__/unit/audit-trail.test.js:81` — adapter preserves
    non-blocking behavior when canonical logger fails

- **Phase C** — Sequencing hardening remains a decision gate (not
  automatic). Re-open when contention metrics warrant.

## Original Problem Summary

Current audit logging is stable enough for the preview/release phase, but two integrity gaps remain:

1. `apps/backend/middleware/audit-logger.js` uses bounded retry (`maxAttempts = 3`) for `sequenceNumber` collisions and may still fall back under high contention.
2. `verifyChain()` checks chain linkage (`previousHash`) but does not recompute `currentHash` from stored row data to detect payload tampering.

## Goal

Improve audit integrity guarantees without breaking current non-blocking audit behavior for user-facing requests.

## In Scope

1. Add stronger integrity verification path that recomputes `currentHash` from persisted row contents.
2. Add tests for:
   - sequence collision exhaustion behavior
   - hash recomputation mismatch detection
   - legacy adapter path (`apps/backend/services/audit-trail.js`) still writing through canonical logger
3. Add operational runbook note or command for periodic audit verification (manual/admin use).
4. Review and document contention thresholds that justify stronger sequencing controls.

## Out of Scope (for this ticket)

1. Full audit subsystem redesign.
2. Converting audit writes to a queue/worker.
3. Global DB locks/advisory locks by default.
4. Breaking change to make audit logging block API responses on failure.

## Proposed Implementation (Phased)

### Phase A: Verification Correctness (low risk)

1. Add a `recomputeHash` verification routine in `apps/backend/middleware/audit-logger.js` (or extracted helper) that validates:
   - `previousHash` chain linkage
   - `currentHash` recomputed from stored row fields
2. Keep current `verifyChain()` public API compatible if possible; add richer result payload only as additive fields.

### Phase B: Test Coverage / Safety Nets (low risk)

1. Add unit tests for recomputation mismatch detection.
2. Add unit tests for retry exhaustion path (after 3 conflicts returns `null` and logs fallback).
3. Add unit test for `services/audit-trail.js` adapter mapping to canonical logger.

### Phase C: Sequencing Hardening (decision gate, not automatic)

1. Measure contention frequency from logs/metrics.
2. If collisions remain material, evaluate one of:
   - DB-backed monotonic sequence source for `sequenceNumber`
   - transaction/locking strategy around sequence allocation
   - alternate append design preserving hash chain order
3. Record decision in a new ADR before implementation.

## Acceptance Criteria

1. `verifyChain()` (or equivalent admin verification path) can detect tampered `currentHash` rows, not only broken `previousHash` links.
2. Tests cover retry success and retry exhaustion behavior.
3. Legacy audit route path (`/api/audit`) still persists to DB through canonical logger path.
4. No regression in existing non-blocking audit behavior (request flow continues if audit write fails).

## Validation Plan

1. `pnpm --dir apps/backend exec eslint middleware/audit-logger.js services/audit-trail.js __tests__/unit/*.test.js`
2. `pnpm --dir apps/backend exec jest __tests__/unit/audit-logger.test.js --runInBand`
3. Add and run any new audit-trail adapter unit test(s).
4. Manual smoke: trigger `/api/audit` route in local rehearsal and confirm DB writes land in `audit_logs`.

## Risks / Trade-offs

1. Recomputing hashes requires a stable field set and serialization order; changing either can invalidate verification.
2. Stronger sequencing guarantees can reduce throughput if implemented with coarse locking.
3. Over-hardening too early can slow feature delivery without measurable compliance benefit.

## Notes for PM / Review

1. Start with Phase A + B only.
2. Treat Phase C as conditional on observed contention, not mandatory scope.
3. Keep commits small and reversible; avoid touching unrelated audit/UI files.
