#!/usr/bin/env bash
# themed-surface-tokens — a tinted surface must carry a value in BOTH themes.
#
# ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
# Walked on the live demo 2026-09-07 (evidence/apple-qa-audit-2026-09-07). Text
# colour in this app flips through CSS variables under `.dark`; SURFACES were
# literal hexes in `:root` with no `.dark` counterpart. So the ground stayed
# near-white while the ink turned near-white too:
#
#   /auth   .bg-leaf-soft > li > span   #f1f3f2 on #eaf9f0 = 1.02:1   (9 nodes)
#   /login  #identifier (typed ID)      #f2f2f2 on #ffffff = 1.12:1
#   404     secondary button            #f2f2f2 on #f1f5f9 = 1.02:1
#
# Nine axe `color-contrast` violations, on the first screens every user meets.
# `bg-leaf-soft` alone is referenced in 85 files, so this cannot be a per-page
# fix — the TOKEN has to carry both values, and something has to keep it that way.
#
# ── WHAT IT CHECKS ────────────────────────────────────────────────────────────
# 1. Every custom property Tailwind consumes as a colour (`rgb(var(--x) …)` in
#    tailwind.config.cjs) is declared in BOTH the `:root` and `.dark` blocks of
#    globals.css, with DIFFERENT values. A `.dark` value identical to the light
#    one is the same bug wearing a declaration.
# 2. No stylesheet under src/styles/ paints a hardcoded background with
#    `!important`. `.field-emphasis` did exactly that (`background: #fff
#    !important`) and sits on every input, select and textarea in the product.
#    Scanning ONE file was not enough: the first version of this probe checked
#    globals-components-layout.css only, the fix went to staging, and the very
#    same shape was still live in globals-components-auth.css `.gov-auth-input` —
#    so the typed national ID was still 1.12:1 after a deploy that was supposed to
#    have fixed it. A probe that looks at one of five files reports PASS for a
#    defect that is still shipping. It reads the whole directory now.
#
# The numeric contrast maths lives with the tokens, in
# apps/web-app/src/styles/__tests__/themed-surfaces-have-dark-values.test.ts —
# this probe guards the STRUCTURE (a value exists in both themes at all), which
# is the part a grep can prove and a jest run in another package might not reach.
#
# Contract: exit 0 PASS · 1 FAIL · 2 BLOCKED (a file it cannot read is BLOCKED,
# never a vacuous PASS).
#
# Usage:  bash scripts/probes/themed-surface-tokens.sh
#         bash scripts/probes/themed-surface-tokens.sh --selftest
#         SURFACE_WEBAPP_ROOT=<dir> bash scripts/probes/themed-surface-tokens.sh
#           ^ scan a synthetic tree, so the probe can be exercised against
#             known-dirty and known-clean fixtures (same reason holiday-single-
#             source.sh carries HOLIDAY_BACKEND_ROOT). CI sets neither.
source "$(dirname "$0")/_lib.sh"

ROOT_DIR="${SURFACE_WEBAPP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)/apps/web-app}"
GLOBALS="$ROOT_DIR/src/styles/globals.css"
TWCONF="$ROOT_DIR/tailwind.config.cjs"
STYLE_DIR="$ROOT_DIR/src/styles"

