# Applicant Wizard Core Step Validation Manual Test Checklist

- Status: Ready for manual execution
- Last Updated: 2026-02-22
- Scope: `StepGeneral`, `StepFarmInfo`, `StepProductionInfo` validation behavior
- Related files:
  - `apps/web-app/src/app/health/applications/new/steps/general-step.tsx`
  - `apps/web-app/src/app/health/applications/new/steps/farm-info-step.tsx`
  - `apps/web-app/src/app/health/applications/new/steps/production-info-step.tsx`

## Purpose

Verify the core Applicant application wizard step validation behaves correctly after:

- field-level error wiring
- dead-code cleanup
- type hardening of validation handlers

This checklist is manual QA for behavior correctness, not a replacement for automated tests.

## Prerequisites

1. Use a test account that can access the Applicant wizard (`/health/applications/new/...`).
2. Start from a clean browser session or note any prefilled user profile data.
3. Confirm the app is reachable and the wizard loads normally.
4. If autosave is enabled in the environment, keep network stable unless a case explicitly asks to test offline/online behavior.

## Pass/Fail Rules

1. `PASS`: behavior matches expected result exactly (field highlight, summary error, or navigation).
2. `FAIL`: missing validation, wrong field highlighted, wrong message category, blocked navigation when data is valid, or navigation proceeds when data is invalid.
3. `BLOCKED`: environment issue prevents execution (login, API down, missing upload support).

## Common Checks (Run Once Per Step)

1. Trigger validation with empty required inputs and click `Next`.
   - Expected: page does not navigate.
   - Expected: top error summary appears and page scrolls to top.
   - Expected: relevant required fields show field-level error state.
2. Change one invalid field.
   - Expected: top error summary can remain, but the edited field error clears when corrected.
3. Fix all required fields and click `Next`.
   - Expected: no validation summary remains.
   - Expected: step navigates to the next route.
4. Click `Back`, return to the step, and confirm previously entered values persist (store-backed behavior).

## Step 2: General Applicant Info (`StepGeneral`)

### Scenario A: INDIVIDUAL required fields

1. Select `INDIVIDUAL`.
2. Leave required fields empty (`firstName`, `lastName`, `idCard`, `phone`, `address`) and do not upload ID card document.
3. Click `Next`.
   - Expected: field errors appear for required fields and `idCardDoc`.
   - Expected summary message indicates highlighted fields must be completed.

### Scenario B: INDIVIDUAL format validation

1. Enter invalid `idCard` (not 13 digits).
2. Enter invalid `phone` (too short/non-phone format).
3. Enter invalid `email` (optional but malformed).
4. Upload required ID card document.
5. Click `Next`.
   - Expected: field errors remain on `idCard`, `phone`, `email`.
   - Expected: navigation is blocked.
6. Correct only one field at a time.
   - Expected: corrected field clears its own error without clearing unrelated invalid fields.

### Scenario C: COMMUNITY required + optional contact format checks

1. Switch applicant type to `COMMUNITY`.
   - Expected: prior field errors are cleared on type switch.
2. Leave required COMMUNITY fields empty (`communityName`, `communityAddress`, `communityRegNumber`, `presidentName`, `presidentIdCard`, `presidentPhone`).
3. Skip required documents (`communityRegDoc`, `communityMeetingDoc`).
4. Click `Next`.
   - Expected: required field/document errors for COMMUNITY set only.
5. Fill required fields but enter malformed `presidentIdCard` or `presidentPhone`.
   - Expected: format-specific field errors.
6. Enter malformed optional `contactPhone` and `contactEmail`.
   - Expected: optional fields validate only when filled.

### Scenario D: JURISTIC required + format checks

1. Switch applicant type to `JURISTIC`.
   - Expected: prior field errors are cleared on type switch.
2. Leave required fields empty (`companyName`, `companyAddress`, `companyType`, `registrationNumber`, `taxId`, `directorName`, `directorIdCard`).
3. Skip required documents (`companyRegDoc`, `directorListDoc`).
4. Click `Next`.
   - Expected: required field/document errors for JURISTIC set only.
5. Fill required fields with malformed `taxId` or `directorIdCard`.
   - Expected: 13-digit format errors.
6. Enter malformed optional phones/emails (`companyPhone`, `directorPhone`, `contactPhone`, `directorEmail`, `contactEmail`).
   - Expected: format errors only on filled optional fields.

