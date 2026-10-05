# Max Lines Feasibility Analysis (2026-03-02)

- Generated: 2026-03-02 07:12:42
- Source: `node scripts/check-max-lines.js --mode=all --warn=400 --max=500`

## Summary

- Total files over 500 lines: **62**
- Refactor-now candidates: **54**
- Exempt/defer candidates: **8**
- Changed in current working tree (conflict risk): **10**
- Unchanged (safer to start): **52**

## Action Buckets

| Action | Count |
|---|---:|
| defer-test-refactor | 3 |
| exempt-asset-registry | 1 |
| exempt-generated | 1 |
| exempt-or-generate-from-schema | 1 |
| exempt-or-restructure-data | 2 |
| refactor-now | 54 |

## Changed Files (High Conflict Risk)

| Lines | Path | Action |
|---:|---|---|
| 954 | `apps/web-app/src/app/health/applications/new/steps/farm-info-step.tsx` | refactor-now |
| 883 | `apps/web-app/src/app/health/applications/new/steps/general-step.tsx` | refactor-now |
| 829 | `apps/web-app/src/app/health/applications/new/steps/production-info-step.tsx` | refactor-now |
| 804 | `apps/web-app/src/app/health/applications/new/steps/plant-selection-step.tsx` | refactor-now |
| 773 | `apps/web-app/src/app/health/applications/new/hooks/use-wizard-store.ts` | refactor-now |
| 743 | `apps/backend/routes/api/provider/handlers/workflow.js` | refactor-now |
| 699 | `apps/web-app/src/app/health/applications/new/steps/documents-step.tsx` | refactor-now |
| 552 | `scripts/validate-health-planting-flow.js` | refactor-now |
| 538 | `apps/web-app/src/app/health/applications/[id]/page.tsx` | refactor-now |
| 514 | `apps/web-app/src/app/health/applications/[id]/preview/page.tsx` | refactor-now |

## Top 25 Unchanged Refactor-Now Files

| Lines | Path | Domain |
|---:|---|---|
| 2313 | `apps/web-app/src/app/health/planting/[id]/page.tsx` | web |
| 1189 | `apps/backend/services/application-service.js` | backend |
| 992 | `apps/backend/services/fraud-detection-service.js` | backend |
| 967 | `apps/backend/services/payment-service.js` | backend |
| 927 | `apps/backend/routes/api/preview.js` | backend |
| 904 | `apps/backend/routes/api/planting-cycles.js` | backend |
| 871 | `apps/backend/services/planting-cycle-service.js` | backend |
| 831 | `apps/backend/routes/api/trace.js` | backend |
| 802 | `apps/backend/routes/api/provider/handlers/scheduler.js` | backend |
| 801 | `apps/backend/controllers/auth-controller.js` | backend |
| 799 | `apps/backend/data/journey-config.js` | backend |
| 783 | `apps/web-app/src/app/provider/audits/[id]/page.tsx` | web |
| 761 | `apps/web-app/src/lib/services/auth-service.ts` | web |
| 746 | `apps/web-app/src/app/health/planting/new/page.tsx` | web |
| 734 | `apps/backend/routes/api/analytics.js` | backend |
| 731 | `apps/backend/services/traceability-service.js` | backend |
| 715 | `apps/web-app/src/app/health/applications/preview/page.tsx` | web |
| 714 | `apps/backend/controllers/field-audit-controller.js` | backend |
| 705 | `apps/web-app/src/app/health/applications/new/steps/review-step-helpers.ts` | web |
| 701 | `apps/web-app/src/app/provider/applications/[id]/page.tsx` | web |
| 696 | `apps/backend/routes/api/plant-units.js` | backend |
| 693 | `apps/backend/routes/api/lab-integration.js` | backend |
| 640 | `apps/backend/services/planting-service.js` | backend |
| 637 | `apps/backend/routes/api/config.js` | backend |
| 636 | `apps/backend/routes/api/provider/handlers/auditor.js` | backend |

## Exempt/Defer Candidates (Rationale Needed)

