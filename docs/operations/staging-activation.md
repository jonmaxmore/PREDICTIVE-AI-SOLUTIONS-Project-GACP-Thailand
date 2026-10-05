# Staging slot — Activation Guide

Stand-alone staging environment running on the **same droplet** as production.
Cost: **$0/month**. Trade-off: shares the kernel/disk/network with prod.

## What you get

- `https://staging.gacpth.com` running the latest `main` branch.
- Separate database (`gacp_staging`) — no risk of clobbering prod data.
- Separate redis keyspace (db index 1) — sessions don't leak across.
- Separate uploads volume — files don't mix.
- CI auto-deploys every push to `main` → staging, **before** promoting to `deploy/production`.

## What you give up

- Resource isolation: a staging memory leak CAN starve prod (mitigated by strict `deploy.resources.limits` in `docker-compose.staging.yml`: 0.5 CPU / 512 MB max per service).
- A real "is the droplet I/O healthy" test — staging shares the same disk.

If those concerns ever bite, switch to a separate $4/mo droplet by changing the host in `.env.staging` and re-running the activation steps below — the rest of the infrastructure is identical.

---

## Activation — one-time steps

### Step 1 — Create the staging database

The `gacp_staging` DB lives in the SAME postgres container as prod.

```bash
ssh root@203.0.113.10

# Create the DB (skip if it already exists)
docker exec -i gacp-postgres psql -U gacp -c "CREATE DATABASE gacp_staging;"
docker exec -i gacp-postgres psql -U gacp -c "GRANT ALL PRIVILEGES ON DATABASE gacp_staging TO gacp;"
```

Optional — seed staging with a sanitized snapshot of prod (do NOT copy real PII):

```bash
# Dump prod (data only, no schema — schema comes from migrations)
docker exec gacp-postgres \
    pg_dump -U gacp --data-only --schema=public \
    --exclude-table=user_consents \
    --exclude-table=audit_logs \
    gacp_db | gzip > /tmp/prod-data.sql.gz

# Restore into staging
zcat /tmp/prod-data.sql.gz | \
    docker exec -i gacp-postgres psql -U gacp -d gacp_staging
rm /tmp/prod-data.sql.gz
```

### Step 2 — Create `/opt/gacp-platform/.env.staging`

Copy the production env file and adjust staging-specific values:

```bash
cd /opt/gacp-platform
cp .env.production .env.staging
chmod 600 .env.staging
```

Edit `.env.staging` and override:

```ini
# Staging-specific values (override what came from prod):
NODE_ENV=staging
STAGING_DB_NAME=gacp_staging
STAGING_PUBLIC_URL=https://staging.gacpth.com

# Staging gets its OWN secrets — never share JWT/encryption keys with prod.
# Generate new ones: openssl rand -base64 48 | tr -d '=' | head -c 64
STAGING_HEALTH_JWT_SECRET=<generate>
STAGING_PROVIDER_JWT_SECRET=<generate>
STAGING_ENCRYPTION_KEY=<generate>
STAGING_QR_SIGNATURE_FALLBACK_SECRET=<generate>
STAGING_PAYMENT_WEBHOOK_SECRET=<generate>

# Staging cookies on a different domain so prod sessions don't bleed in:
STAGING_COOKIE_DOMAIN=.staging.gacpth.com

# Default image tag for staging — auto-updated by CI
STAGING_IMAGE_TAG=main-latest

# Tell the deploy script where the public smoke URL lives:
STAGING_PUBLIC_URL=https://staging.gacpth.com
```

Generate the secrets in-place to avoid copy-paste through chat:

```bash
ssh root@203.0.113.10
cd /opt/gacp-platform

for var in STAGING_HEALTH_JWT_SECRET STAGING_PROVIDER_JWT_SECRET \
           STAGING_ENCRYPTION_KEY STAGING_QR_SIGNATURE_FALLBACK_SECRET \
           STAGING_PAYMENT_WEBHOOK_SECRET; do
    if ! grep -qE "^${var}=.+" .env.staging; then
        echo "${var}=$(openssl rand -base64 48 | tr -d '=' | head -c 64)" >> .env.staging
        echo "  ✅ added $var"
    fi
done
```

### Step 3 — DNS: add `staging.gacpth.com` A record

Cloudflare (or your DNS provider):

| Type | Name | Value | TTL | Proxy |
| :--- | :--- | :--- | :--- | :--- |
| A | staging | 203.0.113.10 | Auto | Off (DNS only) |

If using Cloudflare, "DNS only" means the SSL cert in your nginx vhost is the one terminating TLS, not Cloudflare. Match this with whatever your prod domain uses.

### Step 4 — TLS cert for `staging.gacpth.com`

If you use Let's Encrypt with certbot, request a cert for the new subdomain:

```bash
certbot --nginx -d staging.gacpth.com --non-interactive --agree-tos -m admin@gacpth.com
```

Or, if you already have a wildcard cert for `*.gacpth.com`, the nginx vhost will pick it up automatically.

### Step 5 — Drop the staging nginx vhost in place

