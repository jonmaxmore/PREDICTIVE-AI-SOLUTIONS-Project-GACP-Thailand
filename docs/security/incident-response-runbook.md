# GACP Incident Response Runbook — PDPA ม.28 / NIST SP 800-61

**Effective date**: 2026-05-17 (Iter R4)
**Owner**: Security Lead
**Companion docs**:

- `docs/operations/incident-response-2026-05-16.md` — operational severity / on-call rotation / status-page protocol
- `docs/operations/on-call-rotation-2026-05-16.md` — Tier 1/2/3 escalation tree
- `docs/operations/post-mortem-template.md` — blameless post-mortem skeleton
- `docs/security/pdpa-audit-checklist-2026-05-16.md` — the audit gap this runbook closes (ม.28 Missing items)
- `docs/security/pdpa-erasure-2026-05-16.md` — adjacent PDPA ม.32 surface (right-to-forget; not a breach pathway)

This runbook is the canonical PDPA-aware incident-response playbook layered on top of the generic operational runbook. The generic runbook tells you HOW to run an incident; this one tells you WHEN PDPA ม.28 / PDPC Notification B.E. 2565 (2022) timelines apply and HOW the system surfaces a breach record into the audit chain.

> **Glossary** — _"ม.28"_ is the project's adopted shorthand for the breach-notification clause of the Thai PDPA B.E. 2562 (2019). The statutory citation that appears in some legal-counsel materials is _"มาตรา 37"_ (Section 37). Both refer to the same article — the project standardised on "ม.28" because that is the heading used in `docs/security/pdpa-audit-checklist-2026-05-16.md` and in every `BREACH_*` audit-row `metadata.legalBasis` entry. If a PDPC reviewer or external auditor asks why headings say ม.28 while subject-notification body text cites มาตรา 37, point them at this paragraph.

> **Implementation-status note (2026-08-19, external-services cleanup final-fix-1)** — the `breachNotificationService` module (`recordBreach` / `markPdpcReportSubmitted` / `markSubjectsNotified` / the JSON breach store) described throughout §§2-7 below **does not exist in this codebase**. It was deleted as unwired dead code before this cleanup branch existed (`git log -- apps/backend/services/breach-notification-service.js`, commit `d66959ab`, "Phase1 — delete unwired PDPA breach-notification-service"). Separately, the `BREACH_NOTIFICATION_SUBJECT` in-app template this runbook cites at §2.2/§4/§6.2 was deleted by the external-services cleanup (Task 4, 2026-08-19) — it had zero production callers. **What this means in practice**: everything below describing an automated record→auto-fire→audit-trail pipeline is design intent, not live capability. The ACTUAL current mechanism for a real breach is fully manual: DPO/on-call must (a) track the §3 PDPA ม.28 timeline by hand, (b) compose and send subject notification manually — the only live delivery surface for a subject-facing message today is the in-app `Notification` row via `notification-service.js`/`notification-fanout-service.js`'s surviving IN_APP-only fanout types (there is currently no dedicated breach-notification fanout type), and (c) file the PDPC report via the PDF generator at `apps/backend/services/pdf/pdpc-breach-report-service.js`, which is independent of `breachNotificationService` and still exists. Rebuilding the automation is tracked in the backlog — not addressed in this fix round.

---

## 1. Severity matrix

The platform uses a four-tier severity ladder that maps directly to the breach-notification-service's `BREACH_SEVERITY` enum (`apps/backend/services/breach-notification-service.js`). The generic operational severity (P0–P3 in `docs/operations/incident-response-2026-05-16.md` §1) is broader — it covers performance / availability / business-continuity events that may have NO data-subject impact. PDPA severity is narrower and applies ONLY when personal data was likely exposed.

