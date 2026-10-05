# Regression Test Plan — Post Audit Fix (Batch 1 + 2)

**Date**: 2026-03-06  
**Scope**: All backend changes from FB-01 through FB-03  
**Affected areas**: Auth middleware, RBAC, farm ownership, status machine, payments, sync, schema constraints  

---

## 1. Smoke Tests

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| SM-01 | Server boot | `.env` configured, DB accessible | `npm run dev` | Server starts on configured port, no crash | Total outage | P0 |
| SM-02 | DB connection | `DATABASE_URL` valid | Server startup log | `Prisma connected` log appears | Total outage | P0 |
| SM-03 | Redis/Queue | `REDIS_URL` valid or optional | Server startup log | SLA Queue + PDF Queue ready, or graceful skip | Queue jobs fail silently | P1 |
| SM-04 | Health check | Server running | `GET /api/health` | `200 { status: "ok" }` | Monitoring blind | P0 |
| SM-05 | Prisma schema | Schema file valid | `npx prisma validate` | "schema is valid 🚀" | Cannot generate client | P0 |
| SM-06 | Migration chain | All migrations present | `npx prisma migrate status` | No pending migrations (or expected pending) | Deploy failure | P0 |

---

## 2. Critical Path Tests

### 2.1 Application Lifecycle (Health/HEALTH_USER Flow)

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| CP-01 | Create application | Health user logged in, farm exists | `POST /api/applications` with valid body | `201` with application ID, status=`DRAFT` | HEALTH_USERs cannot apply | P0 |
| CP-02 | Submit application | Application in `DRAFT` | `PUT /api/applications/:id` status→`SUBMITTED` | Status changes to `SUBMITTED` | Workflow blocked | P0 |
| CP-03 | **Status transition guard** | Application in `DRAFT` | Attempt transition `DRAFT`→`APPROVED` | `400` Invalid transition error | Workflow bypass | P0 |
| CP-04 | Phase 1 payment | Application in `PENDING_DOC_FEE` | `POST /api/payments/phase1/:id` | Payment URL + invoice returned | Revenue loss | P0 |
| CP-05 | Phase 2 payment | Application in `DOC_APPROVED`, provider auth | `POST /api/payments/phase2/:id` | Payment URL + invoice, scheduler/admin only | Revenue loss | P0 |
| CP-06 | Document upload | Application editable (`DRAFT`/`REVISION_REQUESTED`) | Upload via wizard/document endpoint | File stored, metadata saved | Application incomplete | P0 |
| CP-07 | Document review | Application `ASSIGNED_FOR_REVIEW`, reviewer auth | Approve → `DOC_APPROVED` | Status changes, history logged | Review stuck | P0 |
| CP-08 | Audit scheduling | Application `AUDIT_FEE_PAID`, scheduler auth | Confirm audit → `AUDIT_CONFIRMED` | Audit assigned, notifications sent | Audit delayed | P1 |
| CP-09 | Audit result | Application `AUDIT_CONFIRMED`, auditor auth | Pass → `AUDIT_PASSED` or CAR → `CAR_PENDING` | Status updated, history logged | Audit stuck | P0 |
| CP-10 | Certificate issuance | Application `APPROVED` | Issue certificate → `CERTIFIED` | Certificate record created, PDF generated | No certificate | P0 |
| CP-11 | **Legacy alias transition** | Application status is legacy (e.g. `UNDER_REVIEW`) | Transition using legacy status | `status-machine.js` resolves alias correctly | Silent failure | P1 |

### 2.2 Login / Logout

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| CP-20 | Health login | Valid health user | `POST /api/auth/health/login` | `200`, `auth_token` cookie set | HEALTH_USERs locked out | P0 |
| CP-21 | Provider login | Valid provider user | `POST /api/auth/provider/login` | `200`, `provider_token` cookie set | provider locked out | P0 |
| CP-22 | Token refresh | Valid refresh token | `POST /api/auth/*/refresh` | New access token returned | Session drops | P1 |
| CP-23 | Logout | Logged-in user | `POST /api/auth/*/logout` | Cookies cleared, `200` | Session leak | P1 |

