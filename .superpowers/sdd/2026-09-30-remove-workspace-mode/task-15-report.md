# Task 15 report - web: step 1 "ยื่นในนาม", chip, lists, farm-create holder

Status: DONE on branch feat/remove-workspace-mode (not pushed). Gaps listed under Concerns.

## What changed
- components/holder/ (new): holder-labels.ts (spec 3.6 strings, one place), holder-picker.tsx (`HolderPicker({entities,value,onChange,purpose})`), holder-chip.tsx (chip + two-step delete-and-restart), holder-list.tsx (filter chips, `useHolderFilter`, `HolderLine`).
- Step 1: type cards replaced by HolderPicker; APPLICANT_TYPE_OPTIONS deleted. Choosing writes `holderEntityId` and `applicantType` (the entity's own type) in one update. Sole editable entity = fact line. `?holder=<id>` preselects (only if the user may edit for it). Written to the store only after a request type is chosen (merely looking writes nothing).
- Store: `holderEntityId` added; `applicantType` stays as the derived register word (steps 2-6, engine and gate read it unchanged). Gate `step1CanProceed` unchanged: applicantType is only ever set together with holderEntityId.
- Auto-save: `buildDraftPayload` sends `entityId` at body top level when there is no applicationId; `holderEntityId` is in NOT_SENT_KEYS (never inside formData). `APPLICATION_HOLDER_REQUIRED` classified as a refusal with the spec 3.6 sentence (constant in lib/i18n/error-code-map.ts), no retry.
- Chip: `_steps/holder-chip-connected.tsx` mounted in `_steps/layout.tsx` for steps 2-6; action = `restartFromStep1` (DELETE /applications/draft/:id, then resetWizard, then /health/applications/new/step/1; on delete failure nothing changes and a message shows).
- Draft resume: application-step-page.tsx hydrates `holderEntityId` from `draft.entityId` when the server sends it (it does not yet, see Concerns).
- Lists: applications, payments, certificates, establishments get filter chips (only with more than one entity) and a "ยื่นในนาม" line per row. Payments resolves the holder through the application list it already loads. Certificates/establishments hide chips when no row carries a holder.
- C5: certificates list and [id] detail hide the QR action when `canPrintQr === false` (list thumbnail button; detail QR + scan line; public link stays). `canPrintQr` added to CertificateDetail type.
- Farm create: HolderPicker purpose=farm, `entityId` in the POST /farms body, submit blocked with no holder, `useEntityPermissions(holder)` instead of `(null)` (Task 14 hand-off).
- nav-config workspaces tile no longer says switch. Picker link goes to `/health/workspaces/new?from=application` (Task 14 hand-off; the brief's `returnTo=wizard` is superseded).

## Evidence
- evidence/remove-workspace-mode/task-15/red.txt, green.txt, screenshots/ (+INDEX.md)
- Web full suite 450 suites / 3723 tests pass (baseline 446 / 3687): no new failures. tsc 0 errors. Probes holder-read-scope, ratchet (26/53/99/0), retired-words, no-secret PASS. No waiver/cover/baseline change.
- Born-green pin (not a fix): "a save of an existing application does not name a holder again".
- Tests assert no workspace/พื้นที่ทำงาน/emoji on picker (file + farm), chip and filter chips (FORBIDDEN_COPY in components/holder/__tests__/fixtures.ts).
- Screenshots are real: Next dev server on this tree + Chromium 390x844 with the API mocked in the browser (no backend ran). Step 1 with 1 holder and with 4 memberships, chip (+confirm), farm-create holder field. All opened and read. The list pages have no screenshot (jest render tests only). The red error card inside 03*.png is step 2's body failing on the mock, not the chip.

## Concerns / not done (the backlog 2026-10-05)
1. GET /applications/draft does not return `entityId` (backend). Resuming a draft in a browser with an empty IndexedDB shows no chip. One-line backend fix.
2. GET /certificates/my omits `entityId`: no holder column or chips on certificates until the backend adds it (web ready).
3. GET /farms/my looks owner-scoped, not holder-scoped; not verified.
4. Pre-existing emoji in SummaryHeader icons on applications/certificates/establishments left as is (outside the touched surfaces).
5. Payments chip/line is page-local (holder line above each phase section); the shared TwoCardPaymentSection component was not touched (money component).

## fix round 1 — 2026-10-05
Status: DONE(probe:holder-read-scope) — evidence/remove-workspace-mode/task-15/{red,green}.txt
- GET /draft now returns entityId (applications.js, select was full-row); GET /certificates/my returns entityId (certificates.js); GET /farms/my is holder-scoped via holderReadWhere + buildFarmSelect has entityId (farm-service.js, farms.js).
- Emoji removed: establishments/certificates/applications client-views (also the lines in the diff), backend msgTitle in applications.js:999-1001; test fails on emoji in pages + sources.
- RED seen: backend 5 unit + 3 real-PG cases. PINS (green at birth, web already wired): resumed-draft chip with empty IndexedDB, cert chips, revoked-member case.
- GREEN: real PG 88/88; backend unit 841/843 suites (wizard-answers-are-writable red on baseline too; finance-paper margin passes alone, fails under load); web 451/3728, tsc clean; ratchet 26/53/99/0.
- Out of scope: backend/services/notification-service.js:110 still has an emoji title (not in diff).