| BREACH_SEVERITY | Trigger | Operational mapping | Auto-fire subject notification |
|-----------------|---------|---------------------|--------------------------------|
| `CRITICAL` | Credential leak; sensitive-PII leak (idCard / healthId / passport plaintext); authentication-system compromise | P0 | Yes — within 24 hours of detection |
| `HIGH` | Partial-PII leak (email + name); audit-chain integrity event; prolonged unauthorised access | P0 or P1 | Yes — within 24 hours of detection |
| `MEDIUM` | Short-window low-PII leak; internal-only exposure; near-miss with no confirmed exfiltration | P2 | No — operator discretion within 72 hours |
| `LOW` | Telemetry-only event; no PII surface; security-control degradation with no data exposure | P2 or P3 | No — not required (PDPC report still filed if any likely risk exists) |

**Default rule** (from `docs/operations/incident-response-2026-05-16.md:18`): if PDPA personal data is involved AND more than one user is impacted, the operational severity is at least P0. The PDPA severity is then determined by the data category (sensitive vs general PII) per the table above.

**The 72-hour PDPC notification deadline (PDPA ม.28 / PDPC Notification 2565/2022) applies uniformly to ALL severities** where the breach is likely to result in risk to data-subject rights and freedoms. Severity governs the SUBJECT-notification deadline ("without undue delay"), NOT the PDPC clock.

---

## 2. NIST SP 800-61 phases tailored to PDPA timelines

Each phase below names the concrete on-call action AND the breach-notification-service entry point invoked. The service exposes `recordBreach`, `markPdpcReportSubmitted`, `markSubjectsNotified`, `getBreach`, and `listBreaches` (see `apps/backend/services/breach-notification-service.js` module.exports).

### 2.1 Detection (T+0)

**Sources**

- SIEM filters on `securityEvent: true` markers in structured logs. Canonical example: the `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE` event emitted from `apps/backend/services/token-revocation-service.js:167-194` (worked dry-run in §6 below).
- PagerDuty `severity=critical` page from monitoring synthetics (covered by `docs/operations/metrics-inventory-2026-05-16.md`).
- Operator manual report (helpdesk escalation; user-supplied evidence of a phishing or credential-harvesting attempt).
- Automated audit-chain integrity sweep failures (chain-hash mismatch detected at `node scripts/system-integrity-check.js` — the verbatim invocation per `.husky/pre-commit`).

**On-call actions**

1. Acknowledge the page within Tier-1 SLA (15 minutes per `docs/operations/on-call-rotation-2026-05-16.md` §1).
2. Open a Slack incident channel `#inc-YYYY-MM-DD-<keyword>` (per `docs/operations/incident-response-2026-05-16.md` §3).
3. Make a preliminary severity call using the matrix in §1. Err on the side of HIGH if unsure — downgrade later if the triage shows no PII surface.

**Service entry point**: none yet. Detection precedes a confirmed breach.

### 2.2 Triage (T+0 to T+1h)

**Goal**: confirm whether the event meets the PDPA ม.28 trigger ("personal data breach … likely to result in a risk to data subject rights and freedoms"). Output is a yes/no plus a candidate `BREACH_SEVERITY`.

**On-call actions**

1. Identify the affected data set: tables, columns, JSON paths. Map each column to the data-category labels listed in `docs/security/pdpa-audit-checklist-2026-05-16.md`.
2. Estimate the affected-subject count via Prisma read replicas. NEVER export raw PII into the incident channel — quote the count only.
3. Loop in DPO + Legal Counsel by T+1h per `docs/operations/incident-response-2026-05-16.md` §4 "PDPA Breach Disclosure (Special Path)".

**Service entry point**: when triage confirms the breach, the operator runs `breachNotificationService.recordBreach({ summary, affectedUserIds, severity, detectedAt, actorId, organizationId, notificationPayload })` from a Node REPL or a future admin-UI tool (R5+ scope). `recordBreach` immediately:

- Persists a JSON record at `apps/backend/storage/breaches/<breachId>.json` (UUIDs only — no email / phone / healthId at rest).
- Computes `deadlines.pdpc72h = detectedAt + 72h` and `deadlines.subjectNotification` per the severity matrix.
- Writes a `BREACH_RECORDED` audit row with `metadata.legalBasis: ['PDPA ม.28', 'PDPC Notification 2565/2022']`.
- For `CRITICAL` or `HIGH`, [DELETED — see implementation-status note above] would have fanned out the `BREACH_NOTIFICATION_SUBJECT` template to each affected user; that template (formerly provided by R4-C in `apps/backend/services/notification-fanout-service.js`) was deleted by the external-services cleanup (Task 4, 2026-08-19, zero production callers). Today: manually send the subject an in-app notification.

