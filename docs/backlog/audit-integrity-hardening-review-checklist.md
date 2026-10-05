# Audit Integrity Hardening - Review Checklist

- Status: Reviewer/Tester Checklist
- Scope: `docs/backlog/audit-integrity-hardening-phase-next.md`
- Related ADR: `docs/adr/ADR-012-audit-log-canonical-write-path-and-phased-chain-verification.md`

## Pre-Review Scope Check

- [ ] Change set is limited to audit integrity hardening scope (`audit-logger`, `audit-trail`, related tests/docs).
- [ ] No unrelated UI/feature refactors are mixed into the same PR.
- [ ] Any schema/database change is justified by this ticket and paired with migration (if applicable).

## Phase A - Verification Correctness

- [ ] `verifyChain()` (or equivalent verification path) still validates `previousHash` linkage.
- [ ] Verification now recomputes and validates `currentHash` from persisted row data.
- [ ] Recomputed hash uses a stable field set and stable serialization order.
- [ ] Changes are additive/backward-compatible for current callers (no breaking API shape without explicit approval).
- [ ] Tampered row scenario is detectable and reported clearly in the verification result.

## Phase B - Test Coverage / Safety Nets

- [ ] Unit test covers `sequenceNumber` collision retry success path.
- [ ] Unit test covers retry exhaustion path (after max retries returns `null` and logs fallback).
- [ ] Unit test covers hash recomputation mismatch detection.
- [ ] Unit test covers legacy `services/audit-trail.js` adapter path writing through canonical logger.
- [ ] Existing audit-related tests still pass without flaky timing assumptions.

## Non-Blocking Behavior (Regression Guard)

- [ ] Audit write failure still does not break user-facing API flows.
- [ ] Fallback logging remains visible enough for ops/debugging (`[AUDIT_FALLBACK]` or equivalent).
- [ ] No new synchronous bottleneck is introduced in hot request paths without explicit measurement.

## Operational / Manual Verification

- [ ] Reviewer can run documented validation commands from the backlog spec.
- [ ] Manual smoke test confirms `/api/audit` path can still land records in `audit_logs` (local rehearsal).
- [ ] Any new operational verification command/runbook note is documented and reproducible.

## Security / Integrity Review

- [ ] No downgrade to hash algorithm or integrity fields.
- [ ] No unsafe randomness introduced.
- [ ] No direct `req.ip` regressions introduced in touched runtime files.
- [ ] No sensitive values are unnecessarily logged into audit metadata.

## Release / Process Hygiene

- [ ] Commits are small and reversible.
- [ ] ADR update is added only if architectural direction changes materially (otherwise backlog/task docs only).
- [ ] Release notes / handoff notes mention behavior changes if verification output shape changed.

## Go / No-Go Summary

- [ ] GO: All required checks above pass, scope remains bounded, and no blocking regressions found.
- [ ] NO-GO: Any of the following exists:
- [ ] Verification misses tampered `currentHash` rows.
- [ ] Retry exhaustion or fallback behavior is untested.
- [ ] PR includes unrelated refactors or unreviewed schema changes.

