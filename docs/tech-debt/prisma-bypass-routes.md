# Prisma Bypass in Route Handlers — Outstanding Tech Debt

## Background

Route handlers under `apps/backend/routes/api/**` were directly importing the
Prisma client and issuing model queries (`prisma.user.findMany`,
`prisma.application.update`, etc.) instead of going through a service-layer
function. This pattern bypasses the canonical filters that services enforce —
soft-delete (`isDeleted: false`), ownership predicates (`healthId`,
`applicantId`), PDPA-safe column projections, and audit logging — and forces
the same row-level rules to be re-implemented at each call site.

Each duplicate is a place a future change can drift, and that drift has caused
PII leaks before (the admin-users column projection, the certificate-verify
soft-delete filter, the CAR ownership predicate). The fix is to keep the
DB access in one place per domain and let the routes call service methods.

## Scope and progress (snapshot: 2026-05-16)

| Status         | Count |
|----------------|-------|
| Total bypass routes audited                                   | 99 |
| Refactored across batches 9 + 10 + 11 + 12 + 13 + 14 + 15 + 16 | 72 |
| **Remaining**                                                 | **27** |

`prisma.` occurrence total in the remaining files: **~149**
(518 − 66 calls retired in batch 10 − 40 calls retired in batch 11
− 18 calls retired in batch 12 − 42 calls retired in batch 13
− 54 calls retired in batch 14 − 115 calls retired in batch 15
− 34 calls retired in batch 16).

**MILESTONE: Remaining is now below 30.** The original audit found 99
direct-prisma route files; 72 are now service-routed. The remainder is
concentrated in two cluster types: large multi-call admin / applications
files (5–13 calls each) that need targeted service-method introductions,
and the system / interoperability / preview clusters that share a
read-mostly analytics surface and can collapse into 2–3 new services.

### Routes refactored in batch 9 (2026-05-15)

| Route                                                | Service used                                           |
|------------------------------------------------------|--------------------------------------------------------|
| `routes/api/certificates/certificates.js`            | `certificate-service.{listCertificates, listCertificatesForUser, getCertificateForUser, findByCertificateNumber}` (new methods) |
| `routes/api/auth/public.js`                          | `certificate-service.findByCertificateNumber`          |
| `routes/api/finance/payments.js`                     | `invoice-service.listForPaymentsView`, `application-service.findForPaymentOwnership` (new methods) |
| `routes/api/applications/applications-car.js`        | `application-service.findOwnedApplicationForApplicant`, `provider-user-service.listActiveProviders` (new methods) |
| `routes/api/admin/users.js`                          | `provider-user-service.{searchAdminUsers, getActiveAdminUserGuard, updateAdminUser}` (new methods) |

Note: `applications-car.js` still imports the Prisma client, but only as a
transaction handle passed into `writeApplicationStatus`, which requires it by
contract. No direct `prisma.X.find/update` calls remain.

### Routes refactored in batch 10 — Provider handlers (2026-05-16)

Top-of-cluster `provider/handlers/*` files migrated to service-layer calls.
Each file now has **zero** direct `prisma.X.find/update/create/groupBy/count`
calls. `prisma` import is retained only where the canonical
`writeApplicationStatus` writer requires it as a transaction handle.

| Route                                                                 | Service used                                                                                                          |
|-----------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `routes/api/provider/handlers/planting.js`                            | `planting-service.{listProviderCycles, aggregateCycleIntegrity, getProviderCycleDetail, listProviderCycleActivities, getProviderCyclePlotQrs}` (new methods) |
| `routes/api/provider/handlers/admin-dashboard-handler.js`             | new `admin-dashboard-service.{getApplicationStatusCounts, countApplicationsCreatedSince, countPendingRevisionDeadlinesPastDue, sumCompletedPaymentsSince, listAuditorUsers, countAuditorActiveAssignments, listRecentApplications}` |
| `routes/api/provider/handlers/admin.js`                               | new `admin-application-service.{listPendingRevisionDeadlines, findApplicationsByIds, findLatestPendingRevisionDeadline, updateRevisionDeadlineDue, findApplicationWorkflowSlice, appendWorkflowHistoryOnly, findApplicationStatusOverrideSlice}` |
| `routes/api/provider/handlers/certificates.js`                        | `certificate-service.{getProviderDashboardAggregates, listExpiringActiveCertificates}` (new methods) |
| `routes/api/provider/handlers/applications.js`                        | `application-service.{listProviderQueue, countProviderQueue, findByIdOrApplicationNumber, getById}` (new methods on `application-provider-query-methods`) |
| `routes/api/provider/handlers/workflow-transitions-handler.js`        | `application-service.{findFirstWithWhere, getById, isApplicationCommentModelAvailable, createApplicationCommentIfAvailable}`, `admin-application-service.bulkUpdateRevisionDeadlineStatus` |
| `routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js` | `application-service.{findFirstWithWhere, findAuditorScheduleCandidates, getById, updateApplicationColumns}`, `provider-user-service.findActiveProviderById` |
| `routes/api/provider/handlers/auditor-session-handler.js`             | `application-service.{findFirstWithWhere, updateApplicationColumns}`                                                  |
| `routes/api/provider/handlers/scheduler-assign-reviewer-handler.js`   | `application-service.{findFirstWithWhere, writeAssignmentColumns}`, `provider-user-service.{findActiveProviderReviewerById, listReviewerCandidates}` |
| `routes/api/provider/handlers/workflow-side-effects.js`               | `admin-application-service.{findRevisionDeadlineByApplicationId, upsertRevisionDeadline, bulkUpdateRevisionDeadlineStatus}` |

New service modules introduced:
- `services/admin-dashboard-service.js` — KPI aggregates with tenant scoping.
- `services/admin-application-service.js` — revision-deadline + admin workflow helpers.
- `services/application-service/application-provider-query-methods.js` — provider-side application reads/writes wired through `application-service.js`.

Existing services extended (new methods only; existing methods unchanged):
- `services/planting-service.js` — 5 provider-facing read methods.
- `services/certificate-service.js` — 2 dashboard / bulk-notify read methods.
- `services/provider-user-service.js` — `findActiveProviderById`, `findActiveProviderReviewerById`, `listReviewerCandidates`.

Smoke tests: every file passes `node -e "require('./apps/backend/routes/api/provider/handlers/<file>')"`.
Unit tests run: `application-service.test.js` (18 pass), `application-status-writer.test.js`
+ `application-review-revision-methods.test.js` (17 pass), `provider-legacy-alias-flag.test.js` (3 pass).

### Routes refactored in batch 11 — Finance cluster (2026-05-16)

Finance routes touched billing, invoices, accounting export and quotes —
the surface where data drift directly maps to revenue + Thai Revenue
Department ม.86 tax-invoice compliance. Every file now has zero live
`prisma.X.find/update/create/count/aggregate` calls (only comments
mentioning `prisma.` for historical context remain).

