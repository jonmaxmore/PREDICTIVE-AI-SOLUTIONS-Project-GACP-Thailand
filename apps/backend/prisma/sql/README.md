# SQL Utility Scripts

Standalone SQL scripts outside Prisma's migration track. These are **operational utilities** run manually when needed.

## Files

### `audit_logs_partition.sql`

**Purpose:** Convert `audit_logs` table to a partitioned table (monthly partitions).

**When to run:** One-time operation when audit_logs table grows large (>1M rows). Run during maintenance window.

```bash
docker exec -i gacp-postgres psql -U gacp -d gacp_db < audit_logs_partition.sql
```

> [!CAUTION]
> This is a destructive operation — back up the table first.

---

## Pre-Migration Safety

### `../pre-migration-dedup-check.sql`

**Purpose:** Pre-flight safety check for unique constraints before running Prisma migrations.

**When to run:** Before any migration that adds unique constraints to existing data.

```bash
docker exec -i gacp-postgres psql -U gacp -d gacp_db < pre-migration-dedup-check.sql
```

## Notes

- All standard migrations are managed by Prisma (`prisma/migrations/`)
- Run `npx prisma migrate deploy` for normal schema changes
- These utility scripts are for DBA-level operations only
