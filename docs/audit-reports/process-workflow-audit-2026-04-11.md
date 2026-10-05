# Process and Workflow Audit

Date: 2026-04-11
Scope: GACP Certification Application end-to-end process integrity, workflow ownership, navigation consistency, and deploy safety
Auditor: Codex

## Executive Summary

The system is operational in production, but the application workflow is not enforced by a single canonical engine.
Multiple routes and services still write application status directly, while the newer workflow transition service writes a different combination of fields.
This creates a structural risk where the runtime process can drift from the intended business process without producing an obvious crash.

Production health is currently stable, but the repo still contains migration-era coupling that should be treated as a deploy gate for future process-sensitive work.

## Severity-Ranked Findings

### P0. Workflow state has multiple competing sources of truth

The codebase currently uses at least three workflow carriers:

- Prisma field `state`
- Legacy field `status`
- JSON field `formData.workflowState`

The declared canonical model in Prisma says `state` is the primary field and `status` is a legacy alias synchronized by database trigger.
However, the workflow transition service writes `status` and `formData.workflowState`, but does not write `state`.

Evidence:

- `apps/backend/prisma/schema/application.prisma`
- `apps/backend/services/workflow-transition-service.js`

Relevant references:

- `application.prisma:27` documents `state` as primary and `status` as legacy alias via `trg_sync_app_state_status`
- `application.prisma:158` still defines `status`
- `workflow-transition-service.js:371` writes `status: nextLegacyStatus`
- `workflow-transition-service.js:375` writes `formData.workflowState: nextState`

Impact:

- Database truth is ambiguous
- Trigger failure or partial reads can create silent state drift
- Query/report/dashboard logic may disagree on actual process state

### P0. The system still has multiple workflow engines

The workflow transition service exists, but many routes and service methods bypass it and mutate `status` directly.
This means the system does not have one authoritative process engine.

Confirmed direct writers include:

- `apps/backend/routes/api/admin/applications.js`
- `apps/backend/routes/api/applications/application-workflow-handlers.js`
- `apps/backend/services/application-service/application-payment-finalization-methods.js`
- `apps/backend/services/application-service/application-review-revision-methods.js`
- `apps/backend/services/application-service/application-submission-methods.js`

Examples:

- `admin/applications.js:209` writes `status: nextStatus`
- `application-workflow-handlers.js:117` writes `status: targetStatus`
- `application-payment-finalization-methods.js:63` writes `status: newStatus`
- `application-payment-finalization-methods.js:156` writes `status: 'SUBMITTED'`
- `application-review-revision-methods.js:260` writes `status: 'EXPIRED'`
- `application-review-revision-methods.js:309` writes `status: 'SUBMITTED'`
- `application-submission-methods.js:122` writes `status: 'PAYMENT_1_PENDING'`

Impact:

- Transition rules can diverge by endpoint
- Audit history structure is inconsistent
- Notifications and side effects can fire differently for the same business event
- Future fixes become dangerous because behavior is distributed

### P1. Revision process vocabulary is inconsistent

The revision flow uses multiple status names for the same domain concept:

- `REVISION_REQUESTED`
- `REVISION_REQUIRED`
- `REVISION_REQ`

Evidence:

- `application-workflow-handlers.js:52` uses `REVISION_REQUESTED`
- `application-review-revision-methods.js:101` sets `REVISION_REQUIRED`
- `application-review-revision-methods.js` later accepts multiple revision aliases as valid revisable states

Impact:

- Revision SLA handling can desync from UI/report logic
- Filters and role-based work queues can miss applications
- Aliases mask incomplete migration rather than solving it

### P1. Payment lifecycle and workflow lifecycle are still modeled as different systems

The older payment-oriented statuses remain active:

- `PAYMENT_1_PENDING`
- `PAYMENT_1_PAID`
- `PAYMENT_2_PENDING`
- `PAYMENT_2_COMPLETED`

The newer canonical process uses document fee and audit fee stages instead:

- `PENDING_DOC_FEE`
- `DOC_FEE_PAID`
- `PENDING_AUDIT_FEE`
- `AUDIT_FEE_PAID`

Evidence:

- `application-submission-methods.js:122`
- `application-payment-finalization-methods.js:59`
- `application-review-revision-methods.js:41`

Impact:

- Business reporting and dashboards must translate between two process models
- Code complexity increases because every consumer needs compatibility logic
- Payment process changes are high risk because they touch both state vocabularies

### P1. The current application wizard still runs on legacy implementation

The current `new` route does not represent a full migration.
The active application step page imports configuration, hooks, and steps from `new-legacy`.

Evidence:

- `apps/web-app/src/app/health/applications/_components/application-step-page.tsx`

Examples:

- imports `FLOW_STEPS`, `ALL_STEPS`, and `STEP_DESCRIPTIONS` from `../new-legacy/application-flow-config`
- imports step components from `../new-legacy/steps/*`

Impact:

- Teams can mistakenly believe the new wizard architecture is already active
- Refactors may target the wrong code path
- Legacy runtime remains on the critical path of production behavior

### P2. Navigation is duplicated across multiple active sources

