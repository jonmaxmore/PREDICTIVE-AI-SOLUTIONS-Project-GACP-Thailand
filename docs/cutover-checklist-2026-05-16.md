# Production Cutover Checklist — 2026-05-16

**hardening loop**: Iter 29 (FINAL)
**Owner**: Project Manager
**Status**: ACTIVE
**Cutover Window**: TBD (target T-0 = 2026-05-23, Saturday 22:00–06:00 ICT)

> Source of truth for the production cutover. Each checkbox must be signed-off by the listed owner before progressing to the next phase. No phase begins until all boxes in the previous phase are ticked or formally waived in the risk register.

---

## 1. T-7 days before cutover (2026-05-16)

| # | Task | Owner | Evidence required | Status |
|---|------|-------|-------------------|--------|
| 1.1 | All Iter 23–29 work merged to `main` | Eng Lead | Git log + PR list | [ ] |
| 1.2 | CI green on every check (lint, unit, integration, e2e, security) | DevOps | GitHub Actions URL | [ ] |
| 1.3 | Staging env tested end-to-end (signup → cert) | QA Lead | Test report `qa/staging-e2e-2026-05-16.md` | [ ] |
| 1.4 | Security audit complete — pen test report received | Security Lead | Vendor PDF + remediation log | [ ] |
| 1.5 | PDPA compliance audit signed off | DPO | Compliance memo + DPIA | [ ] |
| 1.6 | Legal review of ToS + Privacy Notice | Legal | Sign-off email | [ ] |
| 1.7 | DTAM bank account confirmed (Krungthai 123-4-56789-0) | Finance | Bank verification letter | [ ] |
| 1.8 | RSA-2048 private key provisioned in secret manager | Security | Vault path + KMS key id | [ ] |
| 1.9 | DNS + SSL cert (wildcard `*.gacp.dtam.go.th`) provisioned | DevOps | Cert fingerprint + DNS records | [ ] |
| 1.10 | Rollback playbook reviewed by ops | DevOps | Runbook URL | [ ] |
| 1.11 | Customer Success knowledge base seeded with FAQ | CS Lead | KB article count ≥ 30 | [ ] |
| 1.12 | Capacity planning sign-off (Q3 forecast = 1,200 apps) | Product | Forecast doc | [ ] |

**Gate criteria**: 100% of T-7 items closed OR documented waiver in `risks/iter29-waivers.md`.

---

## 2. T-1 day (2026-05-22)

| # | Task | Owner | Evidence | Status |
|---|------|-------|----------|--------|
| 2.1 | Final smoke test on staging (full payment cycle, audit cycle, cert issuance) | QA | Pass screenshot + 0 errors | [ ] |
| 2.2 | Database backup taken (logical + binary), restore-tested | DBA | Backup id + restore log | [ ] |
| 2.3 | Rollback plan briefed to ops on-call | DevOps | Briefing notes + attendee list | [ ] |
| 2.4 | On-call schedule confirmed (24/7 for cutover window + 48h) | DevOps | PagerDuty schedule | [ ] |
| 2.5 | Customer Success FAQ updated for go-live | CS Lead | KB version tag | [ ] |
| 2.6 | Status page (status.gacp.dtam.go.th) pre-staged with banner | DevOps | Banner preview screenshot | [ ] |
| 2.7 | Communication sent to internal stakeholders (DTAM execs) | PM | Email log | [ ] |
| 2.8 | Final feature flags reviewed — no debug flags ON | Eng Lead | Flag matrix screenshot | [ ] |
| 2.9 | Maintenance window announced (T-24h notice email + LINE OA) | PM + CS | Distribution list confirmation | [ ] |
| 2.10 | Freeze on non-cutover merges to `main` (only hotfixes) | Eng Lead | Branch protection enabled | [ ] |

---

## 3. T-0 cutover day (2026-05-23)

