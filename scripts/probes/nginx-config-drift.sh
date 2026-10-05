#!/usr/bin/env bash
# nginx-config-drift — the nginx vhost files the host actually serves must be the ones in git.
#
# ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
# Audit 2026-09-17 (GAP2-01): demo.gacpth.com — production — had been opened to the
# public by deleting one line from /etc/nginx/sites-enabled/gacp-platform.conf on the
# host. deploy/nginx/gacp-platform.conf still said demo was gated, so three auditors
# credited a protection that did not exist, and a DoS reachable by anyone was scored as
# "reachable only by allowlisted addresses". The opposite drift existed too: the repo had
# `proxy_set_header X-Forwarded-Host` (the public verify page builds QR origins from it)
# that the host never received. A config that is edited by hand outside git is a config
# nobody can review.
#
# ── WHAT IT COMPARES ──────────────────────────────────────────────────────────
# Each deploy/nginx/<name>.conf that the host has enabled under
# /etc/nginx/sites-enabled/<name>.conf (symlinks followed). Only line numbers and counts
# are printed, never file content: the confs are token-free by design (tokens live in
# root-only include files), but a probe has no business echoing edge config into logs.
#
# Contract: exit 0 PASS · 1 FAIL · 2 BLOCKED (not running on a host that serves these
# vhosts, or the files cannot be read — never a vacuous PASS).
#
# Usage:  bash scripts/probes/nginx-config-drift.sh
#         bash scripts/probes/nginx-config-drift.sh --selftest
#         NGINX_ENABLED_DIR=<dir> NGINX_REPO_DIR=<dir> bash …   (fixtures; --selftest uses them)
source "$(dirname "$0")/_lib.sh"

ENABLED="${NGINX_ENABLED_DIR:-/etc/nginx/sites-enabled}"
REPO_DIR="${NGINX_REPO_DIR:-$ROOT/deploy/nginx}"

if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    expect() {  # expect <want-exit> <label>
        CASES=$((CASES+1))
        out="$(NGINX_ENABLED_DIR="$TMP/host" NGINX_REPO_DIR="$TMP/repo" bash "$0" 2>&1)"; got=$?
        if [ "$got" = "$1" ]; then echo "  ok   $2 → exit $got"; else echo "  BAD  $2 → exit $got, wanted $1: $out"; BAD=$((BAD+1)); fi
    }
    reset() { rm -rf "$TMP/host" "$TMP/repo"; mkdir -p "$TMP/host" "$TMP/repo" "$TMP/avail"; }
    reset
    printf 'map a $b {\n    default 0;\n}\n' >"$TMP/repo/gacp-platform.conf"
    cp "$TMP/repo/gacp-platform.conf" "$TMP/host/gacp-platform.conf";          expect 0 "A identical"
    printf 'map a $b {\n    default 0;\n    "1:0:0" 1;\n}\n' >"$TMP/host/gacp-platform.conf"; expect 1 "B host edited by hand"
    printf 'server { listen 443; }\n' >"$TMP/repo/demo.gacpth.com.conf"
    printf 'server { listen 443; }\n' >"$TMP/avail/demo.gacpth.com.conf"
    cp "$TMP/repo/gacp-platform.conf" "$TMP/host/gacp-platform.conf"
    ln -s "$TMP/avail/demo.gacpth.com.conf" "$TMP/host/demo.gacpth.com.conf";  expect 0 "C symlinked vhost, identical"
    printf 'server { listen 443; add_header X 1; }\n' >"$TMP/avail/demo.gacpth.com.conf"; expect 1 "D symlink target drifted"
    reset; printf 'x\n' >"$TMP/repo/gacp-platform.conf";                          expect 2 "E host serves none of the repo vhosts"
    rm -rf "$TMP/host";                                                            expect 2 "F no sites-enabled dir (not the host)"
    reset; printf 'x\n' >"$TMP/repo/gacp-platform.conf"; printf 'x\n' >"$TMP/host/gacp-platform.conf"
    printf 'y\n' >"$TMP/repo/preview.gacpth.com.conf";                           expect 0 "G repo-only vhost not enabled on host is not drift"
    echo "selftest: $((CASES-BAD))/$CASES"
    [ "$BAD" -eq 0 ] && exit 0 || exit 1
fi

[ -d "$ENABLED" ] || blocked "$ENABLED not found — this probe only means something on the host that serves the vhosts"
[ -d "$REPO_DIR" ] || blocked "$REPO_DIR not found"

checked=0; drift=()
for repo_file in "$REPO_DIR"/*.conf; do
    [ -e "$repo_file" ] || continue
    name="$(basename "$repo_file")"
    host_file="$ENABLED/$name"
    [ -e "$host_file" ] || continue          # a repo vhost the host does not enable is not drift
    [ -r "$host_file" ] || blocked "cannot read $host_file"
    checked=$((checked+1))
    if ! cmp -s "$repo_file" "$host_file"; then
        n="$(diff "$repo_file" "$host_file" | grep -c '^[<>]' || true)"
        where="$(diff "$repo_file" "$host_file" | grep -E '^[0-9]' | head -5 | tr '\n' ' ')"
        drift+=("$name: $n differing line(s) at repo/host ranges $where")
    fi
done

[ "$checked" -eq 0 ] && blocked "the host enables none of the vhosts in ${REPO_DIR#$ROOT/} — nothing to compare"
if [ "${#drift[@]}" -gt 0 ]; then
    fail "host nginx differs from git in ${#drift[@]} of $checked vhost(s): $(printf '%s; ' "${drift[@]}")— deploy the repo file to the host, or commit the host change"
fi
pass "$checked vhost file(s) on the host are byte-identical to deploy/nginx/"