### 2.3 Traceability & Verification

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| CP-30 | QR generation | Lot/batch exists | `POST /api/trace/*/qr` | QR code + unique `publicUrl` | No traceability | P1 |
| CP-31 | Public verification | QR `publicUrl` exists | `GET /api/public/verify/:code` | Trace data returned | Public trust broken | P0 |
| CP-32 | **QR uniqueness** | Multiple QR generations | Generate QR for different entities | Each `qrCode` and `publicUrl` is unique | Ambiguous lookup | P1 |

---

## 3. Role / Permission Tests

> Focus: Verifying Batch 1 M-003 (RBAC) + M-004 (auth guards) changes

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| RP-01 | **Admin routes** | Non-admin user token | `GET /api/admin/config` | `403 Forbidden` | Privilege escalation | P0 |
| RP-02 | **Admin routes** | Admin user token | `GET /api/admin/config` | `200` with config data | Admin locked out | P0 |
| RP-03 | **Criteria write** | Non-admin user token | `POST /api/criteria` | `403 Forbidden` | Data tampering | P0 |
| RP-04 | **Identity routes** | Non-Provider User token | `GET /api/identity/pending` | `403 Forbidden` | PII exposure | P0 |
| RP-05 | **Identity routes** | Provider User token | `GET /api/identity/pending` | `200` with pending list | provider blocked | P1 |
| RP-06 | **Audit reassign** | Health user (non-provider) | `POST /api/audits/:id/reassign` | `403 Forbidden` | Unauthorized reassignment | P0 |
| RP-07 | **Audit reassign** | Scheduler user token | `POST /api/audits/:id/reassign` | `200` reassignment OK | Scheduling stuck | P1 |
| RP-08 | **Cron routes** | No `x-cron-secret` header | `POST /api/cron/sla-check` | `403 Forbidden` | Cron hijack | P0 |
| RP-09 | **Cron routes** | Valid `CRON_SECRET` header | `POST /api/cron/sla-check` | `200` job executed | SLA check skipped | P1 |
| RP-10 | **Lab webhook** | No/wrong API key | `POST /api/callbacks/lab-result` | `401 Unauthorized` | Fake lab data | P0 |
| RP-11 | **Lab webhook** | Valid `LAB_API_KEY` | `POST /api/callbacks/lab-result` | `200` result processed | Lab integration broken | P1 |
| RP-12 | **Certificate download** | Different user's cert | `GET /api/certificates/:id/download` | `403 Forbidden` | Data breach | P0 |
| RP-13 | **MFA verify** | Brute-force 10+ attempts | `POST /api/mfa/verify` with wrong code | Rate limited (429) | MFA bypass | P0 |
| RP-14 | **Post-audit tasks** | Non-Provider User | `POST /api/post-audit` | `403 Forbidden` | Unauthorized task creation | P1 |
| RP-15 | **Quote accept/reject** | Non-finance user | `POST /api/quotes/:id/accept` | `403 Forbidden` | Unauthorized financial action | P0 |
| RP-16 | **Role normalization** | User with legacy role `reviewer_auditor` | Any authenticated request | `normalizeRole()` → `document_reviewer` | Role mismatch, access denied | P0 |
| RP-17 | **Canonical RBAC** | Frontend calls `normalizeRole()` | Login flow in web-app | Same result as backend | Frontend/backend drift | P1 |

---

## 4. API Contract Tests

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| AC-01 | Payment create | Auth'd health user | `POST /api/payments/create { applicationId }` | `200 { success, data: { phase, invoiceId, paymentUrl, amount, fees } }` | Payment UI broken | P0 |
| AC-02 | Payment status | Auth'd health user, own app | `GET /api/payments/status/:id` | `200 { success, status: { phase1Paid, phase2Paid } }` | Status sync broken | P0 |
| AC-03 | **Payment ownership** | Auth'd health user, other's app | `GET /api/payments/status/:id` | `403 Forbidden` | Cross-tenant data leak | P0 |
| AC-04 | Application list | Auth'd health user | `GET /api/applications` | Only own applications returned | Cross-tenant data leak | P0 |
| AC-05 | **Farm ownership** | Auth'd user, other's farm | `GET /api/site-analyses?farmId=other` | `403 Forbidden` | Cross-tenant data leak | P0 |
| AC-06 | **Farm ownership** | Auth'd user, own farm | `GET /api/site-analyses?farmId=own` | `200` with site analyses | HEALTH_USER blocked | P1 |
| AC-07 | Config endpoints | No auth | `GET /api/config/document-slots` | `200` with static config | Wizard broken | P0 |
| AC-08 | **Sync endpoint** | Auth'd health user (cookie) | `POST /api/sync/offline` | Auth resolves via cookie, no JWT decode | Sync broken | P1 |
| AC-09 | Error response format | Any invalid request | Any endpoint with bad params | `{ success: false, error: "..." }` — no stack trace | Info leak | P1 |