| Route                                                | Service used                                                                                                |
|------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| `routes/api/finance/quotes.js`                       | new `quote-service.{resolveApplicantHealthId, listForProvider, listForApplicant, findByIdWithApplication(Slim), findApplicationForQuote, generateQuoteNumber, createQuote, updateQuote, updateStatus, markAcceptedWithInvoice, markRejected, createInvoiceFromQuote, generateInvoiceNumberSequential, generateInvoiceNumberRandom, findQuoteByNumber, findInvoiceByNumber, updateQuoteNumber, updateInvoiceNumber}` |
| `routes/api/finance/accounting.js`                   | new `accounting-service.{getRootSummary, getDashboardStats}`                                                |
| `routes/api/finance/pricing.js`                      | new `system-config-service.{getByKey, getValue}`                                                            |
| `routes/api/helpers/quotes-provider-routes.js`       | `quote-service.{findByIdWithApplicationSlim, generateInvoiceNumberSequential, createInvoiceFromQuote, updateStatus, findQuoteByNumber, findInvoiceByNumber, updateQuoteNumber, updateInvoiceNumber}` |

New service modules introduced:
- `services/quote-service.js` — canonical home for `Quote` model access,
  including the quote→invoice conversion path with verbatim copy of the
  `{ subtotal, vat, totalAmount }` triple (Tier 8/9 Tax-Invoice canonical
  structure — see method comments).
- `services/accounting-service.js` — finance-dashboard aggregates with
  `isDeleted: false` enforced at the service boundary so soft-deleted
  invoices cannot inflate revenue numbers visible to regulators.
- `services/system-config-service.js` — lean read-side wrapper for
  `SystemConfig` rows; preserves the "table-missing" graceful fallback
  the pricing route depended on (returns null cleanly).

VAT / Tax-Invoice canonical totals (anti-regression for Tier 8/9):
- `quote-service.createQuote` accepts `subtotal / vat / totalAmount` as
  parameters and persists them verbatim. It does NOT recompute the
  triple silently. The route layer does the GACP-exempt math (vat = 0
  per ม.86) so the service stays neutral.
- `quote-service.createInvoiceFromQuote` copies `subtotal / vat /
  totalAmount` verbatim from the source quote onto the new invoice.
  Service comments cite the anti-regression rule directly.
- `accounting-service.getRootSummary` and `getDashboardStats` sum
  `_sum.totalAmount` over PAID invoices — `totalAmount` already includes
  VAT for PLATFORM invoices, which is the correct figure for revenue
  reporting and bank reconciliation. Comment in the service documents
  why we do NOT switch to `subtotal` here.

Smoke tests: each route + service loads cleanly via
`node -e "require('<path>')"`. Tests run:
- `npx jest apps/backend/__tests__/unit/invoice` — 5 suites, 76 pass.
- `npx jest apps/backend/__tests__/unit/finance` — 2 suites, 27 pass
  (including `finance-quotes-no-healthid-url.test.js` which mocks
  `prisma.user.findFirst` + `prisma.quote.findMany/count` — preserved
  because the service still calls the same prisma model methods).
- `npx jest apps/backend/__tests__/unit/payment-phase-flow-canonical-totals`
  — 7 pass (anchor test for canonical phaseTotal).
- `npx jest apps/backend/__tests__/unit/{backfill-platform-invoice-vat,
  phase-invoice-vat-split}` — 35 pass.

### Routes refactored in batch 12 — Applicant wizard (2026-05-16)

The single biggest remaining offender — `applications/applications.js` — is
the main applicant-facing wizard / draft / submit flow. Every health user who
fills the GACP application hits this file. Before the refactor it had 18
direct `prisma.X.method(...)` call sites spread across the readiness check,
the draft-find-or-create helper, the POST /draft / /submit / /prepare /
/draft-documents endpoints, and the GET /draft listing. After the refactor
every direct call is gone — the only remaining `prisma` reference in the
route is the transaction-handle passed to `writeApplicationStatus` (same
exception pattern as `applications-car.js` from batch 9).

| Route                                                | Service used                                                                                                |
|------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| `routes/api/applications/applications.js`            | new `application-service.{findPersonalEntityForHealthIdentity, findApplicationByIdForHealth, findLatestOpenDraftForHealth, healDraftEntityColumns, createDraftForHealth, updateApplicantDraftColumns, findDraftForSubmit, getApplicationSlice, findUserOrganizationId, getApplicantReadinessSnapshot, getLatestOpenDraftForApplicant}` |

Route → service method mapping (line numbers cite pre-refactor positions, also
recorded inline as comments on each new method):

| Route line | Prisma call (before)                                 | Service method (after)                                        |
|-----------:|------------------------------------------------------|---------------------------------------------------------------|
|         98 | `prisma.entity.findFirst` (personal INDIVIDUAL)      | `application-service.findPersonalEntityForHealthIdentity`     |
|        112 | `prisma.application.findFirst` (by id + healthId)    | `application-service.findApplicationByIdForHealth`            |
|        122 | `prisma.application.findFirst` (latest DRAFT)        | `application-service.findLatestOpenDraftForHealth`            |
|        139 | `prisma.application.update` (auto-heal entityId)     | `application-service.healDraftEntityColumns`                  |
|        160 | `prisma.application.create` (new draft)              | `application-service.createDraftForHealth`                    |
|        209 | `prisma.user.findUnique` (readiness)                 | `application-service.getApplicantReadinessSnapshot`           |
|        210 | `prisma.farm.findMany` (readiness)                   | `application-service.getApplicantReadinessSnapshot`           |
|        215 | `prisma.application.findMany` (readiness)            | `application-service.getApplicantReadinessSnapshot`           |
|        288 | `prisma.application.update` (draft save)             | `application-service.updateApplicantDraftColumns`             |
|        341 | `prisma.application.findFirst` (submit lookup)       | `application-service.findDraftForSubmit`                      |
|        472 | `prisma.application.findUnique` (post-submit slice)  | `application-service.getApplicationSlice`                     |
|        541 | `prisma.user.findUnique` (organizationId)            | `application-service.findUserOrganizationId`                  |
|        556 | `prisma.application.update` (prepare)                | `application-service.updateApplicantDraftColumns`             |
|        591 | `prisma.application.update` (upload draft doc)       | `application-service.updateApplicantDraftColumns`             |
|        627 | `prisma.application.update` (delete draft doc)       | `application-service.updateApplicantDraftColumns`             |
|        642 | `prisma.application.findFirst` (GET /draft)          | `application-service.getLatestOpenDraftForApplicant`          |

New service module introduced:
- `services/application-service/application-applicant-query-methods.js` —
  applicant-side application reads/writes wired through `application-service.js`
  alongside the existing draft-query and provider-query method modules.
  Each method header cites the exact `applications.js` line + prisma call
  it replaces for traceability. Behaviour-preserving — every method
  enforces `isDeleted: false` and the `healthId` ownership predicate at
  the service boundary so the route layer cannot accidentally widen the
  filter or skip the soft-delete check.

Why one module covers eleven methods: every method is a thin, behaviour-
preserving wrapper around exactly the call shape the route used to issue.
There is no business logic to consolidate (status transitions still flow
through `writeApplicationStatus`, the wizard's column-projection rules
were already inline). Grouping them in one applicant-query file keeps the
"applicant-facing surface" discoverable while staying parallel to the
existing `application-provider-query-methods.js` module structure.

