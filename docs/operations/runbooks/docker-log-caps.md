# Runbook: Docker container log caps

**Audience:** Ops / SRE
**Last reviewed:** 2026-04-28
**Related:** P0-4 in `docs/architecture/2026-04-28-system-cohesion-master-plan.md`

## Why

The default Docker `json-file` log driver is **unbounded**. With Promtail
tailing every container's logs on a 4GB droplet, `/var/lib/docker/`
will fill over weeks and cause backend / Postgres OOM-equivalent
incidents (no disk → no commit → process exits).

Two layers fix this:

1. **Per-service caps in the compose file** — already applied.
   See `docker-compose.production.yml`: a `x-logging` YAML anchor
   provides `driver: json-file, max-size: 20m, max-file: 5,
   compress: true` to every service via `logging: *default-logging`.

2. **Host-level default driver in `daemon.json`** — operator action,
   *outside the scope of any PR*. Belt-and-braces: catches sidecars
   and ad-hoc containers that don't go through the compose file.

This runbook covers (2).

## Operator-side change

```bash
# Edit /etc/docker/daemon.json (create if missing).
sudo install -m 0644 -o root -g root /dev/null /etc/docker/daemon.json
```

Contents:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5",
    "compress": "true"
  }
}
```

Apply:

```bash
sudo systemctl reload docker
```

`reload` (not `restart`) avoids tearing down running containers.
Existing container log files are NOT rotated retroactively — only
*new* containers honour the host default. Per-service caps in the
compose file handle the existing fleet on next `docker compose up -d`.

## Verifying

After both changes are deployed:

```bash
docker inspect --format='{{.HostConfig.LogConfig}}' gacp-backend
# should print: {json-file map[compress:true max-file:5 max-size:20m]}

du -sh /var/lib/docker/containers/*/*-json.log* 2>/dev/null \
  | sort -h | tail -10
# every file should be ≤ 20MB; total should be bounded by
# (services × 5 × 20MB) ≈ 1.2GB worst case.
```

## Companion: env-file permissions

While you're on the host, also confirm the production env file is not
world-readable:

```bash
ls -l ~/.env.production
# expect: -rw------- ...

chmod 600 ~/.env.production
```

`.env.production` contains DB_PASSWORD, ENCRYPTION_KEY,
PAYMENT_WEBHOOK_SECRET — anything beyond owner-readable is a leak.

## Rollback

If the daemon.json change causes the docker daemon to fail to reload
(usually a JSON syntax slip):

```bash
sudo mv /etc/docker/daemon.json /etc/docker/daemon.json.bad
sudo systemctl reload docker
```

The compose-file caps continue to apply regardless — the host default
is purely belt-and-braces.
