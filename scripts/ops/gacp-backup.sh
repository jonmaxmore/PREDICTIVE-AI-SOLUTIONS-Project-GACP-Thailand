#!/usr/bin/env bash
# gacp-backup — nightly pg_dump of both application databases on the staging box.
#
# WHY THIS EXISTS: until 2026-08-08 there was no backup mechanism at all. What
# existed was three hand-run `predeploy_*.sql` dumps, the newest of which was two
# months old, and no cron entry in either the `ubuntu` or the `root` crontab.
# GOALS.md:18 already recorded "backup ไม่เคยพิสูจน์ restore"; the truth was worse
# — it was not running either.
#
# FORMAT: `-Fc` (custom) rather than plain SQL, because pg_restore can read it
# selectively and reports its own object list, which is what makes the "is this
# file actually a backup" check in the runbook possible without restoring.
#
# RETENTION: 30 days. Dumps are ~1 MB each and the disk has ~65 GB free, so the
# limit is about noise, not space.
#
# THIS FILE IS THE SOURCE OF TRUTH. The staging box runs a copy at
# /usr/local/bin/gacp-backup.sh — see docs/operations/runbooks/backup-and-restore.md
# for how to re-sync it after editing this one.
set -euo pipefail

OUT="${GACP_BACKUP_DIR:-/opt/gacp-platform/backups}"
CONTAINER="${GACP_PG_CONTAINER:-gacp-postgres}"
PGUSER="${GACP_PG_USER:-gacp}"
KEEP_DAYS="${GACP_BACKUP_KEEP_DAYS:-30}"
# Volumes whose loss is unrecoverable. A database restore without these leaves
# every document link pointing at a file that no longer exists — the runbook
# recorded that gap on 2026-08-08 and nothing covered it until now.
#
# gacp-signing-keys is the one that cannot be re-created at all: it holds the RSA
# keys that signed every certificate and QR code ever issued. docker-compose.
# production.yml:208-211 persists it precisely "so previously-issued signatures
# stay verifiable". Losing it invalidates the platform's entire issued history.
#
# STAGING VOLUMES: docker-compose.staging.yml:39-45 declares
# gacp_staging_{uploads,storage,signing_keys} WITHOUT an explicit `name:`, so the
# real names carry the compose project prefix and could not be derived from the
# repo. Confirmed on the box 2026-08-13 via `docker volume ls`:
#   gacp-platform_gacp_staging_uploads       1.337 MB
#   gacp-platform_gacp_staging_storage       0 B
#   gacp-platform_gacp_staging_signing_keys  2.325 kB
#
# SIZE (same run, `docker system df -v`): gacp-uploads-data 63.51 MB is the only
# large one; signing keys are ~2 kB each and both storage volumes are empty. So
# ~65 MB per night against ~65 GB free — a 30-day retention costs roughly 2 GB.
# Re-check with `docker system df -v` if uploads start growing.
VOLUMES="${GACP_BACKUP_VOLUMES:-gacp-uploads-data gacp-storage-data gacp-signing-keys gacp-minio-data gacp-platform_gacp_staging_uploads gacp-platform_gacp_staging_storage gacp-platform_gacp_staging_signing_keys}"
TAR_IMAGE="${GACP_BACKUP_TAR_IMAGE:-alpine:3.20}"

# Dumps carry plaintext PII: apps/backend/services/prisma-pdpa-extension.js:166-171
# leaves firstName, lastName, phoneNumber and province outside the column-encryption
# set, and email is not in it either. They were being written mode 644.
umask 077

