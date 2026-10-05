#!/bin/bash
# ============================================================================
# remote-install.sh — GACP single-host server bootstrap (+ optional deploy)
# ============================================================================
# Run ON the production server as root (or a sudo-capable user):
#
#   curl -fsSL <raw-url>/scripts/deploy/remote-install.sh | bash          # prepare
#   RUN_DEPLOY=true bash scripts/deploy/remote-install.sh                 # prepare + deploy
#
# Hardened 2026-06-03:
#   - OS-agnostic Docker install (apt / dnf / yum) via the official
#     get.docker.com script. The previous version was yum-only (Amazon Linux)
#     and FAILS on Ubuntu/Debian. Idempotent — skips when Docker is present.
#   - Uses Docker Compose v2 (`docker compose`) to match production.yml
#     (was the legacy standalone `docker-compose` v1 binary).
#   - Generates EVERY CHANGE_THIS_* secret in .env.production (was only 2) so
#     the backend env-validator can boot. MINIO_ROOT_PASSWORD and S3_SECRET_KEY
#     share one placeholder and therefore get the same value (required).
#   - Validates the compose file parses before any deploy.
#   - DEFAULT IS PREPARE-ONLY. The actual build + the (possibly destructive)
#     `prisma migrate deploy` only run when RUN_DEPLOY=true, or — preferably —
#     via the canonical GitHub Actions pipeline (.github/workflows/production.yml),
#     which also takes a pre-deploy DB backup.
#
# Overrides: APP_DIR, REPO_URL, DEPLOY_BRANCH, COMPOSE_FILE, RUN_DEPLOY
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/gacp-platform}"
REPO_URL="${REPO_URL:-https://github.com/jonmaxmore/GACP-Certification-Application.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
RUN_DEPLOY="${RUN_DEPLOY:-false}"   # 'true' = also build + migrate + start containers

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

step() { echo -e "\n▶ $*"; }

echo "================================================================"
echo "🚀 GACP server bootstrap — $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo "unknown OS")"
echo "================================================================"

# ── 1. App directory ─────────────────────────────────────────────────────────
step "1. App directory: $APP_DIR"
$SUDO mkdir -p "$APP_DIR"
$SUDO chown "$(id -u):$(id -g)" "$APP_DIR" 2>/dev/null || true
cd "$APP_DIR"

# ── 2. Repository ($DEPLOY_BRANCH) ───────────────────────────────────────────
step "2. Repository ($DEPLOY_BRANCH)"
if [ -d ".git" ]; then
  git fetch origin
  git reset --hard "origin/$DEPLOY_BRANCH"
else
  git clone "$REPO_URL" .
  git checkout "$DEPLOY_BRANCH"
fi

# ── 3. Docker Engine + Compose v2 (OS-agnostic, idempotent) ──────────────────
step "3. Docker Engine + Compose v2"
if command -v docker >/dev/null 2>&1; then
  echo "  ✓ Docker present: $(docker --version)"
else
  echo "  🐳 Installing Docker via get.docker.com (auto-detects apt/dnf/yum)…"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  $SUDO sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "  🔧 Installing docker compose plugin…"
  if   command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -y && $SUDO apt-get install -y docker-compose-plugin
  elif command -v dnf     >/dev/null 2>&1; then $SUDO dnf install -y docker-compose-plugin
  elif command -v yum     >/dev/null 2>&1; then $SUDO yum install -y docker-compose-plugin
  fi
fi
docker compose version >/dev/null 2>&1 || { echo "  ❌ 'docker compose' unavailable after install"; exit 1; }
echo "  ✓ $(docker compose version | head -1)"

if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl enable --now docker >/dev/null 2>&1 || true
fi

# ── 4. .env.production — generate ALL secrets ────────────────────────────────
step "4. .env.production"
if [ -f ".env.production" ]; then
  echo "  ✓ .env.production already exists — leaving it untouched (no secret rotation)"
