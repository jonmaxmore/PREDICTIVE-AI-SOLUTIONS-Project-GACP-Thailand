# Release Notes — Wave A Hygiene & Security Sweep (2026-04-30 / 2026-05-01)

**Status**: Live in production — **Wave A complete**
**Production HEAD**: `286d8b10` (was `a269ae9` at session start)
**Droplet**: `203.0.113.20`
**Image tag**: `ghcr.io/jonmaxmore/gacp-{backend,frontend}:deploy-production-latest`
**Reference**: `docs/audit/2026-04-30-workflow-gap-analysis.md`

> **Update 2026-05-01 (final)**: Phases 40-50 finalized Wave A — REV-11 read migration,
> G3 consumer migrations (audits-reassign + cron payment expiration), G1 backfill
> script + execution, G1 status doc + reader playbook. **37 PRs total**, all 5 Wave A
> gaps closed at the level of "writers + foundations live; per-consumer reader
> migration tracked separately per the audit doc's multi-week estimate."

## What changed

37 PRs landed across two days, closing the **Hygiene & Security** wave (Wave A) of the 2026-04-30 ERP gap analysis. Five gaps moved from `open` to `actionable`:

- **G11** — Soft-delete consistency
- **G15** — Auditor / reviewer FK cleanup
- **G4**  — Per-record visibility (auditor cross-app leak)
- **G3**  — Generalised tracked-field writer (foundation only)
- **G1**  — Polymorphic Attachment model (foundation + 6 consumer migrations)

Plus one bonus PR: schema cleanup of two dead columns flagged during the G1 sweep.

## PR roll

### G11 — Soft-delete consistency (2 PRs)

| PR | Phase | Effect |
|---|---|---|
| #92 | 15 | `isDeleted` / `deletedAt` / `deletedBy` / `deleteReason` columns + `isDeleted` index on 8 lifecycle tables |
| #93 | 16 | Prisma extension auto-filters tombstones on findMany / findFirst / count / aggregate / groupBy / updateMany. `withDeletedRows()` opt-out. 15 unit tests. |

### G15 — Auditor / reviewer FK cleanup (2 PRs)

| PR | Phase | Effect |
|---|---|---|
| #94 | 17 | 4 `*ProviderId` columns on Application now have Prisma relations + DB FK constraints to `User.providerId`. Verified zero orphans pre-migration. |
| #95 | 18 | Drop 3 denormalised name columns (`auditorName`, `assignedAuditor`, `hostName`) + add User FKs on `AuditChecklist.auditorId`, `ScopeOfWork.assignedAuditorId`, `MeetingRoom.hostId`. Tables empty in prod, zero risk. |

### G4 — Per-record visibility (12 PRs incl. hot-fix)

| PR | Phase | Endpoint / surface |
|---|---|---|
| #96 | 19 | `applicationVisibilityFilter` helper + `withVisibility()` wrapper. Applied to GET `/api/provider/applications/:id`. 11 unit tests. |
| #97 | 20 | Same filter on GET `/api/provider/applications` (list endpoint). |
| **#98** | **21** | **HOTFIX**. The filter checked `*ProviderId` columns; production data lives on `auditorId` (User.id). Locked auditors out of all 8 of their assigned apps for ~10 min. Detected via post-deploy smoke test, fixed by extending the filter to check both column sets. |
| #99 | 22 | Auditor session-handler — 4 endpoints (GPS check-in / evidence upload / live-notes / get-session). |
| #100 | 23 | Activities timeline endpoint at `/api/provider/applications/:id/activities`. |
| #101 | 24 | GET `/api/audits/:id`. |
| #102 | 25 | POST `/api/audits/:id/result` (gates the cert-gen pipeline). |
| #103 | 26 | **CRITICAL** — closed missing-auth on `GET /api/post-audit/tasks/:id` + visibility on POST. The route had no auth middleware at all. |
| #104 | 27 | post-audit task PUT / upload / detail (3 endpoints). |
| #105 | 28 | Workflow-transitions handler. |
| #106 | 29 | Auditor router final-approval + reject-to-auditor. |
| #107 | 30 | `applicationsQueue` + 3 dashboard count badges. |

