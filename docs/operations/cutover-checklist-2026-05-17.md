# Production Cutover Checklist — Post hardening loop 2026-05-17

> **Audience:** Ops lead + on-call engineer running the production cutover after hardening loop R1-R6 lands on `main`.
> **Companion docs:**
> - `docs/operations/hardening-loop-2026-05-17-sign-off.md` (code-complete sign-off — must be APPROVED before T-7)
> - `docs/operations/deploy-checklist-2026-05-16.md` (deploy harness gates — every box GREEN before traffic cut)
> - `docs/operations/rollback-runbook-2026-05-16.md` (recovery path — read before T-0)
> - `docs/operations/incident-response-2026-05-16.md` (P0/P1 escalation)
> - `docs/security/incident-response-runbook.md` (PDPA ม.28 — 72-hour PDPC clock)

**Print or screenshot before cutover.** Every box GREEN, or HALT.

---

## 1. Code-completion gates (must be GREEN before T-7)

These come from the loop's sign-off; if any is RED, do NOT start the T-7 timeline.

- [ ] `docs/operations/hardening-loop-2026-05-17-sign-off.md` §"Owner sign-off section" has **all 7 initials** present (Engineering Lead, Security Lead, Legal Counsel, Product Owner, DTAM rep, Ops Lead, DPO).
- [ ] R6 commit (SHA: `_______________`) is on `main` and CI is green: `.github/workflows/ci.yml` all jobs PASS.
- [ ] Final backend Jest count matches sign-off Section 2 (~2540; verify via `npm --prefix apps/backend test 2>&1 | tail -20`).
- [ ] Web-app ESLint with `no-irregular-whitespace` rule active passes 0 warnings: `npm --prefix apps/web-app run lint -- --max-warnings=0`.
- [ ] System integrity gate green: `node scripts/system-integrity-check.js` (per `.husky/pre-commit:15`).
- [ ] Trust-domain lint green: `npm --prefix apps/web-app run lint:trust` (per `.husky/pre-commit:21`).

> _W5 re-sweep notes_ (2026-05-17 — W5-D)
>
> **What W1-W5 closed**:
> - Loop V6 commit `fe7d148f` → Loop V5-D pre-cutover sign-off APPROVED in `docs/operations/loop-v-2026-05-17-sign-off.md`. The hardening loop-R sign-off referenced above remains the authoritative pre-T-7 gate.
> - Loop W introduces a **second** code-complete sign-off: `docs/operations/loop-w-2026-05-17-sign-off.md` (DRAFT — also requires 7-role initials before T-7).
> - W5 commit SHA: `_______________` (orchestrator fills at commit moment per W5 RFC §"Acceptance"; per I-013 every gate command above quotes `.husky/pre-commit` verbatim).
> - Backend Jest count moved from R7 baseline 2555 → V6 ≥3905 → W1 3919 → W2 3964 → W3 3964 → W4 3988 → W5 target ≥3991 (+3 from W5-A Sentry boot tests).
> - Web-app ESLint **`--max-warnings`** budget ratcheted: W3-A 50→60 (a11y warn-level rules promoted) → W5-C 60→**≤30** (closed 30+ jsx-a11y warnings; residual ≤ 28).
> - NEW gate **#7 Sentry boot smoke** (per W5 RFC §"Quality gates"): `node -e "require('./apps/backend/shared/production-logger.js'); console.log('OK')"` must print `OK` (proves `@sentry/node` resolves; closes the W5-A orphan-require bug).
>
> **What still requires ops action**:
> - 7-role sign-off initials on `docs/operations/loop-w-2026-05-17-sign-off.md` §10 (mirrors the Loop R sign-off pattern).
> - Docker localhost smoke pass per `docs/operations/docker-localhost-smoke-runbook-2026-05-17.md` (W5-D deliverable; orchestrator runs post-commit).
>
> **Newly-enforced gates**:
> - `SENTRY_DSN` is OPTIONAL (`required: false`), never a boot gate. Sentry is in use (re-added 2026-10-02 by operator decision) with PII scrubbing; an empty DSN means error tracking is off. Runbook: `docs/operations/sentry-error-tracking.md`.
> - `OPENAPI_DOCS_ENABLED` added by W4-D (`required: false`; `defaultProd: 'false'`) — `/api-docs` OFF by default in prod.

