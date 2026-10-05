# ADR-003: Offline-First via IndexedDB

- Status: Accepted
- Date: 2026-02-22

## Context

Field usage frequently happens in unstable or no-network areas. Losing form/audit data mid-workflow is unacceptable for users and operations.

## Decision

- Treat offline resilience as a first-order requirement for Applicant wizard and field audit tooling.
- Persist client draft state locally (IndexedDB/idb-based persistence).
- Surface sync state (`pending` vs `synced`) in UX.

## Consequences

- Strong resilience in low-connectivity environments.
- Added complexity in sync orchestration and conflict handling.
- Requires backend conflict strategy (see ADR-004).
