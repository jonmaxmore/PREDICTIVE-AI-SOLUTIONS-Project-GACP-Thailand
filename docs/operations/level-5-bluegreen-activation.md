# Level 5 (Blue/Green) — Activation Guide

The compose file, nginx template, and deploy script are in place. This guide
walks through one-time setup and the first cutover. Read it end-to-end
before activating; blue/green has high blast radius if cutover fails.

## What you get

- **Zero-downtime deploy.** `nginx -s reload` swaps upstreams atomically; no dropped requests.
- **Instant rollback.** Previous color stays running for 60 s after cutover; flipping nginx back is ~3 seconds.
- **Forward-compatible migration enforcement.** The runbook now spells out: every migration must work for both old and new code simultaneously during the drain window.
- **Continuous validation.** New color is health-checked + direct-smoked BEFORE any user traffic touches it.

## What you give up

- **2× container memory budget during deploy** (both colors run in parallel for ~2–5 minutes).
- **Schema migrations must be forward-compatible.** No "drop column then ship code" patterns. Use the expand/migrate/contract three-step pattern across multiple deploys.
- **Sticky session breakage** if your app stores in-memory state (we don't — sessions are in Redis ✅).

---

## One-time activation

### Step 1 — Confirm Level 4 (image-based) is working

Blue/green pulls images from GHCR. If `IMAGE_TAG=deploy-production-latest`
doesn't pull successfully today via the regular `deploy-production.sh`,
fix that first.

### Step 2 — Install the nginx blue/green upstream config

The host nginx (the one terminating SSL on the droplet, NOT the
in-container nginx) needs to pick up the generated blue/green upstream
file. The template lives at:

```
/opt/gacp-platform/nginx/bluegreen-upstream.conf.template
```

Render once, with green as the initial active color:

```bash
ssh root@203.0.113.10

cd /opt/gacp-platform
sed -e 's/{{ACTIVE_COLOR}}/green/g' \
    -e 's/{{INACTIVE_COLOR}}/blue/g' \
    nginx/bluegreen-upstream.conf.template \
    > /etc/nginx/conf.d/bluegreen-upstream.conf

nginx -t && nginx -s reload
```

### Step 3 — Update host nginx to use the new upstream names

The host nginx config (likely at `/etc/nginx/sites-available/gacpth.com`
or `/opt/gacp-platform/deploy/nginx/gacp-platform.conf`) must
`proxy_pass` to `gacp_backend_active` and `gacp_frontend_active`
instead of the existing `gacp-backend:8000` / `gacp-frontend:3000`
references.

Find the proxy_pass lines:

```bash
grep -nE "proxy_pass.*gacp-(backend|frontend)" \
    /etc/nginx/sites-enabled/* \
    /opt/gacp-platform/deploy/nginx/*.conf 2>/dev/null
```

Replace each:

| Before | After |
| :--- | :--- |
| `proxy_pass http://gacp-backend:8000;` | `proxy_pass http://gacp_backend_active;` |
| `proxy_pass http://gacp-frontend:3000;` | `proxy_pass http://gacp_frontend_active;` |

Validate + reload:

```bash
nginx -t && nginx -s reload
```

### Step 4 — Bring up the initial GREEN stack alongside the live one

This step lights up the green slot without touching production traffic.

```bash
cd /opt/gacp-platform

# Pull current image into green slot
GREEN_IMAGE_TAG=deploy-production-latest \
    docker compose --env-file .env.production \
    -f docker-compose.production.yml \
    -f docker-compose.bluegreen.yml \
    --profile green up -d backend-green frontend-green

# Wait for healthy
docker inspect --format='{{.State.Health.Status}}' gacp-backend-green
docker inspect --format='{{.State.Health.Status}}' gacp-frontend-green
```

Once both are `healthy`, traffic is **already** going through `gacp_backend_active`
which currently points at `green`. So the legacy `gacp-backend` (no -blue/-green
suffix) container is now the BACKUP path. You can decommission it:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml stop backend frontend
```

### Step 5 — First blue/green deploy

From here, every deploy uses the blue/green script:

```bash
ssh root@203.0.113.10
chmod +x /opt/gacp-platform/scripts/deploy/deploy-bluegreen.sh
IMAGE_TAG=deploy-production-latest \
    /opt/gacp-platform/scripts/deploy/deploy-bluegreen.sh
```

The script will:
1. Detect `green` is active.
2. Pull the new image into `blue` slot.
3. Run prisma migrate deploy.
4. Bring `blue` up.
5. Wait for healthy → smoke `blue` directly.
6. Update nginx → traffic flips to `blue` instantly.
7. Smoke through the public URL.
8. Drain `green` for 60 s.
9. Stop `green`.

Expected total time: **~3–5 minutes**, with **~1 second** of cutover.

### Step 6 — Practice a rollback

Once Step 5 has a green run, deploy a deliberately broken image to
validate rollback. Use a known-good rolling tag from earlier:

```bash
# Find an older tag that you know works:
PREV_TAG=$(grep 'pulling tag:' \
    /var/log/gacp-deploys/$(ls -t /var/log/gacp-deploys/ | sed -n 2p) \
    | awk '{print $NF}')

# Re-deploy that tag (acts as a controlled rollback):
IMAGE_TAG=$PREV_TAG /opt/gacp-platform/scripts/deploy/deploy-bluegreen.sh
```

Validation: tail `/var/log/gacp-deploys/bluegreen-*.log` and watch for
`✅ DEPLOY COMPLETE`.

---

## Forward-compatible migration policy (REQUIRED for blue/green)

When both colors run side-by-side during the drain window, **the database
must answer queries from both old and new code**. This means migrations
follow the **expand / migrate / contract** pattern over multiple deploys:

1. **Expand:** Add new columns/tables. Both old and new code work.
   (e.g., add `users.new_email` column, leave `users.email` alone.)
2. **Migrate:** Backfill data, dual-write from both colors if needed.
   (e.g., new code writes both `email` and `new_email`.)
3. **Contract:** After all old-code deploys are gone, remove the old
   schema in a future deploy.

**Anti-patterns that BREAK blue/green:**
- `DROP COLUMN` (old code reads it, gets errors during drain)
- `RENAME COLUMN` (same problem)
- Adding `NOT NULL` without a default (old code's INSERTs fail)
- Type changes that aren't binary-compatible

**The deploy script does NOT enforce this.** Reviewers must catch it in PR.

Add a note to PR template: "Does this PR contain a destructive migration?
If yes, ship as expand → bake → contract over 3+ deploys."

---

## Troubleshooting

### "nginx -t" fails after cutover

The `bluegreen-upstream.conf.template` placeholders weren't substituted.
Look at `/etc/nginx/conf.d/bluegreen-upstream.conf` — it should contain
`gacp-backend-blue` or `gacp-backend-green`, never `{{ACTIVE_COLOR}}`.

Fix: re-run the deploy script, OR manually `sed` and reload.

### New color stays "starting" forever

```bash
docker logs gacp-backend-blue --tail 100
docker logs gacp-frontend-blue --tail 100
```

Common causes:
- Image tag doesn't exist on GHCR (deploy script catches this in Step 1)
- Required env var missing in `.env.production` (deploy script catches)
- Database migration timed out (rare; investigate prisma logs)

### Both colors are healthy but `/api/health` returns 502

Nginx upstream is pointing to neither / both. Check:

```bash
cat /etc/nginx/conf.d/bluegreen-upstream.conf | head -30
curl http://127.0.0.1:8081/__bluegreen
```

The diagnostic endpoint should print `blue` or `green`. If it prints the
literal `{{ACTIVE_COLOR}}`, the template wasn't rendered.

---

## Maturity ladder — final state after this is activated

| Level | Target | Status |
| :--- | :--- | :--- |
| 0 | Hand-edit on server | ⛔ historical |
| 1 | `git pull` on server | – |
| 2 | CI-orchestrated git pull + safety guards | ✅ done |
| 3 | Image-based deploy via GHCR + tagged rollback | ✅ done (after Step 5 of `level-4-activation.md`) |
| **4** | **Zero-downtime blue/green + instant rollback** | **✅ here after Step 5 of this guide** |
| 5 | Staging → prod promote | optional next: + smaller staging droplet |
| 6 | Canary (% traffic split) | future |
| 7 | GitOps watcher (ArgoCD/Flux) + chaos engineering | aspirational |