Navigation is defined separately in several files:

- `apps/web-app/src/lib/constants.ts`
- `apps/web-app/src/components/layout/app-shell.tsx`
- `apps/web-app/src/components/layout/mobile-bottom-nav.tsx`
- `apps/web-app/src/components/ui/sidebar.tsx`
- `apps/web-app/src/components/ui/mobile-header.tsx`
- `apps/web-app/src/components/ui/sidebar-nav.tsx`

These configs are not identical.
For example, some include `planting`, some do not, and some send users to `profile` while others prefer `settings`.

Impact:

- UX and information architecture are not centrally controlled
- Role nav and mobile/desktop behavior can drift over time
- Product simplification work becomes harder because changes must be repeated

### P2. Deprecated compatibility surfaces remain open

There are still deprecated workflow wrappers that re-export the new transition service:

- `apps/backend/shared/workflow-state-machine.js`
- `apps/backend/shared/status-machine.js`

Impact:

- New imports can continue to spread on legacy paths
- Architecture cleanup remains incomplete
- Dependency ownership is obscured

## Structural Root Cause

This is not mainly a bug problem.
It is a migration-control problem.

The codebase has started a canonicalization effort, but the old runtime paths were not fully retired.
As a result, the system currently operates as a hybrid of:

- new transition service
- legacy direct status mutation
- compatibility aliases
- duplicated frontend projection logic
- partially migrated UI flow

This creates a false sense of safety because production still looks healthy from the outside.

## What Is Outside the Intended Process

The following should be treated as out-of-process behavior and gradually removed:

- Direct `prisma.application.update({ data: { status: ... } })` outside the canonical transition layer
- Any new business logic that writes `formData.workflowState` manually
- Any route that introduces yet another status alias
- Any UI logic that infers process from a different status vocabulary than the backend
- Any wizard/runtime code that assumes `new` is canonical while importing `new-legacy` internally

## What Is Unnecessary or Redundant

- Duplicate workflow carriers: `state`, `status`, `formData.workflowState`
- Duplicate navigation definitions across layout and UI components
- Deprecated re-export wrappers for workflow logic
- Revision aliases that represent migration debt rather than required domain concepts
- Old payment-oriented status vocabulary if the platform has already standardized on document-fee and audit-fee phases

## Current Production Reality

Production runtime was previously verified as healthy:

- application responds successfully on `/api/health`
- production repo state is clean after deploy normalization
- startup logs no longer show prior noisy false-warning messages

This means the problem is structural correctness, not immediate production outage.

## Deploy Gate

Do not ship more workflow-sensitive features until these gates are addressed:

1. Define one canonical workflow field and make every writer use it
2. Move all state transitions behind one transition API/service
3. Freeze and normalize revision vocabulary to one status model
4. Decide whether `new` or `new-legacy` is the active wizard implementation, then remove ambiguity
5. Consolidate navigation config into one owned source per role/platform model

## Recommended Refactor Sequence

### Phase 1. Canonical truth lock

- Decide whether `state` or `status` is the domain field of record
- Keep one compatibility bridge only during migration
- Add assertions/tests to detect drift between workflow fields

### Phase 2. Transition consolidation

- Create one mandatory transition entry point
- Refactor all direct status writers to call it
- Move side effects behind transition hooks instead of route-local logic

### Phase 3. Vocabulary cleanup

- Collapse revision aliases into one canonical status
- Collapse payment status model into the current business fee-phase model
- Remove translation layers that exist only to support outdated names

### Phase 4. UI/runtime cleanup

- Declare whether the application wizard is still legacy-backed
- Either finish the migration or explicitly mark `new` as a shell over legacy until retirement
- Consolidate navigation definitions

### Phase 5. Removal and hardening

- Remove deprecated re-export wrappers
- Remove dead status names and dead dashboard translations
- Add integration tests for full happy path and revision path transitions

## Suggested Context Engineering Prompt

```text
Mission:
Consolidate the GACP Certification workflow into a single enforceable process model before shipping additional process-sensitive work.

Objective:
Eliminate workflow ambiguity across backend, database, and frontend by creating one canonical state model, one transition engine, and one active application wizard/runtime path.

Required outcomes:
1. Replace direct status mutations with one canonical transition service
2. Define one workflow source of truth and keep compatibility mapping temporary and explicit
3. Collapse revision and payment aliases into a single business vocabulary
4. Identify and retire legacy runtime paths, duplicate navigation configs, and deprecated workflow wrappers
5. Add tests that prove the full application lifecycle follows one valid transition graph

Constraints:
- Do not add new workflow features during consolidation
- Do not preserve aliases unless there is a documented migration reason
- Do not leave `new` and `new-legacy` both acting as runtime truth
- Do not allow route-level process logic to diverge from canonical transition logic

Expected output:
- severity-ranked findings
- canonical workflow map
- migration plan in safe phases
- removal list for dead or duplicate process logic
- deploy gate and rollback considerations
```

## Final Assessment

The system is serviceable, but not yet process-authoritative.
If the goal is a professional and durable production platform, the next engineering step should not be more feature layering.
It should be workflow consolidation.
