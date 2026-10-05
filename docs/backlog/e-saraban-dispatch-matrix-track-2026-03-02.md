# e-Saraban + Dispatch Matrix Track (Backlog + Estimate)

Date: 2026-03-02  
Owner: Platform Team (Frontend / Backend / Database)

## Goal

Build a government-ready document routing layer for internal provider operations:

- e-Saraban intake, registration, tracking, and disposition
- Dispatch Matrix for rule-based routing across units/roles
- Auditability, traceability, and integration with existing GACP workflows

## Delivery Scope

1. e-Saraban Core
2. Dispatch Matrix Engine
3. Integration with Application/Review lifecycle
4. Ops visibility (queue, SLA, exception handling)
5. UAT + hardening for go-live gate

## Backlog (Prioritized)

1. `ESB-01` Saraban schema and migration
- Description: create core tables (`saraban_documents`, `saraban_routes`, `saraban_actions`, `saraban_attachments`, `saraban_sla_events`)
- Estimate: 2 dev-days
- Dependency: none
- Acceptance:
- schema applied with migration
- FK/index strategy reviewed
- audit columns (`created_by`, `updated_by`, `request_id`) enforced

2. `ESB-02` Document registration API
- Description: intake endpoint for create/update/register saraban documents
- Estimate: 2 dev-days
- Dependency: `ESB-01`
- Acceptance:
- input validation (Zod/Joi)
- idempotency key support
- immutable registration number after commit

3. `ESB-03` Document lifecycle state machine
- Description: draft -> registered -> routed -> in_progress -> completed -> archived
- Estimate: 2 dev-days
- Dependency: `ESB-02`
- Acceptance:
- invalid transition blocked
- transition history persisted
- unit tests for edge transitions

4. `DMX-01` Dispatch matrix model
- Description: define rule model (`source_unit`, `doc_type`, `priority`, `amount_band`, `target_role`, `fallback_role`)
- Estimate: 1.5 dev-days
- Dependency: `ESB-01`
- Acceptance:
- DB model + seed examples
- admin-readable JSON contract

5. `DMX-02` Dispatch resolver service
- Description: evaluate matrix and produce deterministic route decisions
- Estimate: 2 dev-days
- Dependency: `DMX-01`
- Acceptance:
- deterministic matching order
- fallback routing path
- resolver unit tests (best/normal/bad cases)

6. `DMX-03` Queue assignment and reassignment API
- Description: assign/reassign tasks with reason codes and SLA carry-over
- Estimate: 2 dev-days
- Dependency: `DMX-02`
- Acceptance:
- reassignment audit trail
- role-based authorization
- queue metrics updated atomically

7. `ESB-04` e-Saraban inbox UI (provider)
- Description: inbox list, filters, detail pane, route actions
- Estimate: 3 dev-days
- Dependency: `ESB-02`, `DMX-03`
- Acceptance:
- keyboard + accessibility baseline
- pagination + search
- status/action labels aligned to government wording

8. `ESB-05` Dispatch matrix admin UI
- Description: CRUD for routing rules + simulation panel
- Estimate: 2.5 dev-days
- Dependency: `DMX-01`, `DMX-02`
- Acceptance:
- preview route simulation before publish
- versioned rule snapshots

9. `OPS-01` SLA monitoring and exception dashboard
- Description: overdue, blocked, bounced, and manual override insights
- Estimate: 2 dev-days
- Dependency: `ESB-03`, `DMX-03`
- Acceptance:
- daily queue health view
- downloadable CSV report

10. `INT-01` Integration with current GACP application workflow
- Description: link saraban items to application IDs and review tasks
- Estimate: 2 dev-days
- Dependency: `ESB-03`
- Acceptance:
- deep links from provider/health modules
- one-source-of-truth mapping table

11. `QA-01` UAT + regression bundle
- Description: journey tests, smoke tests, and rollback checklist
- Estimate: 2 dev-days
- Dependency: all above
- Acceptance:
- UAT runbook complete
- pass criteria signed by product owner

## Total Estimate

- Backend: 11.5 dev-days
- Frontend: 7.5 dev-days
- Database: 2.5 dev-days
- QA/UAT: 2 dev-days
- Total: 23.5 dev-days (single team lane)

Parallelized two-lane execution target: 12 to 14 working days.

## Risks and Mitigation

1. Rule explosion in dispatch matrix
- Mitigation: hard cap rule depth + deterministic priority order

2. Reassignment without governance
- Mitigation: mandatory reason code + immutable action log

3. Queue lag at peak periods
- Mitigation: background workers + SLA event indexing

## Definition of Done

1. All acceptance criteria completed
2. No blocker defects in UAT
3. Lint/typecheck/tests pass on changed modules
4. Handoff docs and operational runbook updated
