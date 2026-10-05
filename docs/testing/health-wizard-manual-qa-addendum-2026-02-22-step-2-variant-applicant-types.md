# Applicant Wizard Manual QA Addendum (Step 2 Variant Applicant Types)

Date: 2026-02-22
Related records:
- `docs/testing/Applicant-wizard-manual-qa-execution-record-2026-02-22-steps-1-5.md`
- `docs/testing/Applicant-wizard-manual-qa-addendum-2026-02-22-step-6-depth-and-step-7-sanity.md`
Scope:
- Step 2 (`ข้อมูลผู้ยื่นคำขอ`) targeted manual QA for applicant type variants
- Variants covered: `COMMUNITY`, `JURISTIC`
- Validation focus: required fields, format validation, clear-on-change
Tester: QA Team (Playwright CLI manual interaction)
Session: `wizard-qa2`

## Objective

Increase confidence in the project’s primary application wizard by validating type-specific behavior in the main applicant step:

- Variant-specific required fields render and validate correctly
- Type-specific document requirements are enforced in UI validation
- Format validation works for ID / phone / email fields in each variant
- Clear-on-change behavior works after switching applicant types

## Summary Result

Status: PASS (targeted Step 2 variant QA scope met)

Completed:
- COMMUNITY required validation pass
- COMMUNITY format validation (`presidentIdCard`, `presidentPhone`, optional `contactEmail`)
- COMMUNITY clear-on-change sample check (`communityName`)
- JURISTIC required validation pass
- JURISTIC format validation (`taxId`, `directorIdCard`, optional `directorPhone`, optional `contactEmail`)
- JURISTIC clear-on-change sample check (`companyName`)

## Step 1-5 Status Reconfirmation (User requested)

Verdict: **Yes — Steps 1-5 are still considered “เรียบร้อยดี” for the tested scope.**

Rationale:
- Prior base execution record passed through Step 5 with real runtime checks
- Later QA continued through Steps 6-7 without introducing regressions in Step 2 behavior
- Variant checks in this addendum strengthen confidence specifically at the highest-risk branch point (applicant type switch in Step 2)

Caveat (unchanged):
- This is still targeted manual QA, not exhaustive UAT across all edge cases / all document combinations

## COMMUNITY Variant QA (Step 2)

### A. Required field validation

Action:
- Switch applicant type to `วิสาหกิจชุมชน`
- Click `Next` on empty COMMUNITY form

Observed result:
- Top validation banner shown: `Please complete highlighted required fields.`
- Required inline errors shown for COMMUNITY-specific fields, including:
  - `ชื่อวิสาหกิจชุมชน`
  - `ที่อยู่วิสาหกิจชุมชน`
  - `เลขทะเบียนวิสาหกิจ (สกท.)`
  - `ชื่อ-นามสกุล ประธาน`
  - `เลขบัตรประชาชนประธาน`
  - `เบอร์โทรประธาน`
- Required document slots marked in validation UI:
  - `หนังสือจดทะเบียนวิสาหกิจชุมชน (สกท.)`
  - `รายงานการประชุมอนุมัติการยื่นขอ GACP`

### B. Clear-on-change sample check

Action:
- Fill `ชื่อวิสาหกิจชุมชน`

Observed result:
- `Required` error for that field clears immediately (clear-on-change works)

### C. Format validation checks

Action:
- Enter invalid values:
  - `เลขบัตรประชาชนประธาน = 123`
  - `เบอร์โทรประธาน = 123`
  - `อีเมล = bad-email` (optional contact email)
- Click `Next`

Observed result:
- `เลขบัตรประชาชนประธาน` -> `Must be 13 digits`
- `เบอร์โทรประธาน` -> `Invalid phone`
- `อีเมล` -> `Invalid email`

## JURISTIC Variant QA (Step 2)

### A. Required field validation

Action:
- Switch applicant type to `นิติบุคคล`
- Click `Next` on empty JURISTIC form

Observed result:
- Top validation banner shown: `Please complete highlighted required fields.`
- Required inline errors shown for JURISTIC-specific fields, including:
  - `ชื่อนิติบุคคล`
  - `ประเภทนิติบุคคล`
  - `ที่อยู่จดทะเบียน`
  - `เลขทะเบียนนิติบุคคล`
  - `เลขประจำตัวผู้เสียภาษี`
  - `ชื่อ-นามสกุล กรรมการ`
  - `เลขบัตรประชาชนกรรมการ`
- Required document slots marked in validation UI:
  - `หนังสือรับรองบริษัท (DBD)`
  - `รายชื่อกรรมการผู้มีอำนาจลงนาม`

### B. Clear-on-change sample check

Action:
- Fill `ชื่อนิติบุคคล`

Observed result:
- `Required` error for that field clears immediately (clear-on-change works)

### C. Format validation checks

Action:
- Enter invalid values:
  - `เลขประจำตัวผู้เสียภาษี = 123`
  - `เลขบัตรประชาชนกรรมการ = 123`
  - `เบอร์โทรกรรมการ = 123` (optional)
  - `อีเมล` (shared contact field carried from prior variant) = `bad-email`
- Click `Next`

Observed result:
- `เลขประจำตัวผู้เสียภาษี` -> `Must be 13 digits`
- `เลขบัตรประชาชนกรรมการ` -> `Must be 13 digits`
- `เบอร์โทรกรรมการ` -> `Invalid phone`
- `อีเมล` -> `Invalid email`

## Evidence (Local Artifacts)

Playwright snapshots:
- `.playwright-cli/page-2026-02-22T13-36-19-691Z.yml` (COMMUNITY form render)
- `.playwright-cli/page-2026-02-22T13-36-40-061Z.yml` (COMMUNITY required errors)
- `.playwright-cli/page-2026-02-22T13-37-43-488Z.yml` (COMMUNITY format errors)
- `.playwright-cli/page-2026-02-22T13-38-02-910Z.yml` (JURISTIC form render)
- `.playwright-cli/page-2026-02-22T13-38-21-922Z.yml` (JURISTIC required errors)
- `.playwright-cli/page-2026-02-22T13-39-14-604Z.yml` (JURISTIC format errors)

## Exit Decision for This Addendum

Step 2 applicant-type branching behavior is in good shape for the tested variants (`COMMUNITY`, `JURISTIC`) and aligns with expected validation rules.

Recommended next action:
1. Continue breadth sanity to later steps (8/9), or
2. Run deeper document/UAT scenarios per applicant type if business risk is higher on legal/document packages than on field validation.
