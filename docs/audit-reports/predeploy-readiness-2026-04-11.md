# Pre-Deploy Readiness Report - 2026-04-11

## Scope

This report summarizes the backend workflow normalization and pre-deploy readiness review performed on 2026-04-11.

Primary objective:
- converge the system onto one canonical workflow model
- reduce status drift across runtime writes, read models, notifications, tests, and seed scripts
- identify remaining structural debt that is safe to defer versus blockers that must be fixed before deploy

## What Was Fixed

### 1. Canonical workflow synchronization

Runtime write paths were aligned to keep these fields synchronized:
- `application.state`
- `application.status`
- `formData.workflowState`

Central sync logic now lives in:
- `apps/backend/services/workflow-transition-service.js`

This reduced the previous condition where different services wrote different workflow truths.

### 2. Major runtime writers migrated

Canonical workflow sync is now used in important write paths including:
- application submit
- document review approval/revision
- payment phase creation/finalization
- audit scheduling/result submission
- cron expiry handlers
- admin/provider workflow transitions
- E2E controller helpers

### 3. Canonical payment and review states

The main payment/review lifecycle now consistently uses:
- `PENDING_DOC_FEE`
- `DOC_FEE_PAID`
- `ASSIGNED_FOR_REVIEW`
- `REVISION_REQUESTED`
- `DOC_APPROVED`
- `PENDING_AUDIT_FEE`
- `AUDIT_FEE_PAID`
- `AUDIT_CONFIRMED`
- `CAR_PENDING`
- `CAR_REVIEWING`
- `AUDIT_PASSED`
- `APPROVED`
- `CERTIFIED`

### 4. Read models and projections improved

The following layers were updated to follow canonical interpretation more closely:
- `apps/backend/services/metrics-service.js`
- `apps/backend/shared/health-dashboard-stage.js`
- `apps/backend/services/pdf/application-template-service.js`
- provider dashboard/integration fixtures

Notably:
- `pendingAudit` now returns a real value instead of a hard-coded `0`
- dashboard stage projection now resolves workflow state through the workflow service rather than carrying a larger duplicate alias table

### 5. Notification compatibility layer

Notification naming was normalized without breaking old callers.

Updated files:
- `apps/backend/services/notification-service.js`
- `apps/backend/services/notification/domain-helpers.js`
- `apps/backend/services/notification/line-notify-service.js`
- `apps/backend/services/sms/sms-service.js`

Result:
- new code can use canonical names such as `REVISION_REQUESTED`
- legacy names are still mapped safely during the transition period

### 6. Tests and seed scripts modernized

Updated to reflect the canonical workflow:
- `apps/backend/__tests__/unit/payment-service.test.js`
- `apps/backend/__tests__/unit/application-service.test.js`
- `apps/backend/__tests__/integration/provider-cms-workflow.test.js`
- `apps/backend/prisma/seed-approve.js`
- `apps/backend/prisma/seed-real-fees.js`
- `apps/backend/scripts/seed-test-data.js`
- `apps/backend/scripts/verify-e2e.js`

## Verification Performed

### Tests passed

- `__tests__/unit/payment-service.test.js`
- `__tests__/unit/application-service.test.js`
- `__tests__/integration/provider-cms-workflow.test.js`

Combined verification result:
- 3 suites passed
- 37 tests passed
- 0 failures

### Lint and diff checks

Validated:
- targeted ESLint runs for newly changed workflow/notification/metrics/dashboard files
- `git diff --check`

Status:
- no blocking ESLint errors remain in the files touched during this review
- only CRLF/LF conversion warnings remain in git output

## Remaining Non-Blocking Debt

These items are not immediate deploy blockers, but they remain technical debt:

### 1. Legacy compatibility aliases are still intentionally present

Still retained in:
- `apps/backend/services/workflow-transition-service.js`
- `apps/backend/services/notification-service.js`
- `apps/backend/services/notification/line-notify-service.js`
- `apps/backend/services/sms/sms-service.js`

Reason:
- needed to safely interpret historical production data and old callers

### 2. Large route file with pre-existing warnings

File:
- `apps/backend/routes/api/applications/applications.js`

Observed:
- unused imports/variables warnings

Assessment:
- not introduced by this refactor
- not a runtime blocker
- should be cleaned in a separate route decomposition pass

### 3. Local direct require of backend services outside container

Observed behavior:
- direct Node execution of some backend modules can fail locally when `DATABASE_URL` is absent

Assessment:
- expected for this Docker-first backend
- not a functional regression from this refactor

## Deploy Readiness Assessment

### Recommendation

Status: **Ready for controlled deploy**

Rationale:
- core workflow drift issue has been materially reduced
- canonical write paths are in place
- read models and tests now better reflect the real process
- verification coverage for modified workflow paths passed

### Conditions

Recommended deployment posture:
- deploy in a controlled window
- verify health endpoint immediately after deploy
- verify one real application in each key stage if possible:
  - submitted / pending doc fee
  - assigned for review
  - revision requested
  - pending audit fee
  - audit confirmed

## Biggest Risks Still Worth Watching Post-Deploy

### 1. Historical data with unusual legacy statuses

Although alias handling remains, rare old records may still surface edge cases in dashboards or analytics.

### 2. Notification wording consistency

The notification system is now structurally safer, but some template names still reflect older business wording.

### 3. Very large route modules

Some backend route files remain oversized, which increases future regression risk even though this deploy is acceptable.

## Conclusion

This codebase is in a substantially cleaner state than it was before the audit/refactor pass.

The main abnormality before this work was not one bug but a structural problem:
- multiple workflow truths
- duplicated status vocabularies
- old and new process models coexisting in parallel

That structural issue has been reduced significantly.

The system is ready for a controlled deploy, with remaining issues categorized as manageable technical debt rather than release blockers.