check_tree() {
    local globals="$1" twconf="$2" style_dir="$3"
    local problems=()

    for f in "$globals" "$twconf"; do
        [ -r "$f" ] || { echo "BLOCKED_READ:$f"; return 2; }
    done

    # Tokens Tailwind consumes as colours: rgb(var(--x) / <alpha-value>)
    local tokens
    tokens=$(grep -oE 'rgb\(var\(--[a-z0-9-]+\)' "$twconf" \
             | sed -E 's/rgb\(var\(--//; s/\)$//' | sort -u)
    if [ -z "$tokens" ]; then
        echo "NO_TOKENS"
        return 0
    fi

    # Slice the two declaration blocks. Both are flat (no nested rules), so the
    # first closing brace at column 2 ends them.
    # An ABSENT selector means the file is not the one this probe understands →
    # BLOCKED. An EMPTY block is a real, reportable state → FAIL, via the per-token
    # loop below. Conflating the two is how a probe reports "cannot tell" for the
    # exact defect it exists to catch (selftest case A).
    grep -qE '^[[:space:]]*:root[[:space:]]*\{' "$globals" || { echo "BLOCKED_BLOCKS"; return 2; }
    grep -qE '^[[:space:]]*\.dark[[:space:]]*\{' "$globals" || { echo "BLOCKED_BLOCKS"; return 2; }
    local root_block dark_block
    root_block=$(awk '/^  :root \{/{f=1;next} f&&/^  \}/{exit} f' "$globals")
    dark_block=$(awk '/^  \.dark \{/{f=1;next} f&&/^  \}/{exit} f' "$globals")

    local t light dark
    while IFS= read -r t; do
        [ -n "$t" ] || continue
        light=$(printf '%s\n' "$root_block" | grep -oE "^[[:space:]]*--$t:[^;]*" | head -1 | sed -E "s/^[[:space:]]*--$t:[[:space:]]*//")
        dark=$(printf '%s\n' "$dark_block" | grep -oE "^[[:space:]]*--$t:[^;]*" | head -1 | sed -E "s/^[[:space:]]*--$t:[[:space:]]*//")
        if [ -z "$light" ]; then problems+=("--$t missing from :root"); continue; fi
        if [ -z "$dark" ]; then problems+=("--$t has no .dark value"); continue; fi
        if [ "$light" = "$dark" ]; then problems+=("--$t is identical in both themes ($light)"); fi
    done <<< "$tokens"

    # No stylesheet may nail a background down with !important — EVERY file in the
    # directory, not just the one that happened to be broken first.
    if [ -d "$style_dir" ]; then
        local nailed
        nailed=$(grep -rnE '^[[:space:]]*background(-color)?:[[:space:]]*(#[0-9a-fA-F]{3,8}|white|rgb\([0-9 ,]+\))[[:space:]]*!important' "$style_dir" 2>/dev/null || true)
        if [ -n "$nailed" ]; then
            while IFS= read -r line; do
                problems+=("hardcoded !important background: ${line#"$style_dir"/}")
            done <<< "$nailed"
        fi
    elif [ -r "$style_dir" ]; then
        local nailed
        nailed=$(grep -nE '^[[:space:]]*background(-color)?:[[:space:]]*(#[0-9a-fA-F]{3,8}|white|rgb\([0-9 ,]+\))[[:space:]]*!important' "$style_dir" 2>/dev/null || true)
        if [ -n "$nailed" ]; then
            while IFS= read -r line; do
                problems+=("hardcoded !important background in $(basename "$style_dir"): ${line}")
            done <<< "$nailed"
        fi
    fi

    if [ ${#problems[@]} -gt 0 ]; then
        printf '%s\n' "${problems[@]}"
        return 1
    fi
    return 0
}

# ── selftest: prove the probe goes RED on the real defect and GREEN when fixed ──
if [ "${1:-}" = "--selftest" ]; then
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    mk() { # $1 dir  $2 dark-line  $3 field-background
        mkdir -p "$tmp/$1/src/styles"
        cat > "$tmp/$1/tailwind.config.cjs" <<'EOF'
module.exports = { theme: { extend: { colors: {
  leaf: { soft: 'rgb(var(--leaf-soft) / <alpha-value>)' },
} } } };
EOF
        {
            echo "  :root {"; echo "    --leaf-soft: 234 249 240;"; echo "  }"
            echo "  .dark {"; [ -n "$2" ] && echo "    $2"; echo "  }"
        } > "$tmp/$1/src/styles/globals.css"
        cat > "$tmp/$1/src/styles/globals-components-layout.css" <<EOF
.field-emphasis {
  background: $3;
}
EOF
    }

    fails=0
    # A — the defect as shipped: no .dark value at all
    mk A "" "hsl(var(--card))"
    out=$(check_tree "$tmp/A/src/styles/globals.css" "$tmp/A/tailwind.config.cjs" "$tmp/A/src/styles"); rc=$?
    [ $rc -eq 1 ] && echo "  selftest A (no dark value)        RED   ok" || { echo "  selftest A expected RED, got rc=$rc"; fails=1; }

    # B — a .dark value that is the same colour: a declaration that changes nothing
    mk B "--leaf-soft: 234 249 240;" "hsl(var(--card))"
    out=$(check_tree "$tmp/B/src/styles/globals.css" "$tmp/B/tailwind.config.cjs" "$tmp/B/src/styles"); rc=$?
    [ $rc -eq 1 ] && echo "  selftest B (identical in dark)    RED   ok" || { echo "  selftest B expected RED, got rc=$rc"; fails=1; }

    # C — token fine, but the field class nails white down with !important
    mk C "--leaf-soft: 22 48 31;" "#fff !important"
    out=$(check_tree "$tmp/C/src/styles/globals.css" "$tmp/C/tailwind.config.cjs" "$tmp/C/src/styles"); rc=$?
    [ $rc -eq 1 ] && echo "  selftest C (!important #fff)      RED   ok" || { echo "  selftest C expected RED, got rc=$rc"; fails=1; }

    # D — both fixed
    mk D "--leaf-soft: 22 48 31;" "var(--field-emphasis-bg) !important"
    out=$(check_tree "$tmp/D/src/styles/globals.css" "$tmp/D/tailwind.config.cjs" "$tmp/D/src/styles"); rc=$?
    [ $rc -eq 0 ] && echo "  selftest D (both fixed)           GREEN ok" || { echo "  selftest D expected GREEN, got rc=$rc: $out"; fails=1; }

    # F — the defect hides in a SECOND stylesheet (the miss that shipped to staging)
    mk F "--leaf-soft: 22 48 31;" "var(--field-emphasis-bg) !important"
    cat > "$tmp/F/src/styles/globals-components-auth.css" <<'EOF'
.gov-auth-input {
  background: #fff !important;
}
EOF
    out=$(check_tree "$tmp/F/src/styles/globals.css" "$tmp/F/tailwind.config.cjs" "$tmp/F/src/styles"); rc=$?
    [ $rc -eq 1 ] && echo "  selftest F (second stylesheet)    RED   ok" || { echo "  selftest F expected RED, got rc=$rc: $out"; fails=1; }

    # E — an unreadable file is BLOCKED, never a vacuous PASS
    out=$(check_tree "$tmp/nope/globals.css" "$tmp/nope/tailwind.config.cjs" "$tmp/nope/styles"); rc=$?
    [ $rc -eq 2 ] && echo "  selftest E (unreadable input)     BLOCKED ok" || { echo "  selftest E expected BLOCKED, got rc=$rc"; fails=1; }

    [ $fails -eq 0 ] && pass "selftest: 6/6 cases behaved as specified"
    fail "selftest: at least one case did not behave as specified"
fi

out=$(check_tree "$GLOBALS" "$TWCONF" "$STYLE_DIR"); rc=$?
case $rc in
    2) blocked "cannot read the token files under $ROOT_DIR — refusing to report PASS (${out})" ;;
    1) fail "tinted surfaces without a value in both themes:"$'\n'"$out" ;;
esac
[ "$out" = "NO_TOKENS" ] && blocked "tailwind.config.cjs declares no rgb(var(--…)) colour — the check would be vacuous"
pass "every Tailwind-consumed surface token carries a distinct value in :root and .dark, and no stylesheet under src/styles/ nails a background with !important"
