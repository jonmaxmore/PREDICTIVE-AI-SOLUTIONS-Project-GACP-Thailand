#!/usr/bin/env bash
#
# scripts/deploy/validate-deploy-level.sh
#
# End-to-end validation for the deploy maturity ladder. Run this AFTER
# completing each level's activation guide to confirm everything works.
#
# Usage:
#   ./validate-deploy-level.sh           # check all levels
#   ./validate-deploy-level.sh 3         # check level 3 (image-based)
#   ./validate-deploy-level.sh 4         # check level 4 (blue/green)
#   ./validate-deploy-level.sh 5         # check level 5 (staging)
#
# Run on the production server (or via SSH from local). Reports PASS/FAIL
# per check with remediation hints.

set -uo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/gacp-platform}"
LEVEL="${1:-all}"
PASS=0
FAIL=0
WARN=0

red() { echo -e "\033[31m$*\033[0m"; }
green() { echo -e "\033[32m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }

check_pass() { green "  ✅ $*"; PASS=$((PASS+1)); }
check_fail() { red "  ❌ $*"; FAIL=$((FAIL+1)); }
check_warn() { yellow "  ⚠️  $*"; WARN=$((WARN+1)); }

# ──────────────────────────────────────────────────────────────────────────
# LEVEL 2 — git pull + safety guards (the baseline)
# ──────────────────────────────────────────────────────────────────────────

validate_level_2() {
    echo
    echo "═══ Level 2 — CI-orchestrated git pull + safety guards ═══"

    cd "$PROJECT_DIR" 2>/dev/null || { check_fail "$PROJECT_DIR not found"; return; }

    [ -x scripts/deploy/deploy-production.sh ] \
        && check_pass "deploy-production.sh exists + executable" \
        || check_fail "deploy-production.sh missing or not chmod +x"

    grep -q "set -Eeuo pipefail" scripts/deploy/deploy-production.sh \
        && check_pass "strict bash flags" \
        || check_fail "missing 'set -Eeuo pipefail'"

    grep -q "Pre-flight" scripts/deploy/deploy-production.sh \
        && check_pass "pre-flight check present" \
        || check_fail "no pre-flight section"

    [ -d /var/log/gacp-deploys ] \
        && check_pass "audit log directory exists ($(ls /var/log/gacp-deploys/*.log 2>/dev/null | wc -l) past deploys)" \
        || check_warn "no /var/log/gacp-deploys yet (first deploy will create it)"

    [ -d /var/backups/gacp ] \
        && check_pass "DB backup directory exists ($(ls /var/backups/gacp/*.sql.gz 2>/dev/null | wc -l) backups)" \
        || check_warn "no /var/backups/gacp yet"

    if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
        check_pass "working tree clean (source-of-truth invariant met)"
    else
        check_fail "working tree DIRTY — run snapshot+reset before next deploy"
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# LEVEL 3 — image-based deploy via GHCR
# ──────────────────────────────────────────────────────────────────────────

validate_level_3() {
    echo
    echo "═══ Level 3 — Image-based deploy via GHCR ═══"

    cd "$PROJECT_DIR" 2>/dev/null || { check_fail "$PROJECT_DIR not found"; return; }

    grep -qE "^\s*image:.*ghcr\.io" docker-compose.production.yml \
        && check_pass "compose references ghcr.io image (build replaced)" \
        || check_warn "compose still uses build: directive (expected if Level 3 not yet active on this branch)"

    if docker buildx imagetools inspect ghcr.io/jonmaxmore/gacp-backend:deploy-production-latest >/dev/null 2>&1; then
        check_pass "ghcr.io/jonmaxmore/gacp-backend:deploy-production-latest reachable"
    elif docker buildx imagetools inspect ghcr.io/jonmaxmore/gacp-backend:main-latest >/dev/null 2>&1; then
        check_warn "main-latest exists but deploy-production-latest does not (promote main → deploy/production needed)"
    else
        check_fail "no GHCR image found — workflow permissions not enabled?"
        echo "       fix: https://github.com/jonmaxmore/GACP-Certification-Application/settings/actions"
        echo "       set 'Workflow permissions' to 'Read and write permissions', then re-push"
    fi

    if docker buildx imagetools inspect ghcr.io/jonmaxmore/gacp-frontend:deploy-production-latest >/dev/null 2>&1; then
        check_pass "ghcr.io/jonmaxmore/gacp-frontend:deploy-production-latest reachable"
    else
        check_warn "frontend image may not be ready yet"
    fi

    # Distinguish Level 3 ('docker compose pull …') from Level 2's
    # 'build --pull …' which is a build with --pull-fresh-base, not Level 3.
    if grep -qE "^\s*[A-Z_]+=.*docker compose.*\<pull\>\s+backend\s+frontend" scripts/deploy/deploy-production.sh \
       || grep -qE "compose.*\<pull\>\s+backend frontend" scripts/deploy/deploy-production.sh; then
        check_pass "deploy script uses image 'pull' (Level 3)"
    elif grep -qE "compose.*build\s+--pull\s+backend frontend" scripts/deploy/deploy-production.sh; then
        check_warn "deploy script still on Level 2 'build --pull' path (expected if Level 3 not yet promoted)"
    else
        check_warn "could not classify deploy step in script"
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# LEVEL 4 — blue/green
# ──────────────────────────────────────────────────────────────────────────

validate_level_4() {
    echo
    echo "═══ Level 4 — Blue/green zero-downtime deploy ═══"

    cd "$PROJECT_DIR" 2>/dev/null || return

    [ -f docker-compose.bluegreen.yml ] \
        && check_pass "bluegreen overlay compose exists" \
        || check_fail "docker-compose.bluegreen.yml missing"

    [ -f nginx/bluegreen-upstream.conf.template ] \
        && check_pass "nginx upstream template present" \
        || check_fail "nginx/bluegreen-upstream.conf.template missing"

    if [ -f /etc/nginx/conf.d/bluegreen-upstream.conf ]; then
        if grep -q "{{ACTIVE_COLOR}}" /etc/nginx/conf.d/bluegreen-upstream.conf; then
            check_fail "nginx config has unrendered {{ACTIVE_COLOR}} placeholder — run sed activation step"
        else
            check_pass "nginx upstream config rendered"
            ACTIVE=$(curl -sf http://127.0.0.1:8081/__bluegreen 2>/dev/null | tr -d '[:space:]' || echo "")
            [ -n "$ACTIVE" ] \
                && check_pass "active color = $ACTIVE (diagnostic endpoint responds)" \
                || check_warn "/__bluegreen diagnostic endpoint not responding (nginx not reloaded?)"
        fi
    else
        check_warn "blue/green not yet activated (no /etc/nginx/conf.d/bluegreen-upstream.conf)"
    fi

    BLUE_UP=$(docker inspect --format='{{.State.Status}}' gacp-backend-blue 2>/dev/null || echo "missing")
    GREEN_UP=$(docker inspect --format='{{.State.Status}}' gacp-backend-green 2>/dev/null || echo "missing")
    if [ "$BLUE_UP" = "running" ] || [ "$GREEN_UP" = "running" ]; then
        check_pass "at least one color stack running (blue=$BLUE_UP, green=$GREEN_UP)"
    else
        check_warn "neither blue nor green stack started — Level 4 not active yet"
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# LEVEL 5 — staging slot
# ──────────────────────────────────────────────────────────────────────────

validate_level_5() {
    echo
    echo "═══ Level 5 — Staging slot (same droplet) ═══"

    cd "$PROJECT_DIR" 2>/dev/null || return

    [ -f docker-compose.staging.yml ] \
        && check_pass "staging compose exists" \
        || check_fail "docker-compose.staging.yml missing"

    [ -f .env.staging ] \
        && check_pass ".env.staging present" \
        || check_warn ".env.staging not yet created (see staging-activation.md Step 2)"

    if docker exec gacp-postgres psql -U gacp -tc "SELECT 1 FROM pg_database WHERE datname='gacp_staging'" 2>/dev/null | grep -q 1; then
        check_pass "gacp_staging database exists"
    else
        check_warn "gacp_staging DB not created — see staging-activation.md Step 1"
    fi

    if [ -L /etc/nginx/sites-enabled/staging.gacpth.com.conf ] || [ -f /etc/nginx/sites-enabled/staging.gacpth.com.conf ]; then
        check_pass "staging nginx vhost enabled"
    else
        check_warn "staging nginx vhost not yet symlinked"
    fi

    STAGING_UP=$(docker inspect --format='{{.State.Health.Status}}' gacp-backend-staging 2>/dev/null || echo "missing")
    case "$STAGING_UP" in
        healthy) check_pass "backend-staging container healthy" ;;
        starting) check_warn "backend-staging starting (give it 30s)" ;;
        unhealthy) check_fail "backend-staging UNHEALTHY — check 'docker logs gacp-backend-staging'" ;;
        missing) check_warn "backend-staging not yet started" ;;
        *) check_warn "backend-staging state: $STAGING_UP" ;;
    esac

    if curl -sk -m 5 https://staging.gacpth.com/api/health 2>/dev/null | grep -q '"success":true'; then
        check_pass "https://staging.gacpth.com/api/health returns 200"
    else
        check_warn "staging public URL not reachable yet (DNS / TLS / vhost?)"
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# Dispatch
# ──────────────────────────────────────────────────────────────────────────

case "$LEVEL" in
    all|"")
        validate_level_2
        validate_level_3
        validate_level_4
        validate_level_5
        ;;
    2) validate_level_2 ;;
    3) validate_level_3 ;;
    4) validate_level_4 ;;
    5) validate_level_5 ;;
    *)
        echo "usage: $0 [2|3|4|5|all]"
        exit 2
        ;;
esac

echo
echo "═══ Summary ═══"
green "  $PASS passed"
[ "$WARN" -gt 0 ] && yellow "  $WARN warnings (acceptable if level not yet activated)"
[ "$FAIL" -gt 0 ] && red "  $FAIL failed (action required)"
echo

[ "$FAIL" -eq 0 ]