---

## 5. Database / Migration Validation

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| DB-01 | **Dedup check** | Production DB access | Run `pre-migration-dedup-check.sql` | All 3 queries return empty | Migration will fail | P0 |
| DB-02 | **Migration apply** | DB-01 passed | `prisma migrate deploy` | `20260306200000_add_unique_constraints_audit_m016_m017` applied | Schema mismatch | P0 |
| DB-03 | **gatewayRef unique** | Migration applied | `INSERT` two PaymentTransaction with same `gatewayRef` | Second INSERT fails with unique violation | Duplicate webhooks | P0 |
| DB-04 | **qrCode unique** | Migration applied | `INSERT` two TraceQrSecurity with same `qrCode` | Second INSERT fails | QR ambiguity | P1 |
| DB-05 | **publicUrl unique** | Migration applied | `INSERT` two TraceQrSecurity with same `publicUrl` | Second INSERT fails | Trace collision | P1 |
| DB-06 | **NULL allowed** | Migration applied | `INSERT` PaymentTransaction with `gatewayRef = NULL` | Succeeds (partial unique index) | Webhook flow broken | P1 |
| DB-07 | **Schema no-duplicate** | Only one `schema.prisma` | Check `web-app/prisma/` does not exist | Directory absent | Schema drift | P0 |
| DB-08 | FK integrity | Existing data | `SELECT` orphan records (application without user) | No orphans | Data inconsistency | P1 |

---

## 6. Async / Webhook / Queue Tests

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| AW-01 | **Webhook idempotency** | Payment exists with `gatewayRef` | Send same webhook payload twice | Second call: no duplicate record created | Double charge / double state change | P0 |
| AW-02 | **Webhook atomicity** | Valid webhook payload | `POST /api/webhooks/payment` | Uses `prisma.$transaction`, all-or-nothing | Partial update | P0 |
| AW-03 | **Webhook error codes** | Invalid payload | `POST /api/webhooks/payment` with bad data | Returns `4xx` (not `200`) | Silent data loss | P0 |
| AW-04 | **Cron secret enforcement** | `CRON_SECRET` not set in env | Server startup → cron route hit | `403` or startup warning logged | Cron hijack | P0 |
| AW-05 | SLA queue | Redis available | Wait for cron schedule (or manual trigger) | Job processes without error | SLA breaches undetected | P1 |
| AW-06 | PDF queue | Redis available, valid data | Trigger certificate PDF generation | PDF generated in sandboxed process | No certificate PDF | P1 |
| AW-07 | DLQ queue | `ENABLE_WEBHOOK_DLQ=true` | Failed webhook → DLQ | Job retried at 02:00 daily | Lost webhook data | P1 |
| AW-08 | DLQ disabled | `ENABLE_WEBHOOK_DLQ` not set | Server startup | Log: "Webhook DLQ disabled" — no crash | Silent skip is OK | P2 |
| AW-09 | **Sync auth** | Provider user with only Bearer token | `POST /api/sync/offline` | Falls through to `authenticateHealth` (no jwt.decode) | Sync broken for edge case | P1 |

---

## 7. UI State Tests

