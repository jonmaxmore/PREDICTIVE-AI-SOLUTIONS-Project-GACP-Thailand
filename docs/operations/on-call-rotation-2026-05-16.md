# GACP On-Call Rotation - Iter 29

**Effective Date**: 2026-05-16
**Owner**: SRE Lead
**Review Cadence**: Quarterly
**Scope**: GACP Certification Platform (backend, frontend, finance, admin tooling)

---

## 1. Tier Model

| Tier | Role | Coverage | Primary Severities | Target Response |
|------|------|----------|--------------------|-----------------|
| Tier 1 | SRE on-call | 24/7 (incl. weekends + Thai public holidays) | CRITICAL (P0 / P1) | < 15 min ack, < 30 min mitigate |
| Tier 2 | Backend engineer on-call | Mon-Fri 09:00-17:00 ICT | HIGH (P2) | < 1 hour ack, < 4 hours mitigate |
| Tier 3 | Product manager on-call | Business hours | Incident comms, customer messaging | < 30 min draft external comms |

ICT = Indochina Time (UTC+7), Asia/Bangkok.

---

## 2. Responsibilities by Tier

### Tier 1 - SRE on-call (24/7)
- Acknowledge any PagerDuty `severity=critical` page within 15 minutes.
- Triage: confirm scope (single user / multi-tenant / platform-wide).
- Mitigate: rollback last deploy, scale horizontally, fail over DB, kill rogue query.
- Open Slack incident channel `#inc-<yyyy-mm-dd>-<keyword>` and post structured updates every 15 minutes until resolved.
- Loop in Tier 2 if root cause requires code change.
- Loop in Tier 3 if customer-facing within 30 minutes.
- File post-mortem within 5 business days for any P0 / P1.

### Tier 2 - Backend engineer on-call (Mon-Fri 09-17 ICT)
- Take over `severity=warning` Slack alerts.
- Investigate root cause for incidents Tier 1 mitigated overnight.
- Maintain runbooks under `docs/operations/runbooks/`.
- Pair with QA when an alert correlates with a release.

### Tier 3 - Product manager on-call
- Draft external messaging (status page, email-blast to certified farms, DTAM liaison).
- Coordinate with legal/DPO for PDPA-breach disclosures (72h to PDPC per PDPA Section 28).
- Coordinate with revenue/finance for billing-impacting outages.

---

## 3. Rotation Schedule Template (Weekly)

Rotations begin Monday 09:00 ICT, end the following Monday 09:00 ICT.

| Week | Tier 1 Primary | Tier 1 Secondary | Tier 2 Primary | Tier 3 Primary |
|------|----------------|------------------|----------------|----------------|
| 2026-W20 (May 11-17) | sre.somchai@dtam.go.th | sre.kanya@dtam.go.th | be.anurak@dtam.go.th | pm.naree@dtam.go.th |
| 2026-W21 (May 18-24) | sre.kanya@dtam.go.th | sre.peerapong@dtam.go.th | be.suchin@dtam.go.th | pm.daranee@dtam.go.th |
| 2026-W22 (May 25-31) | sre.peerapong@dtam.go.th | sre.somchai@dtam.go.th | be.anurak@dtam.go.th | pm.naree@dtam.go.th |
| 2026-W23 (Jun 01-07) | sre.somchai@dtam.go.th | sre.kanya@dtam.go.th | be.suchin@dtam.go.th | pm.daranee@dtam.go.th |

Schedule lives in PagerDuty (source of truth). This file is a snapshot.

### Holiday Coverage
Thai public holidays (Songkran 13-15 Apr, His Majesty's Birthday 28 Jul, etc.) follow standard rotation; on-call premium pay applies per HR policy.

---

## 4. Handoff Checklist

Outgoing on-call must complete before handing over:

- [ ] All P0/P1 incidents resolved or fully documented in `#inc-*` channel
- [ ] All warning-level alerts either resolved, silenced with reason, or assigned an owner
- [ ] Open PagerDuty incidents have a current update note within last 4 hours
- [ ] Any temporary workarounds documented in `docs/operations/runbooks/` with TODO and ticket link
- [ ] Pending deploys flagged - either rolled out and verified, or held until incoming on-call is briefed
- [ ] Slack `#sre-handoff` post with: "Handing over to <person>. Open items: <list>. Watch outs: <list>."

Incoming on-call must acknowledge within 30 minutes.

---

## 5. Escalation Path

```
Tier 1 SRE on-call
    |
    | (no ack in 15 min OR confirmed P0)
    v
Tier 1 Secondary + Engineering Manager
    |
    | (no ack in 30 min OR scope = platform-wide)
    v
Head of Platform + CTO
    |
    | (PDPA breach OR > 1h customer-facing outage)
    v
Legal Counsel + DPO + Executive Comms
    |
    | (PDPA breach confirmed)
    v
PDPC notification (Personal Data Protection Committee) - within 72h per Section 28
```

### External Escalation Contacts

| Stakeholder | When to Contact | Channel |
|-------------|-----------------|---------|
| DTAM Director General Office | Platform-wide outage > 1h during business hours | Phone + formal letter |
| Department of Agriculture liaison | Certificate issuance blocked > 4h | Email + phone |
| PDPC (Personal Data Protection Committee) | Confirmed PDPA breach | Formal notification within 72h |
| Cloud provider support (AWS / GCP) | Infrastructure failure | Enterprise support portal |

---

## 6. Tools

- **Paging**: PagerDuty (https://gacp.pagerduty.com)
- **Alerting**: Prometheus Alertmanager -> PagerDuty webhook
- **Comms**: Slack (`#gacp-alerts`, `#inc-*`, `#sre-handoff`)
- **Dashboards**: Grafana (https://grafana.gacp-platform.th)
- **Runbooks**: `docs/operations/runbooks/` (this repo)
- **Status Page**: https://status.gacp-platform.th

---

## 7. Compensation & Burnout Guardrails

- Maximum 1 week of Tier 1 primary per 3 weeks per person.
- After any P0 page, on-call gets next business day off (recovery day).
- Quarterly review of incident load per person; rebalance rotation if > 5 pages/week sustained.

---

**Last reviewed**: 2026-05-16 (Iter 29)
**Next review**: 2026-08-15
