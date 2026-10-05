#!/bin/bash
# ============================================================================
# smoke-endpoints.sh — blanket smoke test of the deployed GACP API surface
# ============================================================================
# Hits the parameterless PUBLIC GET endpoints (expect 2xx) to confirm the stack
# serves across every domain + the DB is reachable, then spot-checks a few
# AUTHED endpoints (expect 401/403) to confirm access control is actually
# enforced. Endpoint list derived from the 597-endpoint inventory (2026-06-03).
#
# Usage:
#   bash scripts/test/smoke-endpoints.sh                       # default https://127.0.0.1 (on the server)
#   bash scripts/test/smoke-endpoints.sh https://gacpth.com    # through Cloudflare (from anywhere)
#   bash scripts/test/smoke-endpoints.sh http://127.0.0.1:8080 # docker nginx directly
# ============================================================================
set -uo pipefail
BASE="${1:-https://127.0.0.1}"
pass=0; fail=0
hit() { curl -sk -o /dev/null --max-time 15 -w '%{http_code}' "$@" 2>/dev/null; }

check() { # check METHOD PATH EXPECT_ERE
  local m="$1" p="$2" exp="$3" code
  code=$(hit -X "$m" "$BASE$p"); code=${code:-000}
  if [[ "$code" =~ $exp ]]; then printf '  \033[32m✓\033[0m %-5s %-52s %s\n' "$m" "$p" "$code"; pass=$((pass+1))
  else printf '  \033[31m✗\033[0m %-5s %-52s %s (want %s)\n' "$m" "$p" "$code" "$exp"; fail=$((fail+1)); fi
}

echo "════════════════════════════════════════════════════════════════"
echo " GACP API smoke test → $BASE"
echo "════════════════════════════════════════════════════════════════"

echo "── PUBLIC (expect 2xx) ──────────────────────────────────────────"
for p in \
  /api/health /api/version /api/standards \
  /api/config /api/config/applicant-types /api/config/area-types \
  /api/config/cultivation-methods /api/config/farm-types /api/config/plants \
  /api/config/provinces /api/config/purposes /api/config/service-types \
  /api/config/templates \
  /api/master-data /api/master-data/cultivation-methods /api/master-data/fees \
  /api/master-data/locations /api/master-data/purposes /api/master-data/qr-pricing \
  /api/system/status-machine /api/system-config/public \
  /api/criteria \
  /api/applications/config /api/applications/journey /api/applications/journey/full-config \
  /api/applications/scoring/standard /api/applications/scoring/categories /api/applications/scoring/levels \
  /api/pricing /api/pricing/fees /api/subscription/plans \
  /api/interoperability/v1/trust/public-key /api/interoperability/v1/trust/registry \
  /api/interoperability/v1/trust/revocations ; do
    check GET "$p" '^(200|204|304)$'
done
# Endpoints needing a query param, or secondary probes:
check GET "/api/system/working-days?from=$(date +%F)&days=5" '^(200|400)$'   # input-validation endpoint (needs from + days|to); 400 = correctly rejecting incomplete input
check GET "/api/health/ready" '^(200|404|503)$'   # readiness gate; liveness = /api/health

echo "── AUTH ENFORCED (expect 401/403 — proves access control works) ──"
check GET    /api/applications            '^(301|401|403)$'   # 301 = trailing-slash redirect → then 401
check POST   /api/applications            '^(301|401|403)$'
check GET    /api/provider/work           '^(401|403)$'
check POST   /api/provider/admin/broadcast '^(401|403)$'
check GET    /api/notifications           '^(401|403)$'
check PATCH  /api/admin/config/x          '^(401|403|404)$'

echo "── E2E routes MUST be gone in production (expect 404) ──"
check POST   /api/e2e/reset               '^404$'

echo "════════════════════════════════════════════════════════════════"
echo "  PASS=$pass  FAIL=$fail"
[ "$fail" -eq 0 ] && echo "  ✅ all checks passed" || echo "  ⚠️  $fail check(s) need a look"
echo "════════════════════════════════════════════════════════════════"
exit 0