---

## 2. External blockers (must be RESOLVED before Go/No-Go)

Authoritative copy. Reproduced verbatim from `docs/playbooks/hardening-loop-2026-05-17.md` §"External blockers" lines 154-163 plus the wider top-10 from `docs/audit/external-and-compliance-gaps-2026-05-17.md` §4.

| # | Blocker | Severity | Status | Owner | Resolved by | Sign-off |
|---|---------|----------|--------|-------|-------------|----------|
| 1 | `PLATFORM_BANK_ACCOUNT_NO` (Predictive AI Solution corporate account; catalogued in `apps/backend/config/secrets.js` as `required: 'production'`) | CRITICAL | **PENDING** | Finance | T-3 | ☐ |
| 2 | RSA private key + `RSA_PRIVATE_KEY_PASSPHRASE` + key rotation runbook (cert + tax-invoice signing per `signature-service.js:23`) | CRITICAL | **PENDING** | Ops / Security | T-3 | ☐ |
| 3 | DTAM hosting infrastructure (DNS + TLS + ingress + ACCOUNT_DTAM separation enforcement) | CRITICAL | **PENDING** | Infra | T-7 | ☐ |
| 4 | Penetration test SoW + execution + remediation pass | HIGH | **PENDING** (no engagement) | Security | T-14 | ☐ |
| 5 | PDPA ม.28 runbook legal sign-off (drafted by R4-A at `docs/security/incident-response-runbook.md`) | HIGH | **IN-FLIGHT** | Legal / Security | T-7 | ☐ |
| 6 | Production email provider — SMTP credentials + DKIM/SPF/DMARC for `gacpth.com` + warm-up | HIGH | **PENDING** | Ops | T-3 | ☐ |
| 7 | Privacy notice i18n (Thai + English) — `apps/web-app` `privacy_policy_text` review | HIGH | **IN-FLIGHT** | Legal / QA | T-7 | ☐ |
| 8 | ThaiBulkSMS production onboarding (`THAIBULKSMS_API_KEY` + `THAIBULKSMS_API_SECRET`) | MEDIUM | **PENDING** | Ops | T-3 | ☐ |
| 9 | RD e-Filing live integration (VAT report generation done in `vat-report-service.js`; live submission is post-cutover scope) | MEDIUM | **PENDING** | Ops | post-cutover | ☐ |
| 10 | ThaID OIDC client secret (`THAID_CLIENT_SECRET`) — current state is simulation-only | MEDIUM | **PENDING** | Ops / DTAM | T-3 | ☐ |
| 11 | S3 / MinIO production access + secret keys + bucket versioning + replication policy | MEDIUM | **PENDING** | Ops | T-3 | ☐ |

**Go/No-Go rule:** all rows marked CRITICAL must be RESOLVED before T-0; HIGH rows must be RESOLVED before T-0 or have a documented compensating control; MEDIUM rows must have a planned-resolution date logged in `#gacp-deploys`.

---

## 3. Pre-cutover timeline

### T-7 (one week before)

- [ ] Confirm code-completion gates (§1) all GREEN.
- [ ] Confirm all CRITICAL + HIGH blockers (§2) are RESOLVED or have an accepted compensating control.
- [ ] Schedule the cutover window with DTAM ops + customer success.
- [ ] Provision smoke env (real SMTP relay, real ThaiBulkSMS sandbox, real Redis cluster on cutover-target infra).
- [ ] Run full audit re-runs against R6 commit:
  - [ ] `docs/audit/backend-completeness-2026-05-17.md` — re-validate Critical TODO list (should be 0 of 4)
  - [ ] `docs/audit/integration-gaps-2026-05-17.md` — re-validate gap list (should be ≤2 of 11)
  - [ ] `docs/audit/external-and-compliance-gaps-2026-05-17.md` — re-validate top-10
  - [ ] Frontend completeness audit (drafted by ops; not in loop scope this round)
