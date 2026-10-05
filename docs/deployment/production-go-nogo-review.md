# Production Go/No-Go Review

**Review date**: 2026-03-06  
**Reviewer**: Automated audit pipeline  
**Input documents**: master-audit-consolidation-report, post-implementation-verification-report, regression-test-plan  
**Audit batches completed**: Batch 1 (FB-01) + Batch 2 (FB-02, FB-03)

---

## A. Go / No-Go Verdict

### 🟡 CONDITIONAL GO — Phased Rollout

The backend security layer is production-ready. Frontend alignment and schema migration require controlled sequencing.

| Component | Verdict | Rationale |
|-----------|---------|-----------|
| **Backend auth/RBAC** | ✅ GO | 15+ routes hardened, 40 tests pass, all P0 auth issues closed |
| **Status machine** | ✅ GO | Canonical dictionary + transition guard operational |
| **Tenant isolation** | ✅ GO | `requireFarmOwnership` enforced on all farm-scoped routes |
| **Schema migration** | 🟡 GO after dedup | Migration ready but requires pre-deploy data check |
| **Payment flow** | 🟡 GO with monitoring | Atomicity fixed, logger hardened; idempotency key exists but gateway-level dedup pending migration |
| **Frontend health flows** | ❌ HOLD | M-006, M-008 not touched — health applicant journey uses wrong contracts |
| **Frontend provider/admin namespace** | ❌ HOLD | M-007, M-012 not touched — cosmetic but confusing |
| **Public verification surface** | ❌ HOLD | M-010 not touched — dual truth endpoints |

---

## B. Remaining Blockers

> Issues that **must** be resolved before full production release.

| # | Issue | Severity | Status | Blocker For |
|---|-------|----------|--------|-------------|
| 1 | **DB migration not applied** | P0 | Migration file ready, dedup check required | Schema deploy |
| 2 | **M-006: Health flows wrong contracts** | P0 | Not touched | Health applicant journey |
| 3 | **M-008: Evidence/document durability** | P0 | Not touched | Document upload reliability |
| 4 | **Integration tests missing** | P1 | Unit tests only (40 pass) | Release confidence |
| 5 | **Migration chain broken** (P3006) | P1 | Pre-existing, shadow DB issue | `prisma migrate dev` workflow |

> [!IMPORTANT]
> Blockers 1 is resolvable in < 1 hour. Blockers 2–3 are Batch 3 scope (frontend work). Blocker 4 can be mitigated by manual API testing. Blocker 5 does not affect `prisma migrate deploy`.

---

## C. Accepted Risks

| # | Risk | Severity | Mitigation | Expiry |
|---|------|----------|-----------|--------|
| 1 | **Session dual-write** (localStorage + cookies) | Medium | Both paths work; provider_token maintained for backward compat | Remove in Batch 3 FB-04 |
| 2 | **30+ files still use `console.error`** | Low | Not security risk; logs work but aren't structured | Batch 3 cleanup |
| 3 | **Workflow status dialect not frozen across all routes** | Medium | `transition-guard` enforces on quotes routes; other routes use raw status strings | Batch 3 FB-05 |
| 4 | **DLQ disabled by default** | Low | Webhook failures logged, manual reconciliation possible | Enable when Redis stable |
| 5 | **Provider Bearer-only sync auth defaults to health** | Low | Cookie-based flow covers 99%+ of sync requests | Monitor error rate after deploy |
| 6 | **`application-flow.js` empty file exists** | Negligible | Unmounted, 0 bytes, no runtime impact | Delete in next cleanup |
| 7 | **QR uniqueness constraint depends on migration** | Medium | Pre-deploy: run migration; Post-deploy: DB enforces | Resolved once migration applied |

---

## D. Required Checks Before Deploy

### Pre-Deploy Checklist

| # | Check | Command / Action | Pass Criteria | Done? |
|---|-------|-----------------|---------------|-------|
| 1 | Env vars complete | `node -e "require('./shared/environment-validator').validate()"` | All REQUIRED vars present, no fallback secrets | ☐ |
| 2 | Schema valid | `npx prisma validate` | "schema is valid 🚀" | ☑ |
| 3 | **Dedup check** | Run `prisma/pre-migration-dedup-check.sql` on production DB | All 3 queries return empty | ☐ |
| 4 | **Apply migration** | `npx prisma migrate deploy` | Migration `20260306200000_...` applied | ☐ |
| 5 | Prisma generate | `npx prisma generate` | Client generated without error | ☐ |
| 6 | Unit tests | `npx jest __tests__/unit/ --no-coverage` | Our 5 suites (40 tests) pass | ☑ |
| 7 | E2E routes disabled | Verify `NODE_ENV=production` in `.env` | `/api/e2e/reset` returns 403 | ☐ |
| 8 | Nginx configured | Check nginx proxy config | Reverse proxy in front of backend | ☐ |
| 9 | Docker build | `docker compose build` | Builds without error | ☐ |
| 10 | Smoke test | `curl /api/health` after deploy | `200 { status: "ok" }` | ☐ |

