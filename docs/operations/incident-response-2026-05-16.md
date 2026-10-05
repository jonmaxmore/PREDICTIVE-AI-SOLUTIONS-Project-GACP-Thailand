# GACP Incident Response Runbook - Iter 29

**Effective Date**: 2026-05-16
**Owner**: SRE Lead
**Companion Doc**: `on-call-rotation-2026-05-16.md`

---

## 1. Severity Levels

| Level | Name | Criteria | Examples | SLO (Mitigate) | SLO (Resolve) |
|-------|------|----------|----------|----------------|---------------|
| P0 | Critical / Crisis | Platform-wide outage, data loss, confirmed PDPA breach | All users cannot log in; DB corruption; PII leak | 30 min | 4 h |
| P1 | High / Major | Major feature broken for > 25% users; revenue blocked | Cert issuance fails; payment flow broken; auth degraded | 1 h | 8 h |
| P2 | Medium / Minor | Single feature broken; workaround exists | Slip upload fails for one PSP; dashboard slow | 4 h | 2 business days |
| P3 | Low / Cosmetic | UI glitch, non-blocking warning | Typo in receipt PDF; wrong icon | Next sprint | Next sprint |

**Default rule**: if PDPA personal data is involved AND > 1 user impacted = P0.

---

## 2. Per-Severity SLOs

| Metric | P0 | P1 | P2 | P3 |
|--------|----|----|----|----|
| Acknowledgement | 15 min | 30 min | 1 h | 1 business day |
| Initial Slack update | 15 min | 30 min | 2 h | n/a |
| Mitigation target | 30 min | 1 h | 4 h | next sprint |
| Resolution target | 4 h | 8 h | 2 business days | next sprint |
| Status page update | 15 min, then every 30 min | 30 min, then every 1 h | 1 h, on resolution | optional |
| Post-mortem due | 5 business days | 5 business days | optional | not required |

---

## 3. Communication Channels

### Internal
- **Primary**: dedicated Slack incident channel `#inc-YYYY-MM-DD-<keyword>`
- **Voice bridge**: Google Meet link pinned in channel for P0/P1
- **Status updates**: post in `#gacp-alerts` every 15 min for P0, 30 min for P1

### External
- **Status page**: https://status.gacp-platform.th (managed via Statuspage.io)
- **Email**: registered farmers via SendGrid template `incident-notice` for P0
- **DTAM liaison**: formal phone + email for any P0 lasting > 1h during business hours

### Roles in an Incident (use slash commands in incident channel)
- `IC` - Incident Commander (Tier 1 SRE on-call)
- `CL` - Comms Lead (Tier 3 PM)
- `Tech` - Technical Lead (Tier 2 backend)
- `Scribe` - takes timestamped notes for post-mortem

---

## 4. Status Page Update Protocol

| Phase | What to Post | When |
|-------|--------------|------|
| Investigating | "We are investigating reports of <symptom>. Impact: <scope>." | within 15 min of P0/P1 detection |
| Identified | "We have identified the issue with <component>. Working on mitigation." | when root cause located |
| Monitoring | "A fix has been applied; we are monitoring." | when mitigation deployed |
| Resolved | "The incident is fully resolved. Post-mortem to follow." | when verified stable for 30 min |

**Tone**: factual, customer-friendly, no internal jargon, Thai + English bilingual for public-facing channels.

### PDPA Breach Disclosure (Special Path)

Per PDPA Section 28: notify PDPC within 72 hours of becoming aware of a personal-data breach. Internal protocol:

1. T+0: SRE detects + opens P0 incident
2. T+1h: DPO + Legal Counsel notified
3. T+4h: scope assessment complete (number of data subjects affected, categories of data, root cause)
4. T+24h: draft notification letter to PDPC
5. T+48h: notification letter sent to PDPC (template at `docs/legal/pdpa-breach-notification-template.md`)
6. T+72h: hard deadline - PDPC notification MUST be submitted
7. If high risk to data subjects -> individual notification per Section 28 second paragraph

**Never wait until T+72h**. Aim for T+48h to leave buffer for legal review.

---

## 5. Incident Workflow

```
Detection (alert / user report / monitoring)
    |
    v
Tier 1 on-call acks PagerDuty (< 15 min for P0)
    |
    v
Open #inc-YYYY-MM-DD-<keyword> channel
    |
    v
Assign IC / Tech / Scribe / Comms Lead
    |
    v
Triage: confirm severity, scope, impact
    |
    v
Status page: "Investigating"
    |
    v
Mitigate (rollback / scale / failover)
    |
    v
Status page: "Monitoring"
    |
    v
Verify stable for 30 min
    |
    v
Status page: "Resolved"
    |
    v
File post-mortem ticket (due 5 business days)
```

---

## 6. Post-Mortem Template

Filename: `docs/operations/post-mortems/YYYY-MM-DD-<keyword>.md`

```markdown
# Post-Mortem: <one-line title>

**Date**: YYYY-MM-DD
**Severity**: P0 | P1 | P2
**Duration**: HH:MM (detection -> resolution)
**Customer Impact**: <number of users / feature / scope>
**Incident Commander**: <name>
**Authors**: <names>

## TL;DR
<2-3 sentence summary>

## Timeline (ICT, 24h)
| Time | Event |
|------|-------|
| HH:MM | <event> |

## Root Cause
<technical root cause>

## Contributing Factors
- <factor 1>
- <factor 2>

## What Went Well
- <positive>

## What Went Poorly
- <negative>

## Action Items
| # | Action | Owner | Due | Ticket |
|---|--------|-------|-----|--------|
| 1 | <action> | @owner | YYYY-MM-DD | GACP-### |

## Lessons Learned
<key takeaways>

## Appendix
- Slack channel: #inc-...
- Grafana snapshot: <url>
- Related runbook: docs/operations/runbooks/...
```

**Blameless culture**: focus on systems and processes, not individuals.

---

## 7. Common Mitigations Cheat Sheet

| Symptom | First Action | Runbook |
|---------|--------------|---------|
| 5xx spike after deploy | Rollback to previous tag | `runbooks/rollback.md` |
| DB connection saturated | Restart backend pods to free pool | `runbooks/db-down.md` |
| Cert renewal pending expiry | Manual cert renewal via Certbot | `runbooks/tls-cert-renewal.md` |
| Secret leaked | Rotate per `runbooks/secret-rotation.md` | `runbooks/secret-rotation.md` |
| GHCR PAT expired | Rotate per `runbooks/ghcr-pat-rotation.md` | `runbooks/ghcr-pat-rotation.md` |
| Audit log writes failing | Promote DB read replica; freeze writes; escalate | `runbooks/audit-log-failure.md` (to be authored) |
| PDPA erasure SLA breach | Manual erasure via admin tooling; notify DPO | Iter 27 docs |

---

## 8. Key Compliance References

| Regulation | Section | Requirement |
|-----------|---------|-------------|
| PDPA | Section 28 | PDPC notification within 72h of breach awareness |
| PDPA | Section 33 | Erasure requests responded within 30 days |
| Revenue Code | Section 86/12 | Tax invoice retention (5 years) |
| Cybersecurity Act | Section 60 | Critical Information Infrastructure incident report |

---

**Last reviewed**: 2026-05-16 (Iter 29)
**Next review**: 2026-08-15