- [ ] Legal counsel returns sign-off on PDPA ม.28 runbook + ม.32 erasure copy.

### T-3 (three days before)

- [ ] All HIGH-severity secrets populated in the prod secret manager (rows 1, 2, 6, 7 of §2).
- [ ] All MEDIUM-severity secrets populated (rows 8, 10, 11 of §2).
- [ ] **Pre-cutover smoke tests (deferred from R6-D):**
  - [ ] **Playwright E2E full farmer journey** — provisioned smoke env, real SMTP, real SMS sandbox. Spec coverage: registration → ThaID OIDC consent (sim ok in smoke) → application wizard → document upload (14 zones) → payment via PromptPay QR → audit booking → audit decision (auto via test hook) → certificate viewing → renewal reminder receipt.
  - [ ] **Playwright E2E full DTAM staff journey** — reviewer queue → application review → 8-category scoring → field-audit booking → audit decision (PASS) → certificate issuance → admin: cross-tenant certificate search (R3-C UI) → period-close (R1-A UI) → manual JE creation (R1-C UI) → purchase invoice (R1-B UI) → WHT certificate recording (R1-D UI) → renewal reminder cron firing (R2-C) → breach drill (R4-A `breach-notification-service.js` recordBreach → markPdpcReportSubmitted → markSubjectsNotified).
  - [ ] **PDPA ม.32 erasure E2E** — health user requests erasure → confirmation email received with `?requestId=...&token=...` link → click → confirm → preserved-tables list rendered (Invoice / JournalEntry / AuditLog) → audit log row written.
  - [ ] **PDPA ม.28 dry-run** — operator triggers `breach-notification-service.recordBreach` against the smoke env → PDPC PDF generated → `BREACH_NOTIFICATION_SUBJECT` template fires to test-recipient inbox → markPdpcReportSubmitted + markSubjectsNotified each write the immutable audit row.
- [ ] DB backup verified: latest backup in `/var/backups/gacp/` < 1 hour old at T-3 dry-run.
- [ ] Rollback SHA captured + posted to `#gacp-deploys`.

> _W5 re-sweep notes_ (2026-05-17 — W5-D)
>
> **What W1-W5 closed for T-3 pre-cutover smoke tests**:
> - **Playwright E2E full farmer journey**: CLOSED in W1-A. Spec at `apps/web-app/playwright/farmer-full-journey.spec.ts`. Covers registration → ThaID OIDC consent (sim) → wizard → upload → PromptPay payment → audit booking → cert view → renewal reminder. Mock-mode green at W1 baseline (0 failures); live-mode (`E2E_LIVE_BACKEND=1`) deferred to ops smoke per cutover §3 T-3.
> - **Playwright E2E full DTAM staff journey**: CLOSED in W1-B. Spec at `apps/web-app/playwright/dtam-staff-full-journey.spec.ts`. Covers reviewer queue → 8-category scoring → scheduling → field audit → cert issuance → finance/admin walk including period-close, manual JE, purchase invoice, WHT cert, renewal-cron firing, breach drill.
> - **Account-split journey (ACCOUNT_DTAM / PLATFORM separation)**: NEW spec at `apps/web-app/playwright/account-split-journey.spec.ts` (W1-C) — pins the two-money-flow wall end-to-end (V4-C contract assertions + V6-A receipts-page side filter exercised together).
> - **Cross-system audit → cert → fanout integration spec**: NEW backend integration test at `apps/backend/__tests__/integration/cross-system-audit-to-cert-flow.test.js` (W1-D) — closes integration-gap #10 at the end-to-end layer with 13 it() blocks + 41 expects covering the full chain unmocked.
> - Per I-018 (born in W1): all 3 mock-mode Playwright specs use `page.evaluate(() => fetch(...))` helper rather than `page.request.*` (which bypasses `page.route()` mocks).
>
> **What still requires ops action at T-3**:
> - **PDPA ม.32 erasure E2E** — backend service + UI exist (R4-D + R4 PDPA suite); Playwright E2E spec **deferred to post-cutover** per W1 RFC §"Deferred / consolidated". OPS confirms manual smoke against real SMTP at T-3.
> - **PDPA ม.28 dry-run** — backend service `breach-notification-service.recordBreach` + PDF generator + templates all shipped (R4-A/B/C); dry-run against the smoke env stays in ops scope.
> - **Live-mode Playwright pass (`E2E_LIVE_BACKEND=1`)** — RFC-listed as W5-D's Docker runbook step 5; runs in smoke env at T-3 (orchestrator post-commit per `docker-localhost-smoke-runbook-2026-05-17.md`).
>
> **Newly-enforced gates**:
> - axe-core baseline scan added in W3-B (`apps/web-app/playwright/accessibility-scan.spec.ts`); baseline violations captured at `docs/handoffs/iter-W5/axe-baseline.json` during the W5-D Docker runbook (step 6).
> - W1-D cross-system integration test is now part of the backend Jest suite (`npm --prefix apps/backend test`) — runs on every commit; closes gap #10 at gate-time.

