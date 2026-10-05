#!/usr/bin/env bash
#
# fix-ghcr-pat.sh — refresh GHCR docker login on the production droplet
#
# Why this exists (Phase 1 #1.13 of the 2026-04-27 audit):
#   The 2026-04-27 deploy at 15:08 UTC+7 failed during
#   `docker compose pull` with `error from registry: denied`. Root cause:
#   /root/.docker/config.json contains no `ghcr.io` auth entry — the PAT
#   that was originally registered with `docker login ghcr.io` has either
#   expired, been rotated, or was never persisted on this host.
#
# What this script does:
#   1. Reads a fine-grained PAT from the GHCR_PAT env var
#   2. Runs `docker login ghcr.io -u jonmaxmore --password-stdin`
#   3. Verifies the entry was written
#   4. Test-pulls one of the GACP images
#   5. Optionally re-runs deploy-production.sh in no-op mode
#
# How to use (on the production droplet, as root):
#
#   # 1. Generate a NEW fine-grained PAT at:
#   #    https://github.com/settings/personal-access-tokens
#   #    Repository access: jonmaxmore/gacp-platform
#   #    Permissions: Packages → Read
#
#   # 2. Run this script with the PAT in env:
#   GHCR_PAT='ghp_REPLACE_WITH_TOKEN' \
#       bash scripts/maintenance/fix-ghcr-pat.sh
#
#   # 3. (Optional) re-run today's deploy now that pull works:
#   /opt/gacp-platform/scripts/deploy/deploy-production.sh
#
# Cleanup tip: do NOT save the PAT in shell history. After running once,
# `unset GHCR_PAT` and clear it from any scratch file.

set -euo pipefail

USER_HANDLE="jonmaxmore"
TEST_IMAGE="ghcr.io/jonmaxmore/gacp-backend:deploy-production-latest"

err() { echo "❌ $*" >&2; exit 1; }
ok()  { echo "✅ $*"; }
inf() { echo "ℹ️  $*"; }

[ "$(id -u)" = "0" ] || err "must run as root (or with docker permissions on /root)"
[ -n "${GHCR_PAT:-}" ] || err "GHCR_PAT env var is empty — generate a PAT at https://github.com/settings/personal-access-tokens and re-run with GHCR_PAT='...' bash $0"

# ─── 1. Login ────────────────────────────────────────────────────────────
inf "[1/4] docker login ghcr.io"
echo "$GHCR_PAT" | docker login ghcr.io -u "$USER_HANDLE" --password-stdin
ok "  docker login succeeded"

# ─── 2. Verify entry ────────────────────────────────────────────────────
inf "[2/4] verify /root/.docker/config.json contains ghcr.io"
if grep -q '"ghcr.io"' /root/.docker/config.json; then
    ok "  ghcr.io entry present"
else
    err "ghcr.io entry NOT found in /root/.docker/config.json — login silently failed"
fi

# ─── 3. Test pull ────────────────────────────────────────────────────────
inf "[3/4] test pull: $TEST_IMAGE"
if docker pull "$TEST_IMAGE" 2>&1 | tail -3; then
    ok "  pull succeeded"
else
    err "pull failed — PAT may lack read:packages on jonmaxmore/gacp-platform"
fi

# ─── 4. Show current image vs running image ─────────────────────────────
inf "[4/4] show image state"
echo "  registry image:"
docker image inspect "$TEST_IMAGE" --format '    digest: {{.Id}}{{"\n    created: "}}{{.Created}}' 2>/dev/null || true
echo "  running container backend:"
docker ps --filter name=gacp-backend --format '    image: {{.Image}}{{"\n    created: "}}{{.CreatedAt}}'

echo
ok "GHCR PAT refreshed. Next deploy will succeed."
echo
echo "To run a deploy now (no-op if image hash matches running container):"
echo "  cd /opt/gacp-platform && ./scripts/deploy/deploy-production.sh"
echo
echo "Security:"
echo "  - PAT was passed via stdin, not as an argv (won't show in process list)"
echo "  - PAT lives in /root/.docker/config.json (mode 0600) until next rotation"
echo "  - Add a periodic CI job that runs 'docker login --no-cache' to detect expiry early"
echo "  - Consider GitHub Apps over PAT for a longer-lived auth scope"