### 2.3 Containment (T+0 to T+4h)

**Goal**: stop the bleed. The PDPA clock keeps ticking — containment runs in parallel with notification preparation.

**On-call actions**

1. If credentials are suspected: rotate the JWT signing key, force-revoke all sessions via `revokeAllUserTokens(userId)` per the recommendation in `apps/backend/services/token-revocation-service.js:187-191`, and rotate any downstream API keys.
2. If an injection / exfiltration vector is suspected: pause the offending route at the load balancer (rollback last deploy per `docs/operations/rollback-runbook-2026-05-16.md`).
3. If credential reuse is suspected on third-party platforms: open a Tier-3 task to draft a public advisory.

**Service entry point**: none. Containment is operational, not record-keeping.

### 2.4 Eradication (T+1h to T+24h)

**Goal**: remove the attacker's foothold and close the vulnerability.

**On-call actions**

1. Patch the vulnerable code path on a branch; pair-review with the Security Lead before merge.
2. Add a regression test that asserts the vulnerable input now fails closed.
3. Validate the patch in staging before deploying to production (`docs/operations/staging-activation.md`).

**Service entry point**: none. Eradication is engineering, not record-keeping. The audit row from §2.2 is the evidence that the incident timeline began.

### 2.5 Recovery (T+24h to T+72h)

**Goal**: restore service to a known-good baseline; submit the PDPC report; notify affected subjects.

**On-call actions**

1. By T+24h, file the PDPC report per §5 below. Do NOT wait until T+72h — leave buffer for legal review.
2. After PDPC submission, run `breachNotificationService.markPdpcReportSubmitted(breachId, { submittedAt, ackNumber, actorId })`. This transitions the breach record to `PDPC_NOTIFIED` and writes a `BREACH_PDPC_NOTIFIED` audit row.
3. Confirm completion of the subject notification batch. Run `breachNotificationService.markSubjectsNotified(breachId, { batchSize, completedAt, actorId })`. This transitions to `SUBJECTS_NOTIFIED` and writes a `BREACH_SUBJECTS_NOTIFIED` audit row.
4. If the breach severity was `MEDIUM` or `LOW`, the subject notification did NOT auto-fire — the operator must invoke the fanout manually or document a justified decision to skip subject notification in the post-mortem.

### 2.6 Lessons learned (T+5 business days)

**Goal**: produce a blameless post-mortem and ratchet a control to prevent recurrence.

**On-call actions**

1. Draft a post-mortem using the template at `docs/operations/post-mortem-template.md`. The Header table includes a `Severity` field — use the operational severity (P0–P3), not BREACH_SEVERITY (this is the convention in the post-mortem template).
2. Cross-link the post-mortem to the breach record (`breachId`) and the audit rows (`BREACH_RECORDED` / `BREACH_PDPC_NOTIFIED` / `BREACH_SUBJECTS_NOTIFIED`).
3. Open a follow-up ticket for the recurring-control ratchet. Examples: add a SIEM filter, add an ESLint rule, add a Jest regression test, tighten a permission scope.
4. Schedule a 30-minute review with Security Lead + DPO + Engineering Lead within 10 business days.

---

## 3. PDPA ม.28 timeline

| Hour | Action | Owner |
|------|--------|-------|
| T+0 | Detection event fires; on-call paged | Tier 1 SRE |
| T+15min | Page acknowledged; Slack channel open | Tier 1 SRE |
| T+1h | DPO + Legal Counsel looped in | Tier 1 SRE |
| T+4h | Scope assessment complete; `recordBreach` invoked | Security Lead + SRE |
| T+24h | Subject notification fan-out complete (CRITICAL/HIGH); PDPC draft ready for legal review | DPO |
| T+48h | PDPC submission target (buffered against the hard 72h deadline) | DPO |
| T+72h | PDPC submission hard deadline per PDPA ม.28 | DPO |
| T+5bd | Post-mortem draft circulated | Incident Commander |
| T+10bd | Post-mortem final; control ratchet ticket triaged | Security Lead |

