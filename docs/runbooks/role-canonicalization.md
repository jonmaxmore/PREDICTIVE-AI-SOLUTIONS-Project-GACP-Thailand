# Runbook — canonicalise `users.role`

**Audience:** the Dev/Admin who runs this on Staging, then Production.
**Time:** ~10 minutes on Staging, ~5 on Production.
**Risk:** low. Everything happens in one transaction that verifies itself before
committing. If any check fails, Postgres rolls the whole thing back and the
table is untouched — never half-migrated.

---

## What this changes

`users.role` currently holds whatever spelling was written at the time:
`HEALTH`, `REVIEWER_AUDITOR`, `SUPER_ADMIN`, `FARMER`, `Applicant`, and so on.
The application translates that on every read (`normalizeRole`) and translates
it back on every write (`canonicalToLegacyRole`).

After this migration the column holds the canonical value directly — lowercase
and alias-collapsed — so the round trip disappears. Ten values are possible:

```
admin  platform_admin  scheduler  document_reviewer  auditor
account_dtam  account_platform  account  health  system
```

Nobody's *authority* changes. This is a spelling change, not a permission
change. `REVIEWER_AUDITOR` and `document_reviewer` already mean the same thing
to the application today.

---

## Before you start

**1. Deploy the application code first.** The code in this branch queries users
by *both* the old and the new spelling, so it works before and after the
migration. That means the deploy order does not matter and a stale read-replica
cannot break anything.

> If you run the migration against a server still on older code, features that
> look up users by role go quiet — notifications stop reaching schedulers and
> admins, and payment slips stop reaching DTAM accountants. They fail
> **silently**, as empty lists rather than errors, so nothing appears in the
> logs. Deploy the code first.

**2. Have a database backup.** The script takes one automatically, but a
Production run should also have the normal nightly backup available.

**3. Run it on Staging first.** Do not let Production be the first time.

---

## Running it

One command. Run it from the repository root.

### Step 1 — dry run (writes nothing)

```bash
bash apps/backend/scripts/run-role-canonicalization.sh
```

This connects, prints the current distribution of role values, and checks every
row against the mapping. It writes nothing at all.

**What you want to see:** a table of current values, then

```
✔ every value is mappable — the migration will not abort
DRY RUN — nothing was written.
```

**If it stops instead**, it will name the exact values it refuses to guess
(for example `COORDINATOR`, `EXECUTIVE`, `PROVIDER`, `OFFICER`). It stops on
purpose: guessing could revive a disabled account or hand someone more
authority than they had. Send the output to the dev team, who will decide what
each of those accounts should become, then re-run.

### Step 2 — apply

```bash
bash apps/backend/scripts/run-role-canonicalization.sh --apply
```

The script then, in order: backs up the `users` table to `./backups/`,
re-checks, applies the migration, verifies the result, and prints the new
distribution.

**What you want to see at the end:**

```
✔ Done. users.role is canonical.
Backup : ./backups/users-role-backup-<timestamp>.sql
```

### Different container or database name?

```bash
DB_CONTAINER=gacp-postgres-staging DB_NAME=gacp_staging \
  bash apps/backend/scripts/run-role-canonicalization.sh --apply
```

`docker ps` lists the container names if you are unsure.

---

## After it finishes

Spot-check that the application still behaves. The three things most worth
clicking, because they are the ones that depend on looking users up by role:

1. **Log in as a provider staff account** — the role still resolves, the correct
   menu appears.
2. **Submit an application as an applicant** — the scheduler/admin notification
   arrives.
3. **Upload a payment slip** — it reaches the DTAM accountant queue.

If all three work, the migration is done.

---

## If something looks wrong

Re-running the script is safe — the mapping is idempotent, so a second run
updates zero rows. Run the dry run again to see the current state.

To restore the `users` table from the backup the script took:

```bash
docker exec -i gacp-postgres psql -U gacp -d gacp_db \
  -c 'TRUNCATE users CASCADE;' < ./backups/users-role-backup-<timestamp>.sql
```

> `TRUNCATE ... CASCADE` also clears rows that reference `users`. On Production,
> prefer a full database restore from the nightly backup and involve the dev
> team — this one-liner is for Staging.

---

## What backs this up

| Piece | Where |
|---|---|
| The mapping, as data | `apps/backend/shared/role-migration-map.js` |
| The SQL, transactional and self-verifying | `apps/backend/prisma/migrations/20260801000000_canonicalize_user_role/migration.sql` |
| Read-only pre/post checker | `apps/backend/scripts/verify-role-canonicalization.js` |
| Mapping unit tests | `apps/backend/__tests__/unit/role-migration-map.test.js` |
| The runner you invoke | `apps/backend/scripts/run-role-canonicalization.sh` |

The SQL and the JavaScript both read the same mapping table, so they cannot
drift apart.
