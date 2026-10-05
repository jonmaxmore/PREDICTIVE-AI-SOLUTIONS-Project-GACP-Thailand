# ⚠️  Unregistered SQL Files in this Directory

> **Audited by agent-data-dba on 2026-05-15.**
>
> **2026-05-15 PM update (system deep-dive Tier 2 expansion):**
> - ✅ `add_dtam_requirements/` placeholder folder DELETED — it was an empty no-op.
> - ✅ The DBA F-04 compound + GIN indexes that this directory historically tried
>   to provide via `add_performance_indexes.sql` are now in a PROPERLY-TIMESTAMPED
>   migration: `20260515170000_add_performance_indexes_compound/migration.sql`.
>   That migration uses different index NAMES from the loose SQL, so both can
>   coexist without conflict (the loose SQL is still ignored by Prisma; the new
>   timestamped one is part of the migration chain).
> - The 3 remaining loose SQL files (`add_farm_audit_enhancements.sql`,
>   `add_performance_indexes.sql`, `fix_schema_gaps.sql`) are still in this
>   directory pending the DBA + ops decision documented below. They contain
>   schema additions for features that have NOT been wired through Prisma
>   (audit photos, fraud detection, labs table) — keeping them as documentation
>   of intent is safer than deletion until product confirms each feature's status.
>
> The following files are present in `apps/backend/prisma/migrations/` but are **NOT
> part of the Prisma migration chain**. `prisma migrate deploy` ignores them because
> they lack the `YYYYMMDDHHMMSS_` timestamp-prefix folder convention that Prisma
> requires for migration tracking.

## Files in question

| Path | Lines | Origin | Idempotency | Status |
|---|---|---|---|---|
| ~~`add_dtam_requirements/migration.sql`~~ | ~~3~~ | ~~Feb 2026 placeholder~~ | ~~Empty — no-op~~ | ✅ Deleted 2026-05-15 |
| `add_farm_audit_enhancements.sql` | 326 | Feb 2026 manual ops | Uses `IF NOT EXISTS` everywhere | Open — pending ops review |
| `add_performance_indexes.sql` | 258 | Feb 2026 manual ops | Uses `CREATE INDEX IF NOT EXISTS` | Partially superseded by `20260515170000_add_performance_indexes_compound` — DBA should diff & decide |
| `fix_schema_gaps.sql` | 179 | Feb 2026 manual ops | Uses `ADD COLUMN IF NOT EXISTS` | Open — pending ops review |

## Why they exist

Before the modular Prisma schema (`prisma/schema/*.prisma`) was finalised, the team
applied schema patches manually via `psql` against dev/staging databases. The SQL
files were committed as documentation of those changes. Some patches were later
codified into proper timestamped Prisma migrations; others were not.

## Schema drift verdict (Sprint 6 audit)

Searching the current Prisma schema (`apps/backend/prisma/schema/*.prisma`) for the
columns and tables that these files create returns **zero matches**:

- `audit_photos`, `last_audit_date`, `gps_verified`, `fraud_score`, `fraud_checked`,
  `photo_hash`, `verification_status`, `file_hash`, `labs` table — **none present**
  in the Prisma schema.

This means **either**:

1. The SQL was applied to some DB at some point but the schema changes were never
   reflected back into Prisma → `prisma migrate dev` would now generate a "drift
   detected" warning and propose to revert them.
2. The SQL was never applied anywhere → these files are aspirational dead intent.

Without inspecting an actual production DB (DTAM hosting is TBD as of 2026-05-15),
we cannot determine which is true. Both possibilities require operator action.

## What to do

**DO NOT** run these SQL files manually against any environment without first:

1. Confirming with `prisma migrate status` whether the target DB matches the Prisma
   schema baseline.
2. If drift is detected: open a Prisma migration via
   `npx prisma migrate dev --create-only --name resolve_schema_drift` and copy the
   relevant SQL into the generated `migration.sql`, edit if needed, then commit.
3. If no drift: these files represent intent that was never realised. Either:
   - Convert the desired changes into a fresh Prisma migration (recommended), OR
   - Delete the loose SQL files entirely.

## Why we did not delete them in Sprint 6

The Sprint 6 audit flagged the drift risk but stopped short of deletion because:

- The team protocol requires destructive deletions to be explicitly authorised.
- The SQL describes domain intent (fraud detection, farm audit checklists, lab
  integration) that might still be desired but was never wired through Prisma.

The right next step is for the **agent-data-dba** owner to convert the desired
parts into proper timestamped Prisma migrations, validate against the schema, then
remove the loose files via `git rm`. Tracked as Debt #1.5 (data-dba subtask).
