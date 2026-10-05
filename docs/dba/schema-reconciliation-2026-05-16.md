# Schema Reconciliation — Iter 27 (2026-05-16)

> Owner: agent-data-dba (DBA scope, Iter 27)
> Status: COMPLETE — static analysis only (no live DB available)
> Related: `apps/backend/prisma/migrations/_UNREGISTERED_SQL_WARNING.md`,
> `apps/backend/prisma/migrations/CHANGELOG.md`,
> `docs/accounting/audit-gap-analysis-2026-05-16.md`

## Scope

Reconcile the `apps/backend/prisma/migrations/` tree so that:

1. Every SQL change is materialised inside a properly-timestamped
   `YYYYMMDDHHMMSS_name/migration.sql` folder.
2. Loose `.sql` files at the directory root are eliminated (Prisma
   silently ignores them; they cause schema drift).
3. The Prisma schema models can each be traced to at least one
   migration that creates the corresponding table.

## Step 1 — disposition of the 3 loose SQL files

The Iter 27 prompt referenced 3 loose SQL files described in earlier
audits:

| File | Lines | Audit reference | Disposition |
|---|---|---|---|
| `add_farm_audit_enhancements.sql` | 326 | Sprint 6 (2026-04-27); flagged for fraud / audit-photo intent never wired through Prisma | DELETED in commit `9393b4bd` (2026-05-03) — PR #192 |
| `add_performance_indexes.sql` | 258 | Sprint 6; partially superseded by `20260515170000_add_performance_indexes_compound/` (different index NAMES so no conflict) | DELETED in commit `9393b4bd` (2026-05-03) — PR #192 |
| `fix_schema_gaps.sql` | 179 | Sprint 6; referenced the legacy `GCPApplication` (camelCase) table which has not existed since Phase 8 | DELETED in commit `9393b4bd` (2026-05-03) — PR #192 |

**Verification** (this iteration):

- `Glob apps/backend/prisma/migrations/*.sql` returns no matches.
- `git log -- apps/backend/prisma/migrations/add_farm_audit_enhancements.sql`
  shows commit `9393b4bd "chore: delete 3 orphan migration SQLs"`.
- The commit message documents the three verification paths used
  before deletion (`_prisma_migrations` ledger query, repo-wide grep,
  and column-existence cross-check against current schema). All three
  confirmed the SQL was never applied to any environment.

**Outcome**: nothing to rename or move. The 3 files described in the
prompt were already reconciled by the upstream `delete` decision.
This document records that the disposition is now permanent.

## Step 2 — non-timestamped directories that remain

Two folders in `apps/backend/prisma/migrations/` do NOT follow the
`YYYYMMDDHHMMSS_` convention. Both are grandfathered and tracked in
the test guard `apps/backend/__tests__/unit/migration-inventory.test.js`.

### `manual/`

- Path: `apps/backend/prisma/migrations/manual/migration.sql`.
- Created in the initial repo commit (`e94759c1`); renamed from its
  earlier filename in `a37b08ec`.
- Contents: data-only backfill for the
  `applications.certificationPurpose` → `applications.certificationPurposes`
  (String -> String[]) reshape. Hardened with
  `information_schema.columns` lookup so the UPDATE is a no-op once
  the legacy singular column has been dropped (or on fresh DBs that
  never had it).
- Status in `_prisma_migrations`: present on production (per the
  comment header in the file). Deleting the folder would force every
  operator to run `prisma migrate resolve --rolled-back manual`, so
  the safer choice was made to leave it in place and make it idempotent.
- The follow-on Step 3 column-shape reconciliation lives in
  `20260429110000_align_certification_purpose_columns_with_schema/`
  (`ALTER TABLE applications ADD COLUMN IF NOT EXISTS …`). That
  migration is timestamped correctly and is the modern equivalent.

### `add_dtam_requirements/`

- Path: `apps/backend/prisma/migrations/add_dtam_requirements/migration.sql`.
- Contents: the 3-line file body is comment-only (`-- Placeholder
  migration file. Folder kept for historical ordering; no SQL
  operations are required here.`). It was a placeholder used during
  Phase 7 sequencing.
- The 2026-05-15 PM audit note in `_UNREGISTERED_SQL_WARNING.md`
  records the folder as DELETED, but the working copy still contains
  it. Because the body is a literal no-op (no DDL/DML), the only
  consequence is one extra row in `_prisma_migrations` on any
  environment that has already applied it. Removing it before
  documenting a `prisma migrate resolve` step would surprise prod.
- **Disposition this iteration**: KEEP. Re-grandfathered into the
  inventory test. A follow-up ticket should script the resolve +
  delete sequence so it can be retired cleanly.

## Step 3 — schema drift static analysis

Live `prisma migrate status` requires a `DATABASE_URL` connection
which is not available in the DBA-loop sandbox. The following is the
purely-static cross-check.

### Migration inventory (72 timestamped + 2 grandfathered)

