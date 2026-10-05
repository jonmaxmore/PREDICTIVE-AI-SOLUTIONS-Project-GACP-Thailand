# Workstream A Review-First Mapping: HEALTH_USER Wizard Reliability / Offline Sync

- Status: Slice A1 implemented; Slice A2 contract lock-down complete; Slice A3 autosave semantics implemented
- Last Updated: 2026-04-21
- Phase: `Core Product Improvements` (post-stabilization)
- Scope: HEALTH_USER wizard autosave, offline state UX, draft save flow (`/api/applications/draft`)

## 2026-04-21 Implementation Update

- Slice A1 autosave/offline UX semantics are implemented in `new-legacy` wizard code.
- `POST /api/applications/draft` and `GET /api/applications/draft` now return both canonical `draftId` and backward-compatible `_id`.
- `DELETE /api/applications/draft/:id` exists and soft-deletes health-owned drafts through `applicationService.deleteDraft(...)`.
- Slice A2 is complete as a contract lock-down pass with backend draft route regression coverage.
- Slice A3 reconciles frontend autosave semantics: no client-only draft sync version increments, saves include the canonical 1-based `step`, and thrown online save failures remain server errors instead of offline retry.

## Purpose

Create a shared mental model of the wizard autosave/offline path before changing code.
This document captures:

- request/auth/DB flow
- related dirty-file impact assessment
- initial findings (what does not make sense)
- recommended first implementation slice and acceptance criteria

## 1. Mental Model (Request / Auth / DB Flow)

### Frontend state and local persistence

1. Wizard form state lives in Zustand (`useWizardStore` / `useApplicationFlowStore`)
   - `apps/web-app/src/app/health/applications/new/hooks/use-wizard-store.ts`
   - `apps/web-app/src/app/health/applications/new/hooks/use-application-flow-store.ts`
2. Zustand persist uses IndexedDB via `idb-keyval` (not localStorage)
   - `apps/web-app/src/lib/indexeddb-storage.ts`