### G3 — Tracked-field writer (1 PR)

| PR | Phase | Effect |
|---|---|---|
| #108 | 31 | New `services/tracked-writer.js` — generic per-field tracked update with audit emission. 17 unit tests. **Foundation only**; consumer migration (phase1Status / phase2Status / auditor reassignment) deferred behind the schema-drift sort. |

### G1 — Polymorphic Attachment (7 PRs)

| PR | Phase | Effect |
|---|---|---|
| #109 | 32 | New `Attachment` Prisma model + migration (CREATE TABLE only, FK to organizations, 6 indexes) + `services/attachment-service.js` (5 functions, 14 unit tests) + tenant-scoped + soft-delete-aware. |
| #110 | 33 | Consumer #1: PaymentSlip uploads dual-write to Attachment inside the existing `prisma.$transaction`. |
| #111 | 34 | Consumer #2: ReportSubmission attachmentUrl on POST + PUT. |
| #112 | 35 | Consumer #3: Lot.labTestReportUrl on POST + PUT. |
| #113 | 36 | Consumer #4: Application.attachments slot uploads (most-trafficked file column on the system). |
| #114 | 37 | Consumer #5: PostAuditTask.documents (append-only multi-file uploads). |
| #115 | 38 | Consumer #6: AuditChecklist.sections.evidence (deeply nested JSON; table empty in prod). |

### Schema cleanup (1 PR)

| PR | Phase | Effect |
|---|---|---|
| #116 | 39 | Drop dead `pdfUrl` columns from `Certificate` and `SOPDocument` (verified 0 of 13 prod cert rows had it set; sop_documents table empty). |

## Migrations applied (in order)

```
20260430190000_add_soft_delete_to_lifecycle_tables  (#92)
20260430200000_add_application_role_fks             (#94)
20260430210000_drop_denorm_names_add_user_fks       (#95)
20260501030000_create_attachment_table              (#109)
20260501050000_drop_dead_pdfurl_columns             (#116)
```

All applied via `npx prisma migrate deploy --schema=prisma/schema` from inside `gacp-backend`. Each is idempotent (`IF NOT EXISTS` on adds, `IF EXISTS` on drops, `ON CONFLICT DO NOTHING` on seeds).

## Production verification

Smoke-tested live during the run:

- **Phase 16 (auto-filter)**: `prisma.application.count()` filtered = 38 (live), `withDeletedRows(...)` = 38 (no tombstones in DB), explicit `where.isDeleted = true` = 0. All three escape hatches behave as designed.
- **Phase 21 (hotfix)**: Auditor `19cab828…` now sees their 8 assigned applications (was 0 pre-fix). Filter accepts matches on both User.id columns and providerId columns.
- **Phase 32 (Attachment)**: End-to-end smoke — `attach()` creates row, `listForResource()` returns it, `findByHash()` finds by content hash, `detach()` flips isDeleted, post-detach list returns 0 (auto-filter respects soft-delete on the new model).

## Discoveries surfaced during the run

These were not on the gap analysis radar at session start; flagging for future work.

1. **Schema drift on Application's auditor columns**. The DB has both `auditorId` / `headAuditorUserId` / `reviewerUserId` / `schedulerUserId` (User.id keys, populated) and `auditorProviderId` / `*ProviderId` (User.providerId keys, all-null). The Phase 17 FKs landed on the empty providerId set. Phase 21 hot-fix added the User.id columns to Prisma so the visibility filter works against today's data. **G3 consumer migration is gated on resolving this drift** — picking one canonical column set, migrating writers, and dropping the unused half. Out of scope for Wave A.

2. **Two dead `pdfUrl` columns**. `Certificate.pdfUrl` had 1 frontend reader but was never written. `SOPDocument.pdfUrl` had zero readers and zero writers. Both dropped in #116.

3. **Three empty audit-feature tables**. `audit_checklists`, `scope_of_works`, `meeting_rooms` are 0-row in production. The features exist as code paths but no user has exercised them yet. Phase 18 + Phase 38 leveraged this for zero-risk migrations.

