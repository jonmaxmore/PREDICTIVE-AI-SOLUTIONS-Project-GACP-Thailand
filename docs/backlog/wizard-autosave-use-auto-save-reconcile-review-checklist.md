# `use-auto-save.ts` Reconciliation Review Checklist (Workstream A / Slice A2)

- Status: Ready for merge/reconcile review
- Last Updated: 2026-02-22
- Scope: `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts`
- Baseline patch to preserve: `421698f2` (`fix(wizard): align draft autosave id contract and cleanup route`)
- Related docs:
  - `docs/backlog/Applicant-wizard-offline-sync-workstream-a-review-first-mapping.md`
  - `docs/backlog/Applicant-wizard-core-step-validation-manual-test-checklist.md`

> Historical update (2026-04-21): The A2 contract fix described here is already present in the canonical `new-legacy` autosave path used in the cleanup-first branch. Keep this checklist as a reconciliation aid for older dirty branches only; do not track it as an open implementation task by default.
> Historical update (2026-04-21, follow-up): Canonical `new-legacy` autosave also no longer increments a client-only `syncVersion` after save success and now posts the canonical 1-based `step` field. Treat version-increment review items below as older-branch reconciliation concerns, not active cleanup-first work.

## Purpose

This checklist is for reconciling the dirty local `use-auto-save.ts` (parallel autosave/offline work) with the already-pushed Slice A2 contract fix in `421698f2`, without accidentally reverting either side.

Use this when the file owner (or reviewer) is ready to merge local autosave/offline changes with the canonical `main` behavior.

## Current Reconciliation Status (Reviewed)

### Backend files (A2 patch status)

These are effectively reconciled in local workspace already (no action needed for A2 behavior):

- `apps/backend/routes/api/applications.js`
- `apps/backend/services/application-service.js`

Notes:

- `applications.js` matches `421698f2` behavior for `draftId` alias + `DELETE /draft/:id`
- `application-service.js` differs from `421698f2` only by whitespace (no behavior drift)

### Frontend file (still divergent)

- `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts`

This file still contains parallel autosave/offline state changes (e.g. `setSyncStatus(...)`) and therefore must be reconciled carefully.

## Non-Negotiable Behavior to Preserve from Slice A2 (`421698f2`)

These items must remain after reconciliation:

