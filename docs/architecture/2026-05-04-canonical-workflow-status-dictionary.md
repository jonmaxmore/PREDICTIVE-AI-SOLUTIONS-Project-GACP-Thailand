# Canonical Workflow & Status Dictionary

- Status: Proposed canonical contract (T-005 deliverable)
- Last Updated: 2026-05-04
- Owners: Security / Architecture review (proposers); Backend, Frontend, Database, QA (reviewers)
- Depends on: `2026-05-04-canonical-auth-session-rbac-contract.md` (T-001)
- Source-of-truth code: `apps/backend/services/workflow-transition-service.js`
- Supersedes / consolidates:
  - `apps/backend/shared/workflow-state-machine.js` (re-export shim)
  - `docs/architecture/canonical-target-model.md` §1 (workflow state machine)
  - `docs/architecture/workflow-state-machine.md`

## Purpose

Freeze a single, signed-off dictionary of every status / phase value the platform may emit, accept, or normalize across:

- Application workflow (the master state machine)
- Quote
- Invoice
- Payment Transaction
- Certificate
- Planting Cycle
- Harvest Batch / Lot

Each route family knows which statuses it **may read**, **may emit**, and **may temporarily normalize** (legacy alias). New code emits canonical only.

This document is **prescriptive**. Anything that contradicts it is a bug.

---

## 1. Application workflow (master state machine)

### 1.1 Canonical states (20)

Source: `services/workflow-transition-service.js:18-39`. Order matches the happy path.

| # | State | Phase | Owner of arrival | Comment-required to emit? |
|---:|---|---|---|:---:|
| 1 | `DRAFT` | pre-submit | system (auto on draft create) | — |
| 2 | `SUBMITTED` | post-submit | health | — |
| 3 | `PENDING_DOC_FEE` | phase 1 billing | system | — |
| 4 | `PHASE_1_SLIP_UNDER_REVIEW` | phase 1 slip | health (uploads slip) | — |
| 5 | `DOC_FEE_PAID` | phase 1 done | account | — |
| 6 | `ASSIGNED_FOR_REVIEW` | doc review | scheduler | — |
| 7 | `REVISION_REQUESTED` | revision loop | document_reviewer / auditor | ✅ |
| 8 | `DOC_APPROVED` | doc done | document_reviewer / auditor | — |
| 9 | `PENDING_AUDIT_FEE` | phase 2 billing | system | — |
| 10 | `PHASE_2_SLIP_UNDER_REVIEW` | phase 2 slip | health (uploads slip) | — |
| 11 | `AUDIT_FEE_PAID` | phase 2 done | account | — |
| 12 | `AUDIT_CONFIRMED` | audit scheduled | scheduler | — |
| 13 | `CAR_PENDING` | corrective action | auditor | ✅ |
| 14 | `CAR_REVIEWING` | CAR submitted | health (resubmits) | — |
| 15 | `AUDIT_PASSED` | audit done | auditor | — |
| 16 | `APPROVED` | final OK | auditor | — |
| 17 | `CERTIFIED` | certificate issued | admin | — |
| 18 | `REJECTED` | terminal fail | auditor / system | ✅ |
| 19 | `EXPIRED` | terminal expiry | system | — |
| 20 | `CANCEL_EXPIRED` | terminal cancel | system | — |

### 1.2 Allowed transitions

Source: `ALLOWED_TRANSITIONS` (`workflow-transition-service.js:165-187`).

```
DRAFT                     → SUBMITTED
SUBMITTED                 → PENDING_DOC_FEE
PENDING_DOC_FEE           → PHASE_1_SLIP_UNDER_REVIEW
PHASE_1_SLIP_UNDER_REVIEW → DOC_FEE_PAID | PENDING_DOC_FEE
DOC_FEE_PAID              → ASSIGNED_FOR_REVIEW
ASSIGNED_FOR_REVIEW       → DOC_APPROVED | REVISION_REQUESTED
REVISION_REQUESTED        → ASSIGNED_FOR_REVIEW | EXPIRED
DOC_APPROVED              → PENDING_AUDIT_FEE
PENDING_AUDIT_FEE         → PHASE_2_SLIP_UNDER_REVIEW
PHASE_2_SLIP_UNDER_REVIEW → AUDIT_FEE_PAID | PENDING_AUDIT_FEE
AUDIT_FEE_PAID            → AUDIT_CONFIRMED
AUDIT_CONFIRMED           → AUDIT_PASSED | CAR_PENDING | REJECTED
CAR_PENDING               → CAR_REVIEWING
CAR_REVIEWING             → AUDIT_PASSED | CAR_PENDING
AUDIT_PASSED              → APPROVED
APPROVED                  → CERTIFIED
CERTIFIED                 → ∅ (terminal)
REJECTED                  → ∅
EXPIRED                   → ∅
CANCEL_EXPIRED            → ∅
```

