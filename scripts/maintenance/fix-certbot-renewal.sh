#!/usr/bin/env bash
#
# fix-certbot-renewal.sh — switch certbot from standalone to webroot
#
# Why this exists (Phase 1 #1.12 of the 2026-04-27 audit):
#   The current certbot config uses authenticator=standalone, which
#   requires certbot to bind port 80 during renewal. The host nginx
#   already holds port 80 in production, so `certbot renew --dry-run`
#   fails. Without a fix, the live cert
#   (/etc/letsencrypt/live/152-42-218-251.sslip.io/) will silently
#   stop renewing and HTTPS will go down on 2026-06-03.
#
# What this script does:
#   1. Snapshot the current nginx vhost and renewal config
#   2. Create the certbot webroot at /var/www/certbot
#   3. Patch the host nginx vhost to serve .well-known/acme-challenge/
#      from that webroot (BEFORE the existing redirect to HTTPS)
#   4. Switch /opt/gacp-platform/nginx/ssl/* from a manual copy to
#      a symlink chain pointing at /etc/letsencrypt/live/... so that
#      a renewed cert is picked up immediately (the host nginx still
#      reads /opt/gacp-platform/... — no nginx config change needed)
#   5. Switch the renewal config from standalone to webroot
#   6. Add a deploy-hook that reloads nginx after each renewal
#   7. Run `certbot renew --dry-run` to verify
#
# Idempotent: re-running this script after success is safe.
#
# Run on the production droplet as root:
#   sudo bash scripts/maintenance/fix-certbot-renewal.sh
#
# Rollback (if anything breaks):
#   - Backups are saved in /root/cert-fix-backups-<timestamp>/
#   - To restore:
#       cp /root/cert-fix-backups-<ts>/152-42-218-251.sslip.io.conf \
#          /etc/letsencrypt/renewal/152-42-218-251.sslip.io.conf
#       cp /root/cert-fix-backups-<ts>/gacp-platform.conf \
#          /etc/nginx/sites-enabled/gacp-platform.conf
#       systemctl reload nginx

set -euo pipefail

DOMAIN="152-42-218-251.sslip.io"
WEBROOT="/var/www/certbot"
NGINX_VHOST="/etc/nginx/sites-enabled/gacp-platform.conf"
RENEWAL_CONF="/etc/letsencrypt/renewal/${DOMAIN}.conf"
NGINX_SSL_DIR="/opt/gacp-platform/nginx/ssl"
LE_LIVE="/etc/letsencrypt/live/${DOMAIN}"
DEPLOY_HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/cert-fix-backups-${TS}"

err() { echo "❌ $*" >&2; exit 1; }
ok()  { echo "✅ $*"; }
inf() { echo "ℹ️  $*"; }

[ "$(id -u)" = "0" ] || err "must run as root"
[ -f "$NGINX_VHOST" ] || err "$NGINX_VHOST not found"
[ -f "$RENEWAL_CONF" ] || err "$RENEWAL_CONF not found"
[ -d "$LE_LIVE" ] || err "$LE_LIVE not found — does the cert exist?"

# ─── 1. Snapshot ─────────────────────────────────────────────────────────
inf "[1/7] Snapshot original configs to $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -p "$NGINX_VHOST"   "$BACKUP_DIR/"
cp -p "$RENEWAL_CONF"  "$BACKUP_DIR/"
[ -d "$NGINX_SSL_DIR" ] && cp -rp "$NGINX_SSL_DIR" "$BACKUP_DIR/nginx-ssl-dir"
ok "  backups in $BACKUP_DIR"

# ─── 2. Create webroot ──────────────────────────────────────────────────
inf "[2/7] Create $WEBROOT"
mkdir -p "$WEBROOT/.well-known/acme-challenge"
chown -R root:root "$WEBROOT"
ok "  webroot ready"

# ─── 3. Patch host nginx vhost ──────────────────────────────────────────
#
# Self-recovering: an earlier version of this script had an awk bug that
# inserted the location block with an empty `root ;` directive, which
# breaks `nginx -t`. If we detect that broken state on entry, restore from
# the most recent backup before re-patching. Idempotent on the success
# path: if the file already contains the CORRECT line `root <webroot>;`
# we skip the patch.

inf "[3/7] Add ACME challenge location to host nginx HTTP block"
EXPECTED_ROOT_LINE="root $WEBROOT;"