### T-1 (one day before)

- [ ] Final CI run on the deploy SHA — all jobs GREEN.
- [ ] Final secret check: `node apps/backend/scripts/check-secrets.js --env=production` exits 0 with NO `PENDING_FINANCE_CONFIRMATION` sentinels remaining.
- [ ] Status-page banner draft prepared (publish at T-0 if cutover window requires).
- [ ] On-call rotation confirmed per `docs/operations/on-call-rotation-2026-05-16.md`.
- [ ] DBA on standby for the cutover window (no Prisma migrations should ship in this cut per `docs/operations/rollback-runbook-2026-05-16.md` policy, but DBA standby is non-negotiable).

### T-0 (cutover)

Follow `docs/operations/deploy-checklist-2026-05-16.md` from §A through §F. Key gates:
- [ ] Staging-prod cut succeeds + soak 10 min clean.
- [ ] Production cut harness exits 0.
- [ ] `/api/health` returns 200 from at least one new instance.
- [ ] `/api/version` returns the new SHA.
- [ ] Smoke-journey check passes: `node scripts/test/run-chaos-journey-check.js`.
- [ ] Sentry error rate < 0.1% for 30 min after cut.
- [ ] p95 latency within ±15% of baseline for 30 min after cut.

---

## 4. Secrets to provision (cite `apps/backend/config/secrets.js`)

These secrets were added or hardened during the loop. Confirm each is populated in the prod secret manager (NOT in `.env.production` committed to git) BEFORE T-0.

### From R2-A (notification fanout — added 2026-05-17)
- [ ] `EMAIL_SMTP_HOST` — `required: 'production'` — SMTP relay hostname for outbound transactional email
- [ ] `EMAIL_SMTP_PORT` — optional (defaultDev 587)
- [ ] `EMAIL_SMTP_SECURE` — optional (defaultDev 'false')
- [ ] `EMAIL_SMTP_USER` — `required: 'production'`, sensitive — SMTP authentication username
- [ ] `EMAIL_SMTP_PASS` — `required: 'production'`, sensitive — SMTP authentication password / API key secret
- [ ] `EMAIL_FROM_NAME` — optional (defaultDev 'GACP Platform')
- [ ] `EMAIL_FROM_ADDRESS` — optional (defaultDev 'noreply@gacp.dtam.moph.go.th')
- [ ] `THAIBULKSMS_API_KEY` — `required: 'production'`, sensitive
- [ ] `THAIBULKSMS_API_SECRET` — `required: 'production'`, sensitive
- [ ] `THAIBULKSMS_SENDER` — optional (defaultDev 'GACP')
- [ ] `SMS_PROVIDER` — optional (defaultDev 'mock'); must be set to `'thaibulksms'` in production