Smoke tests:
- `node -e "require('./apps/backend/routes/api/applications/applications')"`
  loads cleanly.
- `node -e "require('./apps/backend/services/application-service')"` exposes
  all eleven new methods on the singleton.

Tests run:
- `npx jest apps/backend/__tests__/unit/applications-draft-contract apps/backend/__tests__/unit/applications-prepare-active-entity apps/backend/__tests__/unit/applications-submit-capability-gate`
  — 3 suites, 14 pass. Mocks were rewritten to target
  `applicationService.{findLatestOpenDraftForHealth, updateApplicantDraftColumns, findDraftForSubmit, getApplicationSlice, getLatestOpenDraftForApplicant}` instead of `prisma.application.*`.
- `npx jest apps/backend/__tests__/unit --testPathPattern "application" --no-coverage`
  — 131 suites, 1569 pass (no regressions across the broader
  application/audit/finance/billing surface).

Verification:
- `grep "prisma\.(application|user|invoice|paymentTransaction|audit|entity|farm|establishment|document)\." apps/backend/routes/api/applications/applications.js`
  returns 0 live matches (only one comment reference remains, and the
  transaction-handle passed into `writeApplicationStatus`).

### Routes refactored in batch 13 — Audit cluster (2026-05-16)

The `routes/api/audit/*` files cover the audit-scheduling workflow,
farm-audit checklist commits, post-audit corrective tasks, fraud
detection sweeps, and site analyses. These routes read and write
the regulated-records surface (DTAM 5-year retention; ISO 27799:2016
§ 7.10 audit log tamper-evidence; Thai e-Transactions Act B.E. 2544/2001
s.12). Every file now has zero live `prisma.X.method(...)` call sites.
The `prisma` import is retained only as a transaction handle for
`writeApplicationStatus` (audits.js) and `attachmentService.attach`
(post-audit.js) — the same exception pattern as
`applications/applications-car.js` from batch 9.

| Route                                                | Service used                                                                                                |
|------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| `routes/api/audit/audits.js` (13 calls)              | `application-service.{listAuditQueue, listPendingScheduleAudits, listScheduledAudits, findAuditDetail, findByIdOrApplicationNumber, updateApplicationColumns, findFirstWithWhere, findAuditApplication, getById}` (new), `farm-service.updateFarmFromAudit` (new), `certificate-service.findCertificateForApplication` (new) |
| `routes/api/audit/audits-reassign.js` (3 calls)      | `application-service.{listReassignableAudits, findAuditApplication}` (new), `provider-user-service.findReassignmentTargetUser` (new) |
| `routes/api/audit/farm-audit.js` (10 calls)          | new `farm-audit-checklist-service.{listChecklistTemplate, createAuditWithFarmUpdate, listAuditsByFarm, countAuditsByFarm, createAuditPhoto, createGpsVerificationLog, getAuditorPerformanceMetrics}`, `farm-service.findFarmInTenant` (new) |
| `routes/api/audit/fraud-detection.js` (6 calls)      | `farm-service.{findFarmsWithGps, countFarms}` (new), `application-service.{countApplicationsByStatus, listApplicationDocumentsForFraudScan}` (new) |
| `routes/api/audit/post-audit.js` (9 calls)           | new `post-audit-task-service.{findTaskInTenant, listTasksForApplication, createTask, updateTask, appendTaskDocuments, getTaskDetailWithApplication}`, `application-service.findFirstWithWhere` |
| `routes/api/audit/site-analyses.js` (1 call)         | `site-analysis-service.listRecentAnalyses` (new method)                                                      |

New service modules introduced:
- `services/farm-audit-checklist-service.js` — owns the read/write paths
  for `GcpChecklistTemplate`, `FarmAuditChecklists`, `FarmAuditPhotos`,
  `GpsVerificationLogs`. The audit-creation path wraps the checklist row
  + parent farm update in a single `$transaction` so a partial commit
  cannot leave a Farm marked APPROVED without the row that justifies it
  (Thai e-Transactions Act s.12).
- `services/post-audit-task-service.js` — read/write for `PostAuditTask`.
  Visibility predicate (parent application) stays at the route boundary;
  the service is a thin pass-through so the predicate is centralised. The
  `documents` JSON column is append-only by convention — no delete or
  replace helper is exposed (ISO 27799:2016 § 7.10).

Existing services extended (new methods only; existing methods unchanged):
- `services/application-service/application-provider-query-methods.js` —
  9 new methods covering audit-queue listing, audit-detail lookup,
  reassignment list, fraud-scan document lookup, and audit-status counts.
- `services/farm-service.js` — 4 new methods: `findFarmInTenant`,
  `updateFarmFromAudit`, `findFarmsWithGps`, `countFarms`.
- `services/certificate-service.js` — `findCertificateForApplication`
  (idempotency check for audit-result cert generation).
- `services/site-analysis-service.js` — `listRecentAnalyses` (provider
  view with farm-name include only).
- `services/provider-user-service.js` — `findReassignmentTargetUser`
  (tenant-scoped reassignment-target lookup).

PDPA + audit-evidence notes:
- The audit-log read paths in `services/audit-trail.js` (the hash-chained
  AuditLog table) are unchanged in this batch — those handlers already
  go through `listAuditEvents` / `exportAuditEvents` /
  `getTimelineForApplication` per ADR-012. This batch was for the
  audit-workflow tables (Application, Farm, PostAuditTask, etc.), which
  are regulated records but distinct from the immutable audit chain.
- Audit-evidence rows (FarmAuditChecklists, FarmAuditPhotos,
  GpsVerificationLogs) are NOT redacted on read — they are subpoena-
  relevant regulated records under DTAM 5-year retention. Access is
  controlled at the route boundary by `ROLE_GROUPS.AUDIT_STAFF`.
- The PostAuditTask `documents` column is append-only; the service
  exposes no delete or replace helper. Tamper-evidence integrity is
  preserved at the type-system level.

Smoke tests: each refactored route loads cleanly via
`node -e "require('./apps/backend/routes/api/audit/<file>')"`.

Tests run:
- `npx jest apps/backend/__tests__/unit/audit-trail.test.js
   apps/backend/__tests__/unit/audit-logger.test.js
   apps/backend/__tests__/unit/audits-reassign-auth.test.js
   apps/backend/__tests__/unit/audit-log-viewer-handler.test.js`
  — 4 suites, 33 pass.
- `npx jest apps/backend/__tests__/unit/application-service.test.js
   apps/backend/__tests__/unit/application-status-writer.test.js`
  — 2 suites, 32 pass (no regression on the extended services).

Verification:
- `grep "prisma\.\w+\." apps/backend/routes/api/audit/*.js` returns
  comment references only — no live calls in any of the six files.

### Routes refactored in batch 14 — Provider/admin wave 2 (2026-05-16)

Second wave of `routes/api/provider/*` refactors, complementing batch 10
(which retired the heavy `provider/handlers/*` workflow files). This batch
hits the work-orchestration admin surface (StageActivityConfig + SlaPolicy +
UserGroupMembership), the manager-facing KPI dashboard over WorkActivity,
and the rest of the auditor + scheduler routes that batch 10 left behind
(final-approval, urgent-monitor, auditor-workload, send-reminder,
auditor-dashboard, scheduler-dashboard, inspection-start, audit-decision,
and the provider-side application listing/detail page).