1. Autosave success stores draft ID from either `draftId` **or** legacy `_id`
   - current local anchors:
     - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:103`
     - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:104`
     - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:105`
2. `clearDraft()` still calls backend draft cleanup route when `draftId` is present
   - `DELETE /applications/draft/${draftId}` path must remain
3. Local reset after `clearDraft()` still clears autosave local state (`draftId`, errors, timestamps)
4. No schema/version contract is implied in backend draft API (A2 did **not** add optimistic locking)

## Parallel Autosave/Offline Changes to Review (Do Not Blindly Overwrite)

The local dirty file includes parallel state semantics changes and store sync updates. These are not part of A2 and must be reviewed separately:

- `setSyncStatus(...)` usage (store-level sync status updates)
  - local anchors:
    - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:43`
    - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:61`
    - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:93`
    - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:112`
    - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:120`
    - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:138`
    - `apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts:168`
- client-side sync version increment (`nextVersion`) after success
- differences from Slice A1 semantics (`classifyAutoSaveFailure`, `errorKind`, `syncState`) if they were removed/replaced locally

## Review-First Reconciliation Procedure (Recommended)

1. Freeze the target merge base
- Confirm `main` includes `421698f2` (or newer commit containing the same A2 changes).
- Do **not** start from an unknown local snapshot.

2. Compare local dirty file vs A2 baseline
- Review diff specifically against `421698f2`:
  - `git diff --unified=0 421698f2 -- apps/web-app/src/app/health/applications/new/hooks/use-auto-save.ts`
- Classify each diff hunk as one of:
  - `A2 contract fix` (must keep)
  - `parallel autosave/offline work` (review/keep selectively)
  - `noise/formatting`

3. Verify A2 draft ID fallback is still present (mandatory)
- Confirm autosave success path reads:
  - `response.data.draftId` OR `response.data._id`
- If missing, restore this first before touching any sync semantics.

4. Verify backend cleanup route path remains wired (mandatory)
- Confirm `clearDraft()` still calls:
  - `api.delete(`/applications/draft/${autoSaveState.draftId}`)`
- Do not rename path unless backend route contract changes again.

5. Reconcile sync-state semantics explicitly (not implicitly)
- If local branch uses `setSyncStatus('PENDING')` for both dirty and in-flight save:
  - verify UI indicator does not mislabel debounce wait as active sync spinner
- If local branch removed `classifyAutoSaveFailure(...)`:
  - verify offline/network/auth/server failures remain distinguishable in UI (or document intentional downgrade)
- If local branch increments sync version locally:
  - ensure UI/docs do not imply server-side optimistic locking for `/api/applications/draft`

6. Re-test `clearDraft()` behavior manually after merge
- Save a draft (ensure `draftId` is captured)
- Trigger `clearDraft()`
- Verify local state resets
- Verify backend draft cleanup endpoint is called successfully (network tab / logs)

## Merge Safety Rules (Important)

1. Do not `checkout --theirs` / `--ours` the whole file
- This file contains overlapping concerns (A1 semantics + A2 contract fix + local parallel changes)
- Whole-file overwrite is likely to reintroduce a hidden regression

2. Merge in this order
- First preserve A2 contract fix (`draftId/_id` fallback + cleanup route path)
- Then reconcile sync semantics (`setSyncStatus`, error classification, offline retry behavior)
- Then run validation

3. Keep backend and frontend contracts aligned
- Frontend accepts both `draftId` and `_id`
- Backend currently returns both (`draftId` alias and `_id`)
- Do not remove alias support without coordinated backend/frontend patch

## Reviewer Checklist (PASS/FAIL)

### Contract correctness

- [ ] Autosave success stores `draftId` from `draftId || _id`
- [ ] `clearDraft()` calls `DELETE /applications/draft/:id`
- [ ] `clearDraft()` resets local autosave state (`draftId`, error, lastSavedAt, dirty flags)
- [ ] No new draft API field/version assumptions introduced without backend support

### Sync semantics consistency (parallel changes)

- [ ] Local dirty/debounce state is not falsely shown as active syncing (or documented if intentionally changed)
- [ ] Offline/network failures are not mislabeled as generic success/pending
- [ ] Auth/server failures are distinguishable from offline failures (or documented if intentionally simplified)
- [ ] Sync version increments (if present) are clearly client-local semantics only

### Regression checks

- [ ] Autosave success still marks state saved and updates timestamp
- [ ] Autosave failure still preserves dirty state for retry
- [ ] Online recovery listener (if present) does not spam repeated saves
- [ ] `saveNow()` still bypasses debounce safely

## Targeted Validation After Reconcile

Run at minimum (targeted, no full gate required for this file-only merge review):

1. Frontend lint (target file)
```powershell
pnpm --dir apps/web-app exec eslint src/app/health/applications/new/hooks/use-auto-save.ts
```

2. Manual smoke (browser)
- edit wizard fields -> autosave request fires
- success path captures `draftId`
- clear/reset action triggers `DELETE /applications/draft/:id`
- re-open wizard and confirm stale draft behavior matches expectation

3. Optional focused regression (recommended if touching indicator semantics too)
```powershell
pnpm --dir apps/web-app exec jest \
  src/app/health/applications/new/hooks/auto-save-status.test.ts \
  src/components/application-flow/auto-save-indicator.test.tsx --runInBand
```

## Escalation / When to Stop and Split Work

Stop and split into a separate ticket if any of these appear during reconcile:

1. Need backend schema/versioning to support `syncVersion` semantics
2. Need changes across `use-wizard-store.ts`, `layout.tsx`, and `auto-save-indicator.tsx` to preserve correctness
3. Unclear ownership of the dirty autosave file (active parallel work still moving)

If triggered, convert to a tracked `Workstream A` slice with explicit acceptance criteria before merging.