Any other (from → to) pair is rejected by `workflow-transition-service.canTransition()`.

### 1.3 Role-owned transitions

Source: `ROLE_TRANSITIONS` (`workflow-transition-service.js:195-228`).

| Role | Permitted transitions |
|---|---|
| `health` | `DRAFT→SUBMITTED`, `REVISION_REQUESTED→ASSIGNED_FOR_REVIEW`, `CAR_PENDING→CAR_REVIEWING`, `PENDING_DOC_FEE→PHASE_1_SLIP_UNDER_REVIEW`, `PENDING_AUDIT_FEE→PHASE_2_SLIP_UNDER_REVIEW` |
| `account` | `PHASE_1_SLIP_UNDER_REVIEW→DOC_FEE_PAID`, `PHASE_1_SLIP_UNDER_REVIEW→PENDING_DOC_FEE`, `PHASE_2_SLIP_UNDER_REVIEW→AUDIT_FEE_PAID`, `PHASE_2_SLIP_UNDER_REVIEW→PENDING_AUDIT_FEE` |
| `document_reviewer` | `ASSIGNED_FOR_REVIEW→DOC_APPROVED`, `ASSIGNED_FOR_REVIEW→REVISION_REQUESTED` |
| `scheduler` | `DOC_FEE_PAID→ASSIGNED_FOR_REVIEW`, `AUDIT_FEE_PAID→AUDIT_CONFIRMED` |
| `auditor` | document review (same as document_reviewer) + `AUDIT_CONFIRMED→{AUDIT_PASSED,CAR_PENDING,REJECTED}`, `CAR_REVIEWING→{AUDIT_PASSED,CAR_PENDING}`, `AUDIT_PASSED→APPROVED` |
| `admin` | bypass — any allowed transition |
| `system` | `SUBMITTED→PENDING_DOC_FEE`, `DOC_APPROVED→PENDING_AUDIT_FEE`, `*→EXPIRED`, `*→CANCEL_EXPIRED`, `APPROVED→CERTIFIED` (when admin issues cert) |

`HEAD_AUDITOR` transitions were merged into `auditor` (consolidation note in code, line 227).

### 1.4 Comment-required transitions

`REQUIRES_COMMENT_TARGETS` (line 231): emitting `REVISION_REQUESTED`, `CAR_PENDING`, or `REJECTED` requires a non-empty `comment` field. Backend rejects 400 otherwise.

### 1.5 Editable statuses

`EDITABLE_STATUSES` (line 238): the applicant may edit form / upload docs only when the application is in `DRAFT`, `REVISION_REQUESTED`, or `CAR_PENDING`. Any other state → form is read-only.

### 1.6 Legacy alias dictionary (input)

Accepted by `STATE_INPUT_ALIASES` (lines 41-79) for reads only — **NEW CODE MUST NOT EMIT THESE**:

| Legacy / case-variant | Canonical |
|---|---|
| `pending_doc_fee` (lowercase) and 18 other lowercase variants | (their UPPER form) |
| `pending_document_review` | `ASSIGNED_FOR_REVIEW` |
| `doc_review_in_progress` | `ASSIGNED_FOR_REVIEW` |
| `waiting_phase2_payment` | `DOC_APPROVED` |
| `schedulable`, `scheduling` | `AUDIT_FEE_PAID` |
| `inspection_scheduled`, `inspection_in_progress`, `audit_scheduled`, `audit_in_progress` | `AUDIT_CONFIRMED` |
| `inspection_completed`, `audited` | `AUDIT_PASSED` |
| `final_approved` | `APPROVED` |
| `final_rejected` | `REJECTED` |
| `car_submitted` | `CAR_REVIEWING` |
| `registered` | `SUBMITTED` |
| `doc_review` | `ASSIGNED_FOR_REVIEW` |

