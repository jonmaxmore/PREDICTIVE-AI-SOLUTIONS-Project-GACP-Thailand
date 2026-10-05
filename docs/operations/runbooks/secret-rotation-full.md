# Runbook — Coordinated Secret Rotation (DB_PASSWORD · REDIS_PASSWORD · HEALTH_JWT_SECRET · PROVIDER_JWT_SECRET)

**Status:** EXECUTED 2026-08-05 via #762 — retained as the template for the next
coordinated rotation. The compose freeze this document waited on was lifted the
same day (`docs/operations/runbooks/deploy-staging-manual.md`: "Freeze: lifted
2026-08-05"; the JWT legs already invalidated every session, and both JWT secrets
were rotated in #762). Gates G1/G2 in §0 are therefore historical: re-read them as
"confirm the equivalent conditions for *your* rotation", not as blockers left open.
**Owner:** platform operator (executes every step by hand — agents draft only)
**Drafted:** 2026-08-04 · **executed:** 2026-08-05 · **truth-checked:** 2026-08-14
**Tooling:** manual procedure (this document). `scripts/maintenance/rotate-secret.sh`
covers only single-location secrets (allow-list `scripts/maintenance/rotate-secret.sh:55-62`
— no `DB_PASSWORD`/`REDIS_PASSWORD`) and is **not** used here.

**Which document governs what:**

- **Routine JWT-only rotation** (quarterly, nothing else changing) →
  `docs/operations/runbooks/secret-rotation.md` §2 (`rotate-secret.sh`) stays the
  procedure. This runbook does not replace it.
- **DB-password-only rotation** → `docs/operations/runbooks/rotate-database-credential.md`
  (active, INCIDENT-2026-08-04) is authoritative. This runbook imports its safety
  rules for the DB leg and does not fork them.
- **The coordinated 4-secret event** (this leak window: one maintenance window,
  all four values replaced together) → **this runbook**. It is also the only
  documented procedure for `REDIS_PASSWORD`, which no other runbook covers.

> **TL;DR** — one maintenance window, one targeted converge:
> preflight + backups (§3) → generate values into root-only files (§4) → rewrite
> both env files atomically (§5) → `\password` the DB role and **prove the new
> password over a password-authenticated path** (§6) → recreate `redis` +
> `backend` (prod) and `backend-staging` in one wave (§7) → verify battery incl.
> a 30-minute watch, because **no alert rule is loaded at all**
> (rotate-database-credential.md §9) (§8) → audit-log + cleanup (§9). Rollback
> per leg in §10.
>
> Sequencing principle: **the live store and the env files are proven consistent
> before any container is recreated.** The 2026-08-04 outage (the change log,
> entry "ห้าม docker compose up จนกว่า #762 จะปิด") happened because a recompose
> turned env↔store drift into downtime that surfaced only at the next login.

---

## 0. Execution gates — hard stops, all must be true

| # | Gate | How to confirm |
|---|---|---|
| G1 | The PR whose closure lifts the compose freeze (#762, per the operator's 2026-08-04 order recorded in the change log) is **merged and deployed**: the checkout at `/opt/gacp-platform` is pulled up to that merge | `git log` on the server checkout |
| G2 | Operator has lifted the `docker compose up` freeze **in writing** | written order exists |
| G3 | A fresh DB backup exists. ⚠️ **A12 (2026-08-05): the daily cron `/etc/cron.d/gacp-backup` may NOT be installed** — `install-cron.sh` is wired into `deploy-production.sh` only. Re-verified 2026-08-14: `scripts/deploy/deploy-staging.sh` — the deploy that actually runs on the box — never calls it (`grep -c install-cron scripts/deploy/deploy-staging.sh` → `0`; `scripts/ci/check-backup-cron-wired.js` now fails on exactly this, see `reports/rules-audit/wave1-notes.md` §2). Assume the schedule is absent until you have looked. First confirm the schedule exists (`ls -l /etc/cron.d/gacp-backup`; if absent run `sudo /opt/gacp-platform/scripts/backup/install-cron.sh`), then take a fresh backup manually now (`sudo bash scripts/backup/pg-backup.sh`) | `ls -lt /var/backups/gacp/scheduled/daily | head -3` — newest dump < 24 h (`pg-backup.sh:40,75` writes into the `daily/` subdir) |
| G4 | Maintenance window announced — **every logged-in user (applicants and staff) is logged out by the JWT legs** (§2) | announcement sent |
| G5 | No deploy, migration, or blue/green cutover in flight; no `gacp-backend-blue`/`-green` container running | `docker ps --filter name=gacp-backend-` |

Context that makes this a *planned* rotation, not an emergency (operator ground
truth, 2026-08-04): the committed Redis default is **not** live — production
Redis already runs an override (AUTH with the committed value returns
`WRONGPASS`). `HEALTH_JWT_SECRET`/`PROVIDER_JWT_SECRET` were never committed;
they rotate because the same `.env.production` sat in the same leak window.

Committed-secret locations this event retires from service (never quote the
values): `docker-compose.production.yml:90,378` · `docker-compose.staging.yml:69`
· `docker-compose.bluegreen.yml:53` (Redis default) and
`docker-compose.qa.yml:50-52` (QA-only literal JWT values under legacy names —
isolated stack, no production impact; removal belongs to the compose-hardening
PR, not this runbook).

---

## 1. Ground rules for handling the values

1. **No secret ever appears in a command-line argument.** `sudo` journals its
   argv permanently, and `/proc/<pid>/cmdline` is world-readable. Every step
   below passes values via interactive prompts, root-only `0600` files, shell
   **builtins** (`printf`, assignment) inside one `sudo -s` shell, or awk's
   `ENVIRON[]` (the pattern `rotate-secret.sh:159-170` uses). Forbidden forms:
   `redis-cli -a <value>`, `psql -c "ALTER … PASSWORD '<value>'"` from a shell,
   `sed -i "s/…<value>…/"`, `docker exec -e VAR=<value>`.
   **Known residual exposure this runbook cannot remove:** the compose topology
   itself passes the Redis password as `redis-server --requirepass …` argv
   (`docker-compose.production.yml:378`), so the **new** value is readable via
   `ps`/`/proc` by any local user on the host for the container's lifetime.
   Accepted for this event; fixing the topology is follow-up §12.2.
2. **Never print the env files.** No `cat .env.production`. Verify with
   name-only greps and sha256 hashes (§3.1, §5.3, §8.2) that output counts and
   hashes, never values.
3. **Terminal hygiene.** Plain SSH session (port 2222) — no `tmux` logging, no
   `script(1)` recorder, no screen-sharing. Clear scrollback afterwards. Do not
   paste `docker inspect gacp-redis` output anywhere — its `Config.Cmd` holds
   the live `--requirepass` value.
4. **Nothing secret-bearing is created inside `/opt/gacp-platform`** — it is a
   git checkout (2026-08-03 near-miss, the change log). Backups go to
   `/var/backups/gacp/env-rotations/` (`0600`, dir `0700`); scratch files go to
   the `$WORKDIR` under `/root`. Exception: `set_env_line` (§5) makes a
   short-lived `mktemp` sibling of the env file itself — if the session dies
   mid-step, remove `/opt/gacp-platform/.env.*.??????` leftovers before anything
   else touches git (follow-up §12.3 adds a `.gitignore` guard).
5. **redis-cli sessions** always start with history disabled:
   `docker exec -it -e REDISCLI_HISTFILE=/dev/null gacp-redis redis-cli`.
6. **Charset for generated values: `A-Za-z0-9` only** (56–64 chars). The DB and
   Redis values are embedded in URLs (`docker-compose.production.yml:89-90`)
   and in the redis argv; `rotate-database-credential.md` §2.1 additionally
   allows `_-` — this runbook stays alphanumeric, which satisfies both. Files
   must stay LF (no CRLF).
7. **View-once accounting.** Generated values are displayed exactly at the
   marked `VIEW-ONCE` points: `db_password.new` in §6, `redis_password.new` and
   the extracted old Redis value in §8.3. Nowhere else, by anyone.
8. **Clipboard hygiene.** Every VIEW-ONCE paste routes the value through the
   operator workstation's clipboard. Before the window: turn off Windows
   clipboard history (Win+V) and cloud clipboard sync. After the window: copy
   something inert to overwrite the clipboard. A synced clipboard outlives
   every other cleanup in this runbook.

---

## 2. What each rotation touches (verified consumers)

There is **no dual-secret / grace mechanism anywhere**: JWT verification uses
exactly one secret per audience (`apps/backend/config/jwt-security.js:35-41`,
single-secret `jwt.verify`), and refresh tokens are signed with the **same**
per-audience secret (`generateRefreshToken`, `jwt-security.js:204-211`,
`expiresIn: '7d'`; the catalogued `REFRESH_TOKEN_SECRET` has no code reader).
Rotation is a hard cutover.

| Secret | Live store | Consumers that must converge | Blast radius |
|---|---|---|---|
| `DB_PASSWORD` | Postgres role `gacp` inside `gacp-postgres` (`POSTGRES_PASSWORD` env, `docker-compose.production.yml:317`, applies **only at first initdb** — env alone changes nothing) | Full checklist: `rotate-database-credential.md` §1 (8 mandatory + 5 conditional slots). In this window: backend `DATABASE_URL` composed in-compose (`docker-compose.production.yml:89`); `.env.staging` — staging shares the prod postgres container (`docker-compose.staging.yml:66-67`, network membership `:149-151`); literal `DATABASE_URL=` lines (deploy gates grep them: `scripts/deploy/deploy-production.sh:47-48`); `POSTGRES_PASSWORD` name-family duplicate (`scripts/deploy/deploy-preflight.sh:78-88`); pgAdmin saved servers (manual); **postgres-exporter if running** (`monitoring/docker-compose.monitoring.yml:104-109`, `DATA_SOURCE_NAME: ${DATABASE_URL}` — separate stack, check `docker ps`); team password manager | None until restart (pooled connections survive `ALTER ROLE`). Wrong password after restart = crash-loop (`apps/backend/services/prisma-database.js:46,126-141`: URL read once at boot, 10×5 s retries then exit 1). **Neither backup script is a validity check** — both are passwordless trust paths (`pg-backup.sh:80` unix socket; `backup-system.sh:55` in-container loopback TCP, which §3.4 shows is also `trust`). The RLS role `gacp_app` (`apps/backend/scripts/rls/prototype-staging-setup.sql:85`) is a **separate** credential — know it exists, do not rotate it here |
| `REDIS_PASSWORD` | `redis-server --requirepass` argv, applied only on container recreate (`docker-compose.production.yml:378`) | backend `REDIS_URL` composed in-compose (`:90`) feeding **three** independent client sets — `apps/backend/config/redis.js:16,25` (rate-limiter + cache), `apps/backend/services/redis-service.js:37` (cache + token revocation), `apps/backend/services/queue-service.js:38-43,68,100` (Bull queues `sla-monitor`, `webhook-dlq`, `pdf-generator`); `.env.staging` (`docker-compose.staging.yml:69`, same instance, DB index 1); literal `REDIS_URL=` lines (deploy gate `deploy-production.sh:47-48`). The backend never reads the `REDIS_PASSWORD` variable itself — only `REDIS_URL` | During an auth-desync window: access-token revocation **fails open** (traffic flows; CRITICAL `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE`, `apps/backend/services/token-revocation-service.js:178-180`), health login/refresh **fail closed** (`:328,414`), rate limiting falls back to per-process memory, Bull jobs stall silently. `config/redis.js:29` **gives up reconnecting after 10 attempts** — a backend that saw the gap stays degraded until recreated. Data survives (AOF on `gacp-redis-data`) |
| `HEALTH_JWT_SECRET` | `.env.production` (compose passthrough fail-closed, `docker-compose.production.yml:91`) | backend container; **`.env.staging`'s own `HEALTH_JWT_SECRET` line** — staging resolves `${STAGING_HEALTH_JWT_SECRET:-${HEALTH_JWT_SECRET:?}}` (`docker-compose.staging.yml:70`) from `.env.staging` itself (env-file interpolation), and that file began life as a `cp` of `.env.production` (`rotate-database-credential.md` §1.1 slot 4-5) — so it carries the same leaked value and **must be rewritten (§5.1)** | Every applicant logged out instantly: web (24 h access + 7 d refresh, same signing secret) and mobile (access-token only; 401 → login screen, no crash) |
| `PROVIDER_JWT_SECRET` | `.env.production` (`docker-compose.production.yml:92`) | backend container; **`.env.staging`'s own `PROVIDER_JWT_SECRET` line** (same mechanism, `docker-compose.staging.yml:71` — rewritten in §5.1) | Every staff member logged out instantly (12 h token, 8 h cookie, no refresh path); in-flight provider MFA setup/login tokens (10 min) break; staff mid-review lose unsaved form state |

**Alias lines are hygiene, not live fallbacks.** `jwt-security.js:35-41` does
fall back to `JWT_SECRET`/`DTAM_JWT_SECRET`, but the canonical names are
`:?`-required in production compose (`docker-compose.production.yml:91-92`) and
every reader prefers them — a stale `JWT_SECRET` literal **does** reach the
container (passthrough `JWT_SECRET=${JWT_SECRET:-}` at `:93`) yet is always
shadowed; `DTAM_JWT_SECRET` has no passthrough at all. Update the alias lines
(§5.2) so the file stays honest and the stale value drops out of the container
env at the §7 recreate — but do not triage login failures against them.

Not affected (verified): GitHub Actions secrets (no workflow references any of
the four; CI values are throwaway fixtures), the frontend container (zero
references under `apps/web-app`), nginx configs (no secrets), the daily backup
(socket trust), in-process node-cron jobs (`apps/backend/jobs/scheduler.js` —
no Redis dependency).

**Never set the two JWT secrets to the same value** — the server boots but logs
a portal-separation error (`jwt-security.js:91`); both must be ≥ 32 chars or
production boot fails (secrets-catalog gate).

**Window guidance.** Hands-on ≈ 30–45 min + 30 min watch; user impact = forced
re-login + ≈ 1–2 min API restart. Avoid, on **either** clock: 02:00–03:00
(host backup cron 02:17; PDPA sweep 02:30 Asia/Bangkok) and 08:00 UTC = 15:00
ICT (Bull `sla-monitor` cron `'0 8 * * *'`, `queue-service.js:57`, no timezone
option — container-local time; the backend env sets no `TZ`). The `webhook-dlq`
02:00 cron **cannot run in production** — `ENABLE_WEBHOOK_DLQ` is not passed
through the compose env at all (0 hits in `docker-compose.production.yml`).
20:00–23:00 ICT is a reasonable default.

---

## 3. Preflight (read-only — run before the window)

On the production host, root shell (`sudo -s`), `cd /opt/gacp-platform`.

```bash
# 3.1 Env-file inventory — prints names, counts, and hashes; NEVER values.
for f in .env.production .env.staging; do
  echo "== $f =="
  for k in DB_PASSWORD REDIS_PASSWORD HEALTH_JWT_SECRET PROVIDER_JWT_SECRET \
           DATABASE_URL REDIS_URL JWT_SECRET DTAM_JWT_SECRET \
           POSTGRES_PASSWORD POSTGRES_USER POSTGRES_DB DB_USER DB_NAME \
           STAGING_DB_NAME STAGING_HEALTH_JWT_SECRET STAGING_PROVIDER_JWT_SECRET \
           ALLOW_PENDING_SECRETS; do
    printf '%-30s present=%s has-ref=%s\n' "$k" \
      "$(grep -cE "^${k}=" "$f")" \
      "$(grep -cE "^${k}=.*\\\$\\{" "$f")"
  done
done
```

Decision rules for §5 (this detection replacing guesswork is the fix for the
drift class behind the 2026-08-04 outage):

- Secret lines (`DB_PASSWORD` etc.): always rewritten in §5.1.
- `DATABASE_URL`/`REDIS_URL`/alias lines with `has-ref=1` (they contain a
  `${…}` reference anywhere in the value): **leave them alone** — Docker
  Compose v2 expands `${VAR}` references *inside* the env file at load time
  (dotenv interpolation), so these lines track the canonical line
  automatically; §7.3's postgres-exporter (`DATA_SOURCE_NAME: ${DATABASE_URL}`)
  depends on exactly that expansion.
- Those lines with `present=1 has-ref=0`: **materialised literals embedding the
  old value** — must be rewritten in §5.2.
- `ALLOW_PENDING_SECRETS` must be `present=0`, or the boot-time secret gate is
  bypassed and a bad rotation boots instead of failing loudly
  (`apps/backend/config/boot-secret-guard.js`).
- Known state (operator-verified 2026-08-04): `^REDIS_PASSWORD=` count = 1 in
  both files.

```bash
# 3.2 Record running image tags — the converge is pinned to them.
docker inspect gacp-backend  --format '{{.Config.Image}}'
docker inspect gacp-frontend --format '{{.Config.Image}}'
docker inspect gacp-backend-staging --format '{{.Config.Image}}' 2>/dev/null   # if staging up
# IMAGE_TAG / STAGING_IMAGE_TAG for §7 are the part AFTER the last ':'
# (rotate-secret.sh:199-200 pattern).
```

If backend and frontend run different tags, stop and reconcile first.

```bash
# 3.3 Baselines + who else is running.
curl -fsS -o /dev/null -w 'prod  /api/health -> %{http_code}\n' http://127.0.0.1/api/health
docker exec gacp-backend curl -fsS -o /dev/null -w 'prod  /ready -> %{http_code}\n' http://localhost:8000/api/health/ready
docker ps --format '{{.Names}}' | grep -c staging || true       # 0 = staging down → skip its steps
curl -fsS -o /dev/null -w 'stag  /api/health -> %{http_code}\n' http://127.0.0.1:8001/api/health || true
docker ps --filter name=gacp-postgres-exporter --format '{{.Names}} {{.Status}}'   # if present: §7.3
docker ps --filter name=gacp-backend- --format '{{.Names}}'                        # blue/green must be empty (G5)

# 3.4 Predict §6's auth behaviour (no secrets in this file):
docker exec gacp-postgres cat /var/lib/postgresql/data/pg_hba.conf
```

On the stock `postgres:15-alpine` image, initdb-default lines make in-container
**loopback TCP and the unix socket `trust`** (no password asked), and only the
entrypoint-appended `host all all all scram-sha-256` line enforces the
password. §6's verification therefore deliberately connects to the container's
**eth0 address, not 127.0.0.1**. Confirm those lines now so you know what a
prompt (or its absence) means. (Prod backend publishes **no** host port — reach
it via host nginx `:80` or `docker exec`; staging publishes `127.0.0.1:8001`,
`docker-compose.staging.yml:62`.)

---

## 4. Generate the new values (root shell — §4–§6 all run from `$WORKDIR`)

```bash
sudo -s
umask 077
WORKDIR=/root/rotation-$(date -u +%Y%m%dT%H%M)
install -d -m 0700 "$WORKDIR"; cd "$WORKDIR"

tr -dc 'A-Za-z0-9' </dev/urandom | head -c 56 > db_password.new
tr -dc 'A-Za-z0-9' </dev/urandom | head -c 56 > redis_password.new
tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64 > health_jwt.new
tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64 > provider_jwt.new

wc -c ./*.new           # alphabetical: db 56, health_jwt 64, provider_jwt 64, redis 56 (total 240)
sort ./*.new | uniq -d | wc -l                 # 0 = all four distinct
```

The values now exist **only** in these `0600` files, until the `VIEW-ONCE`
points listed in §1.7.

---

## 5. Back up and rewrite the env files (atomic)

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ); echo "$TS"      # note it down — §10 needs it if this shell is gone
install -d -m 0700 /var/backups/gacp/env-rotations
for f in .env.production .env.staging; do
  cp "/opt/gacp-platform/$f" "/var/backups/gacp/env-rotations/${f}-${TS}.manual.bak"
  chmod 0600 "/var/backups/gacp/env-rotations/${f}-${TS}.manual.bak"
done
```

The rewrite helper (awk-`ENVIRON` — value travels via environment, never argv;
refuses missing lines **and empty value files**, the failure shape that set an
empty DB password last time, `rotate-database-credential.md` §3.1):

```bash
set_env_line() {  # set_env_line <env-file> <NAME> <value-file>
  local f="$1" key="$2" vf="$3" tmp
  [ -s "$vf" ] || { echo "ABORT: value file ${vf} missing or empty" >&2; return 1; }
  grep -qE "^${key}=" "$f" || { echo "ABORT: no ${key}= line in ${f} — refusing to add one" >&2; return 1; }
  tmp="$(mktemp "${f}.XXXXXX")" || return 1
  chmod 0600 "$tmp"
  if NEW_VALUE="$(cat "$vf")" awk -v key="$key" '
       substr($0, 1, length(key) + 1) == key "=" { print key "=" ENVIRON["NEW_VALUE"]; next }
       { print }' "$f" > "$tmp"; then
    mv "$tmp" "$f" && chmod 0600 "$f"
  else
    rm -f "$tmp"; echo "ABORT: rewrite failed for ${key}" >&2; return 1
  fi
}
```

**5.1 Canonical lines — always:**

```bash
E=/opt/gacp-platform/.env.production
S=/opt/gacp-platform/.env.staging
set_env_line "$E" DB_PASSWORD          db_password.new
set_env_line "$E" REDIS_PASSWORD       redis_password.new
set_env_line "$E" HEALTH_JWT_SECRET    health_jwt.new
set_env_line "$E" PROVIDER_JWT_SECRET  provider_jwt.new
set_env_line "$S" DB_PASSWORD          db_password.new
set_env_line "$S" REDIS_PASSWORD       redis_password.new
set_env_line "$S" HEALTH_JWT_SECRET    health_jwt.new
set_env_line "$S" PROVIDER_JWT_SECRET  provider_jwt.new
```

The last two lines are load-bearing: `.env.staging` carries its **own** copies
of the JWT lines (it began as a `cp` of `.env.production`), and §7.2's
`--env-file .env.staging` resolves the compose fallback
`${STAGING_HEALTH_JWT_SECRET:-${HEALTH_JWT_SECRET:?}}` from that file — leaving
them stale keeps the leaked secrets **live on staging** after the window. If
`set_env_line` aborts because a JWT line is missing from `.env.staging`, check
the §3.1 inventory: `STAGING_HEALTH_JWT_SECRET`/`STAGING_PROVIDER_JWT_SECRET`
must then exist (rotate those per §5.2) or §7.2 will fail on the `:?`.

**5.2 Conditional lines — exactly as decided from the §3.1 inventory:**

```bash
# Only for lines that were present=1 has-ref=0 (materialised literals):
DB_USER_VAL="$(grep -E '^DB_USER=' "$E" | head -1 | cut -d= -f2-)"; DB_USER_VAL="${DB_USER_VAL:-gacp}"
DB_NAME_VAL="$(grep -E '^DB_NAME=' "$E" | head -1 | cut -d= -f2-)"; DB_NAME_VAL="${DB_NAME_VAL:-gacp_db}"
STG_DB_VAL="$(grep -E '^STAGING_DB_NAME=' "$S" | head -1 | cut -d= -f2-)"; STG_DB_VAL="${STG_DB_VAL:-gacp_staging}"

printf 'postgresql://%s:%s@postgres:5432/%s?schema=public\n' "$DB_USER_VAL" "$(cat db_password.new)" "$DB_NAME_VAL" > database_url.new
printf 'postgresql://%s:%s@postgres:5432/%s?schema=public\n' "$DB_USER_VAL" "$(cat db_password.new)" "$STG_DB_VAL"  > database_url_staging.new
printf 'redis://:%s@redis:6379\n'   "$(cat redis_password.new)" > redis_url.new
printf 'redis://:%s@redis:6379/1\n' "$(cat redis_password.new)" > redis_url_staging.new
chmod 0600 ./*.new

set_env_line "$E" DATABASE_URL database_url.new          # only if literal
set_env_line "$E" REDIS_URL    redis_url.new             # only if literal
set_env_line "$S" DATABASE_URL database_url_staging.new  # only if literal (staging DB name differs!)
set_env_line "$S" REDIS_URL    redis_url_staging.new     # only if literal
```

(`printf` is a bash builtin — the value expands inside the shell, not in any
external command's argv.)

- `POSTGRES_PASSWORD` present (deploy-preflight name family,
  `deploy-preflight.sh:78-88`) → `set_env_line` it to `db_password.new` too.
- `JWT_SECRET` / `DTAM_JWT_SECRET` present as literals → set to the same new
  values as `HEALTH_JWT_SECRET` / `PROVIDER_JWT_SECRET` respectively (hygiene —
  see §2; retirement is follow-up §12.6).
- `STAGING_HEALTH_JWT_SECRET` / `STAGING_PROVIDER_JWT_SECRET` present → rotate
  them too (fresh distinct values, same generation recipe as §4) — they
  override the fallback chain entirely, so skipping them would keep old staging
  sessions alive.

**5.3 Verify the rewrite (value-free):**

```bash
hash_of() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2- | tr -d '\r\n' | sha256sum | cut -c1-12; }

for k in DB_PASSWORD REDIS_PASSWORD HEALTH_JWT_SECRET PROVIDER_JWT_SECRET; do
  printf '%-22s count=%s hash=%s\n' "$k" "$(grep -cE "^${k}=" "$E")" "$(hash_of "$E" "$k")"
done
[ "$(hash_of "$E" DB_PASSWORD)"    = "$(sha256sum < db_password.new    | cut -c1-12)" ] && echo DB_MATCH
[ "$(hash_of "$E" REDIS_PASSWORD)" = "$(sha256sum < redis_password.new | cut -c1-12)" ] && echo REDIS_MATCH
[ "$(hash_of "$E" DB_PASSWORD)"    = "$(hash_of "$S" DB_PASSWORD)" ]    && echo PROD_STAGING_DB_MATCH
[ "$(hash_of "$E" REDIS_PASSWORD)" = "$(hash_of "$S" REDIS_PASSWORD)" ] && echo PROD_STAGING_REDIS_MATCH
[ "$(hash_of "$E" HEALTH_JWT_SECRET)"   = "$(hash_of "$S" HEALTH_JWT_SECRET)" ]   && echo PROD_STAGING_HJWT_MATCH
[ "$(hash_of "$E" PROVIDER_JWT_SECRET)" = "$(hash_of "$S" PROVIDER_JWT_SECRET)" ] && echo PROD_STAGING_PJWT_MATCH
# If §5.1 aborted on missing staging JWT lines (STAGING_* configuration), the two
# *JWT_MATCH echoes will not appear — instead compare hash_of "$S" STAGING_*
# against the fresh value files you generated for them.
stat -c '%a %n' "$E" "$S"                                                # both 600
docker compose --env-file "$E" -f /opt/gacp-platform/docker-compose.production.yml config --quiet && echo COMPOSE_OK
docker compose --env-file "$S" -f /opt/gacp-platform/docker-compose.production.yml \
    -f /opt/gacp-platform/docker-compose.staging.yml config --quiet && echo COMPOSE_STAGING_OK
```

(Absolute `-f` path — this shell is still in `$WORKDIR`. Never run `config`
without `--quiet`: the resolved output contains every secret.)

---

## 6. Change the Postgres password — and prove it — before any restart

The DB leg's full rules live in `rotate-database-credential.md` §3–§5; this
section is the same procedure compressed for the coordinated window. Existing
pooled connections keep working after `ALTER ROLE` (Postgres authenticates at
connect time only), so the old backend keeps serving meanwhile.

```bash
cat db_password.new        # VIEW-ONCE (1 of 3, §1.7) — you paste it twice below

docker exec -it gacp-postgres psql -U gacp -d postgres
postgres=# \password gacp
postgres=# \q
```

`\password` sends a client-side SCRAM hash — plaintext reaches neither server
logs nor argv. **If you hit Enter on an empty prompt, psql really sets an empty
password** (`rotate-database-credential.md` §5 ขั้นที่ 3) — which is why the next
check is mandatory, and why `ALTER ROLE` returning success proves nothing.

**Prove store↔env consistency now, not after the restart:**

```bash
# Connect to the container's eth0 address — NOT 127.0.0.1 and NOT the socket.
# initdb-default pg_hba makes loopback/socket 'trust' (no password asked); only
# non-loopback TCP hits the appended 'host all all all scram-sha-256' line (§3.4).
docker exec -it gacp-postgres sh -c 'psql -h "$(hostname -i)" -U gacp -d gacp_db -c "SELECT 1;"'
```

**psql MUST prompt for a password here** (paste the §6 value — this is the same
view-once). Then:

- Prompt appeared + `1` row → the store matches the file; proceed to §7.
- Prompt appeared + `password authentication failed` → `\password` again.
- **No prompt appeared → the check proved nothing** — the address matched a
  trust rule. Re-read §3.4's pg_hba output and verify instead from a one-shot
  client container: `docker run --rm -it --network gacp-network
  postgres:15-alpine psql -h postgres -U gacp -d gacp_db -c 'SELECT 1;'`
  (prompts; nothing in argv). Do not continue on an unproven password.

(The sibling runbook's own check 7.3 uses `-h 127.0.0.1` + `PGPASSWORD` and is
subject to the same trust caveat — follow-up §12.7.)

Optional, leak-driven rotations only: after §7, kill sessions still
authenticated under the old password from psql. Note the unfiltered form also
kills the **healthy new-password pools** of both backends (Prisma reconnects;
expect a brief error blip during the §8.6 watch) — filter by connection age to
target only pre-rotation sessions:
`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'gacp' AND pid <> pg_backend_pid() AND backend_start < '<§7.1 wall-clock time>';`

(§6's psql commands use `gacp`/`gacp_db` — the compose defaults
`${DB_USER:-gacp}`/`${DB_NAME:-gacp_db}`; if §3.1 showed `DB_USER`/`DB_NAME`
overrides, substitute those values here.)

---

## 7. The converge — one targeted wave

> Freeze reminder: forbidden until §0 G1+G2 are satisfied.

Working-directory model from here on: **§7–§9 run from `/opt/gacp-platform`**,
except every operation touching a value file, which returns to `$WORKDIR`
first (§8.3, §8.5) — no secret-bearing file is ever created in the checkout.

**7.1 Production** — recreate exactly `redis` and `backend`, tag-pinned:

```bash
cd /opt/gacp-platform
IMAGE_TAG=<tag-from-§3.2> docker compose --env-file .env.production \
    -f docker-compose.production.yml up -d --no-deps redis backend
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

`postgres` is deliberately **not** recreated: its only env change
(`POSTGRES_PASSWORD`) is inert on an existing volume, so skipping it means zero
DB downtime. Note the consequence: the **next** full `docker compose … up -d`
(e.g. the next deploy) will recreate `gacp-postgres` because of that pending
env diff — expected, harmless, a ~15 s DB restart at deploy time.

**7.2 Staging — immediately after 7.1.** From the moment 7.1 lands, the old
staging container runs **degraded, not crashed** — Redis auth failures
(`WRONGPASS` spam, health logins fail closed, queues stall, and
`config/redis.js:29` stops retrying), while its pooled DB connections limp on —
so a green `docker ps` proves nothing; recreate it now. Staging is an
overlay; single-file invocation fails on the undeclared `gacp-network`
(`docker-compose.staging.yml:32-34` vs `:151`) — always the two-file form
`deploy-staging.sh:134-137` uses:

```bash
STAGING_IMAGE_TAG=<staging-tag-from-§3.2> docker compose --env-file .env.staging \
    -f docker-compose.production.yml -f docker-compose.staging.yml \
    up -d --no-deps backend-staging
```

(`STAGING_IMAGE_TAG` pinning mirrors §7.1's `IMAGE_TAG` — unpinned, the
staging image falls back to `main-latest` (`docker-compose.staging.yml:54`)
and a silent re-image would masquerade as a rotation failure in §8.)

**7.3 postgres-exporter** — only if §3.3 showed `gacp-postgres-exporter`
running: recreate it from `monitoring/docker-compose.monitoring.yml` with the
updated env (or stop it for now and note it); otherwise it will sit retrying
Postgres auth with the old URL and DB metrics silently die.

---

## 8. Verify battery

**8.1 Up + healthy** (prod backend publishes no host port — via nginx or exec):

```bash
curl -fsS -o /dev/null -w 'prod /api/health -> %{http_code}\n' http://127.0.0.1/api/health
docker exec gacp-backend curl -fsS http://localhost:8000/api/health/ready | head -c 200; echo
curl -fsS -o /dev/null -w 'stag /api/health -> %{http_code}\n' http://127.0.0.1:8001/api/health
curl -fsS http://127.0.0.1:8001/api/health/ready | head -c 200; echo   # expect "status":"READY"
```

**8.2 Containers hold the new values — by hash, never by value**
(`rotate-database-credential.md` §7.1–7.2 pattern; `hash_of` from §5.3):

```bash
docker exec gacp-backend printenv DATABASE_URL | sed -E 's#^.*://[^:]+:([^@]+)@.*$#\1#' | tr -d '\n' | sha256sum | cut -c1-12
hash_of /opt/gacp-platform/.env.production DB_PASSWORD          # must match the line above
docker exec gacp-backend printenv REDIS_URL | sed -E 's#^redis://:([^@]+)@.*$#\1#' | tr -d '\n' | sha256sum | cut -c1-12
hash_of /opt/gacp-platform/.env.production REDIS_PASSWORD       # must match
docker exec gacp-backend-staging printenv DATABASE_URL | grep -oE '@[^?]+'   # host + DB name only (never the credential); must show the STAGING db
```

**8.3 Redis auth — new value works, old override is dead** (value files live in
`$WORKDIR`, never in the checkout — §1.4):

```bash
cd "$WORKDIR"
cat redis_password.new       # VIEW-ONCE (2 of 3)
grep -E '^REDIS_PASSWORD=' "/var/backups/gacp/env-rotations/.env.production-${TS}.manual.bak" \
  | head -1 | cut -d= -f2- | tr -d '\r\n' > old_redis.check
[ -s old_redis.check ] || { echo 'ABORT: empty extraction — wrong TS; do NOT run the AUTH test'; false; }
# Run the guard line above ON ITS OWN and confirm no ABORT before continuing —
# a wholesale paste would sail past it into the redis-cli session.
chmod 0600 old_redis.check
cat old_redis.check          # VIEW-ONCE (3 of 3)

docker exec -it -e REDISCLI_HISTFILE=/dev/null gacp-redis redis-cli
127.0.0.1:6379> AUTH <paste new value>     # OK
127.0.0.1:6379> PING                       # PONG
127.0.0.1:6379> AUTH <paste old value>     # (error) WRONGPASS ← previous override retired
127.0.0.1:6379> quit

shred -u old_redis.check
cd /opt/gacp-platform
```

(The committed compose default was already dead before this event — §0. This
step proves the *pre-rotation override* is retired too.)

**8.4 Logs clean** (greps print log text, never env values):

```bash
docker logs --since 15m gacp-backend 2>&1 | grep -ciE 'wrongpass|noauth|ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE'    # 0
docker logs --since 15m gacp-backend 2>&1 | grep -ciE 'authentication failed|P1000|Failed to connect to PostgreSQL'  # 0
docker logs --since 15m gacp-backend 2>&1 | grep -ciE 'queue.*(ready|started|registered)'                       # ≥ 1
docker logs --since 15m gacp-backend-staging 2>&1 | grep -ciE 'wrongpass|noauth|authentication failed|P1000'     # 0 (if staging up)
```

**8.5 Logins work** (`rotate-database-credential.md` §7.5 — the check that was
missed last time; test accounts only; status code only). The body goes through
a `0600` file — a credential in `curl -d '<json>'` argv would be world-readable
in `/proc` and land in shell history (§1.1):

```bash
printf '{"healthId":"%s","password":"%s"}' '<test-account>' '<test-account-password>' > "$WORKDIR/login.json"
chmod 0600 "$WORKDIR/login.json"

curl -s -o /dev/null -w 'prod login -> %{http_code}\n' \
  -X POST http://127.0.0.1/api/auth/health/login \
  -H 'Content-Type: application/json' -d @"$WORKDIR/login.json"
# 200 or 401 = DB path works (401 = wrong test creds, still proof). 5xx = FAIL → logs.
curl -s -o /dev/null -w 'stag login -> %{http_code}\n' \
  -X POST http://127.0.0.1:8001/api/auth/health/login \
  -H 'Content-Type: application/json' -d @"$WORKDIR/login.json"
```

(`printf` is a builtin — the credential reaches no external argv; it does enter
this root shell's history, which §9 clears.)

Also log in via the web UI: health portal + provider portal (incl. MFA). Old
browser sessions must bounce to login with `?expired=true` — that is the
designed outcome, not a failure.

**8.6 The 30-minute watch — mandatory.** **No alert rule is loaded at all**
(`rotate-database-credential.md` §9: prometheus mounts no `rule_files`, no
alertmanager service deployed, 19 rules in `monitoring/alerts.yml` never
loaded) — nothing will page you if this rotation half-failed. Watch
`docker logs -f gacp-backend` for ~30 min and **re-run 8.1 + 8.5 at the end**:
pooled DB connections opened before the window expire during this period, which
is exactly when the previous incident surfaced. Tell the team a rotation just
happened.

Next-day: fresh backup file in `/var/backups/gacp/scheduled/daily`
(`/var/log/gacp-backup.log`); no `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE`
overnight; `sla-monitor` ran at 08:00 UTC (15:00 ICT). Known pre-existing
breakage, not rotation-caused: `scripts/backup/backup-system.sh:106` (redis
`BGSAVE` without AUTH → `NOAUTH` whenever requirepass is active). Its DB step
(`:55`) is passwordless loopback-trust like `pg-backup.sh` — running either
confirms backup availability only; **the only accepted password proof is §6's
non-loopback check**.

---

## 9. Audit trail + cleanup

```bash
for s in DB_PASSWORD REDIS_PASSWORD HEALTH_JWT_SECRET PROVIDER_JWT_SECRET; do
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ROTATED secret=${s} actor=${SUDO_USER:-root} backup=/var/backups/gacp/env-rotations/.env.production-${TS}.manual.bak method=manual-runbook" \
    >> /var/log/gacp-secret-rotations.log
done
chmod 0600 /var/log/gacp-secret-rotations.log
tail -6 /var/log/gacp-secret-rotations.log

shred -u "$WORKDIR"/*.new "$WORKDIR"/login.json 2>/dev/null; rmdir "$WORKDIR"
history -c
exit          # close the root shell; clear terminal scrollback + clipboard (§1.8)
```

- pgAdmin: saved server registrations (volume `gacp-pgadmin-data`) still hold
  the old DB password — team members re-enter it on next use
  (`rotate-database-credential.md` §7.7).
- **Update the team password manager** (`rotate-database-credential.md` §1.2
  slot 13) — otherwise the next person uses the old values.
- Old values persist in the two `.manual.bak` files (root-only `0600` — that is
  the rollback path; prune after the rotation has soaked) and in
  `backup-system.sh` tarballs, which archive `apps/backend/.env.production`
  (`scripts/backup/backup-system.sh:90`) — verify those archives' permissions.
- The retired Redis default remains in **git history**; after this rotation it
  is dead everywhere, which is the point.
- Residual: the new Redis value sits in `redis-server` argv (§1.1) until
  follow-up §12.2 lands.
- Update `docs/security/secrets-catalog-2026-05-16.md` (rotation date); next
  routine JWT rotation stays on `secret-rotation.md` §1's quarterly cadence.

---

## 10. Rollback (per leg — self-contained; assume the §4 shell is gone)

Open a **new** root shell first:

```bash
sudo -s
umask 077
RB=/root/rollback-$(date -u +%Y%m%dT%H%M); install -d -m 0700 "$RB"; cd "$RB"
WORKDIR="$RB"        # so §8.3/§8.5 re-runs from this shell keep their files here, not at /
ls -1tA /var/backups/gacp/env-rotations/ | head -4    # -A: the backups are dot-files — plain ls shows nothing
BAK_P=/var/backups/gacp/env-rotations/<newest .env.production-*.manual.bak>
BAK_S=/var/backups/gacp/env-rotations/<newest .env.staging-*.manual.bak>
# Re-paste the set_env_line definition from §5 into this shell.

old_of() {  # old_of <bak-file> <NAME> <out-file> — extract to file, never to screen
  grep -E "^$2=" "$1" | head -1 | cut -d= -f2- | tr -d '\r\n' > "$3"
  [ -s "$3" ] || { echo "ABORT: empty extraction for $2 from $1" >&2; return 1; }
  chmod 0600 "$3"
}
```

The `[ -s ]` guards are load-bearing: an empty extraction written back as
`REDIS_PASSWORD=` makes compose's `${REDIS_PASSWORD:-…}` fall back to the
**committed, leaked default** (`docker-compose.production.yml:90,378`) — never
skip them (`rotate-database-credential.md` §3's `:?` rule).

| Failing leg | Symptoms | Rollback |
|---|---|---|
| DB | backend crash-loop; `Failed to connect to PostgreSQL` / `P1000` | Follow `rotate-database-credential.md` §8 (authoritative), using `old_of "$BAK_P" DB_PASSWORD old.db` for the old value (view once when pasting into `\password`); also restore any literal `DATABASE_URL` lines and the `POSTGRES_PASSWORD` family via `set_env_line` from `old.*` files, in **both** env files; then re-run §7.1 + 7.2 |
| Redis | `WRONGPASS`/`NOAUTH` in backend logs; blocklist-outage events keep firing | `old_of "$BAK_P" REDIS_PASSWORD old.redis`; `set_env_line` `REDIS_PASSWORD` (+ literal `REDIS_URL` lines) back in **both** env files; re-run §7.1 + 7.2 — `redis` and `backend` must recreate together (`config/redis.js:29` never self-heals) |
| JWT | backend refuses boot (secret gate) or **new** logins fail on one portal | `old_of` the JWT (+ alias) lines back into `.env.production` from `$BAK_P` **and** the `HEALTH_JWT_SECRET`/`PROVIDER_JWT_SECRET` lines in `.env.staging` from `$BAK_S` (plus `STAGING_*` if §5.2 rotated them); then from `/opt/gacp-platform`: `IMAGE_TAG=<pinned> docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps backend` **and** the §7.2 staging command. Tokens issued during the failed window die — users re-login once more |
| Everything | multiple legs wrong, cause unclear | `cp` both `.manual.bak` files back whole (`chmod 0600`), `\password` back to the old DB value, re-run §7.1–7.3, restart diagnosis at §3 |

Compose commands in this table run from `/opt/gacp-platform`; value-file work
stays in `$RB`. Finish every rollback with:
`shred -u "$RB"/old.* "$RB"/login.json 2>/dev/null; rmdir "$RB"`,
`history -c` in this shell (a §8.5 re-run puts the test credential in its
history too), a `ROLLBACK` line in `/var/log/gacp-secret-rotations.log`, and a
§8 re-verify.

---

## 11. Failure-mode quick reference

| Symptom | Cause | Fix |
|---|---|---|
| §6 verify never prompted for a password | connection matched an initdb-default `trust` line (loopback/socket) — check proved nothing | §6 fallback: client container on `gacp-network`; read §3.4 pg_hba output |
| Backend crash-loops ~50 s after converge with Postgres auth errors | `\password` skipped/typo'd/empty-Enter, or a literal `DATABASE_URL=` line kept the old value | §6 again; §5.2 URL leg; `rotate-database-credential.md` §8.2 for the empty-password case |
| `WRONGPASS` spam + rate-limiter "falling back to memory", not recovering | redis/backend recreated at different times, or only one of requirepass↔`REDIS_URL` changed; `config/redis.js:29` gave up | one §7.1 wave recreating both; backend recreate is mandatory |
| `service "backend-staging" refers to undefined network` | staging invoked single-file | two-file form (§7.2) |
| Backend refuses boot after the converge | a JWT value < 32 chars — boot-secret-guard exits 1 on `TOO_SHORT` | regenerate (§4), rewrite (§5), reconverge; §10 JWT leg if stuck. Do **not** chase alias lines — they can't cause this (§2) |
| Portal-separation error in backend logs | `HEALTH_JWT_SECRET` == `PROVIDER_JWT_SECRET` (boots and logins still work — `jwt-security.js:91` is log-only) | regenerate two distinct values and re-converge |
| Backend silently re-imaged (up/downgrade) | `IMAGE_TAG` not pinned in §7.1 — compose falls back to `deploy-production-latest` (the 2026-04-28 `rotate-secret.sh` incident class, `:184-195`) | §3.2 gate; re-run §7.1 with the pinned tag |
| `deploy-preflight.sh` fails later | `POSTGRES_PASSWORD` family not updated | §5.2 |
| Next staging deploy fails at migrate | `.env.staging` not mirrored | §5.1 |
| DB metrics gone | postgres-exporter still on old URL | §7.3 |
| Duplicate notifications within ~1 h | `notify:dedupe:*` keys lost in restart | benign; self-heals |
| `NOAUTH` from backup-system.sh | pre-existing (no AUTH sent, `:106`) | not rotation-caused; §12.5 |
| CRITICAL `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE` events | expected only inside the §7 window | if continuing after §8 passes → §10 Redis leg |

---

## 12. Follow-ups this rotation exposes (proposals only — separate PRs, operator decides)

1. **Coordinated rotation tooling** — `rotate-secret.sh` can't do any of this
   (allow-list `:55-62`, single line, single file, backend-only restart);
   automating a two-sided multi-file rotation is a design task
   (`rotate-database-credential.md` §0.2 reached the same conclusion).
2. **Move `--requirepass` out of argv** into a root-owned `0600` redis conf/ACL
   file mounted into the container — removes the world-readable `/proc` exposure
   (§1.1) and the `docker inspect` leak (§1.3).
3. **`.gitignore` guard** for `.env.production.*` / `.env.staging.*` — covers
   `set_env_line`/`rotate-secret.sh:153` mktemp leftovers after an interrupted
   run.
4. **Redis healthcheck** (prod `redis` has none) — also unbreaks the blue/green
   overlay's `service_healthy` dependency; pass the password via `REDISCLI_AUTH`
   env, never argv.
5. **`backup-system.sh`**: redis `BGSAVE` sends no AUTH (`:106`) — broken under
   requirepass regardless of rotation.
6. **Alias debt**: retire `JWT_SECRET`/`DTAM_JWT_SECRET` env lines and the
   `jwt-security.js:35-41` fallbacks once confirmed dead; same for the
   never-read `REFRESH_TOKEN_SECRET` catalog entry.
7. **Sibling-runbook amendments** (`rotate-database-credential.md`): its check
   7.3 (`-h 127.0.0.1` + `PGPASSWORD`) doesn't exercise password auth under the
   image's initdb-default pg_hba (loopback trust — same class as this doc's §6
   fix), and its 7.4 curls prod on `127.0.0.1:8000`, a port production does not
   publish (backend has no host port; staging is `:8001`).
8. **Set `STAGING_HEALTH_JWT_SECRET`/`STAGING_PROVIDER_JWT_SECRET`** so staging
   sessions decouple from prod JWT rotations (`docker-compose.staging.yml:70-71`).
9. **Name-family unification** — deploy-preflight wants `POSTGRES_*`
   (`deploy-preflight.sh:78-88`) while compose interpolates `DB_*`; two names
   for one credential is standing drift risk.
10. **Stale sibling details** — `secret-rotation.md` still shows the old `:8000`
    smoke URL (superseded by `rotate-secret.sh:49`); `docker-log-caps.md`
    references `~/.env.production` instead of `/opt/gacp-platform/.env.production`.
11. **Alerting** — the 19 never-loaded rules in `monitoring/alerts.yml`
    (`rotate-database-credential.md` §9) are the reason §8.6's manual watch
    exists at all.

---

## 13. Related

- `docs/operations/runbooks/rotate-database-credential.md` — DB leg authority (INCIDENT-2026-08-04)
- `docs/operations/runbooks/secret-rotation.md` — routine JWT/QR/webhook/encryption rotation
- `docs/operations/env-layering.md` — which env value comes from which layer
- `scripts/maintenance/rotate-secret.sh` — the single-location rotator (allow-list `:55-62`)
- `scripts/backup/pg-backup.sh` + `/etc/cron.d/gacp-backup` — daily DB backup
- `docs/security/secrets-catalog-2026-05-16.md` — canonical secret inventory
- the change log — the 2026-08-04 compose-freeze order and the incident behind it
