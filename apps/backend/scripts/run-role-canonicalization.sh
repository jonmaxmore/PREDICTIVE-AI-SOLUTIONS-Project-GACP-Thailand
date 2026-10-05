#!/usr/bin/env bash
#
# One-command runner for the users.role canonicalisation migration.
#
#   bash apps/backend/scripts/run-role-canonicalization.sh            # dry run
#   bash apps/backend/scripts/run-role-canonicalization.sh --apply    # for real
#
# Order of operations, and it will not skip one:
#   1. back up the users table
#   2. verify the CURRENT state — abort if any row holds a role we refuse to guess
#   3. apply the migration (one transaction; it self-verifies before COMMIT)
#   4. verify the RESULT — every row canonical, or the step failed
#
# Every step is fail-fast. If step 2 aborts, nothing has been written. If step 3
# aborts, Postgres rolled the whole transaction back — the table is untouched,
# not half-migrated.
#
# Environment (override as needed):
#   DB_CONTAINER  docker container running Postgres   (default: gacp-postgres)
#   DB_USER       postgres role                       (default: gacp)
#   DB_NAME       database name                       (default: gacp_db)
#   BACKUP_DIR    where the dump is written           (default: ./backups)

set -Eeuo pipefail

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

die() { red "✖ $*"; exit 1; }

DB_CONTAINER="${DB_CONTAINER:-gacp-postgres}"
DB_USER="${DB_USER:-gacp}"
# Phase-1 cutover: gacp_app (the app's least-priv role) cannot TRUNCATE/ALTER/DROP — this script needs the bootstrap superuser.
[[ "$DB_USER" == "gacp_app" ]] && die "run-role-canonicalization needs the bootstrap superuser (DB_USER=gacp), not the app role gacp_app"
DB_NAME="${DB_NAME:-gacp_db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATION_SQL="${BACKEND_DIR}/prisma/migrations/20260801000000_canonicalize_user_role/migration.sql"

trap 'red "✖ Aborted at line $LINENO. Nothing was committed — the migration runs in a single transaction."' ERR

[[ -f "$MIGRATION_SQL" ]] || die "migration.sql not found at $MIGRATION_SQL"

docker exec "$DB_CONTAINER" true 2>/dev/null \
  || die "cannot reach container '$DB_CONTAINER'. Set DB_CONTAINER=<name> (docker ps to list)."

psql_do() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"; }

step "0. Target"
echo "   container : $DB_CONTAINER"
echo "   database  : $DB_NAME (user $DB_USER)"
psql_do -tAc "SELECT 'users rows: ' || COUNT(*) FROM users;" | sed 's/^/   /'

step "1. Current users.role distribution"
psql_do -c "SELECT \"role\", COUNT(*) AS rows FROM users GROUP BY \"role\" ORDER BY rows DESC;"

step "2. Pre-flight check (read-only)"
if node "${BACKEND_DIR}/scripts/verify-role-canonicalization.js" --before; then
  grn "   every value is mappable — the migration will not abort"
else
  die "pre-flight FAILED: at least one row holds a role the migration refuses to guess.
     Resolve those rows explicitly (see QUARANTINE_VALUES in shared/role-migration-map.js),
     then re-run. Nothing has been changed."
fi

if [[ "$APPLY" -eq 0 ]]; then
  ylw "
DRY RUN — nothing was written.
Re-run with --apply to perform the migration:

    bash apps/backend/scripts/run-role-canonicalization.sh --apply
"
  exit 0
fi

step "3. Backup"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/users-role-backup-${STAMP}.sql"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -t users --data-only > "$BACKUP_FILE"
[[ -s "$BACKUP_FILE" ]] || die "backup is empty — refusing to continue"
grn "   saved $BACKUP_FILE ($(wc -c < "$BACKUP_FILE") bytes)"

step "4. Applying migration"
psql_do -f - < "$MIGRATION_SQL"
grn "   committed"

step "5. Post-migration verification"
node "${BACKEND_DIR}/scripts/verify-role-canonicalization.js" --after \
  || die "post-check FAILED — see the output above and restore from $BACKUP_FILE"

step "6. Final users.role distribution"
psql_do -c "SELECT \"role\", COUNT(*) AS rows FROM users GROUP BY \"role\" ORDER BY rows DESC;"

grn "
✔ Done. users.role is canonical.

Backup : $BACKUP_FILE
Rollback (only if needed — restores the users table to its pre-migration rows):

    docker exec -i $DB_CONTAINER psql -U $DB_USER -d $DB_NAME \\
      -c 'TRUNCATE users CASCADE;' < $BACKUP_FILE

Re-running this script is safe: the mapping is idempotent, so a second run
updates 0 rows.
"
