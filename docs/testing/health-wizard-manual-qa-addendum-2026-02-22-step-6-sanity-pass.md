# Applicant Wizard Manual QA Addendum (Step 6 Sanity Pass)

Date: 2026-02-22
Related base record: `docs/testing/Applicant-wizard-manual-qa-execution-record-2026-02-22-steps-1-5.md`
Scope: Step 6 (`เอกสารประกอบการขอใบรับรอง`) sanity pass on local-prod
Tester: QA Team (Playwright CLI manual interaction)
Session: `wizard-qa2`

## Objective

Continue manual QA after the base record (which passed through Step 5), focusing on:

- Step 6 validation behavior when required documents are incomplete
- Step 6 file upload interaction stability (single-item upload sanity check)
- Missing-doc counter and error summary correctness after upload

## Summary Result

Status: PASS (Step 6 sanity objectives met)

What passed:

- Step 5 -> Step 6 transition already stable from prior run
- Step 6 blocks `Next` with clear missing-document summary (expected behavior)
- Uploading one required Step 6 document succeeds (no crash)
- Missing required counter updates from `0/10` to `1/10`
- Remaining missing count updates from `10` to `9`

What remains:

- Step 6 -> Step 7 full progression was not executed in this round because 9 required documents were intentionally left unuploaded (out of sanity-pass scope)

## Execution Details

### A. Step 6 validation on incomplete documents

Action:
- Click `Next` on Step 6 without uploading required documents

Observed result:
- Page stays on Step 6 (expected)
- Error summary appears with missing-doc count and shortlist of missing items

Example observed message pattern:
- `กรุณาอัปโหลดเอกสารที่จำเป็นให้ครบถ้วน (0/10) | ยังขาด: ...`

### B. Single document upload sanity check

Action:
- Upload `dummy-1.pdf` to the first required document slot (`แบบ ภท.11`)

Observed result:
- File chooser opens successfully
- Upload completes without client-side exception
- UI marks item as `Uploaded`
- No `InvalidStateError` introduced by recent UI kit changes

### C. Re-validate after one upload

Action:
- Click `Next` again after uploading one required document

Observed result:
- Page still blocks progression (expected; incomplete docs remain)
- Error summary updates correctly:
  - from `(0/10)` to `(1/10)`
  - remaining count from `10` to `9`

## Evidence (Local Artifacts)

Playwright snapshots:
- `.playwright-cli/page-2026-02-22T13-24-31-833Z.yml` (Step 6 validation state, missing docs 10)
- `.playwright-cli/page-2026-02-22T13-25-01-919Z.yml` (after one upload, UI shows uploaded item)
- `.playwright-cli/page-2026-02-22T13-25-22-963Z.yml` (re-validation state, missing docs reduced to 9)

Key snapshot evidence lines:
- Missing count `ยังขาดอีก 10 รายการ` -> `ยังขาดอีก 9 รายการ`
- Validation summary `(0/10)` -> `(1/10)`
- First required item (`แบบ ภท.11`) shows `Uploaded`

## Notes / Non-Blocking Observations

1. Known master-data 404 console errors still present during wizard flow
- Same known fallback-path observation from earlier steps
- Did not block Step 6 rendering or upload interaction

2. Step 6 progression to Step 7 is intentionally deferred
- Full completion requires uploading remaining required docs
- This is a QA scope decision, not a runtime defect

## Exit Decision for This Addendum

Step 6 sanity-pass goals are complete and passed.

Recommended next action:
1. If prioritizing stability breadth: Continue manual sanity pass on Step 7+ with minimum viable inputs.
2. If prioritizing document step depth: Execute targeted QA checklist for Step 6 required/optional document categories and file-type validation (`PDF` vs `IMAGE` vs `LINK`).