**"Without undue delay" definition for subject notification**: for `CRITICAL` and `HIGH` severities the breach-notification-service auto-fires the subject template within minutes of `recordBreach`; the operator-confirmed completion deadline is 24 hours from `detectedAt`. For `MEDIUM` the operator-discretion deadline is 72 hours. For `LOW` no automatic subject notification is required.

---

## 4. Subject notification template wording (canonical)

**Status: the `BREACH_NOTIFICATION_SUBJECT` fanout template this section used to describe was deleted by the external-services cleanup (Task 4, 2026-08-19, zero production callers) — see the implementation-status note near the top of this document.** This section holds the canonical Thai and English wording as a reference for whoever composes the manual subject notification today (or rebuilds the automated template later). The wording cites PDPA ม.28 and PDPC Notification B.E. 2565 (2022) verbatim.

### 4.1 Placeholders (contract)

The fanout template MUST consume exactly these placeholders. The breach-notification-service passes them in `notificationPayload` to `recordBreach`.

- `{{breachId}}` — internal reference (e.g. `breach-<32 hex>`)
- `{{breachDateTH}}` — detection date in Buddhist Era, e.g. "17 พฤษภาคม พ.ศ. 2569"
- `{{affectedDataCategoriesTH}}` — Thai list of data categories impacted, e.g. "ชื่อ-นามสกุล, เบอร์โทรศัพท์"
- `{{remedialActionsTH}}` — Thai description of actions the platform has taken, e.g. "ระงับบัญชีที่ได้รับผลกระทบและปิดช่องโหว่แล้ว" (only actions the platform can actually take: there is no password reset or account recovery, operator 2026-09-17)
- `{{contactInformationTH}}` — Thai contact details for follow-up, e.g. "support@gacpthai.com"

### 4.2 Subject line

- Thai: `แจ้งเหตุละเมิดข้อมูลส่วนบุคคล (PDPA ม.28)`
- English: `Personal Data Breach Notification (Thai PDPA Section 37)`

### 4.3 Body — Thai (canonical)

```
เรียน เจ้าของข้อมูลส่วนบุคคล

ระบบรับรอง GACP (Good Agricultural and Collection Practices) ขอแจ้งให้ท่านทราบว่า
เมื่อวันที่ {{breachDateTH}} เกิดเหตุละเมิดข้อมูลส่วนบุคคลที่อาจส่งผลกระทบต่อข้อมูลของท่าน

หมายเลขอ้างอิงเหตุการณ์: {{breachId}}

ประเภทข้อมูลที่ได้รับผลกระทบ:
{{affectedDataCategoriesTH}}

มาตรการเยียวยาที่ผู้ควบคุมข้อมูลได้ดำเนินการ:
{{remedialActionsTH}}

การแจ้งครั้งนี้เป็นไปตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 มาตรา 37
ประกอบกับประกาศคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล เรื่อง หลักเกณฑ์และวิธีการ
ในการแจ้งเหตุการละเมิดข้อมูลส่วนบุคคล พ.ศ. 2565

หากท่านมีข้อสงสัยหรือต้องการสอบถามข้อมูลเพิ่มเติม โปรดติดต่อ:
{{contactInformationTH}}

ขออภัยในความไม่สะดวกที่เกิดขึ้น

ทีมระบบรับรอง GACP
กรมการแพทย์แผนไทยและการแพทย์ทางเลือก
```

### 4.4 Body — English (translation for reference)

```
Dear Data Subject,

The GACP (Good Agricultural and Collection Practices) Certification System
hereby notifies you that on {{breachDateTH}} a personal data breach occurred
that may have affected your personal data.

Incident reference: {{breachId}}

Data categories affected:
{{affectedDataCategoriesTH}}

Remedial actions taken by the data controller:
{{remedialActionsTH}}

This notification is made under Section 37 of the Thai Personal Data
Protection Act B.E. 2562 (2019) read together with the PDPC Notification
on Personal Data Breach Reporting B.E. 2565 (2022).

If you have questions or need further information, please contact:
{{contactInformationTH}}

We apologise for the inconvenience.

GACP Certification System team
Department of Thai Traditional and Alternative Medicine
```