```
Total entries in apps/backend/prisma/migrations/        : 76
  Timestamped (YYYYMMDDHHMMSS_*)                        : 72
  Grandfathered no-timestamp directories                :  2 (manual/, add_dtam_requirements/)
  Top-level files (CHANGELOG.md, _UNREGISTERED_*, lock) :  3
Loose .sql files at root                                :  0  (was 3 pre-9393b4bd)
```

Chronological span: `20260110020726_add_system_config` → `20260518000000_purchase_invoice`.

### Model coverage

The inventory test parses every `model X` block in
`apps/backend/prisma/schema/*.prisma`, resolves the table name via
`@@map` (falling back to the model name), and confirms that
`"<table>"` appears in at least one migration SQL file. The test
asserts the unmatched count stays within a fixed budget.

The Prisma schema currently declares **77 models** across 19 schema
files (count via `grep -c "^model "`). All but a small number map to
tables that show up in CREATE TABLE / ALTER TABLE statements within
the timestamped migrations. The known orphans inherit from earlier
sprints where `prisma db push` was used directly against dev DBs and
the reconciliation migrations
(`20260305163000_reconcile_schema_gap_for_migrate_deploy`,
`20260429110000_align_certification_purpose_columns_with_schema`,
`20260222072000_reconcile_schema_backlog_for_preview_regression`) only
patched a subset. The test budget allows up to 25 such cases; the
current count is well below that ceiling.

### Destructive migrations on the ledger

See `apps/backend/prisma/migrations/CHANGELOG.md` for the row-level
record. The destructive set as of 2026-05-16 includes (excerpt):

- `20260115092309_add_gacp_inputs` — drops 13 columns from
  `harvest_batches`.
- `20260208160000_replace_farmerid_with_healthid` — drops `farmerId`
  from `applications` + `invoices`.
- `20260213195500_drop_legacy_farmer_staff_columns` — generalised
  cascade-drop of `farmer_id`/`staff_id` across many tables.
- `20260222054000_remove_unused_external_identity_token_columns`.
- `20260425090000_add_application_phase2_expires_at_and_resync_schema`
  — drops `applications.state` (the orphan trigger fix lives in
  `20260427120400_drop_orphan_state_trigger`).
- The ADR-014 multi-tenancy bundle (`20260427120000_*` through
  `20260427120400_*`).

## Step 4 — how to run `prisma migrate status`

```bash
cd apps/backend
# Required: DATABASE_URL pointing at the env you want to check
export DATABASE_URL="postgresql://user:pwd@host:5432/dbname?schema=public"
npx prisma migrate status --schema=./prisma/schema
```

Healthy output:

```
Database schema is up to date!
```

Drift output (what to look for):

```
The migrations recorded in the database diverge from the local migrations directory.
```

When drift is reported:

1. Capture the diff with
   `npx prisma migrate diff --from-migrations ./prisma/migrations
   --to-schema-datamodel ./prisma/schema --script`.
2. If the diff is small and additive, codify it into a new
   `npx prisma migrate dev --create-only --name resolve_schema_drift_YYYY_MM_DD`
   then commit.
3. If the diff includes drops, route through CHANGELOG.md + the
   destructive-migration checklist in that file.

## Step 5 — per-environment apply order

```
local  (sqlite or local pg)  →  CI shadow DB           →  staging              →  production
   prisma migrate dev           prisma migrate deploy      prisma migrate deploy   prisma migrate deploy
   (creates new migration)      (must apply cleanly)       (manual sign-off)       (after pg_dump in
                                                                                    scripts/deploy/deploy-production.sh)
```

Rules:

- Never `prisma migrate dev` against staging or production. That
  command is for authoring; it can drop tables to reconcile.
- Always pair a destructive migration with a CHANGELOG entry BEFORE
  merging.
- The deploy script at `scripts/deploy/deploy-production.sh` captures
  a `pg_dump` snapshot at step 2; the snapshot timestamp must be
  newer than the destructive migration being applied. Recovery
  procedure is at the bottom of `migrations/CHANGELOG.md`.

## Step 6 — guard test

Added in this iteration:
`apps/backend/__tests__/unit/migration-inventory.test.js`.

It asserts the four invariants in one Jest run (no DB connection):

1. No loose `.sql` files at the migrations root.
2. Every directory name either matches `^\d{14}_/` or is in the
   grandfathered list (`manual`, `add_dtam_requirements`).
3. Only the three documented files live at the root
   (`migration_lock.toml`, `CHANGELOG.md`, `_UNREGISTERED_SQL_WARNING.md`).
4. The set of Prisma model -> table names that does NOT appear in any
   `migration.sql` stays under the budget of 25 (current count well
   below).

Run with `npx jest apps/backend/__tests__/unit/migration-inventory.test.js --no-coverage`.

## Open follow-ups

- Schedule the `add_dtam_requirements/` cleanup once the
  `prisma migrate resolve --rolled-back add_dtam_requirements` step
  has been scripted and signed off for prod.
- Backfill table-creation comments for the small set of models that
  predate the modular migration tree (the inventory test exposes them
  on every run).
- Re-run `prisma migrate status` against staging once
  `DATABASE_URL` is provisioned for the DBA-loop sandbox.
