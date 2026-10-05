# An applied migration is frozen

Once a migration directory has been applied to ANY database — the shared demo dataset, staging,
production — its `migration.sql` must never be edited again. Add a new migration instead.

## Why this rule exists here, in this directory

Prisma records a checksum of every applied migration in `_prisma_migrations`. If the file changes
after that, `prisma migrate deploy` refuses on every environment that has the old checksum, with
a message about a modified migration, and nothing ships until someone reconciles by hand.

On 2026-08-26 three migrations were applied to the shared demo database in the middle of a working
day, on a tree several agents were still editing:

- `20260826090000_area_sqm_and_cultivation_scope_expand`
- `20260826140000_document_slot_holds_one_current_document`
- `20260826170000_photo_provenance_expand`

An adversarial review had already asked for changes to the first one (the plots backfill guard was
`IS NULL`, which cannot re-sync an edited row), and those changes were made BEFORE it was applied.
Had the order been the other way round, the fix would have had to be a fourth migration — and a
reviewer who "just tidied the SQL" afterwards would have broken deploy everywhere.

## What to do instead

- Something wrong in an applied migration → write a new migration that corrects it.
- Not sure whether it has been applied anywhere → assume it has. `npx prisma migrate status
  --schema prisma/schema` answers for the database in your `.env`; it cannot answer for the
  others.
- A migration you are still writing, that has not touched any database → edit freely. Until it
  is applied, it is just a file.

## The other half

The code must not run ahead of the database either. `config/migration-level-guard.js` checks at
boot that every migration in this tree is applied to the database the process is about to serve,
and refuses in production. That guard exists because a pressed walk found the photo door returning
HTTP 500 on every real photograph — the code wrote columns the database did not have, and nothing
had said so.
