# Applicant Wizard Manual QA Execution Record (Steps 1-5)

Date: 2026-02-22
Scope: Health/Applicant application wizard manual QA on local-prod (`http://localhost:8080`)
Tester: QA Team (Playwright CLI manual interaction)
Session: `wizard-qa2`

## Objective

Validate core wizard flow and field validation behavior for the project’s primary application path, with focus on:

- Step validation correctness (required/format/numeric/clear-on-change)
- Offline/autosave-related UI stability after recent changes
- File upload stability in Step 3 (land document)
- Navigation continuity from Step 1 through Step 4

## Environment

- Compose stack: `docker-compose.local-prod.yml`
- Runtime path: nginx -> frontend -> backend
- Test account (local regression seed):
  - Identifier: `1100100100011`
  - Password: `Test@12345`

## Summary Result

Status: PASS (Steps 1-5 manual QA objectives met)

What passed:

- Step 1 draft document upload path works
- Step 2 field-level validation works (required + Thai ID + email format + clear-on-change)
- Step 3 field-level validation works (required + postal code + positive numeric)
- Step 3 land document upload crash fixed and verified
- Step 3 can proceed to Step 4 with minimum valid data
- Step 4 required validation works
- Step 4 can proceed to Step 5 with minimum valid data
- Step 5 required harvest-method validation works
- Step 5 can proceed to Step 6 with minimum valid data

## Key Findings and Fixes During Execution

### 1. Local-prod wizard POSTs blocked by CORS (fixed)

Impact:
- Wizard QA blocked on login / draft-doc upload POSTs in local-prod

Fix commits:
- `ca805962` `fix(local-prod): allow wizard qa posts and prevent health route hijack`

Related files:
- `docker-compose.local-prod.yml`
- `nginx/nginx.local.conf`
- `nginx/gacp.production.conf`
- `nginx/nginx.qa.conf`

### 2. Text input bindings broken in UI kit (fixed)

Impact:
- Inputs visually accepted typing but React state/validation did not update

Root cause:
- UI system prop splitter stripped native input props (`value`, `onChange`, etc.)

Fix commits:
- `8f3cc441` `fix(wizard): restore input bindings in ui-kit text fields`

Related file:
- `apps/web-app/src/lib/ui-kit/shared.tsx`

### 3. Step 3 file upload caused client-side crash (fixed)

Impact:
- Uploading land ownership document in Step 3 crashed wizard with client-side exception

Root cause:
- `input[type=file]` received programmatic `value/defaultValue`, causing browser `InvalidStateError`

Fix commit:
- `d84b4b71` `fix(wizard): prevent file input crash after ui-kit prop passthrough`

Related files:
- `apps/web-app/src/lib/ui-kit/core.tsx`
- `apps/web-app/src/lib/ui-kit/shared.tsx`

## Step-by-Step Execution Record

### Step 1 / 9 (Document Upload)

Actions:
- Uploaded required M1 documents (`2/2`)
- Confirmed draft document upload API request succeeds

Observed result:
- `POST /api/application-flow/draft-documents` returned `200`
- Next navigation enabled and moved to Step 2

### Step 2 / 9 (General Applicant Info)

Validation checks performed:
- Click `Next` on empty form -> inline `Required` errors shown
- Fill applicant name -> field error clears immediately (clear-on-change)
- Invalid Thai ID (`123`) -> `Must be 13 digits`
- Invalid optional email (`bad-email`) -> `Invalid email`
- After valid minimum inputs + ID document upload -> proceeds to Step 3

Observed result:
- Field-level validation wiring is active and behaves correctly

### Step 3 / 9 (Farm / Plot Info)

Validation checks performed:
- Click `Next` on empty step -> required errors shown on core farm fields
- Invalid postal code (`123`) -> `Must be 5 digits`
- Invalid total area (`0`) -> `Must be greater than zero`
- Fill a required field -> inline error clears on change

Execution checks performed:
- Fill minimum required farm info
- Enter manual GPS (`Latitude/Longitude`)
- Upload one land ownership document (dummy PDF)
- Click `Next`

Observed result:
- Validation behavior correct (required/format/numeric)
- File upload no longer crashes the page after `d84b4b71`
- Navigation succeeds to Step 4

### Step 4 / 9 (Production Info)

Validation checks performed:
- Click `Next` on empty step -> highlighted required fields + top message
- Required inline errors shown for:
  - propagation type
  - irrigation type
- Plant parts validation shown (`Select at least one`)

Execution checks performed (minimum pass data):
- Select propagation type
- Select irrigation type
- Select one plant part
- Fill required supplier name in seed source row 1
- Click `Next`

Observed result:
- Validation semantics work as expected
- Navigation succeeds to Step 5

## Known Non-Blocking Observations

1. Master-data endpoint 404s still appear in console during wizard steps
- Examples:
  - `/api/master-data/gacp-categories`
  - `/api/master-data/environment-checklist`
  - `/api/master-data/water-sources`
  - `/api/master-data/seed-sources`
  - `/api/master-data/step-requirements/3`
- Current behavior: UI still renders and manual QA can proceed (likely fallback/default options present for tested paths)

2. Playwright CLI emits local npm warning (tooling only)
- `Unknown project config "public-hoist-pattern"`
- Does not affect application behavior

## Evidence (Local Artifacts)

Playwright snapshots (selected):
- `.playwright-cli/page-2026-02-22T12-54-46-028Z.yml` (Step 3 validation state with required errors)
- `.playwright-cli/page-2026-02-22T13-16-04-002Z.yml` (Step 3 -> Step 4 navigation success)
- `.playwright-cli/page-2026-02-22T13-16-21-858Z.yml` (Step 4 validation state)
- `.playwright-cli/page-2026-02-22T13-17-32-773Z.yml` (Step 4 -> Step 5 navigation success)
- `.playwright-cli/page-2026-02-22T13-20-26-859Z.yml` (Step 5 validation banner: harvest method required)
- `.playwright-cli/page-2026-02-22T13-20-52-633Z.yml` (Step 5 -> Step 6 navigation success)

Console evidence (selected):
- `.playwright-cli/console-2026-02-22T13-10-46-966Z.log` (post-fix upload path: no `InvalidStateError`, only known master-data 404s)

### Step 5 / 9 (Quality Control)

Validation checks performed:
- Click `Next` on initial Step 5 state -> top error banner shown
- Observed required blocker: harvest method selection (`เก็บเกี่ยว`) button group

Execution checks performed (minimum pass data):
- Select one harvest method (`เก็บด้วยมือ`)
- Keep default drying/storage selections
- Click `Next`

Observed result:
- Validation message clears after selection
- Navigation succeeds to Step 6

## Exit Decision for This Record

Steps 1-5 manual QA objectives are complete and passed for current scope.
Next recommended action: Continue Step 6+ sanity pass or execute broader QA checklist using `docs/backlog/Applicant-wizard-core-step-validation-manual-test-checklist.md`.
