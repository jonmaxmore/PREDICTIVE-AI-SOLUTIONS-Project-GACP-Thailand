# ADR-012: Canonical Audit Log Write Path and Phased Hash-Chain Verification

- Status: Accepted
- Date: 2026-02-22

## Context

During preview-release hardening and rehearsal, two audit logging issues were identified:

1. `apps/backend/middleware/audit-logger.js` could hit `sequenceNumber` unique collisions under concurrent writes.
2. Legacy audit route/service path (`/api/audit` via `apps/backend/services/audit-trail.js`) still attempted to write `AuditLog` rows using an outdated schema shape, causing database audit persistence to fail and silently fall back.

The current phase prioritizes release confidence, regression stability, and minimal scoped changes. A full redesign of the audit hash-chain implementation (database locks, global sequencing, or stronger integrity verification pipeline) would increase risk and scope.

## Decision

1. Keep `apps/backend/middleware/audit-logger.js` as the canonical database writer for the immutable `AuditLog` model.
2. Adapt legacy `apps/backend/services/audit-trail.js` writes to call the canonical audit logger instead of writing Prisma rows directly with obsolete fields.
3. Treat `sequenceNumber` collision handling as a bounded retry (`maxAttempts = 3`) fix for this phase.
4. Defer stronger hash-chain verification enhancements (recomputing and validating `currentHash` from row contents, and high-contention sequencing guarantees) to a future hardening phase.

## Consequences

### Positive

- Restores database-backed audit persistence for the legacy `/api/audit` path without broad refactors.
- Reduces duplicate audit-write logic and schema drift risk.
- Addresses the observed concurrency issue with a low-risk targeted fix.
- Preserves release momentum and avoids over-engineering during the preview/deploy phase.

### Trade-offs

- Under sustained high contention, audit writes can still fall back after retry exhaustion and return `null` (non-blocking behavior preserved).
- `verifyChain()` currently validates linkage (`previousHash`) but does not fully recompute `currentHash` from stored row data.
- A future phase is still required for stronger integrity guarantees if regulatory or operational load demands increase.

