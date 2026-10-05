# Applicant Wizard Manual QA Addendum (2026-02-22): Step 8-10 Breadth Sanity

## Scope
- Environment: `local-prod` via `http://localhost:8080`
- Session: Playwright CLI (`wizard-qa2`)
- Objective:
  - Continue breadth sanity pass beyond previously verified `Step 1-7`
  - Verify gating/navigation on later wizard pages currently reached in the QA state

## Context / Dynamic Step Mapping Note
Wizard step routing is state-driven. In the tested QA session state:
- `/step/8` rendered **Invoice (Phase 1)** page
- `/step/9` rendered **Quote Acceptance** page
- `/step/10` rendered **Invoice (Phase 1)** page after quote confirmation

This addendum records observed runtime behavior as rendered by the current step map/state, not assumptions from static default step labels.

## Results Summary
- `Step 8` render + gate sanity: **PASS (expected guard)**
- `Step 9` quote gating (block before checks, proceed after checks): **PASS**
- `Step 10` render + gate sanity: **PASS (expected guard)**
- No new client-side crash/exception observed during this pass

## Step 8 (Invoice page) – Sanity
### What was checked
- Page renders correctly (`ใบแจ้งหนี้งวดที่ 1`)
- Two invoice acknowledgement checkboxes are interactive
- Next button remains disabled when `applicationId` is missing

### Observed behavior
- Application reference field displayed `-` (missing `applicationId` in current store state)
- After checking both invoice acknowledgement checkboxes, `ไปหน้าชำระเงิน` button remained disabled
- This matches component guard (`canProceed = acceptedStateInvoice && acceptedPlatformInvoice && Boolean(applicationId)`)

### Evidence
- Snapshot (render/gate): `.playwright-cli/page-2026-02-22T13-47-43-172Z.yml`
- Snapshot (after both checks still disabled): `.playwright-cli/page-2026-02-22T13-48-25-693Z.yml`

## Step 9 (Quote Acceptance page) – Breadth Sanity
### What was checked
- Block on `Next` when quote acceptance checkboxes are not checked
- Error message displays correctly
- After checking both quote acceptance checkboxes, `Next` proceeds to next step

### Observed behavior
- Clicking `ยืนยันใบเสนอราคาและไปใบแจ้งหนี้` before checks produced expected error:
  - `กรุณารับทราบใบเสนอราคาทั้ง 2 ฉบับก่อนดำเนินการต่อ`
- After checking both quote acknowledgement checkboxes, next button became actionable and navigated to `/health/applications/new/step/10`
- No crash observed during transition

### Evidence
- Snapshot (step 9 render): `.playwright-cli/page-2026-02-22T13-46-50-976Z.yml`
- Snapshot (error after premature next): `.playwright-cli/page-2026-02-22T13-47-06-624Z.yml`
- Snapshot (both quote checks checked, next enabled): `.playwright-cli/page-2026-02-22T13-47-28-499Z.yml`
- Snapshot (navigated to step 10): `.playwright-cli/page-2026-02-22T13-47-43-172Z.yml`

## Step 10 (Invoice page after quote confirmation) – Sanity
### What was checked
- Page renders without crash after step 9 transition
- Invoice acknowledgement checkboxes remain interactive
- Payment navigation stays disabled when `applicationId` is still absent

### Observed behavior
- Page rendered same invoice layout as expected (`ใบแจ้งหนี้งวดที่ 1`)
- `applicationId` reference still shown as `-`
- After checking both invoice acknowledgement checkboxes, `ไปหน้าชำระเงิน` remained disabled (expected by guard)

### Evidence
- Snapshot (after both checks, button disabled): `.playwright-cli/page-2026-02-22T13-48-25-693Z.yml`

## Relation to Previous QA Records (Step 1-7)
Earlier QA records remain valid and unchanged by this pass:
- `docs/testing/Applicant-wizard-manual-qa-execution-record-2026-02-22-steps-1-5.md`
- `docs/testing/Applicant-wizard-manual-qa-addendum-2026-02-22-step-6-sanity-pass.md`
- `docs/testing/Applicant-wizard-manual-qa-addendum-2026-02-22-step-6-depth-and-step-7-sanity.md`
- `docs/testing/Applicant-wizard-manual-qa-addendum-2026-02-22-step-2-variant-applicant-types.md`

## Known Non-Blocking Observations
- Some master-data endpoints still return `404` in browser console during wizard navigation, but tested flows continue to render and validate correctly (existing known fallback behavior)

## Recommended Next QA Slice
- Execute a positive-path test with a store state/application state that includes a valid `applicationId`, so `Step 10` payment-open behavior can be validated end-to-end (`/payments/phase1/:applicationId` -> redirect/fallback route)