| Lines | Path | Action |
|---:|---|---|
| 906 | `apps/web-app/src/components/ui/icons.tsx` | exempt-asset-registry |
| 902 | `apps/web-app/src/lib/i18n/dictionaries/en.ts` | exempt-or-restructure-data |
| 901 | `apps/web-app/src/lib/i18n/dictionaries/th.ts` | exempt-or-restructure-data |
| 871 | `apps/web-app/src/lib/i18n/types.ts` | exempt-or-generate-from-schema |
| 825 | `apps/backend/__tests__/integration/planting-plot-trace.test.js` | defer-test-refactor |
| 524 | `apps/web-app/src/types/database.ts` | exempt-generated |
| 524 | `apps/backend/__tests__/crypto-service.test.js` | defer-test-refactor |

## Status as of 2026-05-04

Re-ran `node scripts/ci/check-max-lines.js --mode=all --warn=400 --max=500`:

- **FAIL (>500 lines): 24 files** (down from 62, -38)
- **WARN (400-500 lines): 97 files**

### FAIL by area

| Area | Count |
|---|---:|
| `apps/backend` | 12 |
| `apps/web-app` | 6 |
| `scripts/test` | 5 |
| `scripts/tools` | 1 |

### Current FAIL list (>500)

| Lines | Path |
|---:|---|
| 1245 | `apps/backend/services/entity-service.js` |
| 716 | `apps/backend/routes/api/entities/index.js` |
| 671 | `apps/backend/routes/api/applications/applications.js` |
| 661 | `apps/web-app/src/app/provider/accounting/page.tsx` |
| 655 | `scripts/test/e2e-smoke-test.js` |
| 640 | `apps/web-app/src/app/provider/management/page.tsx` |
| 617 | `apps/backend/routes/api/audit/audits.js` |
| 603 | `apps/web-app/src/app/health/applications/new/_steps/steps/farm-info-step.tsx` |
| 596 | `scripts/test/agent-workflow.js` |
| 594 | `apps/backend/routes/api/system/provider.js` |
| 591 | `apps/backend/services/payment-slip-service.js` |
| 581 | `apps/web-app/src/app/provider/settings/work-config/client-view.tsx` |
| 577 | `scripts/test/agent-ux-audit.js` |
| 573 | `scripts/test/agent-ux-page-score.js` |
| 573 | `apps/backend/services/qrcode/qrcode-service.js` |
| 554 | `apps/backend/routes/api/documents/report-submissions.js` |
| 549 | `apps/backend/routes/api/trace/lots.js` |
| 545 | `apps/backend/__tests__/unit/entities-management-routes.test.js` |
| 543 | `apps/backend/services/planting-cycle-service.js` |
| 541 | `scripts/tools/system-audit.js` |
| 508 | `apps/web-app/src/app/provider/applications/[id]/page.tsx` |
| 507 | `apps/web-app/src/app/provider/audits/[id]/page.tsx` |
| 507 | `scripts/test/regression-test-helpers.js` |
| 503 | `apps/backend/constants/document-slots.js` |

### Notes

- The 2026-03-02 wizard files (`farm-info-step.tsx` 954, `general-step.tsx` 883, `production-info-step.tsx` 829, `plant-selection-step.tsx` 804, `use-wizard-store.ts` 773, `documents-step.tsx` 699, `applications/[id]/page.tsx` 538, `applications/[id]/preview/page.tsx` 514) have either been refactored under threshold or restructured (the wizard now lives under `_steps/steps/`). Only `farm-info-step.tsx` (now 603) remains over.
- The 2026-03-02 backend P0s (`application-service.js` 1189, `fraud-detection-service.js` 992, `payment-service.js` 967, `preview.js` 927, `planting-cycles.js` 904, `planting-cycle-service.js` 871, `trace.js` 831, `provider/handlers/scheduler.js` 802, `auth-controller.js` 801, `journey-config.js` 799) appear to have been refactored under threshold; only `planting-cycle-service.js` (now 543) remains in the FAIL list, plus newer items not in the 2026-03-02 snapshot (`entity-service.js` 1245, `entities/index.js` 716, `applications/applications.js` 671, etc.).
- Largest current outlier: `apps/backend/services/entity-service.js` at **1245 lines** — candidate for next refactor slice when scope is approved.

This file is left as the dated 2026-03-02 baseline snapshot for history.
