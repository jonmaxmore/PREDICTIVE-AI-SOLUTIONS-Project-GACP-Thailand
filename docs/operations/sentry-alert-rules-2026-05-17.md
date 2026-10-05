# Sentry Alert Rules — GACP Platform Cutover (2026-05-17)

**Effective**: cutover T-0 (2026-05-17).
**Owner**: SRE Lead.
**Scope**: 5 alert rules covering generic error-rate / latency degradation
plus three GACP-domain-specific paging triggers (PDPA breach, Redis fanout
dedupe degradation, receipt-sequence DB unavailability).
**Source**: `docs/operations/cutover-checklist-2026-05-17.md` §6
"Monitoring + on-call setup".

This document is the post-cutover authoritative list. Every row here MUST
exist as a configured alert rule in the `gacp-backend` Sentry project
before the cutover proceeds (per cutover-checklist §6, go-criteria row
"Monitoring + alert rules active").

Sentry SDKs that emit the events fueling these rules:
- Backend: `@sentry/node@^8.0.0` (Iter W5-A, `apps/backend/shared/production-logger.js`)
- Web-app: `@sentry/nextjs@^8.0.0` (Iter W5-B, `apps/web-app/sentry.{client,server,edge}.config.ts`)

Severity model maps 1:1 to PagerDuty severities documented in
`docs/operations/on-call-rotation-2026-05-16.md` §1:
- **P0** → page Tier 1 + immediate Executive escalation (PDPA-class).
- **P1** → page Tier 1 (24/7 SRE on-call).
- **P2** → page Tier 2 (Backend on-call, Mon-Fri 09-17 ICT).

---

## Rule index

| # | Alert name | Severity | Tier | Source signal |
|---|---|---|---|---|
| 1 | `gacp-error-rate-spike` | P1 | 1 | Sentry `level:error` event count |
| 2 | `gacp-p95-latency-regression` | P2 | 2 | Sentry `transaction.duration` p95 |
| 3 | `gacp-pdpa-breach-recorded` | P0 | 1 | Audit-log row `BREACH_RECORDED` |
| 4 | `gacp-redis-dedupe-miss-rate` | P2 | 2 | Log pattern `REDIS_DEDUPE_MISS` |
| 5 | `gacp-receipt-sequence-db-unavailable` | P1 | 1 | Sentry exception `RECEIPT_SEQUENCE_DB_UNAVAILABLE` |

---

## Rule 1 — `gacp-error-rate-spike`

| Field | Value |
|---|---|
| **Alert name** | `gacp-error-rate-spike` |
| **Sentry rule query** | `event.count > 5 in 5 minutes` filtered to `level:error` (any project: `gacp-backend`, `gacp-web-app`) |
| **Threshold rationale** | Baseline error volume at cutover is < 1 / 5 min in staging-prod smoke. > 5 events / 5 min = 1% error rate at typical 500 req/min traffic. |
| **Severity** | P1 |
| **Tier** | Tier 1 (SRE on-call, 24/7) |
| **Page recipients** | PagerDuty service `gacp-platform-tier1` → on-call primary + secondary at +15 min ack timeout |
| **Runbook link** | `docs/operations/runbooks/high-error-rate.md` — **TBD (post-cutover backlog)**; until written, follow `docs/operations/incident-response-2026-05-16.md` Phase 2 (Triage) |
| **First-line response** | (1) ACK in PagerDuty ≤ 15 min. (2) Open `#inc-<yyyy-mm-dd>-error-spike` Slack channel. (3) Read the top exception in Sentry → identify the route. (4) Check `/api/health` returns 200; if not, declare ROLLBACK per cutover-checklist §7. (5) If single-route, route owner is paged via Slack; if multi-route, escalate Tier 1 secondary + Engineering Manager. |
| **Cross-references** | Cutover §6 row 1; `on-call-rotation-2026-05-16.md` §2 Tier 1 |

---

## Rule 2 — `gacp-p95-latency-regression`

| Field | Value |
|---|---|
| **Alert name** | `gacp-p95-latency-regression` |
| **Sentry rule query** | `p95(transaction.duration) > 4000ms` over a 10-minute window for any backend route (project: `gacp-backend`, transaction-type: `http.server`) |
| **Threshold rationale** | Baseline p95 is ~2s per W4-D OpenAPI doc + V5 staging-prod synthetics. 2× baseline = 4s. Sustained breach > 10 min = real degradation, not a single slow client. |
| **Severity** | P2 |
| **Tier** | Tier 2 (Backend engineer on-call, Mon-Fri 09-17 ICT). Out-of-hours → routes to Tier 1 secondary, who decides whether to wake the Backend on-call. |
| **Page recipients** | PagerDuty service `gacp-platform-tier2` → Backend on-call primary at +1h ack timeout |
| **Runbook link** | `docs/operations/runbooks/p95-latency-regression.md` — **TBD (post-cutover backlog)**; until written, follow `docs/operations/incident-response-2026-05-16.md` Phase 2 + check DB query latency in PG slow-query log |
| **First-line response** | (1) ACK in PagerDuty ≤ 1h. (2) Confirm via Sentry Performance which transaction owns the regression. (3) Check Prometheus + PG slow-query log for the same window. (4) If correlated with a recent deploy, surface to release engineer; if correlated with traffic spike, scale horizontally per `docs/operations/deploy-runbook.md`. |
| **Cross-references** | Cutover §6 row 2; W4-D OpenAPI baseline; `on-call-rotation-2026-05-16.md` §2 Tier 2 |