Every file now has zero live `prisma.X.find/update/create/upsert/count/
groupBy/delete` calls. The `prisma` symbol survives in `auditor-handler-deps.js`
and `scheduler-handler-deps.js` only as the transaction handle threaded into
`writeApplicationStatus` from `auditor-audit-decision-handler.js` (same
exception pattern as `applications/applications-car.js` from batch 9).

| Route                                                                 | Service used                                                                                                          |
|-----------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `routes/api/provider/admin-work-config.js` (10)                       | new `work-config-service.{listStageConfigs, listSlaPolicies, exportStageConfigs, exportSlaPolicies, createStageConfig, updateStageConfig, findStageConfigById, deleteStageConfig, updateSlaPolicy, bulkImportConfigs}` |
| `routes/api/provider/admin-user-groups.js` (6)                        | new `user-group-service.{listMembershipsForUser, findActiveUserForMembership, findRoleGroupByCode, upsertMembership, deleteMembership}` |
| `routes/api/provider/analytics-work-kpis.js` (6)                      | new `work-activity-analytics-service.{countOpenActivities, countOverdueOpenActivities, listActivitiesInWindow, groupByState, groupByTopPerformers, findUsersForPerformerNames}` |
| `routes/api/provider/scheduler.js` (6)                                | `application-service.{listStuckApplications, countAuditorActiveAuditAssignments, countAuditorCompletedAuditsSince, findReminderTargetApplication}` (new), `admin-application-service.listApproachingRevisionDeadlines` (new), `provider-user-service.listActiveAuditors` (new) |
| `routes/api/provider/auditor.js` (5)                                  | `application-service.{listFinalApprovalQueue, findApplicationForFinalApproval, updateApplicationColumns}` (new + existing) |
| `routes/api/provider/applications.js` (4)                             | `application-service.{listProviderApplicationsPage, findProviderApplicationDetail, findVisibleApplicationIdSlice, listWorkActivitiesForApplication}` (new) |
| `routes/api/provider/handlers/auditor-handler-deps.js` (1)            | `invoice-service.listSettlementsForApplication` (new); deps file now re-exports `applicationService` + `invoiceService` for downstream handlers |
| `routes/api/provider/handlers/scheduler-handler-deps.js` (1)          | `invoice-service.listSettlementsForApplication`; re-exports the two services |
| `routes/api/provider/handlers/auditor-dashboard-handler.js` (3)       | `application-service.{listAuditorDashboardApplications, listAuditorsByIds}` (new), `invoice-service.listSettlementsByApplicationIds` (new) |
| `routes/api/provider/handlers/auditor-inspection-start-handler.js` (3)| `application-service.{findAuditDecisionApplication, writeInspectionStart}` (new)                                       |
| `routes/api/provider/handlers/auditor-audit-decision-handler.js` (3)  | `application-service.{findAuditDecisionApplication, findAuditDecisionPostWriteSlice}` (new); `prisma` retained as `writeApplicationStatus` transaction handle |
| `routes/api/provider/handlers/scheduler-dashboard-handler.js` (3)     | `application-service.{listSchedulerDashboardApplications, listAuditorsByIds}` (new), `invoice-service.listSettlementsByApplicationIds` |

New service modules introduced:
- `services/work-config-service.js` — owns StageActivityConfig + SlaPolicy
  read/write paths. Bulk import preserves the "all-or-none" semantics the
  admin UI relies on (transaction-wrapped upsert; partial commits would
  silently misroute new WorkActivity rows).
- `services/user-group-service.js` — owns UserGroupMembership +
  RoleGroup lookups. Soft-delete enforcement (`isDeleted: false` on User)
  lives at the service boundary so a route bug cannot add a deleted user
  to a group.
- `services/work-activity-analytics-service.js` — manager-facing KPI
  roll-up over `work_activities` (read-only). Distinct from
  `work-activity-service.js` which owns the write-side state machine.

Existing services extended (new methods only; existing methods unchanged):
- `services/application-service/application-provider-query-methods.js` —
  16 new methods covering provider-list pagination, detail visibility
  probes, urgent-monitor sweep, auditor + scheduler dashboard primary
  reads, post-write fetch slices for audit-decision + inspection-start,
  and the WorkActivity timeline.
- `services/admin-application-service.js` —
  `listApproachingRevisionDeadlines` (urgent-monitor approaching-deadline
  window).
- `services/provider-user-service.js` — `listActiveAuditors`
  (auditor-workload roster, legacy + canonical role names).
- `services/invoice-service.js` — `listSettlementsForApplication`
  (single-app phase-settlement read used by both auditor + scheduler deps)
  and `listSettlementsByApplicationIds` (multi-app projection used by
  the two dashboards).

Smoke tests: every refactored file passes
`node -e "require('./<path>'); process.exit(0)"`.

Tests run:
- `npx jest apps/backend/__tests__/unit/provider --no-coverage` —
  1 suite, 3 pass.
- `npx jest apps/backend/__tests__/unit/admin --no-coverage` —
  1 suite, 5 pass.
- `npx jest apps/backend/__tests__/unit/application-service.test.js
   apps/backend/__tests__/unit/application-status-writer.test.js
   apps/backend/__tests__/unit/application-review-revision-methods.test.js`
  — 3 suites, 35 pass (no regression on the extended services).

Verification:
- For every file in the table above, the audit
  `grep -E '^\s*[^/].*prisma\.' <file> | grep -vE '^\s*//' |
   grep -v 'prisma\\.\$transaction'` returns 0 live matches.
- The `prisma` symbol is retained only where
  `writeApplicationStatus` needs it as a transaction handle
  (`auditor-audit-decision-handler.js` via `auditor-handler-deps.js`).

### Routes refactored in batch 15 — Identity/documents/cultivation/trace (2026-05-16)

Batch 15 retires the citizen-facing identity surface (MFA), the entire
documents cluster, the cultivation-record CRUD cluster, and the trace
public-scan surface. Every file now has **zero** live
`prisma.X.find/update/create/delete/count` calls. The `prisma` symbol
survives in two of them as the transaction handle threaded into
`attachmentService.attach/detach/listForResource` —
`documents/report-submissions.js` and `trace/lots.js` — same exception
pattern as `applications/applications-car.js` (batch 9) and
`audit/post-audit.js` (batch 13).

