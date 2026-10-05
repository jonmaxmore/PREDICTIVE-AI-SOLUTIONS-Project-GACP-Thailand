# ADR-001: Four-Pillar provider Departmental Structure

- Status: Accepted
- Date: 2026-02-22

## Context

Generic Provider roles alone did not match real DTAM operating boundaries and created ambiguity in ownership, queueing, and approvals.

## Decision

Model provider operations as four explicit pillars:

1. Central Dispatch (queueing, SLA assignment)
2. Unified Audit and Inspection (document + field + traceability checks)
3. Financial Reconciliation (payment dispute and bank reconciliation)
4. Executive Committee (KPI oversight and signature authority)

## Consequences

- Better alignment with ministry operations and training.
- Cleaner RBAC mapping by operational unit instead of ad hoc role labels.
- Fewer cross-team handoff ambiguities in approval and escalation paths.
