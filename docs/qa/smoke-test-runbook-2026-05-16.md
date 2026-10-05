# Smoke Test Runbook — Iter 29 (FINAL)

**Date:** 2026-05-16
**Owner:** QA (hardening loop, Iter 29)
**Test file:** `apps/backend/__tests__/integration/production-smoke.test.js`

---

## What this is

A 5-case Jest suite that asks one question: **"do the basic things still
work?"** It is the fastest possible safety net around a deploy. It runs
**under 10 seconds** on a developer laptop and is meant to be the first
gate before a release reaches end users.

This is not a substitute for the full regression suite — it's a tripwire.
A green smoke means "deploy looks alive". A red smoke means "stop the
deploy / roll back".

---

## What it covers

| # | Case                              | Why it's in the smoke suite |
|--:|-----------------------------------|------------------------------|
| 1 | `GET /api/health` returns 200     | Liveness — if this breaks, nothing else can be true. |
| 2 | `GET /api/health/ready` requires auth + DB | Readiness — proves auth pipeline + DB pool both alive. |
| 3 | `GET /api/auth/public/verify/:n` works without auth | Public surface — proves the most-hit external path is reachable. |
| 4 | `POST /api/auth/login` shape      | Auth endpoint structure — proves the login contract didn't drift. |
| 5 | Canonical fees + single-issuer rule | Business-rule sanity — proves config didn't get clobbered. |

Why exactly five? Anything bigger would tempt the team to add coverage
to the smoke that belongs in the regression suite. The cap forces
discipline: smoke = tripwires only.

---

## When to run it

### Pre-deploy (mandatory)

1. CI runs the smoke as the final Jest job before publishing the image
   tag. If smoke is red, the image is not pushed.
2. SRE running a manual deploy: run smoke against staging FIRST, then
   the deploy script. Order matters — smoke proves staging is healthy
   so the deploy isn't masked by an environment-level fault.

```bash
cd apps/backend
npx jest __tests__/integration/production-smoke --no-coverage
```

Expected output:

```
PASS  __tests__/integration/production-smoke.test.js
  Production smoke suite (Iter 29 — runs <10s)
    1. Health endpoint — public liveness
      ✓ GET /api/health returns 200 when DB is reachable
      ✓ GET /api/health returns 503 when DB is down
    2. Readiness endpoint — auth-gated
      ✓ GET /api/health/ready returns 401 without Authorization
      ✓ GET /api/health/ready returns 200 with valid Bearer + DB up
      ✓ GET /api/health/ready returns 503 with valid Bearer but DB down
    3. Public certificate verify — no auth required
      ✓ GET /api/auth/public/verify/:certNumber works without auth (unknown cert)
      ✓ GET /api/auth/public/verify/:certNumber returns valid for active cert
    4. Auth login endpoint structure (mock)
      ✓ POST /api/auth/login returns 400 with empty body
      ✓ POST /api/auth/login returns token-shaped response on happy mock
    5. Sample data validation (canonical fees + single-issuer rule)
      ✓ Phase 1 fee for 1 scope equals 5,885 THB (5000 + 500 + 385)
      ✓ Phase 2 fee for 1 scope equals 29,425 THB (25000 + 2500 + 1925)
      (แก้ 2026-09-05 — VAT คิดบนค่าบริการทั้งก้อนตั้งแต่ W14; ตัวเลขเดิม
       5,535 / 27,675 เป็นของสูตรที่เลิกใช้แล้ว และจะทำให้ผู้รัน smoke test
       รายงานว่าระบบคิดเงินผิด ทั้งที่ระบบถูก)
      ✓ Full application (3 scopes) sums to canonical grandTotal
      ✓ Canonical FEE constants match business-rules defaults
      ✓ Single-issuer rule: state fees route to DTAM, platform fees route to PLATFORM
      ✓ DTAM issuer carries collection-agent marker (two-money-flow integrity)
      ✓ Unknown service type throws (closed-set guard)

Tests: 16 passed, 16 total
Time:  <10 s
```

### Post-deploy (mandatory, within 5 minutes)

Once a deploy completes, the on-call SRE must run the smoke against
the deployed environment. The `.github/workflows/smoke-on-deploy.yml`
workflow does this automatically when wired up — see §"CI integration"
in the deployment runbook for what the orchestrator will turn on.

For a manual run against production, point the suite at the prod URL
via env vars. Note that the suite runs the routes in-process using
mocked DBs — for **black-box** smoke against a real prod host, use the
companion shell script that hits the live endpoints:

```bash
scripts/test/e2e-smoke-test.js --target https://gacp.dtam.go.th
```

The Jest suite is the **first-line gate**. The shell script is the
**post-deploy verifier**. They overlap by design: defence in depth.

### Acceptance criteria

A smoke run is acceptable when **ALL** of the following hold:

- [ ] Jest exits 0 (every case green).
- [ ] Total wall-clock time < 10 seconds.
- [ ] **Zero** warning logs printed to stderr.
- [ ] No DB / Redis / external service connections logged
      (proves the suite stayed hermetic).
- [ ] The post-deploy shell script (`e2e-smoke-test.js`) exits 0 within
      5 minutes of deploy completion.

If any item fails, **do not proceed with the rollout**. Roll back to the
previous image tag and file a ticket with the failure output.

---

## What runs inside

The smoke suite uses Jest's mock infrastructure for hermeticity:

- `services/prisma-database` → stubbed `findUnique` + `healthCheck`
- `services/audit-trail`     → no-op functions
- `services/certificate-service` → in-memory record swap
- `middleware/rate-limiter`  → pass-through

The routes themselves (`routes/api/auth/public.js`) are real — the suite
exercises the actual request-handler code, only the data access layer
is mocked. This is the right level for a smoke test:

- Too low (pure unit tests) → wouldn't catch route-wiring mistakes.
- Too high (full-stack with real DB) → too slow for a sub-10s gate, and
  flaky in CI.

---

## Failure playbook

| Symptom | Likely cause | First action |
|---------|--------------|--------------|
| Case 1 fails (health 200 not returned) | `routes/api/index.js` health handler regressed | `git log --oneline -- apps/backend/routes/api/index.js` |
| Case 2 fails (ready returns 200 without auth) | Auth-gating broke — security regression | Stop deploy, file a P0 ticket. |
| Case 3 fails (verify returns 500) | `certificate-service.findByCertificateNumber` or its router broke | Check the route file + service file for last commit; see `apps/backend/routes/api/auth/public.js`. |
| Case 4 fails (login shape changed) | Auth endpoint contract drift | Confirm intended; if breaking change, the change-owner must update the smoke. |
| Case 5 fails (fee math off) | `config/business-rules.js` or `modules/billing` changed | Check who changed it; canonical fees must match the docs (see fees table in `config/business-rules.js`). |
| Suite > 10s | Slowdown in test infrastructure | Run with `--verbose` to find the slow case; if a real route file got slow, profile it. |

---

## Maintenance

This suite must stay **exactly** at 5 cases — anything bigger becomes a
regression suite. When adding a new tripwire, retire an old one. The
hard cap forces every PR author to ask: "is what I'm adding the most
important canary, or am I just padding coverage?"

The owner of this runbook (QA) approves any change to the case list.

---

## References

- Test file: `apps/backend/__tests__/integration/production-smoke.test.js`
- Companion shell smoke: `scripts/test/e2e-smoke-test.js`
- Load test runbook: `docs/qa/load-test-runbook-2026-05-16.md`
- CI workflow (planned): `.github/workflows/smoke-on-deploy.yml`
- Cutover checklist: `docs/cutover-checklist-2026-05-16.md`