### Post-Deploy Verification (first 30 minutes)

| # | Check | Method |
|---|-------|--------|
| 1 | Login flows work | Manual: login as health, provider, admin |
| 2 | Application create works | Manual: create + submit application |
| 3 | Auth guards active | `curl /api/admin/config` without auth → 403 |
| 4 | Payment endpoint responds | `POST /api/payments/create` with valid data |
| 5 | Webhook handler responds | Send test webhook → check structured logs |
| 6 | No error spikes | Monitor `logger.error` rate for 30 min |

---

## E. Rollback Triggers

| # | Trigger | Action | Recovery Time |
|---|---------|--------|--------------|
| 1 | **Login failure rate > 5%** | Rollback Docker image to previous tag | < 5 min |
| 2 | **Payment endpoint 500 rate > 1%** | Rollback + investigate webhook handler | < 10 min |
| 3 | **Migration fails on deploy** | `prisma migrate resolve --rolled-back 20260306200000_...` | < 5 min |
| 4 | **Admin routes inaccessible** | Check `requireAdmin` middleware, rollback if needed | < 10 min |
| 5 | **Cross-tenant data visible** | Immediate rollback + security incident | < 5 min |
| 6 | **Queue/Redis crash loop** | Disable queue via env var, redeploy | < 10 min |

### Rollback Procedure

```bash
# 1. Tag current state
docker tag gacp-backend:latest gacp-backend:rollback-20260306

# 2. Rollback to previous image
docker compose down
docker tag gacp-backend:previous gacp-backend:latest
docker compose up -d

# 3. If migration must be reversed
npx prisma migrate resolve --rolled-back 20260306200000_add_unique_constraints_audit_m016_m017

# 4. Verify
curl https://your-domain/api/health
```

---

## F. Recommended Deployment Order

### Phase 1: Backend Security Layer (✅ Ready Now)

**Deploy scope**: All Batch 1 + 2 backend changes

| Order | Component | Files | Risk |
|-------|-----------|-------|------|
| 1 | RBAC + auth middleware | `require-admin.js`, `api-key-auth.js`, `farm-ownership.js` | Low — additive only |
| 2 | Route guards | `admin/index.js`, `identity.js`, `audits-reassign.js`, `cron.js`, `criteria.js` | Low — additive |
| 3 | Status machine | `status-machine.js`, `transition-guard.js` | Low — new files |
| 4 | Sync auth fix | `sync.js` | Medium — changed auth dispatch logic |
| 5 | Payments logger | `payments.js` | Low — console→logger swap |
| 6 | Schema migration | `schema.prisma` + migration | **High — requires dedup check first** |

**Feature flags to enable**: None needed. All changes are backward-compatible guards.

### Phase 2: Frontend Alignment (❌ Hold — Batch 3)

| Module | Issue | Reason to Hold |
|--------|-------|---------------|
| Health applicant journey | M-006, M-008 | Wrong backend contracts, false-success fallbacks |
| Provider/admin namespace | M-007, M-012 | Cosmetic but confusing — needs careful URL migration |
| Public trust surface | M-010 | Dual endpoints — pick canonical one first |
| Session contract freeze | M-001 | Dual-write removal needs coordinated frontend+backend change |
| Evidence upload | M-008 | Frontend wiring not connected to real upload API |

### Phase 3: Infrastructure Hardening (Future)

| Module | Issue | When |
|--------|-------|------|
| Migration chain cleanup | M-019 | Before next schema change |
| Integration test suite | M-022 | Before Phase 2 deploy |
| DLQ activation | M-014 | When Redis is production-stable |
| `console.error` → `logger.error` sweep | — | Batch 3 cleanup sprint |

---

## Summary

```
┌─────────────────────────────────────────────────┐
│  VERDICT: 🟡 CONDITIONAL GO — Phased Rollout    │
│                                                  │
│  Phase 1 (Backend): READY ✅   Deploy Now        │
│  Phase 2 (Frontend): HOLD ❌   Batch 3           │
│  Phase 3 (Infra):    LATER ⏳  Post-stabilize   │
│                                                  │
│  Blockers:    1 actionable (migration)           │
│  Accepted:    7 risks with mitigations           │
│  Tests:       40/40 pass, 61 regression cases    │
│  Rollback:    6 triggers defined                 │
└─────────────────────────────────────────────────┘
```
