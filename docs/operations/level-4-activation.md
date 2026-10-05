# Level 4 (Image-based deploy) — Activation Steps

The code is in place. The following one-time steps activate it. Without these,
the next deploy will try to pull from GHCR, find nothing, and fail.

## Step 1 — Allow GitHub Actions to write packages (1 min)

`https://github.com/jonmaxmore/GACP-Certification-Application/settings/actions`
→ scroll to **Workflow permissions** → select **Read and write permissions**
→ Save.

This lets the built-in `GITHUB_TOKEN` push images to GHCR.

## Step 2 — Trigger the first image build (30 sec, then 5–8 min wait)

The push to `main` from this PR already triggered `.github/workflows/build-images.yml`.
Verify the run at:

`https://github.com/jonmaxmore/GACP-Certification-Application/actions/workflows/build-images.yml`

Expected outcome:
- Two jobs (`backend`, `frontend`) both green
- New packages visible at: `https://github.com/jonmaxmore?tab=packages`
- Tags published: `main-sha-ca9e349`, `main-latest`, `sha-ca9e349`

If the run **failed** with permission errors, repeat Step 1 (the change must
be saved BEFORE the run starts).

## Step 3 — Make GHCR packages public OR set up server pull credential

### Option A — Public packages (recommended for OSS)

`https://github.com/users/jonmaxmore/packages/container/gacp-backend/settings`
→ Danger Zone → Change visibility → **Public** → confirm.

Repeat for `gacp-frontend`.

Server can then pull anonymously — no `docker login` needed.

### Option B — Private + PAT login on server

If you want images private:

1. Create a PAT at `https://github.com/settings/tokens?type=beta`
   - Repository access: GACP-Certification-Application
   - Permissions: **Packages: Read** (only)
   - Expiration: 90 days
2. SSH to production server:
   ```bash
   ssh root@203.0.113.10
   echo "<PAT>" | docker login ghcr.io -u jonmaxmore --password-stdin
   # Credentials cached at /root/.docker/config.json
   ```

## Step 4 — Promote main → deploy/production (triggers production image build)

Once the main image is built and visible on GHCR, promote so a
`deploy-production-latest` tag exists:

```bash
# Local
git checkout deploy/production
git pull
git merge --ff-only origin/main   # or open a PR
git push origin deploy/production
```

The build-images workflow will run again, this time tagging
`deploy-production-sha-<sha>` and `deploy-production-latest`.

## Step 5 — Run a Level 4 deploy

```bash
ssh root@203.0.113.10
/opt/gacp-platform/scripts/deploy/deploy-production.sh
```

The script will:
1. Pre-flight checks (clean tree, env vars present).
2. Backup DB.
3. Fast-forward git (config files only — code ships via image).
4. Run prisma migrate deploy in the *running* container.
5. **Pull** `ghcr.io/jonmaxmore/gacp-backend:deploy-production-latest`
   (and frontend) — no source compile.
6. `docker compose up -d --no-deps backend frontend` — image hash changed,
   containers swap in place.
7. Smoke test `/api/health` and `/api/pricing`. (Was `/api/subscription/plans`
   until M3, 2026-08-23 — that endpoint published a membership price and is
   deleted; `/api/pricing` is the live fee surface.)

Expected deploy time: **~1 minute** (down from ~5–8 min in Level 2 build-from-source).

## Step 6 — Verify rollback works (do this once, then document)

Practice rollback to validate your safety net. From any successful deploy:

```bash
ssh root@203.0.113.10

# Find the previous image tag
LOG=$(ls -t /var/log/gacp-deploys/ | sed -n 2p)
PREV_TAG=$(grep 'pulling tag:' /var/log/gacp-deploys/$LOG | awk '{print $NF}')
echo "Will roll back to: $PREV_TAG"

# Re-deploy pinned to that tag
IMAGE_TAG="$PREV_TAG" /opt/gacp-platform/scripts/deploy/deploy-production.sh

# Verify
curl -sf https://gacpth.com/api/health
```

Rollback time: **~30 seconds** (image already in local Docker cache).

---

## Maturity ladder — final state after activation

| Level | Target | Status |
| :--- | :--- | :--- |
| 0 | Hand-edit on server | ⛔ historical |
| 1 | `git pull` on server | – |
| 2 | CI-orchestrated git pull + safety guards | ✅ done |
| 3 | Image-based deploy via GHCR + tagged rollback | ✅ **here after Step 5** |
| 4 | Staging → prod promote | next session: provision staging droplet |
| 5 | Blue/green or canary | future |
| 6 | GitOps watcher (ArgoCD/Flux) | aspirational |

## Operational improvements unlocked by Level 4

- **Reproducible deploys** — same image runs in CI, on the server, and on any developer's laptop.
- **Audit-grade rollback** — by SHA, by version tag, or by image digest.
- **Deploy time** ~5× faster.
- **Deploy doesn't require Docker build context to fit on the production droplet** (build context can be 600 MB+ on this repo).
- **Foundation for Level 4-staging**: staging just pulls the same image as prod, smoke tests, then promotes.

## Cost

- GHCR: **free** for public packages (any size). Private packages free up to 500 MB; we'll likely cross that and pay ~$0.25/GB-month.
- No new infrastructure.