### 1.7 Legacy DB-status alias dictionary

Accepted by `STATE_BY_LEGACY_STATUS` (lines 110-158) when reading old DB rows:

| Legacy DB status | Canonical state |
|---|---|
| `PAYMENT_1_PAID` | `DOC_FEE_PAID` |
| `PAYMENT_1_PENDING` | `PENDING_DOC_FEE` |
| `REGISTERED` | `SUBMITTED` |
| `PENDING_REVIEW`, `IN_REVIEW`, `UNDER_REVIEW`, `DOC_REVIEW` | `ASSIGNED_FOR_REVIEW` |
| `REVISION_REQUIRED`, `REVISION_REQ` | `REVISION_REQUESTED` |
| `DOCUMENT_APPROVED` | `DOC_APPROVED` |
| `PAYMENT_2_PENDING` | `PENDING_AUDIT_FEE` |
| `PAYMENT_2_COMPLETED`, `AWAITING_SCHEDULE` | `AUDIT_FEE_PAID` |
| `SCHEDULED`, `AUDIT_SCHEDULED`, `AUDIT_IN_PROGRESS`, `PENDING_AUDIT`, `INSPECTION_IN_PROGRESS`, `INSPECTION_SCHEDULED` | `AUDIT_CONFIRMED` |
| `INSPECTION_COMPLETED`, `AUDITED` | `AUDIT_PASSED` |
| `FINAL_APPROVED` | `APPROVED` |
| `FINAL_REJECTED`, `AUDIT_FAILED` | `REJECTED` |
| `CAR_SUBMITTED` | `CAR_REVIEWING` |

Backfill of these legacy DB rows to canonical values is a Database track task; until then routes must round-trip via `STATE_BY_LEGACY_STATUS`.

---

## 2. Quote workflow

Source: `apps/backend/prisma/schema/billing.prisma` Quote.status.

| Canonical | Comment |
|---|---|
| `pending` | default; awaiting accept/reject |
| `accepted` | terminal positive — quote becomes basis for invoice |
| `rejected` | terminal negative |
| `expired` | TTL passed without action |

No legacy aliases. All four are lowercase.

---

## 3. Invoice workflow

Source: `Invoice.status` in `billing.prisma`.

| Canonical | Comment |
|---|---|
| `pending` | default; due date set |
| `paid` | terminal positive |
| `overdue` | past due date, not paid |
| `cancelled` | manually voided |

Lifecycle: `pending` → (`paid` | `overdue` | `cancelled`); `overdue` → (`paid` | `cancelled`).

No legacy aliases.

### Subscription model (Subscription.status, separate billing model)

| Canonical | Comment |
|---|---|
| `PENDING_PAYMENT` | default; awaiting first payment |
| `ACTIVE` | active subscription |
| `EXPIRED` | TTL passed |
| `CANCELLED` | user-cancelled |

Note: subscription uses **uppercase** because it predates the lowercase invoice convention. Frozen here for consistency until a future schema migration aligns them.

---

## 4. Payment Transaction workflow

Source: `PaymentTransaction.status` in `billing.prisma`.

| Canonical (UPPERCASE) | Comment |
|---|---|
| `PENDING` | default — gateway hasn't reported yet |
| `PROCESSING` | gateway in flight |
| `SUCCESS` | terminal positive — webhook confirmed |
| `FAILED` | gateway returned failure |
| `CANCELLED` | user cancelled before gateway processed |
| `EXPIRED` | gateway TTL passed |
| `REFUNDED` | post-success refund |

No legacy aliases. Webhook confirmation is the only allowed path to `SUCCESS`.

### Payment-slip processing (separate `PaymentSlip` model — Phase 1/2 manual flows)

| Canonical | Comment |
|---|---|
| `UNPROCESSED` | default — applicant uploaded |
| `PROCESSED` | account approved |
| `FAILED` | account rejected — applicant must re-upload |