3. `useAutoSave()` watches wizard state, computes a hash, and debounces save requests
   - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts`
4. Layout renders autosave status badge
   - `apps/web-app/src/app/health/applications/new/layout.tsx`
   - `apps/web-app/src/components/application-flow/auto-save-indicator.tsx`

### Request path (frontend -> API)

1. `useAutoSave()` sends `POST /applications/draft` through centralized `apiClient`
2. `apiClient` auto-prefixes to `/api/applications/draft`, sends cookies (`credentials: include`), and adds CSRF header for non-GET when available
   - `apps/web-app/src/lib/api/api-client.ts`

### Authentication flow (backend)

1. `POST /api/applications/draft` is protected by `authenticateHealth`
   - `apps/backend/routes/api/applications.js`
2. `authenticateHealth` accepts:
   - httpOnly cookie (`auth_token`) first
   - `Authorization: Bearer` fallback
   - `apps/backend/middleware/auth-middleware.js`
3. Middleware verifies JWT and attaches normalized `req.user` (including canonical role and resolved `id`)

### Database query / write flow (backend)

1. Route passes `req.user.id` + health scope options into `applicationService.saveDraft(...)`
2. `getHealthScopeOptions(req.user)` prefers `req.user.healthId` and enforces strict health scope
3. `ApplicationService.resolveHealthIdentity(...)` maps identity -> canonical `{ userId, healthId }`
4. `saveDraft(...)` checks for existing `DRAFT` application by `healthId` (`prisma.application.findFirst`)
5. Service updates existing draft or creates a new draft, storing wizard payload under `formData` (JSON)
6. `getDraft(...)` read path returns most recent draft (`orderBy createdAt desc`)

## 2. Dirty File Impact Assessment (Main Workspace)

Main workspace currently has modified files directly inside this workstream path.

### Directly related to Workstream A (autosave/offline indicator)

- `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts`
- `apps/web-app/src/app/health/applications/new/hooks/use-wizard-store.ts`
- `apps/web-app/src/app/health/applications/new/layout.tsx`
- `apps/web-app/src/components/application-flow/auto-save-indicator.tsx`
- `apps/web-app/src/components/ui/icons.tsx`

These changes appear to introduce offline sync status UX and store fields.
They are in-scope and can affect implementation decisions.

### Same feature area but likely different slice (validation UX)

- `apps/web-app/src/app/health/applications/new/steps/general-step.tsx`
- `apps/web-app/src/app/health/applications/new/steps/farm-info-step.tsx`
- `apps/web-app/src/app/health/applications/new/steps/production-info-step.tsx`

Observed changes are primarily field validation error wiring (`zod`, `fieldErrors`) and not autosave/offline behavior.

### Practical conclusion

- Workstream A implementation should **not** be started in the dirty main workspace.
- Use a clean checkout/worktree for implementation, then reconcile with the owner of the dirty wizard changes.
- Review of the dirty autosave/offline diff is still useful and was included in findings below.

## 3. Findings (Review-First)

### 1. `Resolved / Lock-down` Client autosave no longer increments a draft sync version

Current status (2026-04-21): resolved in `new-legacy` autosave; covered by Slice A3 regression tests.

Dirty diff adds client-side `syncStatus/syncVersion` and increments `syncVersion` after autosave success in:

- `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts`
- `apps/web-app/src/app/health/applications/new/hooks/use-wizard-store.ts`

But the current draft backend path (`POST /api/applications/draft`) does not expose or validate a draft version/ETag/optimistic lock for this flow.
Result: UI may imply conflict-safe syncing semantics that do not exist on the server.

### 2. `Resolved / Lock-down` Autosave errors distinguish offline, auth, and server failures

Current status (2026-04-21): resolved in `new-legacy` autosave/offline semantics; covered by Slice A1 and Slice A3 regression tests.

Dirty `AutoSaveIndicator` changes render `syncStatus === 'ERROR'` as "waiting to sync (offline)" style/wording.

This conflates at least 3 different failure classes:

- network offline / transport failure
- auth/session failure (`401`)
- backend validation or server failure (`4xx/5xx`)

That makes troubleshooting harder and can hide real server-side issues.

### 3. `Resolved / Lock-down` Dirty/debounce state is separate from active syncing

Current status (2026-04-21): resolved in `new-legacy` autosave/offline semantics; covered by Slice A1 regression tests.

Dirty diff sets `syncStatus = 'PENDING'` on local edits (`markDirty`) and also before the request is sent.
Indicator then treats `syncStatus === 'PENDING'` as "กำลังซิงค์..." (active syncing spinner).

Effect: during debounce wait or offline local-only state, UI can show an active sync spinner even when no request is in flight.

### 4. `Resolved / Lock-down` Baseline autosave response contract now returns `draftId`

Current status (2026-04-21): resolved in code; covered by Slice A2 regression tests.

Baseline `useAutoSave` reads `response.data.draftId`, but `/api/applications/draft` route returns:

- `_id`
- `applicationNumber`
- `status`

No `draftId` field is returned in the current route response.
This means `autoSaveState.draftId` can remain `null`, so `clearDraft()` backend cleanup path is ineffective.

### 5. `Resolved / Lock-down` Draft cleanup path now has a backend delete route

Current status (2026-04-21): resolved in code; covered by Slice A2 regression tests.

Baseline `clearDraft()` calls:

- `DELETE /applications/draft/${draftId}`

But `apps/backend/routes/api/applications.js` currently exposes `POST /draft` and `GET /draft` (no matching delete route found in this review).
If true in runtime path, local reset may work while backend draft cleanup never occurs.

### 6. `Low-Medium` Save/read draft query behavior is inconsistent under multiple `DRAFT` rows

- `saveDraft(...)` update path uses `findFirst({ where: { healthId, status: 'DRAFT' } })` without explicit order
- `getDraft(...)` read path uses `findFirst(... orderBy: { createdAt: 'desc' })`

If multiple `DRAFT` rows exist for a health account (data anomaly, race, legacy state), save and read may target different rows.
This is not guaranteed to happen often, but it is not a coherent contract.

## 4. Recommended First Implementation Slice (Workstream A)

### Slice A1 (Recommended)

Scope: autosave/offline indicator semantics only (frontend), without claiming backend conflict-safe sync.

Do:

- separate `DIRTY_LOCAL` vs `SYNCING` vs `OFFLINE_RETRY` vs `SAVE_ERROR`
- avoid spinner when only waiting in debounce
- show offline wording only on confirmed transport failure / offline signal
- keep backend response contract unchanged for now

Do not do (in this slice):

- introduce client-side `syncVersion` as if server supports it
- modify backend schema for draft versioning
- refactor step files unrelated to autosave/offline

### Slice A2 (Follow-up)

Scope: draft autosave API contract consistency (complete)

- align frontend expected ID field with backend response (`draftId` vs `_id`)
- either add/delete draft endpoint contract support or remove dead cleanup path
- add tests for autosave success/error classification

### Slice A3 (Follow-up)

Scope: frontend autosave semantic reconciliation (implemented)

- remove client-only draft `syncVersion` increment semantics from the `new-legacy` autosave path
- post the canonical 1-based `step` field alongside legacy `currentStep`
- classify thrown online save failures as server errors instead of offline retry

## 5. Acceptance Criteria (First Implementation Ticket)

Minimum criteria for Slice A1:

1. Local changes during debounce do not display "actively syncing" spinner unless a request is in flight
2. Offline/network failures display a distinct offline/retry state
3. Backend/server/auth failures display a non-offline error state
4. Existing autosave success behavior remains intact
5. Targeted tests or component-level assertions cover at least:
   - dirty local (debounce waiting)
   - syncing in flight
   - offline/transport failure
   - server error

## 6. Process Recommendation (Implementation Start)

Before coding:

1. confirm whether the dirty autosave/offline diff belongs to an active parallel task
2. choose one implementation path:
   - implement in clean worktree and reconcile later (preferred), or
   - coordinate and merge with the owner of the dirty wizard files first
3. write exact acceptance criteria in the ticket/PR description

This keeps Workstream A aligned with the post-stabilization rules:

- review-first
- no scope creep
- reversible commits
- no touching unrelated dirty files
