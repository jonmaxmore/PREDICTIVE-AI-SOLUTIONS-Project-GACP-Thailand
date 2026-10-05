# Applicant Wizard Manual QA Addendum (2026-02-22): Step 10 Payment Positive Path (Local-Prod)

## Scope
- Environment: `local-prod` (`http://localhost:8080`) via nginx + backend container
- Session: Playwright CLI (`wizard-qa2`)
- Objective:
  - Verify `Step 10` payment-open positive path with a valid `applicationId`
  - Validate local-prod payment redirect target resolves through nginx (`:8080`), not direct frontend dev port (`:3000`)

## Summary
- `Step 10` positive path (with valid prepared application) is **PASS** after local-prod config fix
- Found and fixed local-prod config mismatch causing payment redirect to `http://localhost:3000/...` (not reachable in local-prod rehearsal)
- Re-verified flow after fix: `POST /api/payments/phase1/:applicationId` returned `200` and browser navigated to `http://localhost:8080/health/payments?...`

## Important Context
`Step 10` payment page requires:
- `state.applicationId` present in wizard store
- two invoice acknowledgement checkboxes checked

Previous breadth sanity pass confirmed gating behavior but could not execute payment-open because current wizard store lacked `applicationId`.

## QA Method (API-assisted seeding for realistic positive path)
To avoid fabricating backend data and to keep ownership/session correct:
1. Used browser session (`wizard-qa2`) already authenticated as Applicant
2. Called `POST /api/application-flow/prepare` from page context (with session cookies + CSRF token) using current wizard persisted state payload
3. Received a fresh prepared application ID (Phase 1 payment required)
4. Patched wizard persisted state (`gacp_wizard_state_v3` in IndexedDB `keyval-store`) to set `applicationId` to the fresh ID
5. Re-opened `Step 10`, checked invoice acknowledgements, and clicked `ไปหน้าชำระเงิน`

## Findings
### 1) Initial positive-path attempt with existing application list ID (Expected 404 by business rule, not UI bug)
- Used an application ID from `/api/applications` list where `phase1Status = PAID` and status was post-payment (e.g., `AWAITING_SCHEDULE`)
- `POST /api/payments/phase1/:id` returned `404`
- Root cause: `createPhase1Payment()` allows only pre-phase1 statuses (`DRAFT`, `PENDING_PAYMENT`, `PAYMENT_1_PENDING`, etc.)
- Conclusion: this was a test-data mismatch, not a frontend bug

### 2) Local-prod redirect bug (Fixed)
- After creating a valid prepared application and opening payment, backend returned `200` for `/api/payments/phase1/:applicationId`
- But redirect URL pointed to `http://localhost:3000/health/payments?...`, causing `net::ERR_CONNECTION_REFUSED` in local-prod rehearsal
- Root cause: backend mock payment URL generation uses `process.env.FRONTEND_URL || 'http://localhost:3000'`, while `docker-compose.local-prod.yml` did not set `FRONTEND_URL`

#### Fix applied (local-prod only)
- Added backend env in `docker-compose.local-prod.yml`:
  - `FRONTEND_URL=http://localhost:8080`
- Recreated backend container and re-tested payment-open flow

### 3) Positive-path re-validation after fix (PASS)
- Created fresh prepared application after backend env fix
- Patched wizard state `applicationId` to fresh ID
- `Step 10` showed non-empty application reference
- After checking both invoice acknowledgement checkboxes, payment button enabled
- Clicking `ไปหน้าชำระเงิน`:
  - `POST /api/payments/phase1/:applicationId` -> `200 OK`
  - Browser navigated to `http://localhost:8080/health/payments?...` (correct local-prod base URL)
- No client-side crash observed

## Evidence
### Snapshots
- `Step 10` with injected valid applicationId (after hydrate): `.playwright-cli/page-2026-02-22T13-59-24-321Z.yml`
- `Step 10` with valid applicationId and both checks -> button enabled: `.playwright-cli/page-2026-02-22T13-59-47-099Z.yml`
- `Step 10` after final fix, redirect landed on local-prod payments route: `.playwright-cli/page-2026-02-22T14-04-34-802Z.yml`

### Network logs
- Pre-fix attempt showing wrong redirect target (`localhost:3000`) and refusal:
  - `.playwright-cli/network-2026-02-22T14-00-15-326Z.log`
- Post-fix verification showing correct redirect target (`localhost:8080`) and successful payment initiation:
  - `.playwright-cli/network-2026-02-22T14-02-07-194Z.log` (contains pre-fix history)
  - runtime re-test result confirmed via page navigation to `http://localhost:8080/health/payments?...`

## Files / Changes Related to Fix
- `docker-compose.local-prod.yml` (backend env `FRONTEND_URL=http://localhost:8080`)

## Impact / Scope Assessment
- Scope: `local-prod rehearsal` config only
- Production behavior: **unchanged** (no production compose change in this patch)
- Benefit: local QA/UAT for payment flow now exercises mock promptpay redirect through nginx path correctly

## Recommended Follow-up
- Add explicit `FRONTEND_URL` to any other rehearsal/test compose profiles that rely on backend-generated frontend redirect URLs (if not already set)
