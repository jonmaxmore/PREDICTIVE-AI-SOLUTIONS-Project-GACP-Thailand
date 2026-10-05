# DTAM Admin Team Training — 2026-05-16

**Audience**: DTAM Admin staff with elevated privileges
**Prerequisites**: ADMIN role (granted only by Director + Security sign-off), MFA enabled
**Estimated reading**: 50 minutes
**Hands-on lab**: 90 minutes in staging
**Recertification**: Annual

> Admin actions are SENSITIVE and FULLY AUDITED. Every action is permanently logged with PII-aware retention. Misuse of ADMIN role is grounds for disciplinary action.

---

## 1. ADMIN role and scope

### 1.1 Allowed actions

- User management: create, disable, role-change (no password reset: there is no account recovery, operator 2026-09-17). An admin sets a password only once, when creating the account; the staff directory cannot set the password of an existing account (operator 2026-09-26). Each staff member changes their own password at /provider/profile/security with the current password. There is no admin 2FA reset or disable either (operator 2026-09-26, "ถอดทั้งสองประตู"): 2FA recovery belongs to หมอพร้อม, and the owner turns their own 2FA off with a code from their own app.
- Force-status overrides on applications (EMERGENCY only)
- Period close approval (after Finance Controller sign-off)
- Audit log queries
- Capacity planning approvals (auditor hire, scheduler shifts)
- Suspend/restore accounts
- Configure feature flags
- Approve reschedule escalations
- View aggregated KPI dashboards

### 1.2 NOT allowed

- Editing applicant personal data (cannot tamper)
- Editing audit decisions (immutable)
- Editing financial records (use Finance role)
- Issuing certificates (auto-generated only)
- Bypassing payment requirement

### 1.3 4-eye principle

Admin actions classified HIGH-RISK require a second Admin to co-sign before execution:
- Force-status on production
- Period close finalization
- Disabling another Admin account
- Bulk operations (> 10 records)

---

## 2. User management

[FIG-01: Admin > Users > User list]

### 2.1 Create user

1. Admin > Users > New
2. Email (must be DTAM domain for staff roles)
3. Role: APPLICANT, FINANCE, AUDITOR, SCHEDULER, ADMIN
4. Region (for AUDITOR + SCHEDULER)
5. System sends invite with first-time setup link
6. User must complete MFA on first login

### 2.2 Role change

1. Admin > Users > [user] > Change Role
2. Provide written reason (≥ 50 chars)
3. Confirm 4-eye co-sign if going to ADMIN
4. System logs full diff
5. User notified by email

### 2.3 Disable user

Two flavors:
- **Soft disable** (suspended, can be restored)
- **Hard disable** (account closed, 90-day retention then anonymized per PDPA)

Use soft for: temporary leave, suspected misuse pending investigation.
Use hard for: confirmed misuse, employment ended.

### 2.4 Password reset

Self-service is preferred. Admin reset only when:
- User locked out and self-service email broken
- Suspected credential compromise (force change)

Process:
1. Verify user identity (call back to known phone)
2. Admin > Users > [user] > Reset Password
3. System generates one-time token (1h validity)
4. Send via separate channel (not email if email compromised)

---

## 3. Force-status (EMERGENCY ONLY)

[FIG-02: Force-status confirmation dialog]

> Force-status is a state-machine bypass. It directly mutates an application's status without running normal business rules. Every use is reviewed weekly by Security + Product.

### 3.1 Valid use cases

- Stuck application due to bug (e.g. payment processed, status didn't update)
- Lost audit data recovery
- Court-ordered reinstatement
- Data fix after incident

### 3.2 INVALID use cases

- Speeding up an applicant who complained loudly
- Bypassing audit fail
- Granting certificate without audit
- Personal favor

### 3.3 Process

1. Admin > Applications > [app_id] > Force Status
2. Current status displayed
3. Select target status
4. Mandatory: reason (≥ 200 chars), ticket reference, supporting evidence
5. Mandatory: 4-eye approval from second Admin
6. System creates ForceStatusAudit record (permanent, immutable)
7. Applicant notified by email with explanation

### 3.4 Weekly review

Every Monday, Security + Product review all force-status actions from prior week. Patterns of misuse → investigation.

---

## 4. Audit log queries

[FIG-03: Audit Log query interface]

### 4.1 Available queries

- All actions by user
- All actions on resource (application, payment, certificate)
- All force-status actions
- All role changes
- All login events (success + failure)
- All PII access events (GDPR/PDPA)

### 4.2 Querying for investigation

1. Admin > Audit Log > New Query
2. Filter by:
   - actor (who performed action)
   - resource (what was acted on)
   - action type
   - date range
   - IP / user-agent
3. Export CSV (PDPA: encrypted at rest)
4. Investigation log: every export logged again with reason

### 4.3 Retention

- 90 days: hot (queryable in console)
- 1 year: warm (S3, restorable in < 1h)
- 7 years: cold (archive, restorable in < 24h)
- 7 years total per Thai accounting law

### 4.4 PII safety

- Audit log fields are pseudonymized where possible
- Full PII access requires DPO approval
- Audit log itself encrypted at rest (AES-256)

---

## 5. Period close approval

[FIG-04: Period Close approval inbox]

### 5.1 When you act

After Finance submits closed period, you approve to lock.

Process:
1. Admin > Finance > Period Close > Pending
2. Review variance report
3. Confirm Finance sign-off + Controller sign-off
4. Confirm bank reconciliation status
5. Tap "Approve & Lock"
6. Period now immutable (no edits)

### 5.2 What you check

- Variance < 1,000 THB
- Bank reconciliation 100% match
- No suspended journal entries
- Both Finance + Controller signatures present

### 5.3 If issues

- Send back to Finance with notes
- DO NOT approve a non-reconciled period
- Escalate if Finance disagrees with your reject

---

## 6. Feature flags

[FIG-05: Feature flag dashboard]

### 6.1 Categories

- **Kill switches**: disable a feature globally (use with care)
- **Rollout flags**: percentage rollout for safe deploys
- **Region flags**: enable feature for specific provinces
- **User flags**: enable for specific users (testing)

### 6.2 Change process

1. Standard flag change: 1 Admin
2. Production kill switch: 2 Admin co-sign + DevOps notify
3. All changes logged with reason

---

## 7. Common scenarios

### 7.1 Applicant locked out
There is no account recovery (operator 2026-09-17). Staff cannot reset a password or restore access, and must not promise to.
1. Five wrong passwords lock the account for 15 minutes, then it unlocks by itself. Tell the applicant to wait and try again.
2. An applicant who has forgotten the password cannot get back in. Say so plainly; do not offer a workaround.
3. If the account looks compromised: escalate to Security (an admin can disable it).

### 7.2 Lost certificate
- Certificate is downloadable from applicant portal forever
- An applicant who lost portal access cannot get it back (see 7.1)
- Never re-generate certificate — original is on file

### 7.3 Staff member leaves DTAM
- HR triggers offboarding
- Admin disables account same day (hard disable after 7 days)
- Reassign open audits/schedules
- Document in offboarding log

### 7.4 Suspected data breach
- DO NOT take action alone
- Immediately call Security on-call
- Preserve logs (no deletion)
- Follow incident response runbook (`docs/operations/runbooks/`)

---

## 8. Quick reference

- Admin console URL: https://gacp.dtam.go.th/admin
- Helpdesk: admin-support@dtam.go.th, ext. 4000
- Security on-call: ext. 4900 (24/7)
- DPO: dpo@dtam.go.th
- Audit log query training: every Wednesday 14:00
