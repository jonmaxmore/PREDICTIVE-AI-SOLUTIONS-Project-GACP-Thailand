#!/bin/bash
# ============================================================================
# setup-host-nginx.sh — install + configure the HOST nginx edge
# ============================================================================
# Per docs/standards/architecture-nginx-rule.md: the host nginx owns public
# :80/:443 + TLS and proxies to the Docker-internal nginx on 127.0.0.1:8080.
# remote-install.sh only starts the Docker stack (Docker nginx is bound to
# 127.0.0.1:8080), so WITHOUT this edge nothing listens on the public ports
# and a proxied Cloudflare origin returns 522.
#
# Run ON the server as root, AFTER remote-install.sh has cloned the repo and
# started the Docker stack:
#   sudo bash /opt/gacp-platform/scripts/deploy/setup-host-nginx.sh
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/gacp-platform}"
SRC_CONF="$APP_DIR/deploy/nginx/gacp-platform.conf"
DST_AVAIL="/etc/nginx/sites-available/gacp-platform.conf"
DST_ENABLED="/etc/nginx/sites-enabled/gacp-platform.conf"
SSL_DIR="$APP_DIR/nginx/ssl"
CRT="$SSL_DIR/gacp.crt"
KEY="$SSL_DIR/gacp.key"

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
step() { echo -e "\n▶ $*"; }

echo "================================================================"
echo "🌐 GACP host-nginx edge setup (public :80/:443 → 127.0.0.1:8080)"
echo "================================================================"

# ── 1. Install host nginx ────────────────────────────────────────────────────
step "1. Host nginx"
if command -v nginx >/dev/null 2>&1 && [ -d /etc/nginx/sites-available ]; then
  echo "  ✓ nginx present: $(nginx -v 2>&1)"
else
  if   command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -y && $SUDO apt-get install -y nginx
  elif command -v dnf     >/dev/null 2>&1; then $SUDO dnf install -y nginx
  elif command -v yum     >/dev/null 2>&1; then $SUDO yum install -y nginx
  else echo "  ❌ no supported package manager (apt/dnf/yum)"; exit 1; fi
  $SUDO mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
fi

# ── 2. Origin TLS cert (Cloudflare 'Full' works with self-signed) ────────────
step "2. Origin TLS cert → $CRT"
$SUDO mkdir -p "$SSL_DIR"
if [ -f "$CRT" ] && [ -f "$KEY" ]; then
  echo "  ✓ cert already present"
elif [ -f "$SSL_DIR/fullchain.pem" ] && [ -f "$SSL_DIR/privkey.pem" ]; then
  $SUDO cp "$SSL_DIR/fullchain.pem" "$CRT"; $SUDO cp "$SSL_DIR/privkey.pem" "$KEY"
  echo "  ✓ reused the existing self-signed cert (copied to gacp.crt/gacp.key)"
else
  $SUDO openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY" -out "$CRT" -subj "/C=TH/ST=Bangkok/O=GACP/CN=gacpth.com" 2>/dev/null
  echo "  ✓ generated a self-signed origin cert"
fi
echo "  ℹ️  For Cloudflare 'Full (strict)': replace gacp.crt/gacp.key with a"
echo "      Cloudflare Origin Certificate (Dashboard → SSL/TLS → Origin Server)."

# ── 3. Ensure /nginx-health exists in the Docker layer it proxies to ─────────
# (deploy/nginx config exposes /nginx-health on :80 for plain-HTTP checks.)

# ── 4. Install + enable the edge config ──────────────────────────────────────
step "3. Edge config → $DST_AVAIL"
[ -f "$SRC_CONF" ] || { echo "  ❌ $SRC_CONF missing — run remote-install.sh first (it clones the repo)"; exit 1; }
$SUDO cp "$SRC_CONF" "$DST_AVAIL"
$SUDO ln -sf "$DST_AVAIL" "$DST_ENABLED"
$SUDO rm -f /etc/nginx/sites-enabled/default
echo "  ✓ installed + enabled (removed the stock default site)"

# ── 5. Validate + (re)start ──────────────────────────────────────────────────
step "4. Validate + reload"
$SUDO nginx -t
$SUDO systemctl enable nginx >/dev/null 2>&1 || true
$SUDO systemctl reload nginx 2>/dev/null || $SUDO systemctl restart nginx
echo "  ✓ host nginx live on :80/:443 → 127.0.0.1:8080"

cat <<'NOTE'

────────────────────────────────────────────────────────────
✅ Host edge ready. Cloudflare (proxied) checklist:
  • SSL/TLS → Overview → mode = FULL
    (origin uses a self-signed cert; choose 'Full (strict)' only after
     installing a Cloudflare Origin Certificate at nginx/ssl/gacp.crt|.key)
  • Real visitor IP: deploy/nginx/gacp-platform.conf trusts Cloudflare ranges
    (set_real_ip_from + real_ip_header CF-Connecting-IP) so audit logs and
    rate-limiting see the true client IP. Refresh ranges from
    https://www.cloudflare.com/ips/ if Cloudflare updates them.
  • Verify origin reachability (bypassing Cloudflare):
      curl -ki https://127.0.0.1/nginx-health    # on the server → "OK"
────────────────────────────────────────────────────────────
NOTE