**Cutover window**: 22:00–06:00 ICT (8 hours)
**Go/No-Go meeting**: 21:00 ICT
**Communication channel**: `#gacp-cutover-warroom`

### 3.1 Pre-flight (21:00–22:00)

- [ ] Go/No-Go decision recorded (PM, Eng Lead, Ops, Security, Product)
- [ ] All on-call confirmed online
- [ ] Status page set to MAINTENANCE
- [ ] Maintenance window announced (LINE OA, email blast, web banner)

### 3.2 Deploy (22:00–01:00)

- [ ] Final database migration (`prisma migrate deploy`) — DBA
- [ ] Migration verification queries pass — DBA
- [ ] Application deploy (blue env) — DevOps
- [ ] Background workers deployed and healthy — DevOps
- [ ] Cron jobs registered — DevOps
- [ ] Smoke test on prod (synthetic transactions on blue env) — QA
- [ ] DNS switch (5-minute TTL, low-risk window) — DevOps
- [ ] DNS propagation confirmed (≥ 5 global checks) — DevOps
- [ ] HTTPS validated — Security
- [ ] CDN cache purged — DevOps

### 3.3 Validation (01:00–04:00)

- [ ] Smoke test on prod (real account, all 5 personas) — QA
- [ ] Payment slip OCR + verify flow tested with sandbox slip — Finance
- [ ] Certificate issuance tested (PDF + RSA signature verified) — Eng Lead
- [ ] Audit field app sync tested from sample device — QA
- [ ] Monitoring dashboards reviewed (Grafana, Sentry, BetterStack) — DevOps
- [ ] Error rate < 0.5%, p95 latency < 800ms — DevOps
- [ ] No PII leakage in logs (sample audit) — DPO

### 3.4 Hand back (04:00–06:00)

- [ ] Status page updated to OPERATIONAL
- [ ] Announcement sent (LINE OA, email, web)
- [ ] Internal Slack #announce notified
- [ ] Cutover ticket closed
- [ ] On-call handoff to T+1 rotation
- [ ] Cutover sign-off form signed (PM, Eng Lead, Ops, Security, Product, DTAM rep)

---

## 4. T+1 to T+7 post-cutover monitoring

| Day | Activity | Owner |
|-----|----------|-------|
| T+1 | 24/7 monitoring first 48h (rotating on-call) | DevOps |
| T+1 | Daily standup with ops + product (09:00 ICT) | PM |
| T+1 | Customer Success monitors inquiries — target FRT ≤ 1h | CS Lead |
| T+2 | Slip OCR accuracy review (sample 50 slips) | Finance |
| T+3 | First payment-to-audit cycle time review | Product |
| T+5 | Capacity headroom check (CPU, DB connections) | DevOps |
| T+7 | First-week metrics review | PM + Product |
| T+7 | Post-launch retrospective scheduled (target T+14) | PM |
| T+7 | All open incidents triaged + classified | DevOps |

**Exit criteria (T+7)**:
- Zero P0 / P1 incidents in last 72h
- Customer Success queue < 50 open tickets
- Error rate < 0.3%
- All retrospective action items captured

---

## 5. Rollback decision matrix

| Symptom | Severity | Action |
|---------|----------|--------|
| Payment slip OCR fails > 50% | P0 | Rollback within 30 min |
| Certificate issuance fails | P0 | Hotfix or rollback within 1h |
| Auth broken for > 10% of users | P0 | Rollback within 30 min |
| Single persona blocked (e.g. AUDITOR app) | P1 | Hotfix, no rollback |
| Cosmetic UI issue | P3 | Schedule for T+7 patch |

Rollback owner: **Eng Lead** + **DevOps** jointly. PM informed within 5 min.

---

## 6. Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| PM | _ | _ | _ |
| Eng Lead | _ | _ | _ |
| DevOps Lead | _ | _ | _ |
| Security Lead | _ | _ | _ |
| Product Lead | _ | _ | _ |
| DTAM Sponsor | _ | _ | _ |
