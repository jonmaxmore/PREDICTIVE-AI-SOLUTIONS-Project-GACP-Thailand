# Auditor Field-App + Scheduler Queue — UX Notes (Iter 25, 2026-05-16)

This iteration ships two DTAM-staff surfaces that close the loop
between **payment of the audit fee** and **the auditor delivering
their decision on site**:

1. **Scheduler queue** — `/provider/scheduler/queue` (DTAM scheduler).
2. **Auditor field-app** — `/provider/audits/[id]/inspect` (auditor).

Backend services consumed (parallel agents B25-A / B25-B):

- `GET  /audit/scheduling/queue` — paid applications awaiting
  assignment.
- `GET  /audit/scheduling/auditor-availability/:auditorId` — busy /
  free half-day slots for the calendar widget.
- `POST /audit/scheduling/assign` — create the auditor assignment.
- `GET  /audit/onsite/:id/context` — checklist + saved drafts.
- `POST /audit/onsite/:id/start` — GPS check-in.
- `POST /audit/onsite/:id/checklist` — upsert one checklist row.
- `POST /audit/onsite/:id/photo` — multipart photo upload.
- `POST /audit/onsite/:id/decision` — PASS / FAIL / NEEDS_REVIEW.

The thin client lives in
`apps/web-app/src/lib/services/audit-service.ts`.

## Surfaces

### Scheduler queue page

Reuses the batch-22 finance components for visual parity with the
rest of the DTAM dashboards:

- `PageToolbar` — page title + a single primary "รีเฟรช" action and a
  dropdown for secondary actions (export, etc.).
- `SummaryCard` — total pending, oldest pending days, region
  breakdown.
- `FilterBar` + `FilterField` — region select, from/to date pickers,
  status select (defaults to `AUDIT_FEE_PAID`).
- `DataTable` — application number, masked applicant, payment date,
  region, scope, age badge (`> 7d` flips to OVERDUE tone), and the
  "จัดตาราง" CTA.

Clicking "จัดตาราง" opens `<AssignAuditorModal>` (see below).

### AssignAuditorModal

`apps/web-app/src/components/audit/AssignAuditorModal.tsx`

Inputs:

- Date picker — defaults to **today + 7 business days** (skips
  Sat/Sun). The `min` attribute prevents picking a past date.
- Slot buttons — `09:00` and `13:00` (matches the backend's
  AM / PM half-day model).
- Auditor select — populated via
  `AuditService.getAuditors()`.
- Auditor calendar — 14-day grid keyed off the currently picked
  date. Busy half-days come from `getAuditorAvailability` and
  shade rose; free days are white; the picked day is solid emerald.
  Clicking a day re-picks the date.
- Location — prefilled from the application's `farmAddress`,
  editable in case the auditor needs to clarify with the
  applicant before the visit.
- Notes — free-form textarea.

Submission posts to `/audit/scheduling/assign`; on success the
modal closes, a Thai success toast fires, and the parent queue
calls its `load()` to refresh.

### Auditor field-app

`apps/web-app/src/app/provider/audits/[id]/inspect/`

A finite state machine with five visible screens that map to the
brief:

1. **Start screen** (`stage = 'start'`)
   - Big "เริ่มตรวจ" CTA (`min-height 56px`) gated on
     `navigator.geolocation.getCurrentPosition(..., {
     enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })`.
   - On success → POST `/audit/onsite/:id/start` with `{ latitude,
     longitude, accuracy, capturedAt }` → transitions to the
     checklist screen.
   - On failure → inline alert in Thai (e.g. denied permission,
     no fix in 15s).
2. **Checklist screen** (`stage = 'checklist'`)
   - Sticky progress bar (`X/N` + percentage) at the top.
   - Each criterion renders as a `<ChecklistItem>` card with:
     - 3 large radio-style buttons (`ใช่ / ไม่ใช่ / ไม่เกี่ยวข้อง`),
       each ≥ 48px tall to stay tap-friendly.
     - Notes textarea.
     - "แนบภาพ" button that triggers a hidden file input with
       `accept="image/*"` and **`capture="environment"`** — on
       iOS/Android Chrome this opens the native back-camera UI
       directly. Multi-shot via the `multiple` attribute.
   - Auto-save: every checklist mutation is added to a dirty Set;
     a 30-second interval flushes pending rows via
     `submitChecklistItem`. Best-effort — failures don't block
     the UI; the explicit "ส่งผลการตรวจ" submit also re-validates.
3. **Photo capture screen** (modal-less)
   - Rather than building a custom camera UI, we let the browser
     handle the camera. The file input is hidden (`sr-only`) and
     triggered by a dashed-outline "แนบภาพ" button on each
     checklist row. Uploaded files become chips with thumbnails.
