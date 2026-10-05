#!/usr/bin/env bash
# holder-read-scope — the active-entity (workspace) request plumbing stays gone.
#
# FAIL when anything under apps/ spells one of the retired tokens:
#   x-active-entity-id · req.activeEntity · entity-context · runWithEntityContext ·
#   getEntityContext · ACTIVE_ENTITY_MISMATCH · gacp.activeEntityId
# Excluded: node_modules, .next, *.test.* and __tests__/ (tests must be able to send
# the retired header to prove it is not forwarded — plan C6), and prisma/migrations/
# (applied migrations are immutable: editing a comment changes the checksum).
# The ONE allowed line is the boot cleanup in my-entities-provider.tsx, matched by
# exact file AND exact text, so the same text anywhere else still FAILs.
#
# Contract: exit 0 PASS · 1 FAIL · 2 BLOCKED (cannot run) — see _lib.sh.
# Usage:  bash scripts/probes/holder-read-scope.sh
#         bash scripts/probes/holder-read-scope.sh --selftest
#         HOLDER_SCOPE_ROOT=<dir> bash scripts/probes/holder-read-scope.sh   (scan a synthetic apps/ parent)
source "$(dirname "$0")/_lib.sh"

SCAN_ROOT="${HOLDER_SCOPE_ROOT:-$ROOT}"
ALLOWED_FILE='apps/web-app/src/lib/services/my-entities-provider.tsx'
ALLOWED_TEXT="localStorage.removeItem('gacp.activeEntityId')"
PATTERN='x-active-entity-id|req\.activeEntity|entity-context|runWithEntityContext|getEntityContext|ACTIVE_ENTITY_MISMATCH|gacp\.activeEntityId'

if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d 2>/dev/null)" || blocked "selftest: mktemp failed"
    trap 'rm -rf "$TMP"' EXIT; BAD=0
    check() { # label dir expected-exit
        local out code
        out="$(HOLDER_SCOPE_ROOT="$2" bash "$0" 2>&1)"; code=$?
        echo "--- selftest $1 -> exit $code (expected $3)"; printf '%s\n' "$out" | head -5
        [ "$code" = "$3" ] || { echo "*** $1 FAILED"; BAD=$((BAD + 1)); }
    }
    mk() { mkdir -p "$1/apps/web-app/src/lib/services" "$1/apps/backend"; }
    CLEAN_LINE="    try { window.localStorage.removeItem('gacp.activeEntityId'); } catch { /* ignore */ }"
    mk "$TMP/a"; echo "headers['x-active-entity-id'] = id;" >"$TMP/a/apps/backend/x.js"
    check "planted hit in a temp tree -> FAIL" "$TMP/a" 1
    mk "$TMP/b"; printf '%s\n' "$CLEAN_LINE" >"$TMP/b/$ALLOWED_FILE"
    check "cleanup line alone -> PASS" "$TMP/b" 0
    mk "$TMP/c"; echo "send('x-active-entity-id')" >"$TMP/c/apps/web-app/src/lib/x.test.ts"
    mkdir -p "$TMP/c/apps/backend/__tests__"; echo "ACTIVE_ENTITY_MISMATCH" >"$TMP/c/apps/backend/__tests__/y.js"
    check "hit in a *.test.ts and __tests__/ -> PASS" "$TMP/c" 0
    mk "$TMP/d"; printf '%s\n' "$CLEAN_LINE" >"$TMP/d/apps/web-app/src/lib/services/other.tsx"
    check "cleanup text in another file -> FAIL" "$TMP/d" 1
    mk "$TMP/e"; printf '%s\n' "$CLEAN_LINE" >"$TMP/e/$ALLOWED_FILE"; echo "// ACTIVE_ENTITY_MISMATCH" >>"$TMP/e/$ALLOWED_FILE"
    check "second hit in the allowed file -> FAIL" "$TMP/e" 1
    out="$(TMPDIR=/nonexistent/none HOLDER_SCOPE_FORCE_MKTEMP=1 bash "$0" --mktemp-probe 2>&1)"; code=$?
    echo "--- selftest mktemp failure -> exit $code (expected 2)"; printf '%s\n' "$out" | head -3
    [ "$code" = "2" ] || { echo "*** mktemp failure FAILED"; BAD=$((BAD + 1)); }
    [ "$BAD" = 0 ] && { echo "selftest: 6/6 cases ok"; exit 0; }
    echo "selftest: $BAD case(s) failed"; exit 1
fi
if [ "${1:-}" = "--mktemp-probe" ]; then
    mktemp -d >/dev/null 2>&1 || blocked "mktemp failed — cannot scan"
    pass "mktemp ok"
fi

[ -d "$SCAN_ROOT/apps" ] || blocked "no apps/ under $SCAN_ROOT"
HITS="$(grep -rInE "$PATTERN" "$SCAN_ROOT/apps" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=__tests__ --exclude-dir=migrations \
    --exclude='*.test.*' 2>/dev/null | sed "s#^$SCAN_ROOT/##")"
BAD_HITS=""
while IFS= read -r line; do
    [ -z "$line" ] && continue
    file="${line%%:*}"; text="${line#*:*:}"
    if [ "$file" = "$ALLOWED_FILE" ] && printf '%s' "$text" | grep -qF "$ALLOWED_TEXT" \
        && [ "$(printf '%s' "$text" | grep -oE "$PATTERN" | wc -l)" = 1 ]; then continue; fi
    BAD_HITS="$BAD_HITS$line"$'\n'
done <<<"$HITS"
if [ -n "$BAD_HITS" ]; then
    printf '%s' "$BAD_HITS" | cut -c1-160
    fail "retired active-entity token(s) under apps/ ($(printf '%s' "$BAD_HITS" | grep -c .) line(s))"
fi
pass "no active-entity plumbing under apps/ (only the boot cleanup is allowed)"
