#!/usr/bin/env bash
# scripts/ops/run-walkthrough.sh — operator runs this DIRECTLY on the staging
# machine. Does not depend on GitHub Actions (Actions is currently locked —
# operator postponed billing; see .github/workflows/staging-walkthrough.yml
# header for the equivalent dispatch workflow to switch to once it is back).
#
# What it does:
#   1. Checks node/pnpm (and docker, if --seed-uat) are present on this
#      machine — fails loudly and early if not, does not try to install them.
#   2. (default ON, --no-seed-uat to skip) generates one random password per
#      WALK role and rotates ONLY the matching canonical UAT test account
#      already seeded by apps/backend/prisma/seed-gacp.js, via
#      scripts/ops/uat-account-seed.js `docker cp`'d into the
#      gacp-backend-staging container's own app directory (NOT /tmp — see
#      the "3. UAT account password rotation" section below for why) and run
#      there with `docker exec`. Every role's rotation result prints as an
#      unambiguous `SEEDED ok: <role>` / `FAILED: <role> - <reason>` line —
#      see that script's header for exactly what it touches (and does not
#      touch). Generated passwords: (a) exported into THIS shell only for the
#      spec run below, (b) written once to ~/walkthrough-creds-<date>.txt
#      (chmod 600) for later reuse — NEVER printed to stdout/log.
#   3. `pnpm install` scoped to the web-app workspace package.
#   4. `npx playwright install chromium` (this machine has real internet
#      access, unlike the sandbox this kit was authored in — see
#      apps/web-app/playwright.walkthrough.config.ts for the executablePath
#      fallback logic this feeds).
#   5. Runs the walkthrough spec against BASE_URL.
#   6. Packs evidence/staging-walkthrough/ into
#      ~/walkthrough-pack-<date>.tar.gz for download/handoff. The creds file
#      from step 2 is DELIBERATELY EXCLUDED from this archive.
#
# Usage:
#   scripts/ops/run-walkthrough.sh [BASE_URL] [--no-seed-uat] [--roles r1,r2]
#
#   BASE_URL   default: https://staging.gacpth.com if reachable, else
#              http://localhost:3001 (frontend-staging's published port —
#              docker-compose.staging.yml:170).
#
# Credentials without --seed-uat: export WALK_<ROLE>_ID / WALK_<ROLE>_PW
# yourself before running (ROLE = FARMER, REVIEWER, AUDITOR, SCHEDULER,
# ACCOUNT, ADMIN). Any role left unset is skipped, not guessed — this mirrors
# apps/web-app/e2e-walkthrough/role-routes.ts's own rule.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEB_APP_DIR="$REPO_ROOT/apps/web-app"
BACKEND_CONTAINER="gacp-backend-staging" # docker-compose.staging.yml:63

SEED_UAT=1
BASE_URL=""
ROLES_ARG=""

for arg in "$@"; do
  case "$arg" in
    --no-seed-uat) SEED_UAT=0 ;;
    --seed-uat) SEED_UAT=1 ;;
    --roles=*) ROLES_ARG="${arg#--roles=}" ;;
    -h|--help)
      sed -n '2,42p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    http*://*) BASE_URL="$arg" ;;
    *)
      if [ -z "$BASE_URL" ]; then BASE_URL="$arg"; fi
      ;;
  esac
done

log() { echo "[run-walkthrough] $*"; }
err() { echo "[run-walkthrough] ERROR: $*" >&2; }

# ─── 1. Preflight ────────────────────────────────────────────────────────
log "[1/6] preflight"

command -v node >/dev/null 2>&1 || { err "node not found on this machine — install Node 24.x first (.nvmrc)"; exit 2; }
command -v pnpm >/dev/null 2>&1 || { err "pnpm not found on this machine — corepack enable && corepack prepare pnpm@8 --activate (or install per docs/)"; exit 2; }
log "  node $(node -v), pnpm $(pnpm -v)"

if [ ! -f "$WEB_APP_DIR/package.json" ]; then
  err "apps/web-app/package.json not found under $REPO_ROOT — run this from a checkout of the repo"
  exit 2
fi