> These are manual/browser tests for frontend behavior affected by backend changes.

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| UI-01 | Admin dashboard | Admin logged in | Navigate to `/provider/admin` | Dashboard loads, config accessible | Admin blind | P0 |
| UI-02 | **Role display** | User with legacy role alias | Login → view profile/dashboard | Role displayed as canonical name | Confusion | P1 |
| UI-03 | Payment wizard | Health user, app in `PENDING_DOC_FEE` | Click "Pay" → payment page | Payment URL loads, amount correct | Payment stuck | P0 |
| UI-04 | Document wizard | Health user, app in `DRAFT` | Navigate to wizard step 4 (documents) | Upload UI functional, slots match config | Cannot submit docs | P0 |
| UI-05 | Application status | Health user | View application list | Status badge shows correct canonical status | User confusion | P1 |
| UI-06 | Certificate download | Health user, own certificate | Click download | PDF downloads successfully | No proof of cert | P1 |
| UI-07 | **Cross-tenant block** | Health user | Directly access `/api/site-analyses?farmId=OTHER` | Error shown, not other's data | Data breach | P0 |
| UI-08 | Audit reassign UI | Scheduler logged in | Navigate to audit reassignment page | Form loads, reassign works | Scheduling stuck | P1 |
| UI-09 | QR verification page | Public user | Scan QR → public verify page | Certificate/trace data displayed | Public trust broken | P0 |
| UI-10 | Session expiry | User idle > token TTL | Interact with UI | Redirect to login (no crash) | UX broken | P1 |

---

## 8. Production Safety Checks

| ID | Area | Preconditions | Steps | Expected Result | Failure Impact | Priority |
|----|------|--------------|-------|-----------------|---------------|----------|
| PS-01 | **Env vars complete** | Production server | Check all required env vars via `environment-validator.js` | All REQUIRED vars present, no fallback secrets | Auth bypass | P0 |
| PS-02 | **No debug logging** | Production build | grep `console.log` in `auth-service.ts` | All wrapped in `isDev` guard | Info leak | P0 |
| PS-03 | **E2E routes disabled** | `NODE_ENV=production` | `POST /api/e2e/reset` | `403 Forbidden` | Data wipe | P0 |
| PS-04 | **Nginx reverse proxy** | Production deploy | Check port exposure | Only Nginx port (80/443) exposed, backend internal | Direct attack surface | P0 |
| PS-05 | HTTPS | Production domain | `curl -I https://domain` | Valid SSL certificate, HSTS header | MITM risk | P0 |
| PS-06 | **Error messages** | Production | Trigger 500 error | Response contains generic error, no stack trace | Info leak | P1 |
| PS-07 | Rate limiting | Production | 100+ requests in 1 minute to `/api/mfa/verify` | Rate limited (429) after threshold | Brute force | P0 |
| PS-08 | **Migration applied** | Production DB | `prisma migrate status` | All migrations applied, no pending | Schema mismatch | P0 |
| PS-09 | Docker health | Production containers | `docker ps` | All containers healthy, restart count = 0 | Silent failure | P1 |
| PS-10 | Log aggregation | Production | Check logger output format | Structured JSON logs (not console.error) | Debugging blind | P1 |

---

## Execution Priority Matrix

| Priority | Count | Execution Order |
|----------|-------|----------------|
| **P0** (must pass before deploy) | 38 | Run first — any failure = release blocker |
| **P1** (should pass) | 22 | Run second — failures create tech debt tickets |
| **P2** (nice to have) | 1 | Run last — informational only |

## Affected-Area Coverage Map

| Changed File | Test IDs Covering It |
|-------------|---------------------|
| `require-admin.js` | RP-01, RP-02, RP-03 |
| `farm-ownership.js` | AC-05, AC-06, UI-07 |
| `api-key-auth.js` | RP-10, RP-11 |
| `audits-reassign.js` | RP-06, RP-07, UI-08 |
| `canonical-rbac.js` | RP-16, RP-17 |
| `status-machine.js` | CP-03, CP-11 |
| `transition-guard.js` | CP-03, CP-11 |
| `sync.js` | AC-08, AW-09 |
| `payments.js` | CP-04, CP-05, AC-01, AC-02, AC-03 |
| `schema.prisma` (unique) | DB-01→DB-08, AW-01 |
| `webhooks.js` | AW-01, AW-02, AW-03 |
| `cron.js` | RP-08, RP-09, AW-04 |
| `queue-service.js` | AW-05→AW-08 |
| `identity.js` | RP-04, RP-05 |
| `certificates.js` | RP-12, UI-06 |
| `mfa.js` | RP-13, PS-07 |