| Route                                                                 | Service used                                                                                                          |
|-----------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `routes/api/identity/mfa.js` (9)                                      | new `identity-service.{getMfaStatus, storePendingTotpSecret, findPendingTotpSecret, enableMfaWithBackupCodes, findUserForMfaVerify, updateBackupCodes, touchLastLogin, findMfaSecretForDisable, disableMfa}` |
| `routes/api/documents/documents.js` (1)                               | new `document-service.listApplicantApplicationsForDraftDocs`                                                          |
| `routes/api/documents/sop-documents.js` (7)                           | new `document-service.{listSopDocumentsForUser, findSopDocumentForUser, createSopDocument, updateSopDocument, softDeleteSopDocument}` |
| `routes/api/documents/templates.js` (7)                               | new `document-service.{listActiveTemplates, findActiveTemplateByCode, listTemplateVersions, findLatestTemplateVersion, deprecateActiveTemplatesForCode, createTemplate, updateTemplate}` |
| `routes/api/documents/report-submissions.js` (13)                     | new `document-service.{listActiveCertificatesForUser, listReportSubmissionsForUserYear, listReportSubmissionsForUser, findReportSubmissionForUser, findCertificateForUser, findReportSubmissionByPeriod, createReportSubmission, findOwnedReportSubmissionDraft, updateReportSubmission, reviewReportSubmission, softDeleteReportSubmission}` |
| `routes/api/documents/reports.js` (9)                                 | `metrics-service.{countActiveFarms, groupFarmsByProvince, groupApplicationsByStatus, getAnalyticsAggregates, countActiveHealthApplicants}` (new methods on existing service) |
| `routes/api/cultivation/seed-sources.js` (8)                          | new `cultivation-record-service.{findCycleOwnedByUser, listSeedSourcesByCycle, createSeedSource, findSeedSourceOwnedByUser, updateSeedSource, deleteSeedSource}` |
| `routes/api/cultivation/water-sources.js` (8)                         | new `cultivation-record-service.{findPlotOwnedByUser, listWaterSourcesByPlot, createWaterSource, findWaterSourceOwnedByUser, updateWaterSource, deleteWaterSource}` |
| `routes/api/cultivation/fertilizer-records.js` (8)                    | new `cultivation-record-service.{listFertilizerRecordsByCycle, createFertilizerRecord, findFertilizerRecordOwnedByUser, updateFertilizerRecord, deleteFertilizerRecord}` |
| `routes/api/cultivation/controlled-environments.js` (8)               | new `cultivation-record-service.{listControlledEnvironmentsByPlot, createControlledEnvironment, findControlledEnvironmentOwnedByUser, updateControlledEnvironment, deleteControlledEnvironment}` |
| `routes/api/cultivation/plots.js` (5)                                 | `farm-service.findOwnedFarmForPlotOps` (new), `planting-service.{createPlotForFarm, listPlotsByFarm, findPlotWithFarmOwner, deletePlot}` (new methods) |
| `routes/api/cultivation/harvest-batches.js` (5)                       | `farm-service.listOwnerFarmIds` (new), `harvest-service.{findActivePlantSpeciesCode, countHarvestBatchesWithPrefix, createHarvestBatchWithIncludes, updateHarvestBatchTrackingUrl}` (new) |
| `routes/api/cultivation/plant-units.js` (1)                           | `planting-service.findCyclePlotInCycle` (new)                                                                          |
| `routes/api/cultivation/planting-cycles-unit-plot-routes.js` (4)      | `planting-service.{findCycleForGenerate, findCyclePlotInCycle, listPlotCycleQrRecordsForCycle}` (new)                  |
| `routes/api/cultivation/planting-cycles-activity-harvest-routes.js` (11) | `planting-service.{findOwnedApplicationDocuments, findCyclePlotInCycle, findPlantUnitInCycle, createCultivationLog, listCultivationLogs, findCycleForLegacyHarvest, countHarvestBatchesGlobal, commitLegacyHarvest}` (new) |
| `routes/api/trace/lots.js` (9)                                        | `traceability-service.{listOwnerFarmIdsForTrace, findHarvestBatchFarmId, findHarvestBatchWithLots, countLotsByBatch, createLot, updateLotTrackingUrl, findLotDetailById, findLotForUpdate, updateLotWithFarmInclude}` (new); `prisma` retained as `attachmentService` transaction handle |
| `routes/api/trace/trace-batch-lot-routes.js` (4)                      | `traceability-service.{findPublicBatchByAnyIdentifier, findActiveTraceIntegrityRecord, findPublicLotByAnyIdentifier}` (new) |
| `routes/api/trace/trace-verification-routes.js` (3)                   | `traceability-service.{findTraceEntityById, findCycleWithFarmForTrace, findBatchWithFarmForTrace, updateBatchTraceQr}` (new) |

New service modules introduced:
- `services/document-service.js` — canonical home for SOP documents,
  document templates, report submissions, and the read-side of draft
  documents embedded in `Application.formData`. Ownership predicates
  (`userId` for citizen-facing rows, certificate-ownership chain for
  submissions) and `isDeleted: false` are enforced at the service
  boundary so a route bug cannot widen the filter. DocumentTemplate is
  a global config table — no ownership predicate, but reads default to
  `status: 'ACTIVE'` unless the caller asks for the versions list.
- `services/identity-service.js` — per-user identity reads/writes for
  the MFA path. Soft-delete on User is enforced on every read
  (`findFirst({ where: { id, isDeleted: false } })`) so a deleted user
  cannot enable MFA, verify a TOTP, or burn a backup code. Column
  projections are intentionally narrow per-method — the read-only
  status check returns only the `twoFactorEnabled` boolean; the verify
  payload returns the canonical user trio (`twoFactorSecret`,
  `twoFactorEnabled`, `twoFactorBackupCodes`) and nothing else.
- `services/cultivation-record-service.js` — owns SeedSource,
  WaterSource, FertilizerRecord, and ControlledEnvironment. The four
  GACP cultivation-record tables share the same parent-ownership chain
  (record → cycle/plot → Farm.ownerId); centralising the predicate here
  retired four copy-pasted inline ownership probes.

Existing services extended (new methods only; existing methods
unchanged):
- `services/farm-service.js` — `listOwnerFarmIds` (replaces inline
  `getUserFarmIds` helper in `cultivation/harvest-batches.js` and
  `trace/lots.js`), `findOwnedFarmForPlotOps` (canonical projection for
  the plot CRUD endpoints in `cultivation/plots.js`).
- `services/planting-service.js` — 12 new methods covering plot CRUD,
  cycle-plot membership probes, plantUnit-in-cycle membership probes,
  the cultivation-log read/write paths inside the activity endpoint,
  and the legacy `/harvest` transaction wrapper.
- `services/harvest-service.js` — 4 new methods backing the
  harvest-batches.js create path: plant-species code resolution,
  batch-number counter, the canonical-include create + post-create
  trackingUrl update.
- `services/traceability-service.js` — 13 new functions covering the
  public-trace surface for `Lot` and `HarvestBatch` plus the
  `traceQrSecurity` lookup. All include shapes are kept verbatim from
  the old route code so the public scan response stays bit-identical.
- `services/metrics-service.js` — 5 new methods (`countActiveFarms`,
  `groupFarmsByProvince`, `groupApplicationsByStatus`,
  `getAnalyticsAggregates`, `countActiveHealthApplicants`) backing the
  provider-facing `/api/reports/*` dashboard route.

PDPA + integrity notes:
- The MFA `findUserForMfaVerify` projection no longer reads
  `password` or any column the JWT payload doesn't need. The TOTP
  secret + backup-code array are only returned for the verify path.
- `documents/report-submissions.js` still dual-writes the attachment
  pointer into the `Attachment` table via `attachmentService.attach`,
  which requires `prisma` as a transaction handle. That single
  exception is the only reason `prisma` is still imported in the
  refactored file.