if [ "$SEED_UAT" = "1" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    log "  docker not found — cannot --seed-uat on this machine, continuing WITHOUT it (export WALK_*_ID/_PW yourself, or re-run with --no-seed-uat to silence this)"
    SEED_UAT=0
  elif ! docker ps --filter "name=^${BACKEND_CONTAINER}\$" --filter "status=running" -q | grep -q .; then
    log "  container '$BACKEND_CONTAINER' is not running — cannot --seed-uat, continuing WITHOUT it"
    SEED_UAT=0
  fi
fi

# ─── 2. Resolve BASE_URL ─────────────────────────────────────────────────
if [ -z "$BASE_URL" ]; then
  if curl -sk -m 5 -o /dev/null -w '%{http_code}' https://staging.gacpth.com 2>/dev/null | grep -q '^[23]'; then
    BASE_URL="https://staging.gacpth.com"
  else
    # frontend-staging publishes 127.0.0.1:3001 -> container:3000
    # (docker-compose.staging.yml:170) — usable from the staging box itself
    # even when the public hostname/nginx vhost is not reachable.
    BASE_URL="http://localhost:3001"
  fi
fi
log "  base URL: $BASE_URL"

# ─── 3. UAT account password rotation (default on) ──────────────────────
DATE_TAG="$(date +%Y%m%d-%H%M%S)"
if [ "$SEED_UAT" = "1" ]; then
  log "[2/6] rotating UAT account passwords (canonical test accounts only — see scripts/ops/uat-account-seed.js)"
  CREDS_FILE="$HOME/walkthrough-creds-$DATE_TAG.txt"
  # Captured into a shell variable only — never echoed. See
  # scripts/ops/gen-uat-passwords.js for exactly what it prints (nothing else).
  PW_JSON="$(node "$SCRIPT_DIR/gen-uat-passwords.js" "$CREDS_FILE")"

  # Where inside the container to copy the seed script — NOT /tmp (what this
  # ran with on 2026-08-06's first real run). /tmp has no node_modules
  # ancestor anywhere above it, so `require('@prisma/client')`/
  # `require('bcryptjs')` from a script placed there is GUARANTEED to throw
  # MODULE_NOT_FOUND before printing a single per-role line, on ANY image —
  # confirmed against apps/backend/Dockerfile:88-105 (prod deps live under
  # /app/node_modules, pnpm-hoisted) + :104/:122 (WORKDIR /app/apps/backend,
  # CMD runs `node server.js` from there — the app's own require()s already
  # resolve from that directory, so ours will too). `docker exec ... pwd`
  # (no -w override) reports the container's actual runtime WORKDIR — used
  # first in case a differently-built image sets it elsewhere; falls back to
  # the Dockerfile-verified path if that query fails for any reason.
  SEED_TARGET_DIR="$(docker exec "$BACKEND_CONTAINER" pwd 2>/dev/null || true)"
  if [ -z "$SEED_TARGET_DIR" ] || ! docker exec "$BACKEND_CONTAINER" test -d "$SEED_TARGET_DIR/node_modules" 2>/dev/null; then
    log "  container's reported cwd ('$SEED_TARGET_DIR') has no node_modules — falling back to /app/apps/backend (apps/backend/Dockerfile:104)"
    SEED_TARGET_DIR="/app/apps/backend"
  fi
  SEED_REMOTE_FILE="$SEED_TARGET_DIR/.walkthrough-uat-account-seed.js"

  if ! docker cp "$SCRIPT_DIR/uat-account-seed.js" "$BACKEND_CONTAINER:$SEED_REMOTE_FILE"; then
    err "docker cp of uat-account-seed.js into $BACKEND_CONTAINER:$SEED_REMOTE_FILE failed — cannot --seed-uat, aborting (re-run with --no-seed-uat to export WALK_*_ID/_PW yourself instead)"
    exit 2
  fi

  SEED_LOG="$(mktemp)"
  SEED_EXIT=0
  docker exec -w "$SEED_TARGET_DIR" -e WALK_UAT_PASSWORD_MAP="$PW_JSON" "$BACKEND_CONTAINER" \
    node "$SEED_REMOTE_FILE" 2>&1 | tee "$SEED_LOG" || SEED_EXIT=$?
  docker exec "$BACKEND_CONTAINER" rm -f "$SEED_REMOTE_FILE" || true

  # uat-account-seed.js prints one unambiguous `SEEDED ok: <role>` or
  # `FAILED: <role> - <reason>` line per role (2026-08-07) — count them
  # directly instead of trusting only the process exit code, so a silent
  # zero-rotation run (exit 0 is possible when every account is legitimately
  # "not seeded on this environment" — see that script's header) still gets
  # reported loudly here.
  SEEDED_COUNT="$(grep -c '^SEEDED ok:' "$SEED_LOG" || true)"
  FAILED_COUNT="$(grep -c '^FAILED:' "$SEED_LOG" || true)"
  log "  seed summary: $SEEDED_COUNT/6 role(s) SEEDED ok, $FAILED_COUNT/6 FAILED (exit=$SEED_EXIT) — per-role detail is in the [2/6] output above"
  if [ "$SEED_EXIT" -ne 0 ] || [ "$SEEDED_COUNT" -eq 0 ]; then
    err "password rotation did NOT succeed for any role — every WALK_*_PW exported below will NOT match the database, so every authenticated role's login in this run WILL fail. Continuing anyway (evidence still gets packaged with per-role loginError detail — see walkthrough-manifest.json). Fix the FAILED reason(s) in the [2/6] output above, then re-run."
  else
    log "  password rotation done — $SEEDED_COUNT role(s) ready to log in this run"
  fi
  rm -f "$SEED_LOG"

  pw_for() { node -e "const m=JSON.parse(process.argv[1]); process.stdout.write(m[process.argv[2]]||'')" "$PW_JSON" "$1"; }
  export WALK_FARMER_ID="1186494077533";   export WALK_FARMER_PW="$(pw_for farmer)"
  export WALK_REVIEWER_ID="1111111111111"; export WALK_REVIEWER_PW="$(pw_for reviewer)"
  export WALK_AUDITOR_ID="2222222222222";  export WALK_AUDITOR_PW="$(pw_for auditor)"
  export WALK_SCHEDULER_ID="3333333333333"; export WALK_SCHEDULER_PW="$(pw_for scheduler)"
  export WALK_ACCOUNT_ID="4444444444444";  export WALK_ACCOUNT_PW="$(pw_for account)"
  export WALK_ADMIN_ID="9876543210987";    export WALK_ADMIN_PW="$(pw_for admin)"
  unset PW_JSON
  log "  credentials for this run exported (not printed) — also saved to $CREDS_FILE (chmod 600, NOT included in the tar.gz pack, delete it once you are done with it)"
else
  log "[2/6] --no-seed-uat (or docker unavailable) — using whatever WALK_<ROLE>_ID/_PW you already exported"
  for role in FARMER REVIEWER AUDITOR SCHEDULER ACCOUNT ADMIN; do
    id_var="WALK_${role}_ID"; pw_var="WALK_${role}_PW"
    if [ -n "${!id_var:-}" ] && [ -n "${!pw_var:-}" ]; then
      log "  $role: credentials present"
    else
      log "  $role: no credentials — this role's authenticated pages will be skipped (not guessed)"
    fi
  done
fi

# ─── 4. Install web-app deps ─────────────────────────────────────────────
log "[3/6] pnpm install (web-app workspace only)"
( cd "$REPO_ROOT" && pnpm install --filter web-app... --frozen-lockfile )

# ─── 5. Playwright browser ────────────────────────────────────────────────
log "[4/6] npx playwright install chromium"
( cd "$WEB_APP_DIR" && npx playwright install chromium )

# ─── 6. Run the spec ──────────────────────────────────────────────────────
log "[5/6] running walkthrough spec against $BASE_URL"
WALK_ROLES_ENV=""
[ -n "$ROLES_ARG" ] && WALK_ROLES_ENV="$ROLES_ARG"

SPEC_EXIT=0
(
  cd "$WEB_APP_DIR"
  E2E_BASE_URL="$BASE_URL" \
  WALK_ROLES="$WALK_ROLES_ENV" \
  npx playwright test --config=playwright.walkthrough.config.ts
) || SPEC_EXIT=$?

if [ "$SPEC_EXIT" -ne 0 ]; then
  err "walkthrough spec exited $SPEC_EXIT — packaging whatever evidence exists anyway (see manifest for what actually got captured)"
fi

# ─── 7. Package ───────────────────────────────────────────────────────────
log "[6/6] packaging evidence"
EVIDENCE_DIR="$REPO_ROOT/evidence/staging-walkthrough"
PACK_FILE="$HOME/walkthrough-pack-$DATE_TAG.tar.gz"
if [ -d "$EVIDENCE_DIR" ]; then
  tar -czf "$PACK_FILE" -C "$REPO_ROOT/evidence" staging-walkthrough
  log "  pack: $PACK_FILE ($(du -h "$PACK_FILE" | cut -f1))"
else
  err "no $EVIDENCE_DIR produced — walkthrough spec did not run far enough to write anything"
  exit "${SPEC_EXIT:-1}"
fi

log "done."
exit "$SPEC_EXIT"