else
  cp .env.production.example .env.production
  # Alphanumeric-only secrets → safe to substitute with sed, no escaping needed.
  gen()  { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | cut -c1-"${1:-48}"; }
  fill() { sed -i "s|$1|$2|g" .env.production; }

  fill CHANGE_THIS_STRONG_PASSWORD                "$(gen 32)"   # DB_PASSWORD
  fill CHANGE_THIS_STRONG_REDIS_PASSWORD          "$(gen 32)"   # REDIS_PASSWORD
  fill CHANGE_THIS_WITH_OPENSSL_RAND_BASE64_64    "$(gen 64)"   # HEALTH_JWT_SECRET
  fill CHANGE_THIS_WITH_DIFFERENT_SECRET          "$(gen 64)"   # PROVIDER_JWT_SECRET (must differ)
  fill CHANGE_THIS_ENCRYPTION_KEY_32CHARS_OR_MORE "$(gen 48)"   # ENCRYPTION_KEY
  fill CHANGE_THIS_MASTER_ENCRYPTION_KEY          "$(gen 48)"   # MASTER_ENCRYPTION_KEY
  fill CHANGE_THIS_HMAC_KEY                        "$(gen 48)"   # HMAC_KEY
  fill CHANGE_THIS_SESSION_SECRET                  "$(gen 48)"   # SESSION_SECRET
  fill CHANGE_THIS_QR_HMAC_SECRET_DEDICATED_KEY    "$(gen 48)"   # QR_SIGNATURE_FALLBACK_SECRET
  fill CHANGE_THIS_WEBHOOK_HMAC_SECRET             "$(gen 48)"   # PAYMENT_WEBHOOK_SECRET
  fill CHANGE_THIS_PGADMIN_PASSWORD                "$(gen 24)"   # PGADMIN_PASSWORD
  fill CHANGE_THIS_GRAFANA_PASSWORD                "$(gen 24)"   # GRAFANA_PASSWORD
  # Shared placeholder: MINIO_ROOT_PASSWORD === S3_SECRET_KEY (same credential)
  fill CHANGE_THIS_MINIO_PASSWORD                  "$(gen 40)"

  chmod 600 .env.production
  echo "  ✅ Generated all secrets into .env.production (chmod 600)"
  if grep -q "CHANGE_THIS" .env.production; then
    echo "  ⚠️  Some placeholders still remain — review manually:"
    grep -n "CHANGE_THIS" .env.production || true
  fi
  echo "  ℹ️  Still set by hand before go-live: real domain URLs, SENTRY_DSN,"
  echo "      INTEROP_PARTNER_API_KEYS, and replace the self-signed TLS cert."
fi

# ── 5. Nginx TLS bootstrap cert (self-signed; replace with real TLS) ─────────
step "5. Nginx TLS bootstrap cert"
$SUDO mkdir -p nginx/ssl
# Names MUST match deploy/nginx/gacp-platform.conf (the host edge): gacp.crt/gacp.key.
if [ ! -f "nginx/ssl/gacp.crt" ]; then
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout nginx/ssl/gacp.key -out nginx/ssl/gacp.crt \
    -subj "/C=TH/ST=Bangkok/O=GACP/CN=gacpth.com" 2>/dev/null
  echo "  ✅ Self-signed origin cert nginx/ssl/gacp.crt (host edge uses it; replace with a Cloudflare Origin Cert before go-live)"
else
  echo "  ✓ TLS cert already present"
fi

# ── 6. Validate the compose file ─────────────────────────────────────────────
step "6. Validate $COMPOSE_FILE"
docker compose --env-file .env.production -f "$COMPOSE_FILE" config >/dev/null
echo "  ✓ compose file parses cleanly with .env.production"

# ── 7. Deploy (opt-in) ───────────────────────────────────────────────────────
if [ "$RUN_DEPLOY" != "true" ]; then
  echo -e "\n✅ PREPARE-ONLY complete. Server is ready for deploy."
  echo "   • To deploy now:      RUN_DEPLOY=true bash scripts/deploy/remote-install.sh"
  echo "   • Preferred (CI):     push a release so .github/workflows/production.yml"
  echo "                         deploys (it also takes a pre-deploy DB backup)."
  exit 0
fi

step "7. Deploy containers (RUN_DEPLOY=true)"
docker compose --env-file .env.production -f "$COMPOSE_FILE" up -d --build

step "8. Database migrations"
sleep 10
# The backend RUNNER image has node/npx only — pnpm lives in the builder stage,
# so `pnpm` is not on PATH here (was the cause of "sh: pnpm: not found"). The
# modular schema lives in the prisma/schema DIRECTORY and package.json has no
# prisma.schema field, so --schema is required. WORKDIR is /app/apps/backend.
docker compose --env-file .env.production -f "$COMPOSE_FILE" run --rm backend \
  sh -lc "cd /app/apps/backend && npx --no-install prisma migrate deploy --schema prisma/schema"

echo "================================================================"
echo "✅ Bootstrap + deploy finished."
echo "   Replace nginx/ssl with real TLS and set real domain URLs in .env.production."
echo "================================================================"
