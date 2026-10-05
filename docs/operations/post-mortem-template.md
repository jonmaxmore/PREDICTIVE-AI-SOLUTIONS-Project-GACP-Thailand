# Post-Mortem Template

**Purpose**: Boilerplate for analyzing production incidents. Goal is blameless learning, not punishment.
**Time SLA**: Draft within 5 business days of incident resolution; final within 10 business days.
**Audience**: Engineering, Ops, Product, Customer Success, leadership.

> Replace all `<<placeholders>>` and remove this banner before circulating. Keep the doc concise: aim for 3–5 pages, with diagrams only where they earn their place.

---

## 1. Header

| Field | Value |
|-------|-------|
| Incident ID | INC-`<<YYYYMMDD-NN>>` |
| Title | `<<short, factual title>>` |
| Severity | P0 / P1 / P2 / P3 |
| Status | Draft / In Review / Final / Closed |
| Date detected | `<<YYYY-MM-DD HH:MM ICT>>` |
| Date resolved | `<<YYYY-MM-DD HH:MM ICT>>` |
| Duration | `<<H:MM>>` |
| Author | `<<author>>` |
| Reviewers | `<<list>>` |
| Distribution | engineering, ops, product, CS, exec |

---

## 2. Executive summary (≤ 200 words)

Plain-language description for non-technical readers. Include:
- What happened
- Who was affected (users, internal staff)
- Business impact (revenue, certifications delayed, reputation)
- Resolution summary
- Key takeaway in one sentence

---

## 3. Impact

### 3.1 User impact

- Number of users affected: `<<count>>`
- Personas affected: applicant / finance / auditor / scheduler / admin
- Duration of degraded service: `<<H:MM>>`
- Severity to user: `<<can't login / can't pay / can't audit / etc.>>`

### 3.2 Business impact

- Revenue/payment processing delayed: `<<amount in THB>>`
- Certifications delayed: `<<count>>`
- Audits affected: `<<count>>`
- SLA breach: `<<yes/no, which SLA>>`

### 3.3 Compliance impact

- PDPA: `<<no incident / breach reported / breach in progress>>`
- Accounting: `<<period close impacted? journal integrity affected?>>`
- Reportable to regulators: `<<yes/no>>`

---

## 4. Timeline (in ICT, 24h format)

| Time | Event | Actor |
|------|-------|-------|
| `<<HH:MM>>` | First abnormal signal (alert / user report) | `<<who>>` |
| `<<HH:MM>>` | Incident declared, severity assigned | `<<who>>` |
| `<<HH:MM>>` | On-call paged | `<<who>>` |
| `<<HH:MM>>` | Investigation begins | `<<who>>` |
| `<<HH:MM>>` | Initial hypothesis | `<<who>>` |
| `<<HH:MM>>` | Mitigation attempted | `<<who>>` |
| `<<HH:MM>>` | Mitigation effective | `<<who>>` |
| `<<HH:MM>>` | Root cause identified | `<<who>>` |
| `<<HH:MM>>` | Fix deployed | `<<who>>` |
| `<<HH:MM>>` | Resolved (back to normal) | `<<who>>` |
| `<<HH:MM>>` | Communication to users | `<<who>>` |

---

## 5. What happened (detailed narrative)

`<<Plain prose narrative of the incident. Walk through it like a story. Include screenshots / log excerpts only where they materially add to understanding. Should be readable by an engineer who wasn't on call.>>`

---

## 6. Root cause analysis

### 6.1 Direct cause

`<<What specifically broke? Be precise. e.g. "A query without index was added in PR #1234 causing DB CPU to spike when traffic exceeded 200 RPS.">>`

### 6.2 Contributing factors

`<<List ≥ 3 contributing factors. Examples: missing alerting, lack of staging traffic load, code review didn't catch the missing index, runbook was out of date.>>`

### 6.3 Five Whys

1. Why did `<<the incident>>` happen?
   - Because `<<answer>>`
2. Why?
   - Because `<<answer>>`
3. Why?
   - Because `<<answer>>`
4. Why?
   - Because `<<answer>>`
5. Why?
   - Because `<<answer>>` (this is your structural / cultural root cause)

---

## 7. What went well

`<<3–5 bullets on what worked during the incident. Examples: alerting fired quickly, on-call was reachable, rollback was clean, comms were clear, customer success had macros ready.>>`

---

## 8. What didn't go well

`<<3–5 bullets on what didn't work. Examples: alert was noisy and dismissed, dashboards didn't surface DB CPU, rollback failed first attempt, internal comms went to wrong channel, customer comms delayed.>>`

---

## 9. Where we got lucky

`<<List moments where the outcome could have been worse but for a coincidence. Examples: incident happened during low-traffic window, on-call happened to be online, a prior load test had primed the team. These deserve investment so we don't depend on luck next time.>>`

---

## 10. Action items

Each action item must have:
- An owner (named person, not team)
- A due date
- A linked ticket
- A clear acceptance criterion

| ID | Action | Type | Owner | Due | Ticket | Status |
|----|--------|------|-------|-----|--------|--------|
| AI-1 | `<<action>>` | fix / prevent / detect / mitigate / process | `<<name>>` | `<<date>>` | `<<URL>>` | open |
| AI-2 | `<<action>>` | … | … | … | … | … |
| AI-3 | `<<action>>` | … | … | … | … | … |

Action types:
- **fix**: address the specific bug
- **prevent**: stop this class of issue
- **detect**: catch faster next time
- **mitigate**: reduce blast radius next time
- **process**: improve people/process

> Discipline: tracked in product backlog. Reviewed monthly. Aging > 90 days = escalation.

---

## 11. Lessons learned

`<<Captures the meta-insight. What does this incident teach us about our system, team, or process? Generalize beyond this specific bug.>>`

---

## 12. Glossary

`<<Define any acronyms or system-specific terms. Helps new readers.>>`

---

## 13. Appendix

- Logs: `<<S3 path>>`
- Dashboards (snapshotted at incident time): `<<links>>`
- Slack thread: `<<#channel + permalink>>`
- PagerDuty incident: `<<URL>>`
- Related PRs: `<<URLs>>`
- Status page entry: `<<URL>>`
- Customer comms: `<<email/LINE blast text>>`

---

## 14. Sign-off

| Role | Name | Sign | Date |
|------|------|------|------|
| Author | _ | _ | _ |
| Eng Lead | _ | _ | _ |
| Ops Lead | _ | _ | _ |
| Product Lead | _ | _ | _ |
| PM | _ | _ | _ |

---

## How to use this template

1. Copy this file: `cp post-mortem-template.md post-mortem-INC-YYYYMMDD-NN.md`
2. Fill out within 5 business days of incident
3. Schedule review meeting (60 min) with author + reviewers
4. Update action items based on review feedback
5. Distribute final to stakeholders
6. Action items enter product backlog
7. Review action items monthly at ops standup
