# UAT Sign-off Pack — Audit Fix v1.0

**Date**: 2026-03-06  
**Release**: Batch 1+2 (FB-01, FB-02, FB-03)  
**UAT Owner**: QA Lead  
**UAT Status**: ⬜ Not Started  

---

## A. UAT Scope

### In Scope (Backend changes — Batch 1+2)

| # | Feature Area | What Changed | UAT Required |
|---|-------------|-------------|-------------|
| 1 | Admin route access | `requireAdmin` middleware on `/api/admin/**` | Verify admin can access, non-admin cannot |
| 2 | provider route access | `providerOnly` middleware on identity, audits, post-audit, revision | Verify provider can access, Applicant cannot |
| 3 | Farm tenant isolation | `requireFarmOwnership` on site-analyses, training-records | Verify user A cannot see user B's farm |
| 4 | Cron authentication | `verifyCronSecret` mandatory | Verify cron works with secret, rejects without |
| 5 | Lab webhook auth | `requireApiKey('LAB_API_KEY')` | Verify lab callback accepts valid key, rejects invalid |
| 6 | Quote transitions | `guardTransition` on accept/reject/send | Verify only valid status transitions allowed |
| 7 | Payment logging | `console.error` → `logger.error` | Verify payment errors appear in structured logs |
| 8 | Sync auth | jwt.decode removed | Verify sync endpoint works for provider + health users |
| 9 | DB unique constraints | `gatewayRef`, `qrCode`, `publicUrl` @unique | Verify duplicates rejected at DB level |

### Out of Scope (Not changed — Batch 3)

| # | Area | Reason |
|---|------|--------|
| 1 | Health frontend flows | M-006 — not touched |
| 2 | Evidence upload UI | M-008 — not touched |
| 3 | Provider/admin namespace | M-007 — not touched |
| 4 | Public verification page | M-010 — not touched |
| 5 | Planting deep links | M-012 — not touched |

---

## B. UAT Test Cases

### TC-01: Admin Access Control

| Field | Value |
|-------|-------|
| **Precondition** | Admin user + non-admin user accounts exist |
| **Steps** | 1. Login as admin → GET `/api/admin/config` |
| | 2. Login as Applicant → GET `/api/admin/config` |
| | 3. No auth → GET `/api/admin/config` |
| **Expected** | 1. 200 OK  2. 403 Forbidden  3. 401/403 |
| **Owner** | QA |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-02: provider Route Access

| Field | Value |
|-------|-------|
| **Precondition** | Provider User + Applicant user accounts exist |
| **Steps** | 1. Login as provider → GET `/api/identity/pending` |
| | 2. Login as Applicant → GET `/api/identity/pending` |
| **Expected** | 1. 200 OK  2. 403 Forbidden |
| **Owner** | QA |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-03: Farm Tenant Isolation

| Field | Value |
|-------|-------|
| **Precondition** | User A owns Farm-1. User B owns Farm-2 |
| **Steps** | 1. Login as User A → GET `/api/site-analyses?farmId=Farm-1` |
| | 2. Login as User A → GET `/api/site-analyses?farmId=Farm-2` |
| | 3. Login as User B → GET `/api/training-records?farmId=Farm-1` |
| **Expected** | 1. 200 (own data)  2. 403 Forbidden  3. 403 Forbidden |
| **Owner** | QA |
| **Priority** | **P0 — Security critical** |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-04: Cron Secret Authentication

| Field | Value |
|-------|-------|
| **Precondition** | `CRON_SECRET` set in environment |
| **Steps** | 1. `curl -H "x-cron-secret: $CRON_SECRET" /api/cron/sla-check` |
| | 2. `curl -H "x-cron-secret: wrong-secret" /api/cron/sla-check` |
| | 3. `curl /api/cron/sla-check` (no header) |
| **Expected** | 1. 200 OK  2. 403 Forbidden  3. 403 Forbidden |
| **Owner** | DevOps |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-05: Lab Webhook Authentication

| Field | Value |
|-------|-------|
| **Precondition** | `LAB_API_KEY` set in environment |
| **Steps** | 1. `curl -H "x-api-key: $LAB_API_KEY" -X POST /api/callbacks/lab-result` |
| | 2. `curl -H "x-api-key: invalid" -X POST /api/callbacks/lab-result` |
| | 3. `curl -X POST /api/callbacks/lab-result` (no header) |
| **Expected** | 1. 400/200 (request processed)  2. 401/403  3. 401/403 |
| **Owner** | DevOps |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-06: Quote Status Transitions