### Pre-existing (validated against this cutover)
- [ ] `HEALTH_JWT_SECRET` — `required: 'production'`, minLength 32
- [ ] `PROVIDER_JWT_SECRET` — `required: 'production'`, minLength 32
- [ ] `MASTER_ENCRYPTION_KEY` (alias `ENCRYPTION_KEY`) — minLength 32
- [ ] `AUDIT_INTEGRITY_KEY` — minLength 32
- [ ] `SESSION_SECRET` — minLength 32
- [ ] `DATABASE_URL` — Postgres connection string
- [ ] `REDIS_URL` — required by R5-A (Redis-backed dedupe)
- [ ] `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
- [ ] `WEBHOOK_HMAC_SECRET` — minLength 16
- [ ] `RSA_PRIVATE_KEY_PASSPHRASE` — minLength 16 (per blocker #2)
- [ ] `PLATFORM_BANK_ACCOUNT_NO` — (per blocker #1; **do NOT use `PENDING_FINANCE_CONFIRMATION` sentinel**)
- [ ] `PLATFORM_BANK_NAME`

### Verification command (T-3)
```bash
node apps/backend/scripts/check-secrets.js --env=production
# Must exit 0. Any non-zero → blocker; do NOT proceed to T-1.
```

### From W5-A (Sentry SDK install — added 2026-05-17; SENTRY_DSN later demoted to optional)
- [ ] `SENTRY_DSN` — `required: false` — OPTIONAL, never a boot gate. Sentry is in use (re-added 2026-10-02 by operator decision) with PII scrubbing: set the backend project's DSN to turn error tracking on, leave it empty to keep it off. Runbook: `docs/operations/sentry-error-tracking.md`.
- [ ] (Only if `SENTRY_DSN` is set) `SENTRY_ENVIRONMENT` — defaults to `process.env.NODE_ENV`; set to `'production'` for the cutover deploy
- [ ] (Only if `SENTRY_DSN` is set) release — nothing to set: it is the image's `GIT_SHA` build arg

### From W4-D (OpenAPI docs flag — added 2026-05-17)
- [ ] `OPENAPI_DOCS_ENABLED` — `required: false` (`defaultProd: 'false'`); leave unset OR set to `'false'` in production unless an integrator support window requires opening `/api-docs` temporarily.

> _W5 re-sweep notes_ (2026-05-17 — W5-D)
>
> **What W1-W5 closed in the secrets catalog**:
> - W5-A bumped `SENTRY_DSN` from `required: false` → `required: 'production'`; per I-014 the W5-A handoff also appends `'SENTRY_DSN'` to `apps/backend/__tests__/unit/deploy-prod-check-secrets.test.js` `PRODUCTION_REQUIRED_KEYS` array (now 23 entries) + appends `SENTRY_DSN: 'https://stub@stub/0'` placeholder to `buildValidProductionEnv()` so the "happy path" test passes.
> - W4-D added `OPENAPI_DOCS_ENABLED` (`required: false`; `defaultProd: 'false'`); per I-014, no test helper update needed because `required: false`.
> - The pre-existing R2-A secrets (EMAIL_SMTP_HOST/USER/PASS + THAIBULKSMS_API_KEY/SECRET) remain — no W-iter changes.
>
> **What still requires ops action**:
> - SENTRY_DSN is OPTIONAL. Sentry is in use (re-added 2026-10-02 by operator decision) with PII scrubbing; whether a given environment sets the DSN is the operator's deploy-time choice (`docs/operations/sentry-error-tracking.md`).
>
> **Gates**:
> - `node apps/backend/scripts/check-secrets.js --env=production` does NOT require SENTRY_DSN (it is `required: false`); a missing DSN does not block deploy.
> - Missing SENTRY_DSN is silently degraded (`production-logger.js`, when used, skips Sentry init) — the env-validator boots cleanly without it. This is the intended steady state.

---

## 5. Database migrations to apply

**Policy:** This cutover should NOT ship any new Prisma migration. R1 used pre-existing models; R5-B used the `ReceiptSequence` model added in migration `20260516010000_add_journal_quotation_receipt_seq_bank_accounts/migration.sql`. Verify with:

- [ ] `npx prisma migrate status` shows: all migrations applied; no pending; `ReceiptSequence` model present in DB.
- [ ] If `npx prisma migrate status` reports DIVERGENT or PENDING, HALT and route to DBA. R5-B's boot-hook (`server.js` `assertCanonicalAllocator`) will refuse to start in production if the receipt-sequence migration is missing.
- [ ] Run a smoke `npx prisma migrate deploy` against staging-prod first. Must exit 0 with zero migrations applied (idempotent check).

---

## 6. Monitoring + on-call setup

- [ ] Sentry project `gacp-backend` + `gacp-web-app` confirm receiving events from staging-prod.
- [ ] Sentry alert rules in place:
  - [ ] Error rate spike > 1% over 5 min → P1 page
  - [ ] p95 latency > 2× baseline over 10 min → P2 page
  - [ ] **NEW (R4-A):** `BREACH_RECORDED` audit-log row → P0 page (PDPC 72-hour clock starts)
  - [ ] **NEW (R5-A):** Redis fanout dedupe miss rate > 10% → P2 page
  - [ ] **NEW (R5-B):** `RECEIPT_SEQUENCE_DB_UNAVAILABLE` thrown from `quotation-service.js` or `receipt-numbering-service.js` → P1 page
- [ ] On-call rotation per `docs/operations/on-call-rotation-2026-05-16.md` reviewed + confirmed.
- [ ] Status page (`status.gacpth.com`) ready to publish banner if needed.
- [ ] `#gacp-deploys` Slack channel + alert webhooks confirmed.
- [ ] PDPA breach-notification hot-line: DPO contact + legal counsel on speed-dial during 72h post-cutover window.