---

## Rule 3 — `gacp-pdpa-breach-recorded` (R4-A — PDPA Section 28)

| Field | Value |
|---|---|
| **Alert name** | `gacp-pdpa-breach-recorded` |
| **Sentry rule query** | Event with tag `audit_action = 'BREACH_RECORDED'` (emitted by `apps/backend/services/breach-notification-service.js` which writes the audit-log row + emits a Sentry capture-message at severity `fatal`) |
| **Threshold rationale** | One occurrence = page. PDPA Section 28 mandates notification to PDPC within 72 hours of breach awareness; the page starts the clock and forces an immediate DPO + Legal counsel acknowledgement. |
| **Severity** | P0 |
| **Tier** | Tier 1 (SRE on-call, 24/7) + Tier 3 (PM on-call, comms) + DPO + Legal counsel (speed-dial per cutover-checklist §6 line 159) |
| **Page recipients** | PagerDuty service `gacp-platform-tier1` + Slack `#pdpa-breach-72h` + email blast to `dpo@gacp.dtam.moph.go.th` + Legal counsel mobile speed-dial |
| **Runbook link** | `docs/security/incident-response-runbook.md` (R4-A — authoritative PDPA breach playbook) |
| **First-line response** | (1) ACK in PagerDuty ≤ 15 min — the 72h PDPC clock has STARTED. (2) Open `#inc-<yyyy-mm-dd>-pdpa-breach` + invite DPO + Legal counsel within 30 min. (3) Capture scope: affected data subjects, data categories, root cause hypothesis. (4) Phase 1 (Detection) of `incident-response-runbook.md` Section 28 sub-playbook. (5) DPO drafts PDPC notification before T+24h; Legal reviews before T+48h; submit before T+72h. (6) Post-mortem within 5 business days per `post-mortem-template.md`. |
| **Cross-references** | Cutover §6 row 3; R4-A `breach-notification-service.js`; PDPA Section 28; `on-call-rotation-2026-05-16.md` §5 escalation chain |

---

## Rule 4 — `gacp-redis-dedupe-miss-rate` (R5-A — fanout integrity)

| Field | Value |
|---|---|
| **Alert name** | `gacp-redis-dedupe-miss-rate` |
| **Sentry rule query** | Custom metric: `count_if(log.message contains 'REDIS_DEDUPE_MISS') / count_if(log.message contains 'fanout.dispatch') > 0.10` over a rolling 10-minute window. Logs flow via Winston → Logtail → Sentry breadcrumbs (or via direct `Sentry.captureMessage('REDIS_DEDUPE_MISS', 'warning')` from `apps/backend/services/notification-fanout-service.js`). |
| **Threshold rationale** | Redis-backed dedupe key (`fanout:dedupe:<event-id>`) prevents duplicate delivery when multiple worker replicas process the same notification. > 10% miss = Redis degraded or worker count exceeds key TTL window. Sustained miss → user-visible duplicate emails / SMS. |
| **Severity** | P2 |
| **Tier** | Tier 2 (Backend on-call); escalate to Tier 1 if miss-rate > 25% (treat as Redis outage). |
| **Page recipients** | PagerDuty service `gacp-platform-tier2` → Backend on-call primary at +1h ack |
| **Runbook link** | `docs/operations/runbooks/redis-dedupe-degraded.md` — **TBD (post-cutover backlog)**; until written, the first-line response section here is authoritative |
| **First-line response** | (1) ACK in PagerDuty ≤ 1h. (2) Check Redis health: `redis-cli PING`, `INFO replication`. (3) Check fanout worker count + log volume — a sudden worker scale-up can race the dedupe TTL window. (4) If Redis is up but miss rate persists, increase `FANOUT_DEDUPE_TTL_SEC` from default 60 → 300 and re-deploy. (5) If Redis is down, fail over to standby per `docs/operations/runbooks/redis-failover.md` (if present). (6) Post-mortem if user-facing duplicates were sent. |
| **Cross-references** | Cutover §6 row 4; R5-A `notification-fanout-service.js`; W2-B Redis sentinel boot-gate |

---

## Rule 5 — `gacp-receipt-sequence-db-unavailable` (R5-B — receipt allocator)

