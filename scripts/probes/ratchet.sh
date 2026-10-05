#!/usr/bin/env bash
# ratchet — one-way debt burn-down (the project rules §4.2).
# Recounts every counter and compares against the baselines in scripts/probes/ratchet-baseline.txt:
#   count > baseline  → FAIL (new debt is forbidden)
#   count < baseline  → PASS + prints the lower number (operator ratchets baseline DOWN)
# Missing baseline (bootstrap) → prints counts and PASSES with a BOOTSTRAP note;
# the numbers printed here are what the operator seeds scripts/probes/ratchet-baseline.txt with.
# dead-route: [DRAFT] — no mechanical counter yet (needs route↔test↔UI matrix).
source "$(dirname "$0")/_lib.sh"

BIZ_DIRS=("$BACKEND/services" "$BACKEND/routes" "$BACKEND/jobs" "$BACKEND/middleware")

count_hardcode() {
    local total=0 n
    while IFS= read -r pat; do
        case "$pat" in ''|'#'*) continue;; esac
        n=$(grep -rE "$pat" "${BIZ_DIRS[@]}" --include='*.js' 2>/dev/null | wc -l)
        total=$((total + n))
    done < "$(dirname "$0")/hardcode-patterns.txt"
    echo "$total"
}

count_todo() {
    grep -rEn 'TODO|FIXME|HACK|XXX' "${BIZ_DIRS[@]}" "$BACKEND/shared" "$BACKEND/config" \
        --include='*.js' 2>/dev/null | wc -l
}

count_env_direct() {
    grep -rEn 'process\.env\.[A-Z_]+' "$BACKEND/services" "$BACKEND/routes" "$BACKEND/jobs" "$BACKEND/middleware" \
        --include='*.js' 2>/dev/null | wc -l
}

# A file is a SOURCE for a domain only when the domain pattern hits a line that is
# not comment-only. Rationale (the backlog): naming an identifier in a
# comment used to make the file count as a duplicate source, so writing "the second
# calendar was deleted on purpose, do not bring it back" pushed this counter 4→5
# with zero code duplication present, and correcting a guard's documented scope at a
# reviewer's request flipped holiday-single-source PASS→FAIL
# (evidence/l001/ratchet-comment-token-regression-result-fail.txt). A counter that
# rises when you document accurately pays agents to delete the documentation. This
# filter is generic — it fixes every domain in ssot-domains.txt at once, including
# the bare-token ones (entity-legal-name), rather than one pattern at a time.
# It only ever REMOVES comment-only evidence; a domain whose pattern hits real code
# is counted exactly as before (pinned by --selftest cases B/D).
count_dup_source() { # [$1 backend-dir] [$2 domains-file]
    # Sum over domains of (defining files - 1); 0 = every domain has ONE source.
    local backend="${1:-$BACKEND}" domains="${2:-$(dirname "$0")/ssot-domains.txt}"
    local excess=0 files kept n domain pat f
    while IFS='|' read -r domain pat; do
        case "$domain" in ''|'#'*) continue;; esac
        files=$(grep -rlE "$pat" "$backend" --include='*.js' \
            --exclude-dir=node_modules --exclude-dir=__tests__ 2>/dev/null || true)
        kept=""
        while IFS= read -r f; do
            [ -z "$f" ] && continue
            # Keep the file only if at least one MATCHING line is not comment-only.
            # A trailing comment on a code line still counts (case E) — the test is
            # on the line, not on the token.
            # (the blank-line alternative below is what makes "grep found nothing"
            #  resolve to "not a source" instead of "a source")
            printf '%s\n' "$(grep -E "$pat" "$f" 2>/dev/null)" \
                | grep -qvE '^[[:space:]]*(//|\*|/\*)|^[[:space:]]*$' || continue
            kept="$kept$f"$'\n'
        done <<<"$files"
        n=$(printf '%s' "$kept" | grep -c . || true)
        # ${kept%$'\n'} drops the accumulator's trailing newline so the rendered line
        # is byte-identical to the previous implementation for an unchanged tree —
        # this string lands in the tracked evidence/probe-results.json.
        [ "$n" -gt 1 ] && { excess=$((excess + n - 1)); echo "  dup [$domain] $n sources: $(printf '%s' "${kept%$'\n'}" | sed "s#^$backend/#apps/backend/#" | tr '\n' ' ')" >&2; }
    done < "$domains"
    echo "$excess"
}

