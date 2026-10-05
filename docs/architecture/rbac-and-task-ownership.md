# RBAC & Task Ownership — GACP Platform

> Canonical roles, permissions, and task ownership matrix.

## Source of Truth
`shared/canonical-rbac.js`

## Canonical Roles (6)

| Role | Value | Side | Primary Duty |
|------|-------|------|-------------|
| HEALTH | `health` | Applicant | Submit apps, upload docs, pay fees |
| DOCUMENT_REVIEWER | `document_reviewer` | Provider | Review uploaded documents |
| SCHEDULER | `scheduler` | Provider | Assign reviewers, schedule audits |
| AUDITOR | `auditor` | Provider | Conduct audits, issue decisions |
| ACCOUNT | `account` | Provider | Finance, invoices, receipts |
| ADMIN | `admin` | Provider | Full system access |

## Dual-Duty Rule
The same person may hold both `document_reviewer` and `auditor` roles.
These are separate **task modes**, not separate people.
The `sameReviewerAuditor` flag on Application tracks this.

## Permission Matrix

| Permission | health | doc_reviewer | scheduler | auditor | account | admin |
|-----------|--------|-------------|-----------|---------|---------|-------|
| application.submit | ✅ | | | | | ✅ |
| application.view.self | ✅ | | | | | ✅ |
| application.view.all | | ✅ | ✅ | ✅ | ✅ | ✅ |
| application.document.review | | ✅ | | ✅ | | ✅ |
| application.schedule | | | ✅ | | | ✅ |
| application.audit.record | | | | ✅ | | ✅ |
| application.workflow.transition | | ✅ | ✅ | ✅ | | ✅ |
| users.manage | | | | | | ✅ |
| accounting.dashboard.read | | | | | ✅ | ✅ |
| invoice.view.all | | | | | ✅ | ✅ |
| receipt.issue | | | | | ✅ | ✅ |
| report.export | | | ✅ | ✅ | ✅ | ✅ |
| audit.timeline.read | | ✅ | ✅ | ✅ | ✅ | ✅ |
| audit.submit | | | | ✅ | | ✅ |
| application.override | | | | | | ✅ |

## Legacy Aliases (compatibility only)

| Legacy Value | Canonical Role |
|-------------|---------------|
| super_admin | admin |
| reviewer, reviewer_auditor | document_reviewer |
| inspector, audit, head_auditor, approver, final_approver | auditor |
| accountant, finance | account |
| Applicant | health |

## Role Groups (for middleware)
- `ALL_PROVIDER`: All provider roles
- `ADMIN_ONLY`: admin only
- `REVIEWERS`: admin + document_reviewer + auditor
- `AUDIT_STAFF`: admin + doc_reviewer + auditor + scheduler
- `FINANCE`: admin + account
- `SCHEDULERS`: admin + scheduler
- `FULL_STAFF`: All provider roles (alias of ALL_PROVIDER)