| Field | Value |
|---|---|
| **Alert name** | `gacp-receipt-sequence-db-unavailable` |
| **Sentry rule query** | Exception with `exception.type = 'Error'` AND `exception.value matches /^RECEIPT_SEQUENCE_DB_UNAVAILABLE/` (thrown from `apps/backend/services/quotation-service.js` or `apps/backend/services/receipt-numbering-service.js` — error code defined in `apps/backend/shared/error-codes.js`) |
| **Threshold rationale** | One occurrence = page. The receipt-sequence allocator is the gating step for issuing a paid quotation receipt; if it cannot allocate, the user cannot complete payment. R5-B's boot-hook `assertCanonicalAllocator` in `server.js` refuses to start production if the `ReceiptSequence` model is missing, so this exception in steady-state means a runtime DB connectivity issue (not migration drift). |
| **Severity** | P1 |
| **Tier** | Tier 1 (SRE on-call, 24/7) |
| **Page recipients** | PagerDuty service `gacp-platform-tier1` → on-call primary at +15 min ack timeout |
| **Runbook link** | `docs/operations/runbooks/receipt-sequence-db-unavailable.md` — **TBD (post-cutover backlog)**; until written, the first-line response section here is authoritative |
| **First-line response** | (1) ACK in PagerDuty ≤ 15 min. (2) Check PG primary `/api/health` → if degraded, fail over to replica per `docs/operations/deploy-runbook.md`. (3) Verify `npx prisma migrate status` is clean — if migrations are pending, follow `docs/operations/rollback-runbook-2026-05-16.md` §4. (4) Pause new-quotation submissions via feature-flag if available; surface user-facing banner via status page (`status.gacpth.com`). (5) Once DB recovers, replay any queued quotations from Bull queue. (6) Post-mortem within 5 business days. |
| **Cross-references** | Cutover §6 row 5; R5-B `receipt-numbering-service.js`; R5-B server-boot `assertCanonicalAllocator`; `shared/error-codes.js` |

---

## Acceptance checklist (pre-cutover gate)

For each row above, the cutover engineer MUST verify:

- [ ] Rule exists in Sentry project `gacp-backend` (or `gacp-web-app` for rule 1 if web-side errors are paged).
- [ ] PagerDuty service mapping is in place; an on-call rotation member receives a synthetic test page.
- [ ] First-line response section here matches the runbook link target OR explicitly states `TBD`.
- [ ] Severity (P0/P1/P2) and tier (1/2) match `on-call-rotation-2026-05-16.md` §1.

When all 5 rows are checked, the cutover-checklist §6 "Monitoring + alert rules active" row flips to GREEN.

---

## Deferred / out-of-scope (per RFC I-017)

The cutover-checklist §6 lists 5 alert rules. W5-A's deliverable is exactly
those 5 rules. The following observability work is intentionally NOT
included this iter and lives in the post-cutover backlog:

| Topic | Reason for defer |
|---|---|
| Sentry performance monitoring (transaction spans on transactional routes) | Requires per-route `Sentry.startTransaction` wrappers; out of W5-A scope (the package install + boot test is the focus). Defer to post-cutover. |
| Sentry profiling integration (`@sentry/profiling-node`) | Separate package, separate sample-rate tuning. Defer to post-cutover capacity-planning work. |
| Prometheus metric labels on cutover-critical paths (`BREACH_RECORDED`, `REDIS_DEDUPE_MISS`, `RECEIPT_SEQUENCE_DB_UNAVAILABLE`) | Per W5 RFC `§Out of scope`: Sentry application-tier alerts satisfy cutover §6; Prometheus metrics-tier labels are a separate surface tracked in `monitoring/alerts.yml`. Defer to post-cutover observability hardening. |
| Sentry session replay for the web-app | Disabled by default (PDPA caution — `replaysSessionSampleRate: 0` in `sentry.client.config.ts` per W5-B). Enable only after DPO sign-off on the data-collection scope. |
| Three TBD runbooks (`high-error-rate.md`, `redis-dedupe-degraded.md`, `receipt-sequence-db-unavailable.md`) | Each first-line response section in this doc is the interim authoritative runbook. Promotion to a dedicated runbook file is post-cutover backlog. |

---

## References

- `docs/operations/cutover-checklist-2026-05-17.md` §6 — source-of-truth alert list
- `docs/operations/on-call-rotation-2026-05-16.md` §1, §5 — tier model + escalation chain
- `docs/operations/incident-response-2026-05-16.md` — generic incident playbook
- `docs/security/incident-response-runbook.md` — PDPA Section 28 sub-playbook (Rule 3)
- `apps/backend/services/breach-notification-service.js` — emits `BREACH_RECORDED` (Rule 3)
- `apps/backend/services/notification-fanout-service.js` — emits `REDIS_DEDUPE_MISS` (Rule 4)
- `apps/backend/services/quotation-service.js` + `services/receipt-numbering-service.js` — throw `RECEIPT_SEQUENCE_DB_UNAVAILABLE` (Rule 5)
- `apps/backend/shared/error-codes.js` — canonical error-code list
- `apps/backend/shared/production-logger.js` — Sentry SDK initialization point