- `trace/lots.js` keeps its 404-not-403 cross-tenant ownership shape
  (T-014 / PR-02) — service methods don't change that, they just
  centralise the lookup.

Smoke tests: every refactored route loads cleanly via
`node -e "require('./<path>')"`. All 14 direct-loaded routes plus the
4 deps-injected helper modules pass.

Tests run:
- `npx jest apps/backend/__tests__/integration/reports` — 8 pass.
  (Test was updated to mock the new `metricsService.*` aggregator
  methods.)
- `npx jest apps/backend/__tests__/integration/mfa-roundtrip` — 5 pass.
  (Mock extended to expose `prisma.user.findFirst` because
  identity-service uses findFirst+isDeleted instead of findUnique.)
- `npx jest apps/backend/__tests__/integration/planting-plot-trace*`
  — 13 pass across 3 suites. (Mock extended with
  `plantingService.{findCycleForGenerate, findCyclePlotInCycle}` that
  fall through to the prisma mock so per-test data stays drop-in.)
- `npx jest apps/backend/__tests__/unit/closing-review-fixes` — 21
  pass. (Regression gate updated to read mfa.js + identity-service.js
  concatenated, since the canonical column writes moved to the
  service.)
- `npx jest apps/backend/__tests__/unit/document-numbering apps/backend/__tests__/unit/document-analysis-service apps/backend/__tests__/unit/resolve-health-identity-hash-lookup`
  — 49 pass.
- `npx jest apps/backend/__tests__/unit/application-service.test.js apps/backend/__tests__/unit/application-status-writer.test.js`
  — 32 pass (no regression on the application surface).

Verification:
- For every file in the table above, the audit
  `grep -E '^\s*[^/].*prisma\.' <file> | grep -vE '^\s*//'` returns 0
  live matches.
- The `prisma` symbol survives only as the transaction handle for
  `attachmentService` (lots.js, report-submissions.js).

### Routes refactored in batch 16 — Final-wave helpers / provider tail / auth (2026-05-16)

Batch 16 retires the long tail of small (1–5 call) helper routes plus the
remaining low-call provider handlers, and finally takes the
provider-login `/auth/provider/*` surface off the direct-prisma path.
Every file in this batch now has **zero** live `prisma.X.method(...)`
calls. Two files retain the `prisma` symbol: `workflow-handler-deps.js`
keeps it as the transaction handle that `writeApplicationStatus` is
threaded through (consumed by `workflow-revision-expirations-handler.js`)
— same exception pattern as `applications/applications-car.js` (batch 9).
`workflow-revision-expirations-handler.js` itself imports `prisma` from
deps only for that handle.

| Route                                                                 | Service used                                                                                                          |
|-----------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `routes/api/entities/index.js` (1)                                    | `entity-service.listMembersForEntity` (new)                                                                            |
| `routes/api/certificates/standards.js` (1)                            | `certificate-service.listActiveStandards` (new)                                                                        |
| `routes/api/helpers/lots-label-routes.js` (2)                         | `traceability-service.{findLotForLabel, findLotsForBatchLabels}` (new)                                                 |
| `routes/api/helpers/lots-utility-routes.js` (5)                       | `traceability-service.{findLotForPrintCheck, markLotAsPrinted, findLotQrPayload, findLotPrintLabelPayload, listLotsByBatchId}` (new) |
| `routes/api/helpers/plant-unit-ownership.js` (3)                      | `farm-service.listOwnerFarmIds` (existing), `planting-service.{findCycleFarmId, findPlantUnitByIdOrQr}` (new)          |
| `routes/api/provider/provider-directory-utils.js` (2)                 | `provider-user-service.{listAllUsersForProviderDirectory, findUserForProviderDirectory}` (new, canonical projection)   |
| `routes/api/provider/handlers/analytics.js` (1)                       | `application-service.groupApplicationsByActorAndStatus` (new)                                                          |
| `routes/api/provider/handlers/communication.js` (2)                   | `provider-user-service.listUserIdsForBroadcast` (new), `notification-service.listRecentAdminBroadcasts` (new)          |
| `routes/api/provider/handlers/reviewer.js` (3)                        | `application-service.{listReviewerQueueApplications, findApplicationByIdOrNumberFormDataSlice, updateReviewerProgress}` (new) |
| `routes/api/provider/handlers/scheduler-audit-schedules-get-handler.js` (2) | `application-service.listSchedulerScheduleApplications` (new), `provider-user-service.listAuditorsByIdsForScheduler` (new) |
| `routes/api/provider/handlers/scheduler-auditors-handler.js` (1)      | `provider-user-service.listAuditorsForScheduler` (new)                                                                 |
| `routes/api/provider/handlers/scheduler-audits-route-optimization-handler.js` (1) | `application-service.listAuditorRouteApplications` (new)                                                  |
| `routes/api/provider/handlers/workflow-audit-timelines-handler.js` (1) | `application-service.findApplicationByIdOrNumberTimelineSlice` (new)                                                  |
| `routes/api/provider/handlers/workflow-handler-deps.js` (2)           | `invoice-service.listSettlementsForApplication` (existing); deps now re-exports `applicationService` + `invoiceService` for downstream handlers |
| `routes/api/provider/handlers/workflow-revision-expirations-handler.js` (3) | `application-service.{findApplicationByIdOrNumberWorkflowSlice, getApplicationExpirationSlice}` (new), `admin-application-service.bulkUpdateRevisionDeadlineStatus` (existing); `prisma` retained as `writeApplicationStatus` transaction handle |
| `routes/api/auth/auth-provider.js` (3)                                | `provider-user-service.{findProviderForLoginByHash, touchProviderLastLogin, findProviderUserById}` (new)               |

New service methods introduced (existing service modules extended; no
new service modules created in this batch):
- `services/entity-service.js` — `listMembersForEntity` for the
  `GET /api/entities/:id/members` route, with the User column projection
  centralised so a route bug cannot widen the visible columns past the
  `{id, healthId, firstName, lastName, email}` whitelist.
- `services/certificate-service.js` — `listActiveStandards` for the
  public certification-standards catalog.
- `services/traceability-service.js` — 7 new methods covering the
  lot-label + lot-utility helper routes (label print, batch labels,
  print-state probe, mark-printed, QR payload reads, batch listing).
  Same farm-ownership include shapes as the existing batch 15 methods.
- `services/planting-service.js` — 2 new methods for the plant-unit
  ownership helper. The narrow projections (just `farmId` + the
  `cycle.farm.ownerId` chain) keep the helper from pulling extra
  columns into memory when answering "does this user own this unit?"
- `services/provider-user-service.js` — 8 new methods:
  - directory listing + single-provider lookup (`listAllUsersForProviderDirectory`,
    `findUserForProviderDirectory`) with `PROVIDER_DIRECTORY_SELECT`
    column whitelist enforced at service boundary.
  - admin broadcast recipient resolution (`listUserIdsForBroadcast`).
  - auditor roster + auditor-by-ids for the scheduler dashboard
    (`listAuditorsForScheduler`, `listAuditorsByIdsForScheduler`).
  - provider-login lookup-by-hash + lastLogin bump + me-endpoint user
    fetch (`findProviderForLoginByHash`, `touchProviderLastLogin`,
    `findProviderUserById`) — central audit point for the
    `/auth/provider/*` surface.