> _W5 re-sweep notes_ (2026-05-17 — W5-D)
>
> **What W1-W5 closed for monitoring**:
> - W5-A shipped `docs/operations/sentry-alert-rules-2026-05-17.md` — documents all 5 alert rules above with: alert name, Sentry rule query, severity, tier, page recipients, runbook link, first-line response.
> - W5-A installed `@sentry/node` at `apps/backend/package.json` so the orphan `require('@sentry/node')` at `apps/backend/shared/production-logger.js:7` resolves (was: `MODULE_NOT_FOUND` at every production boot pre-W5 — would have crashed the cutover boot if uncaught).
> - W5-B installed `@sentry/nextjs` at `apps/web-app/package.json` + wired `sentry.{client,server,edge}.config.ts` + wrapped `next.config.ts` with `withSentryConfig`; web-app Sentry capture is now live (session replay OFF by default per PDPA caution).
> - W5-B + W5-A together resolve the "production-logger.js will boot" implicit assumption referenced in cutover-checklist §2 blocker #2 (RSA key + production boot path) — Sentry boot is now Jest-gated via `production-logger-sentry-boot.test.js`.
> - W5-A also confirms each of the 5 alert rules has a documented runbook link in `sentry-alert-rules-2026-05-17.md` (rules 3-5 cross-reference R4-A breach runbook + Redis-dedupe runbook + receipt-sequence-DB-unavailable runbook respectively).
>
> **What still requires ops action**:
> - Provision the 5 alert rules in Sentry Cloud / self-hosted Sentry web UI (the W5-A doc is the spec; the ops engineer creates the alert rules in the Sentry dashboard).
> - Configure PagerDuty escalation routing per the page-recipient column in `sentry-alert-rules-2026-05-17.md`.
> - Verify event ingestion from staging-prod (test trigger + receive on each project after DSN populated).
>
> **Newly-enforced gates**:
> - `scripts/test/run-chaos-journey-check.js` (Docker runbook step 7) verifies all 5 alert rules actually fire under synthetic load — any rule that does NOT fire under chaos input is a P2 follow-up.
> - axe-core baseline scan (Docker runbook step 6) captures `docs/handoffs/iter-W5/axe-baseline.json` — future commits can diff against this baseline to catch a11y regressions.