4. **Review screen** (`stage = 'review'`)
   - Yes / No / N/A counts as colored summary cells.
   - Photo count.
   - GPS check-in coordinates with a deep-link to OpenStreetMap
     (`https://www.openstreetmap.org/?mlat=&mlon=#map=17/...`).
   - Full checklist list with the answer pill on the right.
5. **Decision screen** (`stage = 'decision'`)
   - Three large decision buttons: `ผ่าน / ต้องทบทวน / ไม่ผ่าน`.
   - Summary textarea (required).
   - "ข้อค้นพบสำคัญ" critical-findings list with `+ เพิ่มรายการ` /
     `×` controls.
   - Submit → POST `/audit/onsite/:id/decision` → success screen.

After the decision is submitted the user lands on
`stage = 'done'` — a confirmation card reading "ส่งผลการตรวจ
เรียบร้อย — ระบบจะแจ้งผู้สมัครอัตโนมัติ" with a deep-link back to
the audits list.

## Mobile breakpoint behavior

- The field-app uses a single-column layout up to the `md` (768px)
  breakpoint and never exceeds `max-w-3xl` on tablet / desktop so
  one-handed phone use stays the dominant case.
- All interactive controls (radio buttons, file picker button, slot
  picker, decision buttons) have explicit `min-h-[44px..56px]`
  classes — the lower bound matches the Apple HIG touch-target
  recommendation.
- The sticky progress bar uses `backdrop-blur` so long checklists
  stay scannable without losing context.
- The decision-screen action row stacks `flex-col-reverse` on
  mobile to keep the destructive "back" action below the primary
  submit (avoids accidental misfires).
- The scheduler queue's `DataTable` already uses `mobileHidden`
  flags on the lower-priority columns (payment date, region,
  scope) so the mobile view collapses to: app number → applicant →
  age → action.

## GPS + camera API usage

- **GPS** — `navigator.geolocation.getCurrentPosition` with
  `enableHighAccuracy: true`, `timeout: 15000`, `maximumAge: 0`.
  We post `{ latitude, longitude, accuracy, capturedAt }` to the
  start endpoint and reuse the same fix as the `gps` metadata
  attached to each subsequent photo upload (lets the audit trail
  prove the photos were taken in the same trip).
- **Camera** — `<input type="file" accept="image/*"
  capture="environment" multiple>`. We deliberately use the
  browser-native capture intent rather than a custom WebRTC
  pipeline:
  1. Lower battery / CPU cost on the auditor's tablet.
  2. No permission re-prompting beyond what the OS already shows.
  3. iOS Safari supports `capture="environment"` since iOS 14 and
     Android Chrome since v59 — both squarely in the supported
     band.
- **Network upload** — `multipart/form-data` via `FormData`. The
  shared `apiClient` deletes the JSON `Content-Type` header when
  the body is `FormData` so the browser sets the multipart
  boundary automatically.

## Offline mode

Not in scope for Iter 25 — the auditor field-app currently assumes
a working network connection. The 30-second auto-save batches
checklist rows but does not buffer them through IndexedDB. A
follow-up iteration should:

1. Wrap the `AuditService.submitChecklistItem` / `uploadPhoto`
   calls in an outbox-style queue persisted to IndexedDB
   (`idb-keyval` is already a dependency).
2. Replay the queue when `navigator.onLine` transitions to `true`.
3. Surface a "ออฟไลน์ — บันทึกแบบร่าง" banner so the auditor knows
   their photos haven't yet uploaded.

This is deferred to keep the surface honest; doing it badly would
silently lose evidence which is worse than not doing it at all.

## File map (Iter 25)

| File                                                                          | Purpose                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------- |
| `apps/web-app/src/lib/services/audit-service.ts`                              | API client for B25-A / B25-B endpoints   |
| `apps/web-app/src/components/audit/AssignAuditorModal.tsx`                    | Scheduler assignment dialog              |
| `apps/web-app/src/components/audit/ChecklistItem.tsx`                         | Field-app criterion card                 |
| `apps/web-app/src/components/audit/__tests__/AssignAuditorModal.test.tsx`     | Modal prop + open/close smoke test       |
| `apps/web-app/src/components/audit/__tests__/ChecklistItem.test.tsx`          | Checklist card smoke test                |
| `apps/web-app/src/app/provider/scheduler/queue/page.tsx`                      | Scheduler queue route (server wrapper)   |
| `apps/web-app/src/app/provider/scheduler/queue/client-view.tsx`               | Scheduler queue client island            |
| `apps/web-app/src/app/provider/audits/[id]/inspect/page.tsx`                  | Field-app route (server wrapper)         |
| `apps/web-app/src/app/provider/audits/[id]/inspect/client-view.tsx`           | Field-app state machine + screens        |