- `services/application-service` (via `application-provider-query-methods.js`)
  — 9 new methods covering the analytics groupBy, reviewer queue + save
  flow, scheduler queue + route optimisation, audit-timeline lookup,
  and revision-expiration read+post-write slices.
- `services/notification-service.js` — `listRecentAdminBroadcasts`
  read-side helper for the admin-communication log endpoint.

PDPA + canonical-projection notes:
- `provider-directory-utils.js` previously inlined the User column
  projection at two separate call sites. Both now share
  `PROVIDER_DIRECTORY_SELECT` on the service. If a future column is
  added (e.g., `mfaEnabledSince`), the service is the only place to
  update — route layer cannot accidentally include it.
- `auth-provider.js` previously had two divergent User projections
  (login returning the full row, `/me` returning the full row). Both
  go through service methods now; if we tighten the projection later
  to drop `password` / `twoFactorSecret` from the response, the
  service is the single switch.
- `notification-service.listRecentAdminBroadcasts` keeps the original
  `distinct: ['title']` semantic so the dashboard still shows one row
  per broadcast (not one row per recipient).

Smoke tests: every refactored file passes
`node -e "require('./<path>')"`.

Tests run:
- `npx jest apps/backend/__tests__/unit --no-coverage --testPathPattern
   "application|invoice|audit|payment|certificate|provider|admin|cultivation|trace"`
  — 135 suites, 1608 pass, 1 skipped (known issue documented elsewhere),
  0 failed.
- `npx jest apps/backend/__tests__/unit/application-service.test.js
   apps/backend/__tests__/unit/application-status-writer.test.js
   apps/backend/__tests__/unit/closing-review-fixes
   apps/backend/__tests__/unit/applications-draft-contract
   apps/backend/__tests__/unit/applications-prepare-active-entity
   apps/backend/__tests__/unit/applications-submit-capability-gate
   apps/backend/__tests__/unit/workflow-audit-timelines-handler`
  — focused regression set, 71 pass.
- `npx jest apps/backend/__tests__/integration/reports
   apps/backend/__tests__/integration/mfa-roundtrip` — 13 pass.

Test updates:
- `__tests__/unit/workflow-audit-timelines-handler.test.js` — mock now
  exposes `applicationService.findApplicationByIdOrNumberTimelineSlice`
  on the `workflow-handler-deps` doMock (instead of
  `prisma.application.findFirst`) since the handler reads through the
  service layer. The `prisma.auditLog.findMany` throw-on-call guard is
  preserved as a regression gate.

Verification:
- For every file in the table above, the audit
  `grep -nE '^[^/]*prisma\.[a-zA-Z]' <file> | grep -v 'prisma\.\$transaction'
   | grep -v '^\s*//'` returns 0 live matches.

## Remaining files (27)

Grouped by directory so each cluster can be tackled as a coordinated PR.

### `applications/` (4 files, 35 occurrences)

Batch 12 (2026-05-16) retired `applications/applications.js` (18 calls).

- `applications/revision-deadline.js` (12)
- `applications/application-workflow-handlers.js` (7)
- `applications/application-listing-handlers.js` (5)
- `applications/application-bundles.js` (13)
- `applications/criteria.js` (6)

### `provider/` (1 file, 3 occurrences)

Batch 10 (2026-05-16) retired 10 files (~66 calls). Batch 14 (2026-05-16)
retired 12 more files (~54 calls). Batch 16 (2026-05-16) retired the
remaining 10 small helper / handler files (~21 calls) and the legacy
provider-directory utility — see *Routes refactored in batch 16* above.
Only `provider/work.js` remains.

- `provider/work.js` (3)
- ~~`provider/provider-directory-utils.js`~~ — retired in batch 16
- ~~`provider/handlers/analytics.js`~~ — retired in batch 16
- ~~`provider/handlers/communication.js`~~ — retired in batch 16
- ~~`provider/handlers/reviewer.js`~~ — retired in batch 16
- ~~`provider/handlers/scheduler-audit-schedules-get-handler.js`~~ — retired in batch 16
- ~~`provider/handlers/scheduler-auditors-handler.js`~~ — retired in batch 16
- ~~`provider/handlers/scheduler-audits-route-optimization-handler.js`~~ — retired in batch 16
- ~~`provider/handlers/workflow-audit-timelines-handler.js`~~ — retired in batch 16
- ~~`provider/handlers/workflow-handler-deps.js`~~ — retired in batch 16 (`prisma` retained as transaction handle for `writeApplicationStatus`)
- ~~`provider/handlers/workflow-revision-expirations-handler.js`~~ — retired in batch 16 (same `prisma` exception)

### `audit/` (0 files, 0 occurrences) — CLEARED in batch 13 (2026-05-16)
All `routes/api/audit/*` files now go through the service layer. Each
file may retain `prisma.` mentions in comments (banners explaining the
exception pattern or the historical fix) but no live
`prisma.<model>.<method>(...)` call exists in any of the six files.
See *Routes refactored in batch 13 — Audit cluster* above.

### `admin/` (5 files, 24 occurrences)
- `admin/applications.js` (5)
- `admin/config.js` (2)
- `admin/index.js` (4)
- `admin/planting.js` (9)
- `admin/plants.js` (6)

### `auth/identity/` (0 files, 0 occurrences) — CLEARED in batches 15 + 16 (2026-05-16)

Batch 15 (2026-05-16) retired `identity/mfa.js` (9 calls). Batch 16
(2026-05-16) retired `auth/auth-provider.js` (3 calls) — see *Routes
refactored in batch 16* above. `identity/consent.js` had only a comment
reference to `prisma.userConsent.create()` (no live call) and is
considered already-clean.

- ~~`auth/auth-provider.js`~~ — retired in batch 16
- ~~`identity/consent.js`~~ — comment-only reference, already clean
- ~~`identity/mfa.js`~~ — retired in batch 15

### `finance/` (0 files, 0 occurrences) — CLEARED in batch 11 (2026-05-16)
All `finance/*` routes now go through the service layer. `payments.js`
still contains a `prisma.user.findFirst` mention but only as a comment
in a banner explaining the H8 fix — no live call.

### `documents/` (0 files, 0 occurrences) — CLEARED in batch 15 (2026-05-16)

All five `documents/*` routes now go through `document-service` (new)
or `metrics-service` (for the dashboard analytics route). Each file may
retain `prisma.` references in comments (banners explaining the
attachment-service exception pattern) but no live
`prisma.<model>.<method>(...)` call exists in any of the five files.
See *Routes refactored in batch 15* above.

### `cultivation/` (0 files, 0 occurrences) — CLEARED in batch 15 (2026-05-16)

All nine `cultivation/*` files migrated:
- The four GACP record CRUD endpoints (seed-sources,
  water-sources, fertilizer-records, controlled-environments) now go
  through new `cultivation-record-service`.