4. **Disk capacity event on droplet during Phase 33 deploy**. `/dev/vda1` filled to 100% mid-pull (905 MB free of 116 GB). Recovered 46 GB via `docker image prune -af` + `docker builder prune -af`. Now at 22% used. **Recommend setting up a disk alert at 80% — currently no monitoring in place.** Tracked as operations follow-up.

## What did NOT ship (deferred work)

| Item | Reason | Tracked |
|---|---|---|
| **G3 consumer migration** (phase1Status / phase2Status / auditor reassignment writers ports onto trackedUpdate) | Blocked on schema drift sort | open todo |
| **G1 reader migration** (controllers + frontend code reading from JSON columns switch to attachment-service) | Out of scope for "foundation + writer dual-write" wave; needs per-model PR | open todo |
| **G1 PDPA backfill enrichment** (uploadedBy is null on dual-writes from contexts that didn't have user.id) | Cosmetic — backfill script later | open todo |
| **Stale remote branch `feat/wave-a-phase24-visibility-audits-detail`** | Phase 24 first attempt was blocked by system safety check; superseded by #101. Branch never merged but still in remote. | open todo |
| **PAT rotation** | The token used to drive `gh` API calls during this session was passed to the agent as plaintext through transcripts. Owner acknowledged the risk and chose to defer rotation until session end. | open todo |
| **Disk alert config** | Mentioned above. Operations responsibility. | open todo |
| **Drop `Certificate.pdfUrl` from frontend interface** | The TypeScript interface still declares `pdfUrl?: string`. Reading it now always yields undefined. Cosmetic; clean up next time the file is touched. | open todo |

## Rollback plan

All migrations are additive or drop columns that are guaranteed empty:

- `20260430190000` — `ADD COLUMN ... DEFAULT FALSE` on 8 tables. Reversible via `DROP COLUMN`.
- `20260430200000` — `ADD CONSTRAINT ... FOREIGN KEY`. Reversible via `DROP CONSTRAINT`.
- `20260430210000` — `DROP COLUMN auditorName/assignedAuditor/hostName` on tables that were empty + `ADD CONSTRAINT FK`. Drop direction loses no data; FK adds reversible via `DROP CONSTRAINT`.
- `20260501030000` — `CREATE TABLE attachments`. Reversible via `DROP TABLE`.
- `20260501050000` — `DROP COLUMN pdfUrl` on tables/rows where it was always null. Loss is zero data; restoration needs `ADD COLUMN` re-adding the column with no data.

To roll back code: revert the merge commits in reverse order on `deploy/production`, then redeploy. The frontend has no breaking changes — every consumer migration was dual-write and readers still read from the legacy column.

## Wave A finalization (Phases 40-50)

After the initial 25-PR sweep, an additional 12 PRs landed to close the
deferred items and bring Wave A to a professional handoff state.

### Documentation + analysis

| PR | Phase | Effect |
|---|---|---|
| #117 | 40 | This doc itself — initial release notes |
| #118 | 41 | `docs/audit/2026-05-01-application-role-column-drift.md` — analysis of the 8 parallel role columns on Application; recipe for the 4-PR drift unwind |

### Application role column drift unwind (Phases A → D)

| PR | Phase | Effect |
|---|---|---|
| #119 | 42 (A) | Add 3 canonical role columns (`reviewerId`, `headAuditorId`, `schedulerId`) + indexes |
| #120 | 43 (B) | FK constraints on the 4 canonical columns + Prisma named relations renamed to make dormant Phase 17 ones explicit |
| #121 | 44 (C) | Writer migration in `scheduler-assign-reviewer-handler` + visibility filter simplified to canonical columns only. 3-branch OR replaces 6-branch OR. |
| #122 | 45 (D) | Drop 7 dormant role columns + 4 Phase 17 FK constraints + 4 dormant Prisma named relations. Schema collapses to canonical 4 |

### Wave A wrap-up (final group)

| PR | Phase | Effect |
|---|---|---|
| #123 | 46 | REV-11 ownership check reads `Application.reviewerId` (canonical column) with `formData.PROVIDERAssignment.reviewerId` JSON fallback for legacy assignments |
| #124 | 47 | G3 consumer #1: `audits-reassign.js` migrated to `trackedUpdate` for the auditorId change. Audit log gets per-field rows instead of silent column writes |
| #125 | 48 | G1 backfill script (`scripts/backfill-attachments.js`) — idempotent, all 6 dual-writer consumers covered |
| #126 | 48a | Hot-fix: backfill script Prisma 5.22 syntax (`{ NOT: { field: null } }` instead of `{ field: { not: null } }`) |
| #127 | 49 | G1 status doc + reader migration playbook at `docs/audit/2026-05-01-g1-attachment-migration-status.md` |
| #128 | 50 | G3 consumer #2: cron payment-expiration writers migrated to `trackedUpdate`. Audit log captures `phase1Status` / `phase2Status` flips on timeout |

### Migrations applied (full list, in order)

```
20260430190000_add_soft_delete_to_lifecycle_tables  (#92)
20260430200000_add_application_role_fks             (#94)
20260430210000_drop_denorm_names_add_user_fks       (#95)
20260501030000_create_attachment_table              (#109)
20260501050000_drop_dead_pdfurl_columns             (#116)
20260501070000_add_canonical_role_columns           (#119)
20260501080000_add_canonical_role_fks               (#120)
20260501090000_drop_dormant_role_columns            (#122)
```

8 migrations total. All idempotent (`IF NOT EXISTS` on adds, `IF EXISTS` on drops).

### Wave A — final gap status

| Gap | Status | Notes |
|---|---|---|
| **G11** soft-delete | ✅ Complete | schema + auto-filter extension + opt-out, 15 unit tests |
| **G15** auditor / reviewer FK | ✅ Complete | denorm name columns dropped, all role columns now FK-typed |
| **G4** per-record visibility | ✅ Complete | 8 endpoints + 1 critical missing-auth fix; filter simplified to canonical columns in Phase 44 |
| **G3** tracked-field writer | ✅ Complete | foundation + 2 consumer migrations (audits-reassign, cron expiration). Other phase-status writers were already canonical via `writeApplicationStatus(additionalData)` |
| **G1** polymorphic Attachment | ✅ Foundations + writers + backfill | 6 dual-writer consumers; backfill executed on prod (0 rows to migrate — feature surfaces empty); reader migration deferred per audit doc's multi-week estimate, tracked at `docs/audit/2026-05-01-g1-attachment-migration-status.md` |

### Final smoke verification (Phase 50 deploy)

- **`/api/health`** → 200 OK at commit `286d8b10`
- **Backend image revision** matches `286d8b10d0c5` (Phase 50 commit)
- **8 cron jobs** registered on backend startup
- **Backfill script** ran clean: 0 created, 0 errors (no live legacy data)
- **Auditor visibility filter** still returns expected 8 apps for assigned auditor
- **Frontend lint baseline** still 94 warnings (unchanged since session start)
- **Frontend tsc** clean
- **System integrity** 53/53

## Operational state at end of session

- **`/api/health`** → 200 OK
- **8 cron jobs** registered on backend startup
- **Disk** — 22% used, 90 GB free
- **Backend image** — `ghcr.io/jonmaxmore/gacp-backend:deploy-production-latest` at `286d8b10d0c5`
- **8 migrations** applied successfully
- **Lint baseline** — 94 warnings (frontend), unchanged from session start

## Next session bookmark

Pick up at:
1. `docs/audit/2026-04-30-workflow-gap-analysis.md` — **Wave B (Operator productivity)** gaps G2 / G5 / G6 / G7 / G18 are next priority
2. `docs/audit/2026-05-01-g1-attachment-migration-status.md` — per-consumer G1 reader migration playbook (small follow-up PRs)
3. Operational follow-ups still in the deferred-items table:
   - PAT rotation (token used during this session is in plaintext transcripts)
   - Stale remote branch `feat/wave-a-phase24-visibility-audits-detail`
   - Disk alert configuration on droplet