Slip status drives the parent application's `PHASE_*_SLIP_UNDER_REVIEW` transitions (§1.3 `account` row).

---

## 5. Certificate workflow

Source: `Certificate.status` in `certification.prisma`.

| Canonical (lowercase) | Comment |
|---|---|
| `active` | default; cert is in force |
| `expired` | past `expiryDate` |
| `revoked` | admin-revoked |
| `renewed` | superseded by a later cert |

Legacy alias seen in code: `'ACTIVE'` (uppercase) — accepted on read, normalized to `active` on write. `applications.js` `/geography/farms` query in `analytics.js` was patched to use `'ACTIVE'` form pre-merge; the canonical form is **lowercase** (matches the `@default("active")` in the schema).

---

## 6. Planting Cycle workflow

Source: `PlantingCycle.status` in `cultivation.prisma`.

```
PLANNING → PLANTED → GROWING → HARVESTED → COMPLETED
```

| Canonical | Comment |
|---|---|
| `PLANNING` | default; before planting |
| `PLANTED` | seeds in soil; cycle started |
| `GROWING` | mid-cycle |
| `HARVESTED` | harvest batches created (cycle is locked for plot edits, see §6.1) |
| `COMPLETED` | cycle closed; trace data archived |

### 6.1 Lock semantics

Once a cycle reaches `HARVESTED`, plot assignments are immutable (the validate-health-planting-flow regression gate verifies this at line 310: `lockMessage.includes('locked')`). Any PATCH that tries to add/change `plotAssignments` after `HARVESTED` returns 400.

---

## 7. Plant Unit workflow

Source: `PlantUnit.status` in `cultivation.prisma`.

| Canonical | Comment |
|---|---|
| `DRAFT` | created but not confirmed |
| `PLANTED` | confirmed (QR generated) |
| `GROWING` | mid-cycle |
| `HARVESTED` | linked to a harvest batch |
| `SOLD` | sold via QR trace |
| `DIED` | lost (must record reason) |
| `REMOVED` | manually removed by user |

`SOLD`, `DIED`, `REMOVED` are terminal.

---

## 8. Harvest Batch / Lot workflow

Source: `HarvestBatch.status`, `Lot.status` in `cultivation.prisma` and `trace.prisma`.

### 8.1 Harvest Batch

| Canonical | Comment |
|---|---|
| `CREATED` | default — batch created at harvest time |
| `PACKED` | post-packaging |
| `SHIPPED` | left the farm |
| `DELIVERED` | reached buyer / consumer |

### 8.2 Lot (Quality)

| Canonical | Comment |
|---|---|
| `PENDING` | default — awaiting first quality check |
| `MATCHED` | reconciled with QR-trace verifications |
| `DISCREPANCY` | quality data mismatched a verification — manual review required |

---

## 9. Report Submission status

Source: `ReportSubmission.status` in `certification.prisma`.

| Canonical | Comment |
|---|---|
| `PENDING_REVIEW` | default — awaiting reviewer |
| `APPROVED` | reviewer approved |
| `REJECTED` | reviewer rejected — applicant resubmits |
| `SUPERSEDED` | replaced by a later submission |

---

## 10. Per-route-family responsibility table

For each backend mount in `apps/backend/routes/api/`, this table records which status fields it touches.