# docker treats a `-v` source that is not an absolute path as a NAMED VOLUME
# rather than a bind mount. A relative GACP_BACKUP_DIR would therefore send every
# tarball into an invisible volume while the run exits 0 and the dumps — written
# by the shell, which resolves the path normally — still appear on disk.
case "$OUT" in
    /*) ;;
    *) echo "gacp-backup: GACP_BACKUP_DIR must be an absolute path, got: $OUT" >&2; exit 1 ;;
esac

mkdir -p "$OUT"
# The tarballs are written by the container and land root-owned, so a per-file
# chmod from a non-root cron user cannot be relied on. The directory mode is the
# protection that does not depend on who created the file.
chmod 700 "$OUT" 2>/dev/null || true

TS=$(date -u +%Y%m%d_%H%M%S)

# 2026-09-15: the local postgres container was retired — every database is Supabase,
# and those are dumped nightly from root's crontab by scripts/backup/supabase-backup.sh.
# With the container gone, skip the dump loop and STILL archive the volumes below:
# the signing keys and uploads are the part of this script that cannot be re-created,
# and under `set -e` the first failing pg_dump used to end the run before reaching
# them — zero-byte gacp_db_*.dump files and not one .tgz from 2026-09-10 to 09-15.
if docker container inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    for DB in gacp_db gacp_staging; do
        DUMP="$OUT/${DB}_${TS}.dump"
        docker exec "$CONTAINER" pg_dump -U "$PGUSER" -Fc "$DB" > "$DUMP"
        chmod 600 "$DUMP"

        # Proves the archive HEADER AND TOC are readable — not that the dump is
        # complete. In custom format the header and TOC precede the data and --list
        # stops after the TOC, so a dump truncated inside the data section still
        # lists cleanly. It does catch the case that matters most here: the shell's
        # `>` creates the file before pg_dump writes a byte, so a run that died at
        # the very start left a zero-byte file that looked like a backup.
        if ! docker exec -i "$CONTAINER" pg_restore --list >/dev/null < "$DUMP"; then
            echo "gacp-backup: ${DB} dump is not a readable archive: ${DUMP}" >&2
            exit 1
        fi
    done
else
    echo "gacp-backup: postgres container '$CONTAINER' not running — no local databases to dump (Supabase dumps: scripts/backup/supabase-backup.sh); archiving volumes only"
fi

# Retention runs HERE — after the dumps proved good, before the volume archives.
# Placing it last meant that any failure in the volume loop skipped it entirely
# under `set -e`, so a night that ran out of disk added two dumps, deleted
# nothing, and did the same again every night after. Placing it before the dumps
# would prune even on a night when no new backup was produced.
find "$OUT" -name '*.dump' -mtime "+${KEEP_DAYS}" -delete
find "$OUT" -name '*.tgz' -mtime "+${KEEP_DAYS}" -delete

# Fail early and clearly if the tar image is not present, rather than midway
# through the loop with docker's own message.
if ! docker image inspect "$TAR_IMAGE" >/dev/null 2>&1; then
    echo "gacp-backup: tar image not available locally: $TAR_IMAGE (docker pull it first)" >&2
    exit 1
fi

for VOL in $VOLUMES; do
    # A named volume that does not exist is NOT an error to docker — `docker run
    # -v missing-name:/src` creates it empty and tars nothing, so a typo would
    # produce a valid, empty archive and a green run. Check first.
    if ! docker volume inspect "$VOL" >/dev/null 2>&1; then
        echo "gacp-backup: volume does not exist: $VOL (check the name against 'docker volume ls')" >&2
        exit 1
    fi

    ARCHIVE="${VOL}_${TS}.tgz"

    # Create the file HERE, at mode 600, before the container writes to it.
    # `tar czf` opens an existing path with O_WRONLY|O_CREAT|O_TRUNC, which keeps
    # the inode — so mode and owner survive. Letting the container create it
    # instead produced root-owned 0644 archives (observed on the staging box
    # 2026-08-14: gacp-uploads-data_*.tgz, 55 MB of uploaded farmer documents),
    # and the follow-up `chmod ... || true` could not fix that because cron runs
    # as a non-root user and silently failed every night.
    #
    # The 0700 directory did contain the exposure, which is why this was never a
    # live hole. But a directory mode protects only files still in that
    # directory: copy an archive to a share, an incident folder, or another box
    # and 0644 travels with it. The file mode is the one that does.
    install -m 600 /dev/null "$OUT/${ARCHIVE}"

    docker run --rm -v "$VOL":/src:ro -v "$OUT":/dst "$TAR_IMAGE" \
        tar czf "/dst/${ARCHIVE}" -C /src .
done