| Field | Value |
|-------|-------|
| **Precondition** | Application with quote in DRAFT status |
| **Steps** | 1. Finance user: send quote (DRAFT→SENT) |
| | 2. Finance user: attempt accept (DRAFT→ACCEPTED, skipping SENT) |
| | 3. Health user: accept quote (SENT→ACCEPTED) |
| **Expected** | 1. 200 OK  2. 400 Invalid transition  3. 200 OK |
| **Owner** | QA |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-07: Login Flows (All Roles)

| Field | Value |
|-------|-------|
| **Precondition** | Valid accounts: health user, provider, admin |
| **Steps** | 1. Login as health user → verify dashboard loads |
| | 2. Login as provider → verify provider dashboard loads |
| | 3. Login as admin → verify admin dashboard loads |
| | 4. Logout each → verify session cleared |
| **Expected** | All logins succeed, dashboards load, logouts clear session |
| **Owner** | QA |
| **Priority** | **P0** |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-08: Application Lifecycle

| Field | Value |
|-------|-------|
| **Precondition** | Health user with verified farm |
| **Steps** | 1. Create new application → status DRAFT |
| | 2. Fill required fields → save |
| | 3. Submit application → status SUBMITTED |
| | 4. Admin assigns auditor → status REVIEWING |
| | 5. Verify application appears in admin list |
| **Expected** | Each transition succeeds, statuses match |
| **Owner** | QA |
| **Priority** | **P0** |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-09: Payment Endpoint

| Field | Value |
|-------|-------|
| **Precondition** | Application with approved quote |
| **Steps** | 1. `POST /api/payments/create` with valid data |
| | 2. Check structured logs for `[Payments]` entries |
| | 3. Attempt duplicate `gatewayRef` → should be rejected by DB |
| **Expected** | 1. Payment created  2. Structured JSON logs  3. Unique violation error |
| **Owner** | QA + DevOps |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-10: Sync Endpoint (Provider)

| Field | Value |
|-------|-------|
| **Precondition** | Provider user logged in with session cookie |
| **Steps** | 1. GET `/api/sync` with valid provider cookie |
| | 2. GET `/api/sync` with valid health cookie |
| | 3. GET `/api/sync` without cookie |
| **Expected** | 1. 200 (provider data)  2. 200 (health data)  3. 401 |
| **Owner** | QA |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

### TC-11: Database Unique Constraints

| Field | Value |
|-------|-------|
| **Precondition** | Migration applied, DB accessible |
| **Steps** | 1. `\d payment_transactions` → check `gatewayRef` unique |
| | 2. `\d trace_qr_security` → check `qrCode`, `publicUrl` unique |
| | 3. `INSERT INTO payment_transactions` with duplicate `gatewayRef` |
| **Expected** | 1-2. Unique indexes visible  3. Unique violation error |
| **Owner** | DBA |
| **Result** | ⬜ Pass / ⬜ Fail / ⬜ Blocked |
| **Notes** | |

---

## C. UAT Summary

| Category | Total | Pass | Fail | Blocked | Not Run |
|----------|-------|------|------|---------|---------|
| Access Control (TC-01–02) | 2 | | | | 2 |
| Security (TC-03–05) | 3 | | | | 3 |
| Workflow (TC-06) | 1 | | | | 1 |
| Core Flows (TC-07–08) | 2 | | | | 2 |
| Payment (TC-09) | 1 | | | | 1 |
| Sync (TC-10) | 1 | | | | 1 |
| Database (TC-11) | 1 | | | | 1 |
| **Total** | **11** | **0** | **0** | **0** | **11** |

---

## D. UAT Decision

| Criteria | Required | Status |
|----------|----------|--------|
| All P0 test cases pass (TC-03, TC-07, TC-08) | Mandatory | ⬜ |
| No P0/P1 failures unresolved | Mandatory | ⬜ |
| All security tests pass (TC-01–05) | Mandatory | ⬜ |
| All workflow tests pass (TC-06) | Recommended | ⬜ |
| All DB constraint tests pass (TC-11) | Mandatory | ⬜ |
| Total pass rate ≥ 90% | Recommended | ⬜ |

### Sign-off

| Role | Name | Decision | Date |
|------|------|----------|------|
| QA Lead | | ⬜ Accept / ⬜ Reject / ⬜ Conditional | |
| Lead Dev | | ⬜ Accept / ⬜ Reject / ⬜ Conditional | |
| Product Owner | | ⬜ Accept / ⬜ Reject / ⬜ Conditional | |

### UAT Verdict

- ⬜ **ACCEPTED** — All mandatory criteria met, proceed to deploy
- ⬜ **CONDITIONAL** — Minor issues, deploy with known limitations
- ⬜ **REJECTED** — P0 failures found, fix required before deploy
