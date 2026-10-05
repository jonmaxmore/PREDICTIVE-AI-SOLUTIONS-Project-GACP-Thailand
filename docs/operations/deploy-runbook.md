# GACP Platform — Production Deploy Runbook

**Last updated:** 2026-04-26 · **truth-checked:** 2026-08-14
**Audience:** anyone with SSH access to the production droplet

> **2026-08-14 — no part of this deploy happens automatically.** GitHub Actions is
> permanently unavailable (operator ruling, the change log 2026-08-14), so the
> `promote-deploy-branch` and `deploy` jobs described below cannot run — and the
> promote job was already `if: false` by L5 (NO AUTO-DEPLOY) before that. Images are
> built on the box (`docs/operations/runbooks/build-images-on-the-box.md`), and the
> operator runs the deploy script by hand. Read the branch model below as *the state
> the server should be in*, not as a pipeline that moves it there.

---

## Branch model

```
main                  ← integration / always shippable
  ↓ (fast-forward performed by the operator — the auto-FF job cannot run)
deploy/production     ← canonical production state; what the server runs
  ↓ (operator runs scripts/deploy/deploy-production.sh on the host)
production server     ← /opt/gacp-platform on droplet, HEAD must = origin/deploy/production
```

**Invariants** (enforced by `scripts/deploy/deploy-production.sh`):

1. Production server's working tree is clean — `git status` returns empty.
2. `HEAD == origin/deploy/production` exactly. No drift.
3. Required env vars exist in `/opt/gacp-platform/.env.production`.
4. All secrets at least 32 chars (per env-validator).

---

## Standard deploy (happy path)

```bash
# 1. Ship a feature branch through PR → main.
#    PR must be approved + CI green (branch protection enforces this).

# 2. CI auto-promotes main → deploy/production
#    (workflow: .github/workflows/ci.yml job: promote-deploy-branch)
#    If deploy/production has unique commits, an auto-PR is opened instead.

# 3. CI deploys deploy/production
#    (workflow: ci.yml job: deploy → SSHes the server and runs:)
ssh root@203.0.113.10 /opt/gacp-platform/scripts/deploy/deploy-production.sh
```

The script handles:

| Step | What | Failure exit code |
| :--- | :--- | :--- |
| 1 | Pre-flight (clean tree, branch, env vars) | 1 |
| 2 | `pg_dump` to `/var/backups/gacp/gacp-pre-deploy-{ts}.sql.gz` | 2 |
| 3 | `git fetch && git merge --ff-only origin/deploy/production` | 1 |
| 4 | `prisma migrate deploy` (in backend container) | 3 |
| 5 | Rebuild + rolling restart of `backend` + `frontend` only | 4 |
| 6 | Curl `/api/health` (5 retries) | 5 |
| 7 | Audit log to `/var/log/gacp-deploys/{ts}.log` | – |

---

## Manual deploy (when CI is unavailable)

```bash
ssh root@203.0.113.10
cd /opt/gacp-platform
./scripts/deploy/deploy-production.sh
```

Same script. Same guards.

---

## Rollback

The deploy script logs a rollback recipe at the bottom of every successful
deploy log. To roll back the most recent deploy:

```bash
ssh root@203.0.113.10
cd /opt/gacp-platform
ls -t /var/log/gacp-deploys/ | head -2          # find current + previous log
tail -20 /var/log/gacp-deploys/<previous>.log    # find OLD_HEAD line

# Reset code to previous HEAD
git fetch origin deploy/production
git reset --hard <previous-OLD_HEAD>

# Rebuild + restart
docker compose --env-file .env.production -f docker-compose.production.yml \
    up -d --build --no-deps backend frontend

# If migration regression, restore DB
zcat /var/backups/gacp/gacp-pre-deploy-<ts>.sql.gz | \
    docker compose --env-file .env.production -f docker-compose.production.yml \
    exec -T postgres psql -U gacp gacp_db
```

---

## Required env vars

The script aborts unless **all** of these are set in `/opt/gacp-platform/.env.production`:

| Variable | Purpose | Min length |
| :--- | :--- | :--- |
| `DATABASE_URL` | Postgres connection | – |
| `REDIS_URL` | Redis connection | – |
| `HEALTH_JWT_SECRET` | Health-portal JWT signing | 32 chars |
| `PROVIDER_JWT_SECRET` | Provider-portal JWT signing | 32 chars |
| `ENCRYPTION_KEY` | AES-256-GCM envelope of PII | 32 chars |
| `QR_SIGNATURE_FALLBACK_SECRET` | HMAC fallback for QR signing (must NOT equal any JWT secret) | 32 chars |
| `PAYMENT_WEBHOOK_SECRET` | HMAC verifier for gateway callbacks | 32 chars |

Optional but strongly recommended:

| Variable | Default if unset | Behaviour change |
| :--- | :--- | :--- |
| `MASTER_ENCRYPTION_KEY` | falls back to a generated dev key | warning logged |
| `BCRYPT_ROUNDS` | `12` | – |
| `COOKIE_SECURE` | `true` (when `NODE_ENV=production`) | cookies served only over HTTPS |
| `COOKIE_DOMAIN` | – | scoped cookies |
| `REQUIRE_MFA_FOR_PRIVILEGED` | `false` | when `true`, admins/providers require MFA |
| `BILLING_FREE_TIER_FOR_ALL` | `false` | when `true`, all users get PREMIUM features (introductory promo) |