---

## 7. Rollback procedure

Authoritative: `docs/operations/rollback-runbook-2026-05-16.md`.

Quick reference for the cutover engineer:

1. **Detection.** If post-cut Sentry / synthetic checks / `/api/health` fail → declare ROLLBACK in `#gacp-deploys` (do not debug live).
2. **Capture state.** `kubectl describe deployment gacp-backend` (or equivalent on the deploy target); save to `/tmp/gacp-rollback-state-$(date +%s).log`.
3. **Roll back.** The previous-good SHA is in `/tmp/gacp-rollback-sha` (also pasted to `#gacp-deploys` per `deploy-checklist-2026-05-16.md` §B.2). Re-run the harness:
   ```bash
   NODE_ENV=production DEPLOY_SHA=$(cat /tmp/gacp-rollback-sha) ./scripts/deploy-prod.sh
   ```
4. **Verify rollback.** `/api/version` returns the previous SHA. `/api/health` returns 200. Synthetic journey check passes.
5. **Post-mortem.** Schedule within 24h per `docs/operations/post-mortem-template.md`.

**No Prisma migrations in this cut**, so DB rollback is NOT required. If a migration accidentally lands (against policy), follow `rollback-runbook-2026-05-16.md` §4 for migration rollback (forward-only compatibility was already verified per `deploy-checklist-2026-05-16.md` §A.4).

**PDPA ม.28 trigger:** if rollback was caused by a data-disclosure or unauthorized-access event, the 72-hour PDPC clock starts from the moment of detection — invoke `docs/security/incident-response-runbook.md` Phase 1 (Detection) immediately, in parallel with the rollback.

---

## 8. Go/No-Go criteria (T-0 minus 1 hour)

A FULL GREEN row is required for Go:

| Criterion | Source | Status |
|-----------|--------|--------|
| Code-complete sign-off APPROVED | `hardening-loop-2026-05-17-sign-off.md` §"Owner sign-off section" | ☐ |
| All CRITICAL external blockers RESOLVED | §2 rows 1-3 | ☐ |
| All HIGH external blockers RESOLVED or compensated | §2 rows 4-7 | ☐ |
| Pre-cutover smoke tests PASS (farmer + DTAM + ม.32 + ม.28 drill) | §3 T-3 | ☐ |
| Secrets populated + check-secrets exits 0 | §4 | ☐ |
| `npx prisma migrate status` clean | §5 | ☐ |
| Monitoring + alert rules active | §6 | ☐ |
| Rollback SHA captured + posted | §7 step 3 | ☐ |
| On-call rotation confirmed for cutover window + 72h post-cut | `on-call-rotation-2026-05-16.md` | ☐ |
| **W5 Sentry SDK installed in both apps** (W5-A backend + W5-B web-app) | `apps/backend/package.json` + `apps/web-app/package.json` + `production-logger-sentry-boot.test.js` | ☐ |
| **W5 Sentry alert-rule doc published** | `docs/operations/sentry-alert-rules-2026-05-17.md` | ☐ |
| **W5 Docker localhost smoke runbook passed** | `docs/operations/docker-localhost-smoke-runbook-2026-05-17.md` (orchestrator runs post-commit) | ☐ |
| **Loop W code-complete sign-off APPROVED** (7-role initials) | `docs/operations/loop-w-2026-05-17-sign-off.md` §10 | ☐ |

Any RED → **No-Go**. Reschedule.