### 4.5 SMS variant (160 chars)

```
แจ้งเตือน PDPA: ระบบ GACP พบเหตุละเมิดข้อมูลของท่าน (อ้างอิง {{breachId}}). ดูรายละเอียดในอีเมลของท่าน หรือติดต่อ {{contactInformationTH}}
```

### 4.6 PII-leak invariants

The template renderer MUST satisfy these invariants (asserted by `apps/backend/__tests__/unit/notification-fanout-service.test.js` per R4-C scope):

- The rendered `bodyTHHtml` MUST NOT contain a raw 10-digit phone-number sequence. Phone references in placeholders MUST be either redacted (e.g. `XXX-XXX-5678`) or omitted.
- The rendered `bodyTHHtml` MUST NOT contain a raw `@<domain>` email address fragment. The contact-information placeholder uses an operator-managed inbox (e.g. `support@gacpthai.com`) and is the only sanctioned email surface in the template.

---

## 5. PDPC report submission workflow

The breach-notification-service does NOT submit the PDPC report directly. PDPC submission is a manual workflow performed by the DPO with sign-off from Legal Counsel. The platform-side surface for the report is the PDF generator delivered by R4-B at `apps/backend/services/pdf/pdpc-breach-report-service.js` and the HTML skeleton at `apps/backend/services/pdf/templates/pdpc-breach-notification.html`. Both files carry an operator-warning header noting that the form layout is best-effort and MUST be verified against the current PDPC published form (`https://www.pdpc.or.th`) before production submission.

### 5.1 Submission steps

1. Operator fetches the breach record via `breachNotificationService.getBreach(breachId)`.
2. Operator invokes the PDF generator (R4-B): `generatePdpcBreachReportPdf(breachRecord) → Buffer`. The PDF returned is a Thai-first single-page A4 document mirroring the PDPC official Annex A form.
3. DPO + Legal Counsel review the PDF for completeness and accuracy of free-text fields.
4. DPO submits the PDF + supplementary evidence to the PDPC via the official channel (postal, in-person, or PDPC e-submission portal once provisioned).
5. PDPC issues an acknowledgement number.
6. Operator records the acknowledgement via `breachNotificationService.markPdpcReportSubmitted(breachId, { submittedAt, ackNumber, actorId })`. This transitions the breach record to `PDPC_NOTIFIED` and writes the `BREACH_PDPC_NOTIFIED` audit row.

### 5.2 Out of scope for Iter R4

- Real PDPC API submission. Iter R4 generates the PDF and records the workflow; live filing requires production RSA keys and a verified PDPC portal account (ops cutover).
- Automatic dispatch of the PDF over email/portal. The DPO performs the submission manually.

---

## 6. Worked example — `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE` dry-run

This section walks the runbook end-to-end using a synthetic incident triggered by the existing SecOps event in `apps/backend/services/token-revocation-service.js:167-194`. The event fires when the Redis blocklist used by `isAccessTokenBlocklisted` is unreachable; the service fails OPEN by policy (documented at `apps/backend/services/token-revocation-service.js:199-208`).

### 6.1 Scenario

A 12-minute Redis outage on 2026-05-17 at 08:00 UTC silently disables access-token revocation. During the outage, an attacker known to be in possession of one stolen access token (jti prefix `f3a8e2bc12345678`) is able to use it after the legitimate user reported the theft. The user's account holds general-PII (name + email + phone).

### 6.2 Walkthrough