```bash
ssh root@203.0.113.10

cd /opt/gacp-platform
ln -sf $(pwd)/deploy/nginx/staging.gacpth.com.conf \
       /etc/nginx/sites-enabled/staging.gacpth.com.conf

nginx -t && systemctl reload nginx
```

### Step 6 — Bring up the staging stack manually for the first time

```bash
ssh root@203.0.113.10

# Pull the latest main image
docker compose --env-file /opt/gacp-platform/.env.staging \
    -f docker-compose.production.yml \
    -f docker-compose.staging.yml \
    pull backend-staging frontend-staging

# Run migrations against staging DB (one-shot container)
docker run --rm --network gacp-network \
    -e DATABASE_URL="postgresql://gacp:$(grep '^DB_PASSWORD=' /opt/gacp-platform/.env.staging | cut -d= -f2-)@postgres:5432/gacp_staging?schema=public" \
    ghcr.io/jonmaxmore/gacp-backend:main-latest \
    sh -c "cd /app/apps/backend && npx prisma migrate deploy"

# Start the staging stack
docker compose --env-file /opt/gacp-platform/.env.staging \
    -f docker-compose.production.yml \
    -f docker-compose.staging.yml \
    up -d backend-staging frontend-staging

# Wait + verify
sleep 30
curl -sf https://staging.gacpth.com/api/health
```

Expected response (on success):

```json
{"success":true,"version":"3.0.0","database":"postgresql","dbStatus":{"status":"connected","type":"postgresql"},"message":"GACP API v3.0 is running"}
```

### Step 7 — Verify CI auto-deploy

Push any commit to `main`:

```bash
# (locally)
echo "" >> README.md
git add README.md
git commit -m "test: trigger staging auto-deploy"
git push origin main
```

Watch the workflow run at:
`https://github.com/jonmaxmore/GACP-Certification-Application/actions`

Expected sequence:
1. Build & push images (`build-images.yml`)
2. CI tests pass
3. **`Deploy to Staging`** job runs and succeeds
4. **Only then** `Promote main → deploy/production` runs

If staging fails, the promote job is skipped — prod won't see the broken commit.

---

## Daily flow after activation

```
You push to main
    ↓
CI builds + pushes image to GHCR
    ↓
CI runs tests
    ↓
CI deploys staging  ← exercises the deploy path against real infra
    ↓
CI promotes main → deploy/production (only if staging succeeded)
    ↓
CI deploys deploy/production via deploy-production.sh (or blue/green script)
    ↓
You verify at https://gacpth.com
```

If staging shows a regression that tests didn't catch, fix it before promoting:

```bash
# Local
git revert <bad-commit>
git push origin main
# ...new staging deploy validates the revert before prod sees it.
```

---

## Operational notes

### Staging DB drift

Staging DB schema can drift from prod if a migration is applied to staging
but the corresponding feature isn't merged to deploy/production yet.
That's by design — it's the whole point of staging.

To resync staging from a known-good prod state:

```bash
ssh root@203.0.113.10

# Drop staging
docker exec -i gacp-postgres psql -U gacp -c "DROP DATABASE gacp_staging;"
docker exec -i gacp-postgres psql -U gacp -c "CREATE DATABASE gacp_staging;"

# Restore from latest prod backup
LATEST=$(ls -t /var/backups/gacp/gacp-pre-deploy-*.sql.gz | head -1)
zcat "$LATEST" | docker exec -i gacp-postgres psql -U gacp -d gacp_staging

# Run any newer migrations
IMAGE_TAG=main-latest /opt/gacp-platform/scripts/deploy/deploy-staging.sh
```

### Staging "noindex"

The vhost adds `X-Robots-Tag: noindex, nofollow, noarchive` so search
engines don't index staging. Combined with no-cache headers, this
ensures staging URLs don't leak into search results.

### Deactivating staging

If you ever need to free up resources on the droplet:

```bash
ssh root@203.0.113.10
cd /opt/gacp-platform
docker compose --env-file .env.staging \
    -f docker-compose.production.yml -f docker-compose.staging.yml \
    stop backend-staging frontend-staging

# Disable nginx vhost
rm /etc/nginx/sites-enabled/staging.gacpth.com.conf
systemctl reload nginx

# Optional: drop the DB
# docker exec -i gacp-postgres psql -U gacp -c "DROP DATABASE gacp_staging;"
```

To resume later just re-link the nginx symlink and `up -d` again — no
state lost.

---

## Maturity ladder — final state after activation

| Level | Target | Status |
| :--- | :--- | :--- |
| 0 | Hand-edit on server | ⛔ historical |
| 1 | git pull on server | – |
| 2 | CI-orchestrated git pull + safety guards | ✅ done |
| 3 | Image-based deploy via GHCR + tagged rollback | ✅ shipped |
| 4 | Zero-downtime blue/green + instant rollback | ✅ shipped |
| **5** | **Staging → prod promote (same droplet, $0)** | **✅ here after Step 7** |
| 6 | Canary (% traffic split) | future |
| 7 | GitOps watcher + chaos engineering | aspirational |