## Step 3: Farm Info (`StepFarmInfo`)

### Scenario A: Required top-level fields (field-level)

1. Leave top-level fields empty:
   - `farmName`
   - `address`
   - `province`
   - `district`
   - `subdistrict`
   - `postalCode`
   - `totalAreaSize`
   - `totalAreaUnit`
   - `landOwnership`
2. Click `Next`.
   - Expected: field-level errors appear on top-level fields.
   - Expected: `province` select shows error state.

### Scenario B: Postal code and total area format validation

1. Enter a postal code not equal to 5 digits.
2. Enter `totalAreaSize` as `0` or negative/invalid text.
3. Fill all other required top-level fields.
4. Click `Next`.
   - Expected: `postalCode` format error (`5 digits`).
   - Expected: `totalAreaSize` positive number error.

### Scenario C: Summary-level validations after top-level passes

1. Fill all top-level fields correctly.
2. Do not set farm GPS.
3. Click `Next`.
   - Expected: summary error for missing farm GPS location.
4. Add GPS but keep plots empty (or remove all plots if UI allows).
5. Click `Next`.
   - Expected: summary error requiring at least one plot.

### Scenario D: Plot row completeness and area consistency

1. Keep one plot but leave `plot.name` or `plot.areaSize` empty.
2. Click `Next`.
   - Expected: summary error requiring name/area for every plot.
3. Fill plot rows but make total plot area exceed farm area.
4. Click `Next`.
   - Expected: summary error `Total plot area exceeds farm area.`

### Scenario E: Land ownership documents

1. Fill all valid farm + plot + GPS data.
2. Leave land document uploads empty.
3. Click `Next`.
   - Expected: summary error requiring at least one land ownership document.
4. Upload one valid land document (or use `OTHER` with name + file).
5. Click `Next`.
   - Expected: validation passes and navigates to next step.

## Step 4: Production Info (`StepProductionInfo`)

### Scenario A: Required field-level validation

1. Leave `propagationType` and `irrigationType` empty.
2. Leave `plantParts` with no selection.
3. Click `Next`.
   - Expected: field errors for `propagationType`, `irrigationType`, and `plantParts`.
   - Expected: top summary error shown and navigation blocked.

### Scenario B: Optional numeric fields (format/range)

1. Fill required fields (`propagationType`, `irrigationType`, `plantParts`) correctly.
2. Enter invalid numeric values:
   - `treeCount` < 0
   - `harvestCycles` <= 0
   - `estimatedYield` < 0
3. Click `Next`.
   - Expected: field-level numeric errors.
4. Correct fields one-by-one.
   - Expected: corrected field error clears without resetting other invalid fields.

### Scenario C: Seed source row completeness (summary-level)

1. Keep at least one seed source row.
2. Leave `sourceType` empty (if UI allows) or `supplierName` empty.
3. Fill all field-level-required production fields correctly.
4. Click `Next`.
   - Expected: summary error requiring seed source type/supplier name for each row.
5. Add multiple seed source rows and leave one row incomplete.
   - Expected: navigation remains blocked until all rows satisfy minimum fields.

### Scenario D: Valid completion path

1. Fill valid `propagationType`, `irrigationType`, `plantParts`.
2. Use valid/blank optional numeric fields.
3. Ensure every seed source row has `sourceType` and `supplierName`.
4. Click `Next`.
   - Expected: no validation summary remains.
   - Expected: step navigates to next route.

## Cross-Step Regression Checks (Core Application Quality)

1. Switching applicant type in `StepGeneral` does not leave stale field errors from the previous applicant type.
2. Field error highlight and top summary remain consistent after repeated `Next` clicks.
3. Correcting data after a failed validation does not require page refresh.
4. Navigation (`Back` then `Next`) does not lose valid values already entered.
5. If autosave indicator is visible, validation errors do not cause misleading "syncing" spinner when no request is in flight (sanity check only; full autosave behavior is covered in Workstream A).

## Execution Record (Fill During Test)

- Environment:
- Build/commit SHA:
- Tester:
- Date/Time:
- Browser:
- Result (`PASS` / `FAIL` / `BLOCKED`):
- Failed scenarios (IDs):
- Notes / screenshots:
- Follow-up ticket(s):