- `plots.js` + `harvest-batches.js` + `plant-units.js` go through
  `farm-service` (ownership probes), `planting-service` (plot CRUD +
  cycle-plot membership), and `harvest-service` (batch number,
  plant-species code, create+trackingUrl flow).
- The two deps-injected helper files
  (`planting-cycles-unit-plot-routes.js`,
  `planting-cycles-activity-harvest-routes.js`) no longer pull
  `prisma` from `deps` — they import `planting-service` directly and
  call the new cultivation methods.

See *Routes refactored in batch 15* above for the full method table.

### `trace/` (0 files, 0 occurrences) — CLEARED in batch 15 (2026-05-16)

All three `trace/*` files now go through `traceability-service`. The
public-facing scan endpoints retain their bit-identical include shapes
because the service methods preserve the original include trees
verbatim. `lots.js` retains `prisma` only as the transaction handle
threaded into `attachmentService.attach/detach/listForResource` —
same exception pattern as `applications/applications-car.js`. See
*Routes refactored in batch 15* above.

### `system/` (5 files, 30 occurrences)
- `system/analytics.js` (8)
- `system/analytics-predictive-performance-routes.js` (8)
- `system/cron.js` (3)
- `system/dashboard.js` (6)
- `system/notifications.js` (4)
- `system/provider.js` (9)

### `interoperability/integration/` (4 files, 15 occurrences)
- `integration/consumer-feedback.js` (5)
- `integration/interoperability.js` (4)
- `interoperability/interoperability-core.js` (1)
- `interoperability/interoperability-trace-events.js` (5)

### `preview/` (2 files, 13 occurrences)
- `preview/preview.js` (5)
- `preview/preview-financial-utils.js` (8)

### `platform-admin/` (1 file, 7 occurrences)
- `platform-admin/organizations.js` (7)

### `helpers/` (0 files, 0 occurrences) — CLEARED in batches 11 + 16 (2026-05-16)

Batch 11 retired `helpers/quotes-provider-routes.js`. Batch 16 retired
the remaining three helpers — see *Routes refactored in batch 16* above.

- ~~`helpers/lots-label-routes.js`~~ — retired in batch 16
- ~~`helpers/lots-utility-routes.js`~~ — retired in batch 16
- ~~`helpers/plant-unit-ownership.js`~~ — retired in batch 16
- ~~`helpers/quotes-provider-routes.js`~~ — retired in batch 11 (finance cluster)

### Misc

Batch 16 (2026-05-16) retired `entities/index.js` and
`certificates/standards.js`. `routes/api/index.js` shows 0 live prisma
calls in the original audit; the surviving "1" was a comment reference.

- ~~`entities/index.js`~~ — retired in batch 16
- ~~`certificates/standards.js`~~ — retired in batch 16
- `routes/api/index.js` (0 live — comment-only reference, already clean)

## Effort estimate per cluster

Estimates assume a single engineer familiar with the service layer, including
adding the new service methods, refactoring, and writing/updating tests.

| Cluster                                  | Rough effort |
|------------------------------------------|--------------|
| `provider/handlers/*` (28 files)         | 4–5 person-days. Most files are thin wrappers per workflow step; many can share a single new method in `application-service` or `workflow-transition-service`. Highest payoff because of fan-out volume. |
| `applications/*` (6 files)               | 2 person-days. `applications.js` alone is 18 calls and touches the wizard/draft flow; coordinate with C1/C2 owners of the review methods. |
| `audit/*` (6 files)                      | 2 person-days. Most callers already use `field-audit-service`; the remaining methods should land there. |
| `finance/*` (4 files)                    | 1 person-day. `quotes.js` is the bulk; `invoice-service` is already the right home. |
| `documents/*` (5 files)                  | 2 person-days. There is no canonical "documents service" yet — needs new `document-service.js`. |
| `cultivation/*` (9 files)                | 2 person-days. Lots of small CRUD; consider a generic `cultivation-record-service` keyed on entity type. |
| `system/*` (6 files)                     | 1.5 person-days. Mostly read-only analytics; safe to move into `metrics-service` / new `system-report-service`. |
| `admin/*` (5 files)                      | 1 person-day. Pattern already established by the admin/users refactor in this batch. |
| `auth/identity/*` (3 files)              | 1 person-day. `mfa.js` is sensitive — coordinate with auth team. |
| `trace/*` (3 files)                      | 0.5 person-day. `traceability-service` already exists. |
| `interoperability/integration/*` (4)     | 1 person-day. |
| `preview/*` (2 files)                    | 0.5 person-day. Mostly read-only dashboards; can share a `preview-service`. |
| `platform-admin/*`, `helpers/*`, misc    | 1 person-day. |
| **Total**                                | **~20 person-days** |

## Recommended next priorities

In order of risk-weighted return:

1. **`provider/handlers/*`** — highest call volume, broadest blast radius. A
   single mistake in a workflow handler (auditor decision, scheduler assign)
   can corrupt application state or expose cross-tenant data. Fan-out makes a
   shared service method here the highest-leverage fix.

2. **`applications/applications.js`** (18 calls) — the applicant-facing wizard
   and draft flow. PII-heavy; some of the predicates here have shifted with
   the PDPA Phase D rollout (JWT no longer carries `healthId`) and the
   ownership clauses need to stay aligned with the canonical
   `applicationService.resolveHealthIdentity` everywhere.

3. **`audit/audits.js`** (13 calls) and **`audit/farm-audit.js`** (10 calls)
   — these write to the immutable audit-log chain and operate on data that
   regulators may subpoena. Service-layer enforcement of audit hashing and
   actor-role validation is non-negotiable.

4. ~~**`finance/quotes.js`** (17 calls) and **`finance/accounting.js`** (13
   calls) — financial reporting. Already paired with `invoice-service`;
   moving the rest gives us a single audit point for revenue numbers.~~
   Retired in batch 11 (2026-05-16). New `quote-service.js`,
   `accounting-service.js`, and `system-config-service.js` are now the
   canonical audit points for revenue / billing data.

5. **`documents/report-submissions.js`** (13 calls) — touches PDPA-protected
   submission artifacts. No service yet, so the first PR will create
   `document-service.js`.

Lower-priority clusters (cultivation, trace, preview, helpers) are smaller
read-mostly endpoints and can be parallelised by junior engineers once the
patterns above are established.

## How to refactor (template)

For each route file:

1. Identify the service that owns the model (e.g. `Certificate` →
   `certificate-service`). If none exists, create one named
   `<domain>-service.js` under `apps/backend/services/`.
2. Move the Prisma query into a method on that service. Keep the column
   projection (`select` / `include`) inside the service so route bugs cannot
   accidentally widen the result.
3. Always enforce `isDeleted: false` and the ownership predicate
   (`healthId` / `applicantId` / `tenantId`) at the service boundary.
4. Remove the `require('.../prisma-database')` line from the route. If
   `prisma` is still needed as a transaction handle for `writeApplicationStatus`
   or similar, leave a comment explaining the exception (see
   `applications/applications-car.js` for the canonical example).
5. Run `npx jest apps/backend/__tests__` to confirm row-level filters still
   apply.
6. Verify with `Grep "prisma\\." <file>` — the result should be empty or
   contain only comments / `prisma.$transaction` boundaries.