| Phase | Action | Concrete invocation |
|-------|--------|---------------------|
| Detection (T+0) | SIEM picks up the `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE` event with `severity: 'CRITICAL'`; PagerDuty pages Tier 1 SRE | Logged event from `apps/backend/services/token-revocation-service.js:178-193` |
| Triage (T+30min) | Confirms the user-reported theft correlates with the outage window; reads the audit chain for the jti prefix; estimates 1 affected subject | Read-only Prisma query on `AuditLog` |
| Containment (T+45min) | Restores Redis blocklist; forces `revokeAllUserTokens(userId)` for the affected user; rotates the JWT signing key as a precaution | Per the `recommendedAction` text emitted by the SecOps event |
| Record (T+1h) | `breachNotificationService.recordBreach({ summary: 'Access-token blocklist outage allowed reuse of stolen jti', affectedUserIds: ['user-uuid-1'], severity: 'HIGH', detectedAt: '2026-05-17T08:00:00.000Z', actorId: 'sre-on-call', notificationPayload: { breachDateTH: '17 พฤษภาคม พ.ศ. 2569', affectedDataCategoriesTH: 'ชื่อ-นามสกุล, อีเมล, เบอร์โทรศัพท์', remedialActionsTH: 'ระงับบัญชีที่ได้รับผลกระทบ + หมุนคีย์ JWT', contactInformationTH: 'support@gacpthai.com' } })` returns `{ breachId, status: 'RECORDED', deadlines: { pdpc72h: '2026-05-20T08:00:00.000Z', subjectNotification: '2026-05-18T08:00:00.000Z' } }` | Service call from on-call REPL |
| Subject notification (T+1h) | [Design intent, not live — see implementation-status note above] `recordBreach`/`BREACH_NOTIFICATION_SUBJECT`/`_fireBreachSubjectFanout` do not exist in this codebase; the on-call operator manually sends the subject an in-app notification instead | Manual step, no service call today |
| Eradication (T+4h) | Patch lands: blocklist failure now emits an alert AND increments a SLO budget metric; ESLint rule added to prevent direct `redisService.get` calls outside the wrapper | Engineering PR |
| PDPC notification (T+30h) | DPO reviews the PDF report; PDPC submission via portal; ack `PDPC-2026-05-18-001` returned | `breachNotificationService.markPdpcReportSubmitted(breachId, { submittedAt: '2026-05-18T14:00:00.000Z', ackNumber: 'PDPC-2026-05-18-001', actorId: 'dpo-1' })` |
| Subject batch confirm (T+30h) | Operator confirms email deliveries via the email transport logs | `breachNotificationService.markSubjectsNotified(breachId, { batchSize: 1, completedAt: '2026-05-18T14:30:00.000Z', actorId: 'dpo-1' })` |
| Post-mortem (T+5bd) | Draft circulated using `docs/operations/post-mortem-template.md`; control ratchet ticket opened to add a SIEM dashboard widget for the SecOps event | Post-mortem |

### 6.3 What the audit chain looks like after the dry-run

The breach produces exactly three audit rows in `AuditLog` (in addition to the legacy authentication / authorisation rows from the application traffic):

1. `action: 'BREACH_RECORDED'`, `severity: 'WARNING'`, `metadata.legalBasis: ['PDPA ม.28', 'PDPC Notification 2565/2022']`, `metadata.breachSeverity: 'HIGH'`, `metadata.affectedSubjectsCount: 1`, `metadata.pdpc72h: '2026-05-20T08:00:00.000Z'`, `metadata.subjectNotificationDeadline: '2026-05-18T08:00:00.000Z'`, `metadata.autoFire: true`
2. `action: 'BREACH_PDPC_NOTIFIED'`, `severity: 'WARNING'`, `metadata.pdpcAckNumber: 'PDPC-2026-05-18-001'`
3. `action: 'BREACH_SUBJECTS_NOTIFIED'`, `severity: 'WARNING'`, `metadata.batchSize: 1`

The breach record JSON at `apps/backend/storage/breaches/<breachId>.json` carries the same metadata plus the full `history[]` for the workflow state machine, but NO PII (only the user UUID).

---

## 7. Roles + escalation matrix

This section is a hook into `docs/operations/on-call-rotation-2026-05-16.md` so the PDPA workflow does not duplicate the on-call routing. The mapping below names the PDPA-specific role overlay on top of the generic Tier model.