# ── selftest ──────────────────────────────────────────────────────────────────
# In-file so the operator can re-run the evidence (Law 3.11); same convention as
# scripts/probes/status-vocab.sh --selftest. Exercises count_dup_source against
# synthetic backends using the REAL ssot-domains.txt patterns, so a pattern edit
# that reopens the comment hole fails here.
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    DOMAINS="$(dirname "$0")/ssot-domains.txt"
    check() { # $1 label  $2 backend-dir  $3 expected-excess
        local got
        CASES=$((CASES + 1))
        got="$(count_dup_source "$2" "$DOMAINS" 2>/dev/null)"
        echo "--- selftest $1 → dup-source excess $got (expected $3)"
        count_dup_source "$2" "$DOMAINS" 2>&1 >/dev/null | sed 's/^/    /'
        [ "$got" = "$3" ] || { echo "*** $1 FAILED: excess $got != $3"; BAD=$((BAD + 1)); }
        echo
    }
    calendar_at() { mkdir -p "$(dirname "$1")"; printf 'const RECURRING_HOLIDAYS = [\n  "01-01",\n];\nmodule.exports = { RECURRING_HOLIDAYS };\n' >"$1"; }
    legal_at()    { mkdir -p "$(dirname "$1")"; printf 'const PLATFORM_LEGAL_NAME_TH = "กรมการแพทย์แผนไทยฯ";\nmodule.exports = { PLATFORM_LEGAL_NAME_TH };\n' >"$1"; }

    # A — one calendar + one file whose ONLY reference is a comment ⇒ 0 excess.
    #     This is the L-001 regression, reproduced.
    calendar_at "$TMP/A/utils/working-days.js"
    mkdir -p "$TMP/A/routes"
    printf '// RECURRING_HOLIDAYS and EXTRA_HOLIDAYS_BY_YEAR live in utils/working-days.js.\n// Do not add a second PUBLIC_HOLIDAYS table here.\nmodule.exports = {};\n' \
        >"$TMP/A/routes/deps.js"
    check A "$TMP/A" 0

    # B — MUTATION: two REAL calendars ⇒ 1 excess. Without this, case A could be
    #     "fixed" by making the counter blind.
    calendar_at "$TMP/B/utils/working-days.js"
    calendar_at "$TMP/B/services/legacy-holidays.js"
    check B "$TMP/B" 1

    # C — same regression on a BARE-token domain (entity-legal-name), which is why
    #     the filter is generic instead of a per-domain regex tweak.
    legal_at "$TMP/C/config/platform.js"
    mkdir -p "$TMP/C/services"
    printf '/*\n * PLATFORM_LEGAL_NAME_TH is defined in config/platform.js — import it, never retype it.\n */\nmodule.exports = {};\n' \
        >"$TMP/C/services/invoice-pdf.js"
    check C "$TMP/C" 0

    # D — MUTATION on the same bare-token domain: two real declarations ⇒ 1 excess.
    legal_at "$TMP/D/config/platform.js"
    legal_at "$TMP/D/services/invoice-pdf.js"
    check D "$TMP/D" 1

    # E — a trailing comment on a LIVE code line is not a comment-only line; the
    #     file still counts. Pins that the filter is line-shaped, not token-shaped.
    calendar_at "$TMP/E/utils/working-days.js"
    mkdir -p "$TMP/E/services"
    printf 'const RECURRING_HOLIDAYS = ["01-01"]; // duplicated on purpose to prove detection\nmodule.exports = { RECURRING_HOLIDAYS };\n' \
        >"$TMP/E/services/dup.js"
    check E "$TMP/E" 1

    echo "=================================================="
    [ "$BAD" -eq 0 ] && { echo "ratchet --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "ratchet --selftest: $BAD assertion(s) FAILED"; exit 1
fi

HC=$(count_hardcode); TD=$(count_todo); ED=$(count_env_direct); DS=$(count_dup_source)
OUT="$EVIDENCE_DIR/ratchet-current.txt"
{
    echo "hardcode: $HC"
    echo "todo: $TD"
    echo "env-direct: $ED"
    echo "dup-source: $DS"
    echo "dead-route: DRAFT (no mechanical counter yet)"
} | tee "$OUT"

FAILED=""
for pair in "hardcode:$HC" "todo:$TD" "env-direct:$ED" "dup-source:$DS"; do
    name="${pair%%:*}"; val="${pair##*:}"
    base="$(baseline "$name")"
    if [ -z "$base" ]; then
        echo "BOOTSTRAP: no baseline for '$name' in scripts/probes/ratchet-baseline.txt — seed it with $val"
    elif [ "$val" -gt "$base" ]; then
        FAILED="$FAILED $name($val>$base)"
    fi
done
[ -n "$FAILED" ] && fail "ratchet increased:$FAILED — new debt is forbidden (the project rules 3.5/3.6)"
pass "no counter above baseline — current: hardcode=$HC todo=$TD env-direct=$ED dup-source=$DS ($OUT)"
