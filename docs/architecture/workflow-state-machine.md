# Workflow State Machine — GACP Platform

> Canonical reference for the 18-state GACP certification workflow.

## Source of Truth
`services/workflow-transition-service.js`

## States (18)

| # | State | Category | Description |
|---|-------|----------|-------------|
| 1 | DRAFT | Applicant | Form being filled |
| 2 | SUBMITTED | System | Form submitted, invoice pending |
| 3 | PENDING_DOC_FEE | Payment | Phase 1 invoice issued |
| 4 | DOC_FEE_PAID | Payment | Phase 1 confirmed |
| 5 | ASSIGNED_FOR_REVIEW | Review | Reviewer assigned |
| 6 | REVISION_REQUESTED | Review | Docs need revision |
| 7 | DOC_APPROVED | Review | Docs approved |
| 8 | PENDING_AUDIT_FEE | Payment | Phase 2 invoice issued |
| 9 | AUDIT_FEE_PAID | Payment | Phase 2 confirmed |
| 10 | AUDIT_CONFIRMED | Audit | Audit scheduled |
| 11 | CAR_PENDING | Audit | Corrective action issued |
| 12 | CAR_REVIEWING | Audit | CAR response submitted |
| 13 | AUDIT_PASSED | Audit | Audit passed |
| 14 | APPROVED | Decision | Final approval |
| 15 | CERTIFIED | Terminal | Certificate issued |
| 16 | REJECTED | Terminal | Application rejected |
| 17 | EXPIRED | Terminal | Deadline expired |
| 18 | CANCEL_EXPIRED | Terminal | Revision deadline expired |

## Transition Table

```
DRAFT → SUBMITTED
SUBMITTED → PENDING_DOC_FEE
PENDING_DOC_FEE → DOC_FEE_PAID
DOC_FEE_PAID → ASSIGNED_FOR_REVIEW
ASSIGNED_FOR_REVIEW → DOC_APPROVED | REVISION_REQUESTED
REVISION_REQUESTED → ASSIGNED_FOR_REVIEW | EXPIRED
DOC_APPROVED → PENDING_AUDIT_FEE
PENDING_AUDIT_FEE → AUDIT_FEE_PAID
AUDIT_FEE_PAID → AUDIT_CONFIRMED
AUDIT_CONFIRMED → AUDIT_PASSED | CAR_PENDING | REJECTED
CAR_PENDING → CAR_REVIEWING
CAR_REVIEWING → AUDIT_PASSED | CAR_PENDING
AUDIT_PASSED → APPROVED
APPROVED → CERTIFIED
```

## Role Ownership

| Transition | Owner |
|-----------|-------|
| DRAFT → SUBMITTED | health |
| REVISION_REQUESTED → ASSIGNED_FOR_REVIEW | health |
| CAR_PENDING → CAR_REVIEWING | health |
| ASSIGNED_FOR_REVIEW → DOC_APPROVED | document_reviewer, auditor |
| ASSIGNED_FOR_REVIEW → REVISION_REQUESTED | document_reviewer, auditor |
| DOC_FEE_PAID → ASSIGNED_FOR_REVIEW | scheduler |
| AUDIT_FEE_PAID → AUDIT_CONFIRMED | scheduler |
| AUDIT_CONFIRMED → AUDIT_PASSED | auditor |
| AUDIT_CONFIRMED → CAR_PENDING | auditor |
| AUDIT_CONFIRMED → REJECTED | auditor |
| CAR_REVIEWING → AUDIT_PASSED | auditor |
| AUDIT_PASSED → APPROVED | auditor |
| APPROVED → CERTIFIED | admin |
| Payment transitions | system/webhook |

## Mandatory Comment Required
- REVISION_REQUESTED
- CAR_PENDING
- REJECTED

## Editable States (applicant can modify form)
- DRAFT
- REVISION_REQUESTED
- CAR_PENDING