---

## GitHub branch protection (one-time setup)

These settings make the runbook above enforceable, not just aspirational.
Open https://github.com/jonmaxmore/GACP-Certification-Application/settings/branches
and add a rule for each protected branch:

### `main` rule

- ✅ Require a pull request before merging
  - Required approvals: **1** (or self-approve as solo until team grows)
  - Dismiss stale approvals when new commits are pushed
- ✅ Require status checks to pass before merging
  - Required:
    - `System Integrity Check`
    - `Lint & Format`
    - `Test`
    - `Auth Hardening Gate`
    - `Build Success`
- ✅ Require conversation resolution before merging
- ✅ Require linear history
- ✅ Restrict who can push to matching branches → empty list (no direct push)
- ❌ Do NOT allow force pushes
- ❌ Do NOT allow deletions

### `deploy/production` rule

- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - Required: `Build Success`
- ❌ Do NOT allow force pushes
- ❌ Do NOT allow deletions
- ✅ Restrict pushes to: `github-actions[bot]` (and yourself for emergency)

---

## Image-based deploy (Level 4)

Ship containers, not source code. Every push to `main` and `deploy/production`
triggers `.github/workflows/build-images.yml` which:

1. Builds backend + frontend images.
2. Pushes to **GHCR** (GitHub Container Registry) at:
   - `ghcr.io/jonmaxmore/gacp-backend`
   - `ghcr.io/jonmaxmore/gacp-frontend`
3. Tags each push with:
   - `<branch>-<sha>` — immutable, e.g. `main-sha-abc1234`
   - `<branch>-latest` — rolling, e.g. `deploy-production-latest`
   - `<version>` — for `v*.*.*` tags (release pin)

`docker-compose.production.yml` uses `image: ghcr.io/.../gacp-backend:${IMAGE_TAG:-deploy-production-latest}`,
so the deploy script just `pull`s the new tag and `up -d` swaps containers
in place — no source-on-server build step.

### Tagged rollback (Level 4 superpower)

```bash
ssh root@203.0.113.10

# Find the previous deploy's image tag
ls -t /var/log/gacp-deploys/ | head -3
grep 'pulling tag:' /var/log/gacp-deploys/<previous>.log

# Re-run deploy pinned to that tag
IMAGE_TAG=sha-abc1234 /opt/gacp-platform/scripts/deploy/deploy-production.sh
```

Rollback time: ~30 seconds (image already pulled to local cache; just swap).

### One-time GHCR setup on the server

The first time the server pulls from GHCR (private repo only — public repos
need no auth), `docker login` is required:

```bash
# On the production server, ONCE:
echo "$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin
```

The PAT needs `read:packages` scope. Store it at `/root/.docker/config.json`
(automatic after `docker login`). Re-running the deploy script does NOT
require re-auth — Docker caches the credentials.

If the repo is **public**, no `docker login` needed; pull works anonymously.

### The old CI deploy job — dead, and what replaced it

The `.github/workflows/ci.yml` `deploy` job used to SSH the host and run the
deploy script, against an image `build-images.yml` had pushed minutes earlier.
**Neither job can run since 2026-08-14** (Actions unpaid — the change log). Today
the image is built on the box and the operator runs the script directly:
`docs/operations/runbooks/build-images-on-the-box.md`, then
`sudo IMAGE_TAG=local-<sha12> bash scripts/deploy/deploy-staging.sh` for staging.
`scripts/deploy/deploy-staging.sh` skips the registry pull when the local image
exists, so no GHCR round-trip is involved. Whether the deployed commit is the one
it should be is proven by the probe `deploy-drift` (a required full-gate check),
not by a green pipeline.

---

## Deploy maturity ladder — where we are, where we're going

| Level | Target | Status |
| :--- | :--- | :--- |
| 0 | Hand-edit on server | ⛔ historical (eliminated 2026-04-26) |
| 1 | `git pull` on server | – |
| 2 | CI-orchestrated `git pull` with safety guards | ✅ done 2026-04-26 |
| **3** | **Image-based deploy via GHCR + tagged rollback** | **✅ done 2026-04-26 (Level 4 in our maturity table; reordered to land before staging)** |
| 4 | Staging → prod promote | next: add staging droplet + auto-deploy on main |
| 5 | Blue/green or canary | future |
| 6 | GitOps watcher (ArgoCD/Flux) + chaos engineering | aspirational |

---

## Incident: server in dirty state

If a deploy fails the pre-flight clean-tree check, **do not** force the deploy.
Capture the dirty state first:

```bash
ssh root@203.0.113.10
cd /opt/gacp-platform
TS=$(date +%Y%m%d-%H%M%S)
SNAP=/root/gacp-snapshots/$TS
mkdir -p $SNAP
git diff > $SNAP/working-tree.patch
git diff --cached > $SNAP/staged.patch
git ls-files --others --exclude-standard > $SNAP/untracked-list.txt
git stash push --include-untracked -m "snapshot before forced deploy $TS"
```

Then either:

- Reset to origin and accept the loss (snapshot recoverable from `$SNAP`):
  `git reset --hard origin/deploy/production && git clean -fdx`
- Or open an investigation PR to commit the captured patches back to a branch
  before deciding what to keep.

**Never `--no-verify` past the pre-flight check on production.**