# Check for the broken `root ;` pattern FIRST. A file can simultaneously
# contain a correct patched line AND the broken empty-root line if a
# previous broken run left a half-patched file and a later run's awk
# appended a second location block. The broken pattern poisons the file
# regardless of whether the correct line is also present.
HAS_BROKEN_ROOT=false
if grep -qE "^\s*root\s*;" "$NGINX_VHOST"; then
    HAS_BROKEN_ROOT=true
fi

if [ "$HAS_BROKEN_ROOT" = "false" ] && grep -qF "$EXPECTED_ROOT_LINE" "$NGINX_VHOST"; then
    inf "  already correctly patched"
else
    # Recovery branch — broken state OR no patch at all.
    if [ "$HAS_BROKEN_ROOT" = "true" ] || grep -qF "/.well-known/acme-challenge/" "$NGINX_VHOST"; then
        inf "  detected broken previous patch — searching for an ORIGINAL clean backup"
        CLEAN_BACKUP_VHOST=""
        # Iterate oldest-to-newest. First clean backup wins (typically the
        # very first run's snapshot, before any awk patch ran).
        for d in $(ls -d /root/cert-fix-backups-*/ 2>/dev/null | sort); do
            f="${d}gacp-platform.conf"
            [ -f "$f" ] || continue
            # Clean = no empty `root ;` AND no acme-challenge location
            # block at all (i.e., truly the pre-patch original).
            if ! grep -qE "^\s*root\s*;" "$f" && ! grep -qF "/.well-known/acme-challenge/" "$f"; then
                CLEAN_BACKUP_VHOST="$f"
                break
            fi
        done
        if [ -n "$CLEAN_BACKUP_VHOST" ]; then
            cp -p "$CLEAN_BACKUP_VHOST" "$NGINX_VHOST"
            ok "  restored vhost from $CLEAN_BACKUP_VHOST (original clean state)"
        else
            err "vhost looks broken but no clean backup found at /root/cert-fix-backups-*/gacp-platform.conf — manual cleanup needed; check with: grep -L 'acme-challenge' /root/cert-fix-backups-*/gacp-platform.conf"
        fi
    fi

    # Insert ACME location BEFORE the "Redirect all other traffic to HTTPS"
    # block. Use ^~ so it takes precedence over the regex-less / location.
    # Pass WEBROOT via -v (NOT ENVIRON[]) so it doesn't depend on whether
    # WEBROOT is exported into awk's environment.
    awk -v webroot="$WEBROOT" '
        /# Redirect all other traffic to HTTPS/ && !injected {
            print "    # ACME HTTP-01 challenge — must precede the redirect"
            print "    location ^~ /.well-known/acme-challenge/ {"
            print "        root " webroot ";"
            print "        try_files $uri =404;"
            print "        access_log off;"
            print "    }"
            print ""
            injected = 1
        }
        { print }
    ' "$NGINX_VHOST" > "$NGINX_VHOST.tmp.$TS"
    mv "$NGINX_VHOST.tmp.$TS" "$NGINX_VHOST"

    # Defensive verify: confirm the patched line is correct.
    if ! grep -qF "$EXPECTED_ROOT_LINE" "$NGINX_VHOST"; then
        err "patch did not produce the expected '$EXPECTED_ROOT_LINE' line — see $NGINX_VHOST"
    fi
    ok "  patched"
fi

# ─── 4. Symlink nginx SSL dir at LE paths ───────────────────────────────
# /opt/gacp-platform/nginx/ssl/gacp.crt → ../etc/letsencrypt/live/<dom>/fullchain.pem
# This way, when LE renews, the host nginx + docker nginx both pick up the
# new cert immediately on `nginx -s reload` (the deploy-hook below).

inf "[4/7] Point /opt/gacp-platform/nginx/ssl/* at LE live cert"
mkdir -p "$NGINX_SSL_DIR"
# Save the originals if they're regular files (not symlinks)
for fname in gacp.crt gacp.key; do
    target="$NGINX_SSL_DIR/$fname"
    if [ -f "$target" ] && [ ! -L "$target" ]; then
        mv "$target" "$BACKUP_DIR/$fname.orig"
    fi
done
ln -sfn "$LE_LIVE/fullchain.pem"  "$NGINX_SSL_DIR/gacp.crt"
ln -sfn "$LE_LIVE/privkey.pem"    "$NGINX_SSL_DIR/gacp.key"
ls -la "$NGINX_SSL_DIR/gacp.crt" "$NGINX_SSL_DIR/gacp.key"
ok "  symlinks in place"