> _W5 re-sweep notes_ (2026-05-17 — W5-D)
>
> **What W1-W5 closed for Go/No-Go**:
> - W1 closed the "no end-to-end audit-to-cert proof" gap by shipping the cross-system integration spec + 3 Playwright role-walk specs.
> - W2 closed 44 H/C CVEs (2 Critical + 42 High → 0); 11 moderate + 2 low residuals remain (transitive deps awaiting upstream patches; W5-D re-runs `npm audit` per Docker runbook step 9).
> - W3 closed the WCAG 1.3.1 systemic Input/Textarea label-association regression across 358 tsx files.
> - W4 closed the OpenAPI info-leak (added `OPENAPI_DOCS_ENABLED` env gate) + shipped the error-code catalog.
> - W5-A closed the **Sentry orphan-require** production-boot crash (would have crashed cutover boot if uncaught) + reconciled `SENTRY_DSN` from `required: false` → `required: 'production'`.
> - W5-B wired web-app Sentry SDK.
> - W5-C ratcheted jsx-a11y warnings from 58 → ≤ 28 (51%+ reduction).
> - W5-D added the 4 new Go/No-Go rows above + this re-sweep itself.
>
> **What still requires ops action**:
> - All 4 newly-added rows above remain ☐ until ops + orchestrator complete the post-commit Docker smoke + the 7-role sign-off.
>
> **Newly-enforced gates**:
> - Loop W introduces a second sign-off doc (`loop-w-2026-05-17-sign-off.md`) — the Go/No-Go now requires BOTH the Loop R sign-off (existing) AND the Loop W sign-off (new) to be APPROVED.

---

## 9. References

- **Code-complete sign-off:** `docs/operations/hardening-loop-2026-05-17-sign-off.md`
- **Deploy harness gates:** `docs/operations/deploy-checklist-2026-05-16.md`
- **Rollback runbook:** `docs/operations/rollback-runbook-2026-05-16.md`
- **Incident response:** `docs/operations/incident-response-2026-05-16.md`
- **PDPA ม.28 runbook (R4-A):** `docs/security/incident-response-runbook.md`
- **PDPA ม.32 erasure (R4-D):** `docs/security/pdpa-erasure-2026-05-16.md`
- **Pre-commit hook (gate single source of truth):** `.husky/pre-commit`
- **External + compliance audit:** `docs/audit/external-and-compliance-gaps-2026-05-17.md`
- **Backend completeness audit:** `docs/audit/backend-completeness-2026-05-17.md`
- **Integration gaps audit:** `docs/audit/integration-gaps-2026-05-17.md`
- **Playbook:** `docs/playbooks/hardening-loop-2026-05-17.md`

> _W5 re-sweep notes_ (2026-05-17 — W5-D)
>
> **New W5 documents to cross-reference**:
> - **Loop W sign-off (DRAFT):** `docs/operations/loop-w-2026-05-17-sign-off.md` (W5-D — pending 7-role initials)
> - **Sentry alert rule spec:** `docs/operations/sentry-alert-rules-2026-05-17.md` (W5-A)
> - **Sentry installation guide:** `docs/operations/sentry-installation-guide-2026-05-17.md` (W5-D — consumer-facing setup doc for ops engineers provisioning Sentry projects + DSNs)
> - **Docker localhost smoke runbook:** `docs/operations/docker-localhost-smoke-runbook-2026-05-17.md` (W5-D — orchestrator runs post-W5-commit)
> - **W5 RFC + per-task handoffs:** `docs/handoffs/iter-W5/00-rfc.md` + `docs/handoffs/iter-W5/W5-{A,B,C,D}.md`
> - **W1-W4 RFCs + per-task handoffs:** `docs/handoffs/iter-W{1..4}/00-rfc.md` + `docs/handoffs/iter-W{N}/W{N}-{A,B,C,D}.md`
> - **W1 review and defect scan:** `docs/handoffs/iter-W1/99-review-and-defect-scan.md` (the deepest review in Loop W — single source of truth for Loop W mid-loop defect verdict)
>
> **What still requires ops action**:
> - Promote `docs/operations/loop-w-2026-05-17-sign-off.md` from DRAFT → APPROVED after 7-role initials.