| Tier | Generic role | PDPA-specific role |
|------|--------------|--------------------|
| Tier 1 | SRE on-call | First responder; opens the Slack channel; runs `recordBreach` after triage |
| Tier 2 | Backend engineer on-call | Containment + eradication; pair-reviews the patch with Security Lead |
| Tier 3 | Product manager on-call | Communications lead; drafts the public statement |
| Security Lead | n/a | Owns the breach record state machine; approves severity calls |
| DPO | n/a | Owns the PDPC submission; signs off on the PDF report; runs `markPdpcReportSubmitted` |
| Legal Counsel | n/a | Reviews the PDPC submission; advises on Section-37(2) "high risk" determination |

Escalation paths and on-call rotation schedules live in `docs/operations/on-call-rotation-2026-05-16.md` — this runbook does not duplicate them.

---

## 8. Post-mortem template hook

Every PDPA breach incident MUST produce a post-mortem using the template at `docs/operations/post-mortem-template.md`. The PDPA-specific overlay on top of the generic template:

- The Header table's `Severity` field uses the operational severity (P0–P3) per the template's enumerated values. Additionally, the Executive summary section MUST include the `BREACH_SEVERITY` tier and the `breachId` for cross-reference.
- The `5. Timeline` section MUST include the four timestamps from the breach record: `detectedAt`, `recordedAt`, `pdpc.submittedAt`, `subjectNotification.completedAt`.
- The `7. Action items` section MUST include at least one control ratchet (SIEM filter / ESLint rule / Jest test / permission tightening) keyed to preventing recurrence. The ratchet ticket number MUST be cross-linked.
- The `9. Appendix` section SHOULD attach the PDF generated via `generatePdpcBreachReportPdf` (R4-B) as evidence of the PDPC submission.

The post-mortem MUST be circulated within 5 business days of the breach being marked `SUBJECTS_NOTIFIED` (or, where subject notification was operator-discretion and skipped, within 5 business days of `PDPC_NOTIFIED`).

---

## Appendix A — verification commands

The following commands are quoted verbatim from `.husky/pre-commit`. Run them before declaring an incident resolved to ensure no regression in adjacent surfaces:

- `node scripts/system-integrity-check.js` — 52 system integrity checks (audit-chain hash sanity, schema drift, secret-catalog completeness)
- `npm --prefix apps/web-app run lint:trust` — trust-domain lint (frontend tenant-isolation invariants)

These are the only commands invoked by the pre-commit gate; CI runs the heavier sweep (full Jest, ESLint, typecheck) per `.github/workflows/ci.yml`.

## Appendix B — quick-reference service surface

```
const breachService = require('./services/breach-notification-service');

// 1. After triage confirms a breach:
const { breachId, deadlines } = await breachService.recordBreach({
    summary: 'Short Thai/English description',
    affectedUserIds: ['user-uuid-1', 'user-uuid-2'],
    severity: 'HIGH',                       // BREACH_SEVERITY
    detectedAt: '2026-05-17T08:00:00.000Z',
    actorId: 'sre-on-call',
    organizationId: 'org-uuid',
    notificationPayload: {
        breachDateTH: '17 พฤษภาคม พ.ศ. 2569',
        affectedDataCategoriesTH: 'ชื่อ-นามสกุล, อีเมล',
        remedialActionsTH: 'ระงับบัญชีที่ได้รับผลกระทบและปิดช่องโหว่แล้ว',
        contactInformationTH: 'support@gacpthai.com',
    },
});

// 2. After PDPC submission returns an ack:
await breachService.markPdpcReportSubmitted(breachId, {
    submittedAt: '2026-05-18T14:00:00.000Z',
    ackNumber: 'PDPC-2026-05-18-001',
    actorId: 'dpo-1',
});

// 3. After subject notification batch completes:
await breachService.markSubjectsNotified(breachId, {
    batchSize: 2,
    completedAt: '2026-05-18T14:30:00.000Z',
    actorId: 'dpo-1',
});

// 4. Read access for post-mortem:
const record = await breachService.getBreach(breachId);
const allOpen = await breachService.listBreaches({ status: 'RECORDED' });
```

The exported public surface is exactly `{ recordBreach, markPdpcReportSubmitted, markSubjectsNotified, getBreach, listBreaches, BREACH_STATUS, BREACH_SEVERITY }`. Anything else is internal and may change without notice.
