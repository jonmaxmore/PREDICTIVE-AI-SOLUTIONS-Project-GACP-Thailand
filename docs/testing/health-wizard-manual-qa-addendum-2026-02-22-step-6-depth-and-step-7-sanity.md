# Applicant Wizard Manual QA Addendum (Step 6 Depth + Step 7 Sanity)

Date: 2026-02-22
Related records:
- `docs/testing/Applicant-wizard-manual-qa-execution-record-2026-02-22-steps-1-5.md`
- `docs/testing/Applicant-wizard-manual-qa-addendum-2026-02-22-step-6-sanity-pass.md`
Scope:
- Step 6 depth QA (remove/re-upload + invalid file type handling)
- Step 7 sanity pass (review/final confirmation blocking behavior)
- Re-confirm status of Steps 1-5 based on executed evidence
Tester: QA Team (Playwright CLI manual interaction)
Session: `wizard-qa2`

## Summary Result

Status: PASS (for current QA scope)

Completed in this addendum:
- Step 6 remove uploaded document works
- Step 6 invalid file type rejection works (PDF-only slot rejects `.md`)
- Step 6 re-upload after rejection works
- Step 7 route renders and review page loads
- Step 7 final-confirm button blocks correctly when required data remains incomplete
- Steps 1-5 status reconfirmed as "เรียบร้อยดี" for current tested scope (with documented non-blocking caveats)

## Step 1-5 Status Reconfirmation (Requested Review)

Verdict: **Yes, Steps 1-5 are in good shape for the tested scope**.

Why this is a reasonable conclusion:
- Manual QA execution record already passed through Step 5:
  - `docs/testing/Applicant-wizard-manual-qa-execution-record-2026-02-22-steps-1-5.md`
- Real blockers found during QA (CORS, nginx health route hijack, UI kit input binding, file-input crash) were fixed and verified in runtime
- Subsequent progression reached Step 6 and Step 7 without new regressions invalidating earlier steps

What "good shape" means here:
- Core navigation works through Steps 1-5 with minimum valid inputs
- Required/format/numeric validations behave correctly in tested paths
- File upload interactions in wizard no longer crash after UI-kit fixes

Known caveats (non-blocking, documented):
- Master-data endpoint `404` errors still appear in console for some endpoints (fallback behavior still allows tested wizard paths)
- This is not a full combinatorial UAT for all applicant types/edge cases yet

## Step 6 Depth QA (Documents Step)

### A. Remove uploaded file

Precondition:
- First required document slot (`แบบ ภท.11`) already had one uploaded file

Action:
- Click `Remove uploaded file`

Observed result:
- Slot returns to `Select document file`
- Missing count returns to `10`
- No crash

### B. Invalid file type rejection (PDF-only slot)

Action:
- Upload `README.md` to PDF-only slot (`แบบ ภท.11`)

Observed result:
- Validation message shown:
  - `ไฟล์ "README.md" ไม่ตรงประเภทเอกสาร (.pdf)`
- Slot remains unuploaded (`Select document file`)
- No crash / no navigation break

### C. Re-upload valid PDF after rejection

Action:
- Upload `dummy-1.pdf` back to the same slot

Observed result:
- Item returns to `Uploaded`
- Missing count goes back to `9`
- Upload interaction remains stable

## Step 7 Sanity Pass (Review / Confirmation Step)

### A. Route access and rendering

Action:
- Navigate directly to `/health/applications/new/step/7` in authenticated session

Observed result:
- Step 7 review page renders successfully
- "ข้อมูลที่ยังไม่ครบ" section is visible
- "ไปแก้ไข" buttons are rendered

### B. Final confirmation blocking behavior

Action:
- Click `ยืนยันและไปขั้นตอนยืนยันคำขอ`

Observed result:
- Page remains on Step 7 (expected)
- Incomplete-data summary is shown (example includes missing fields/sections)
- System does not incorrectly allow final confirmation while data is incomplete

## Evidence (Local Artifacts)

Step 6 depth snapshots:
- `.playwright-cli/page-2026-02-22T13-31-09-721Z.yml` (after remove; missing count back to 10)
- `.playwright-cli/page-2026-02-22T13-31-39-772Z.yml` (invalid file type reject for `README.md`)
- `.playwright-cli/page-2026-02-22T13-32-18-120Z.yml` (re-upload success; `Uploaded`, missing count 9)

Step 7 sanity snapshots:
- `.playwright-cli/page-2026-02-22T13-32-35-107Z.yml` (Step 7 review page render)
- `.playwright-cli/page-2026-02-22T13-33-06-443Z.yml` (final-confirm blocked with incomplete-data summary)

## Exit Decision for This Addendum

1. Step 6 document interaction quality is stronger after depth checks (remove/re-upload/type reject all behaved correctly).
2. Step 7 review/final confirmation gating behaves correctly under incomplete data.
3. Steps 1-5 remain acceptable and stable for the tested scope.

Recommended next action:
- Continue breadth sanity pass to Step 8/9 **or** run targeted deep QA on applicant-type variants (INDIVIDUAL / COMMUNITY / JURISTIC) with the same checklist discipline.
