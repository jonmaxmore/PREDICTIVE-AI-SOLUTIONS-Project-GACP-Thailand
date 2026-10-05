#!/bin/bash
set -euo pipefail

# ============================================================================
# build-images.sh — build the backend + frontend Docker images LOCALLY on the
# host and tag them as the names docker-compose.production.yml pulls.
#
# WHY THIS EXISTS
#   docker-compose.production.yml pins the app services to a prebuilt registry
#   image:
#       image: ${BACKEND_IMAGE:-ghcr.io/jonmaxmore/gacp-backend}:${IMAGE_TAG:-deploy-production-latest}
#   There is NO `build:` section, so `docker compose up --build` does NOT build
#   — it only ever PULLS. On a single-host deploy without a CI image-publish
#   pipeline that means **code changes merged to main never reach the server**:
#   the running container keeps serving whatever image was last pulled. (This is
#   why backend fixes — e.g. the platform-fee VAT total — can sit on main yet
#   never take effect in production.)
#
#   This script builds both images from the CURRENT checkout and tags them with
#   the exact name:tag the compose file expects, so a subsequent
#       docker compose ... up -d backend frontend
#   recreates the containers from the freshly-built local image (Docker uses a
#   local image when its name:tag matches; it won't re-pull).
#
# USAGE (on the server, repo checked out at $APP_DIR — default /opt/gacp-platform)
#   # 1. get the code you want to ship
#   cd /opt/gacp-platform && git fetch origin && git checkout main && git pull origin main
#   # 2. build (both services by default)
#   bash scripts/deploy/build-images.sh
#   # 3. roll the containers
#   docker compose --env-file .env.production -f docker-compose.production.yml up -d backend frontend
#
#   Build only one service:        SERVICES="backend" bash scripts/deploy/build-images.sh
#   Point the frontend edge pages at the public API (optional — see note below):
#       NEXT_PUBLIC_API_URL=https://gacpth.com/api bash scripts/deploy/build-images.sh
#
# NOTE on NEXT_PUBLIC_API_URL
#   The browser apiClient uses an ORIGIN-RELATIVE base (`/api`), so the app
#   works without this var — it only affects a couple of pages that read
#   process.env.NEXT_PUBLIC_API_URL directly (cert verify, application-preview
#   PDF). Left unset, the build matches the CI image exactly (no regression).
#   Set it to the public API base if you want those edge pages pinned too.
# ============================================================================

APP_DIR="${APP_DIR:-/opt/gacp-platform}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/jonmaxmore/gacp-backend}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.io/jonmaxmore/gacp-frontend}"
IMAGE_TAG="${IMAGE_TAG:-deploy-production-latest}"
SERVICES="${SERVICES:-backend frontend}"

cd "$APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker not found on PATH" >&2
  exit 1
fi

echo "========================================"
echo "🔨 Building GACP images from: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown') ($APP_DIR)"
echo "   services : $SERVICES"
echo "   tag      : $IMAGE_TAG"
echo "========================================"

build_backend() {
  echo "→ backend  → ${BACKEND_IMAGE}:${IMAGE_TAG}"
  docker build -f apps/backend/Dockerfile -t "${BACKEND_IMAGE}:${IMAGE_TAG}" .
}

build_frontend() {
  echo "→ frontend → ${FRONTEND_IMAGE}:${IMAGE_TAG}"
  # NEXT_PUBLIC_API_URL is baked at build time (Next.js). Only pass it when the
  # operator set it; unset = identical inputs to the CI image (safe default).
  local args=()
  if [ -n "${NEXT_PUBLIC_API_URL:-}" ]; then
    args+=(--build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}")
  fi
  docker build -f apps/web-app/Dockerfile "${args[@]}" -t "${FRONTEND_IMAGE}:${IMAGE_TAG}" .
}

for svc in $SERVICES; do
  case "$svc" in
    backend)  build_backend ;;
    frontend) build_frontend ;;
    *) echo "✗ unknown service '$svc' (expected: backend | frontend)" >&2; exit 1 ;;
  esac
done

echo "========================================"
echo "✅ Built: $SERVICES"
echo ""
echo "Next — recreate the containers with the fresh image(s):"
echo "  docker compose --env-file .env.production -f docker-compose.production.yml up -d $SERVICES"
echo ""
echo "Then apply any pending DB migrations (backend only):"
echo "  docker compose --env-file .env.production -f docker-compose.production.yml \\"
echo "    run --rm backend sh -lc 'cd /app/apps/backend && npx --no-install prisma migrate deploy --schema prisma/schema'"
echo "========================================"