# ─── 5. Switch renewal authenticator ────────────────────────────────────
inf "[5/7] Switch authenticator standalone → webroot in $RENEWAL_CONF"
sed -i.tmp "s|^authenticator = standalone|authenticator = webroot|" "$RENEWAL_CONF"
if grep -q "^webroot_path" "$RENEWAL_CONF"; then
    sed -i.tmp "s|^webroot_path =.*|webroot_path = $WEBROOT|" "$RENEWAL_CONF"
else
    # Append under [renewalparams] section, after the authenticator line
    sed -i.tmp "/^authenticator = webroot/a webroot_path = $WEBROOT" "$RENEWAL_CONF"
fi
# Old [renewalparams] format expects per-domain webroot mapping in
# [[webroot_map]] section. Ensure it's present:
if ! grep -q "^\[\[webroot_map\]\]" "$RENEWAL_CONF"; then
    cat >> "$RENEWAL_CONF" <<EOF

[[webroot_map]]
${DOMAIN} = ${WEBROOT}
EOF
fi
rm -f "$RENEWAL_CONF.tmp"
ok "  renewal config updated"

# ─── 6. Deploy-hook: reload nginx after renewal ─────────────────────────
inf "[6/7] Install deploy-hook to reload nginx after renewal"
mkdir -p "$DEPLOY_HOOK_DIR"
cat > "$DEPLOY_HOOK_DIR/reload-nginx.sh" <<'EOF'
#!/usr/bin/env bash
# Auto-installed by scripts/maintenance/fix-certbot-renewal.sh
# Reload host nginx + docker nginx after a successful cert renewal.
set -e
nginx -t && systemctl reload nginx || true
# Also signal docker nginx — it reads from the same SSL dir via volume mount
docker exec gacp-nginx nginx -s reload 2>/dev/null || true
echo "[deploy-hook] reloaded nginx after renewal at $(date -Iseconds)"
EOF
chmod +x "$DEPLOY_HOOK_DIR/reload-nginx.sh"
ok "  deploy-hook installed"

# ─── 7. Validate ────────────────────────────────────────────────────────
inf "[7/7] Validate"
nginx -t || err "nginx config test failed — restore from $BACKUP_DIR"
systemctl reload nginx
ok "  host nginx reloaded"

# Verify the ACME challenge path is reachable
TESTFILE="$WEBROOT/.well-known/acme-challenge/_certbot-fix-test-$TS"
echo "ok-$TS" > "$TESTFILE"
if curl -sf --max-time 5 "http://${DOMAIN}/.well-known/acme-challenge/_certbot-fix-test-$TS" | grep -q "ok-$TS"; then
    ok "  ACME path reachable over HTTP"
else
    err "ACME path NOT reachable — check nginx config"
fi
rm -f "$TESTFILE"

# Run the actual dry-run
inf "  running certbot renew --dry-run"
if certbot renew --dry-run --no-random-sleep-on-renew 2>&1 | tee /tmp/certbot-dry-run-$TS.log | tail -10; then
    if grep -q "Congratulations, all simulated renewals" /tmp/certbot-dry-run-$TS.log; then
        ok "  ✅ certbot renewal DRY-RUN SUCCEEDED"
    else
        err "dry-run output unexpected — see /tmp/certbot-dry-run-$TS.log"
    fi
else
    err "certbot dry-run failed — see /tmp/certbot-dry-run-$TS.log"
fi

# Smoke-test HTTPS
inf "  HTTPS smoke check"
curl -sfk --max-time 5 "https://${DOMAIN}/api/health" >/dev/null && ok "  HTTPS still serves /api/health" || err "HTTPS smoke failed"

echo
ok "DONE — TLS auto-renewal is now wired correctly."
echo
echo "What you can verify any time:"
echo "  certbot renew --dry-run          # should report success"
echo "  systemctl list-timers | grep certbot   # systemd timer that triggers renewal"
echo "  ls -la /opt/gacp-platform/nginx/ssl/   # both .crt and .key are now symlinks"
echo
echo "Rollback if needed:"
echo "  cp $BACKUP_DIR/152-42-218-251.sslip.io.conf $RENEWAL_CONF"
echo "  cp $BACKUP_DIR/gacp-platform.conf $NGINX_VHOST"
echo "  rm $NGINX_SSL_DIR/gacp.crt $NGINX_SSL_DIR/gacp.key"
echo "  cp $BACKUP_DIR/gacp.crt.orig $NGINX_SSL_DIR/gacp.crt"
echo "  cp $BACKUP_DIR/gacp.key.orig $NGINX_SSL_DIR/gacp.key"
echo "  systemctl reload nginx"