| Route family | Reads | Emits | Normalizes legacy on read |
|---|---|---|---|
| `/api/applications/*` (health) | application all 20 states | `DRAFT→SUBMITTED` (canonical only), `REVISION_REQUESTED→ASSIGNED_FOR_REVIEW` | yes — `STATE_BY_LEGACY_STATUS` for older rows |
| `/api/applications/*` (provider review) | all 20 | per `ROLE_TRANSITIONS` for role | yes |
| `/api/preview/*` | DRAFT, REVISION_REQUESTED, CAR_PENDING (only editable states) | none — read-only | yes |
| `/api/payments/*` | PaymentTransaction status, Invoice status | PaymentTransaction `PENDING→{PROCESSING,SUCCESS,FAILED,CANCELLED,EXPIRED}`, Invoice `pending→{paid,cancelled}` | no |
| `/api/payments/webhook` (system) | PaymentTransaction | `→SUCCESS`, `→FAILED` (only path that may set SUCCESS) | no |
| `/api/payment-slips/*` (account) | PaymentSlip status, Application | PaymentSlip `UNPROCESSED→{PROCESSED,FAILED}`, Application `PHASE_*_SLIP_UNDER_REVIEW→{DOC_FEE_PAID,PENDING_DOC_FEE,AUDIT_FEE_PAID,PENDING_AUDIT_FEE}` | no |
| `/api/certificates/*` (read) | Certificate `active`, `expired`, `revoked`, `renewed` | none (issuance is via workflow) | accepts `'ACTIVE'` uppercase |
| `/api/certificates/*` (admin issue) | Application APPROVED | Certificate `active` | — |
| `/api/audits/*` | Application AUDIT_CONFIRMED, AUDIT_PASSED, CAR_PENDING, CAR_REVIEWING, REJECTED | per ROLE_TRANSITIONS auditor | yes |
| `/api/admin/*` | all | any allowed transition (admin bypass) | yes |
| `/api/provider/*` | per role | per role | yes |
| `/api/planting-cycles/*` | PlantingCycle status, PlantUnit status, HarvestBatch status | full lifecycle | no |
| `/api/trace/*`, `/api/lots/*` (public) | Lot status, HarvestBatch status, Certificate status (read-only) | none | accepts `ACTIVE` uppercase for cert |
| `/api/system/*` (analytics) | Certificate `'ACTIVE'` upper (legacy query), Application count | none | yes — query uses upper, schema default is lower |

### 10.1 Frontend badge / action mappings

`apps/web-app/src/lib/health-dashboard-stage.ts` and `apps/web-app/src/lib/health-dashboard-stage.js` provide the canonical Thai label + action button per state. Any portal that diverges from those mappings is a bug. Same dictionary is used by:

- `apps/web-app/src/app/health/dashboard/client-view.tsx`
- `apps/web-app/src/app/health/applications/**/*.tsx`
- `apps/web-app/src/app/provider/applications/**/*.tsx`
- `apps/web-app/src/app/admin/applications/**/*.tsx`

The dictionary's keys are the 20 canonical states. Provider/admin views may further partition by role — but the source state value MUST be canonical.

---

## 11. Definition of Done for T-005

This dictionary is signed off when:

1. ✅ Application 20-state machine + transitions + ROLE_TRANSITIONS mirror the code source-of-truth (§1)
2. ✅ Quote / Invoice / Subscription / PaymentTransaction / PaymentSlip status sets enumerated (§§2-4)
3. ✅ Certificate status set enumerated (§5)
4. ✅ Planting Cycle / Plant Unit / Harvest Batch / Lot status sets enumerated (§§6-8)
5. ✅ Report Submission status set enumerated (§9)
6. ✅ Each `/api/*` route family's read/emit/normalize responsibilities listed (§10)
7. ✅ Legacy alias dictionaries explicitly listed for input (§1.6) and DB (§1.7)
8. ⏳ Sign-off recorded by Backend, Frontend, Database, QA, Security/Architecture reviewers

Once §8 lands, downstream tasks T-006 (backend transition validation hardening), T-007 (frontend health portal alignment), T-008 (provider/admin alignment) execute against this dictionary.

## Out of scope for this document

- **Implementation diff** — how to migrate each existing site to comply is T-006/T-007/T-008 territory.
- **Database backfill** of legacy DB-status values to canonical (Database track).
- **Workflow transition unit tests** — the dictionary is the spec; tests verify code conforms.

## Validation checklist for reviewers

- [ ] §1.1 state list matches `services/workflow-transition-service.js:18-39` exactly (no extra, no missing)
- [ ] §1.2 transitions match `ALLOWED_TRANSITIONS` exactly
- [ ] §1.3 role transitions match `ROLE_TRANSITIONS` exactly
- [ ] §1.6 input aliases match `STATE_INPUT_ALIASES` exactly
- [ ] §1.7 DB aliases match `STATE_BY_LEGACY_STATUS` exactly
- [ ] §§2-9 status sets match the schema `@default(...)` comments and any code-side enum constants
- [ ] §10 every `router.use(...)` in `apps/backend/routes/api/index.js` has a row in the table
