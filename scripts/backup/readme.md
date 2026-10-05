# GACP Platform — Backup Scripts

This directory holds the production database backup tooling. The platform
runs on a single DigitalOcean droplet with Docker Compose; PostgreSQL lives
in the `gacp-postgres` container, and backups are pulled out via
`docker exec pg_dump`.

## Files

| File | Purpose |
| --- | --- |
| `pg-backup.sh` | Daily backup script. Cron-driven. Has restore mode. |
| `install-cron.sh` | Idempotent installer for `/etc/cron.d/gacp-backup`. |
| `cron.gacp-backup.template` | Reference cron content for manual install. |
| `backup-system.sh` | Older full-system backup script (S3 / local). Not on the daily cron. |

## What runs daily

`pg-backup.sh` writes a compressed `pg_dump` to:

```
/var/backups/gacp/scheduled/
├── daily/    # gacp_<timestamp>.sql.gz                 (kept 7 days)
├── weekly/   # gacp_weekly_<timestamp>.sql.gz   Sunday (kept 28 days)
└── monthly/  # gacp_monthly_<timestamp>.sql.gz  1st     (kept 180 days)
```

The canonical backup root is **`/var/backups/gacp`** — same root as
pre-deploy snapshots from `scripts/deploy/deploy-production.sh`. Scheduled
backups go in the `scheduled/` subdirectory so they don't mix with manual
pre-deploy backups.

DB defaults: `DB_NAME=gacp_db`, `DB_USER=gacp`, `DB_CONTAINER=gacp-postgres`.
Override via env if needed.

## Install the cron entry

On the production droplet, with the repo deployed at `/opt/gacp-platform`:

```bash
sudo /opt/gacp-platform/scripts/backup/install-cron.sh
```

This writes `/etc/cron.d/gacp-backup` (mode 0644) with:

```
17 2 * * * root /opt/gacp-platform/scripts/backup/pg-backup.sh >> /var/log/gacp-backup.log 2>&1
```

Re-run the installer any time you change the schedule or the template.

Verify after install:

```bash
ls -la /etc/cron.d/gacp-backup
# Wait for 02:17, then:
tail -50 /var/log/gacp-backup.log
ls -la /var/backups/gacp/scheduled/daily/
```

## Restore from a backup

```bash
# Restore a specific backup file. Replaces ALL data in gacp_db. 5-second abort window.
sudo /opt/gacp-platform/scripts/backup/pg-backup.sh --restore \
    /var/backups/gacp/scheduled/daily/gacp_20260428_021700.sql.gz
```

The script uses `--single-transaction` so a failed restore won't leave the
DB in a half-applied state.

## Retention policy

| Tier    | Kept for | Trigger       |
| ------- | -------- | ------------- |
| Daily   | 7 days   | Every run     |
| Weekly  | 28 days  | Sunday        |
| Monthly | 180 days | 1st of month  |

Off-droplet replication (S3 / Spaces) is **not** in scope for this script.
See `backup-system.sh` (older, separate) for the S3 path.

## Log file

`/var/log/gacp-backup.log` is rotated by
`deploy/logrotate/gacp-platform.conf`. Install with
`scripts/maintenance/install-logrotate.sh`.

## Why minute 17?

Cron jobs scheduled at `:00` create a worldwide load spike (every machine
on the Internet runs cron at the top of the hour). Off-minute scheduling
spreads load on shared infrastructure (DNS, NTP, package mirrors).
