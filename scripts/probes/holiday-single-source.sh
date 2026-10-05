#!/usr/bin/env bash
# holiday-single-source — exactly ONE Thai holiday calendar source in backend.
#
# ── WHY THE PATTERN IS A *DECLARATION* PATTERN ────────────────────────────────
# This probe used to grep for the bare tokens RECURRING_HOLIDAYS|PUBLIC_HOLIDAYS|
# EXTRA_HOLIDAYS anywhere in a file. A file that merely NAMED one of them in a
# comment therefore counted as a second calendar. the backlog records
# that happening three separate times in one work item, twice while doing exactly
# what a reviewer had asked for:
#   - a comment saying "do not bring the second source back" pushed dup-source 4→5
#     while the duplicated code was already deleted, and
#   - writing the guard's true scope down (reviewer finding F3) flipped this probe
#     PASS→FAIL without a single line of logic changing
#     (evidence/l001/ratchet-comment-token-regression-result-fail.txt).
# A guardrail that punishes accurate documentation teaches agents to delete the
# documentation, which is strictly worse than the duplication it was hunting. So
# the pattern matches a DECLARATION — `const RECURRING_HOLIDAYS = …`, or an object
# literal key `PUBLIC_HOLIDAYS: …` — not a mention.
#
# It is deliberately NOT loosened past that: --selftest cases C/D re-introduce a
# real second calendar in both declaration shapes and assert this probe still goes
# red (mutation testing, same method the L-001 reviewer used).
#
# ── SINGLE SOURCE FOR THE PATTERN ITSELF ──────────────────────────────────────
# The regex lives in scripts/probes/ssot-domains.txt (domain `holiday-calendar`)
# and is read from there, so this probe and ratchet.sh's dup-source counter cannot
# drift apart — having the same rule written twice is the very thing Law 3.6
# forbids, and both copies were previously maintained by hand.
#
# Contract: exit 0 PASS · 1 FAIL · 2 BLOCKED (a pattern it cannot read is BLOCKED,
# never a vacuous PASS).
#
# Usage:  bash scripts/probes/holiday-single-source.sh
#         bash scripts/probes/holiday-single-source.sh --selftest
#         HOLIDAY_BACKEND_ROOT=<dir> bash scripts/probes/holiday-single-source.sh
#           ^ scan a synthetic backend tree. Exists so this probe can be exercised
#             against known-dirty and known-clean fixtures instead of only against
#             whatever the repo happens to contain today (same reason status-vocab.sh
#             carries STATUS_VOCAB_ROOT). CI sets neither and gets the real layout.
source "$(dirname "$0")/_lib.sh"

DOMAINS_FILE="${SSOT_DOMAINS_FILE:-$(dirname "$0")/ssot-domains.txt}"
SCAN_BACKEND="${HOLIDAY_BACKEND_ROOT:-$BACKEND}"

# ── selftest ──────────────────────────────────────────────────────────────────
# In-file so the operator can re-run the evidence (Law 3.11), same convention as
# scripts/probes/status-vocab.sh.
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0

    # The one real calendar, in the shape apps/backend/utils/working-days.js uses.
    real_calendar() {
        mkdir -p "$1/utils"
        cat >"$1/utils/working-days.js" <<'JS'
const RECURRING_HOLIDAYS = [
  '01-01', '04-13',
];
const EXTRA_HOLIDAYS_BY_YEAR = {
  2026: ['05-01'],
};
module.exports = { RECURRING_HOLIDAYS, EXTRA_HOLIDAYS_BY_YEAR };
JS
    }
    check() { # $1 label  $2 backend-dir  $3 expected-exit  [$4 needle]
        local out code
        CASES=$((CASES + 1))
        out="$(HOLIDAY_BACKEND_ROOT="$2" bash "$0" 2>&1)"; code=$?
        echo "--- selftest $1 → exit $code (expected $3)"; printf '%s\n' "$out"
        [ "$code" = "$3" ] || { echo "*** $1 FAILED: exit $code != $3"; BAD=$((BAD + 1)); }
        if [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -q -- "$4"; then
            echo "*** $1 FAILED: output does not mention '$4'"; BAD=$((BAD + 1))
        fi
        echo
    }

    # A — one declaration, nothing else ⇒ PASS. Baseline; without it a probe that
    #     always fails would satisfy every mutation case below.
    mkdir -p "$TMP/A"; real_calendar "$TMP/A"
    check A "$TMP/A" 0 'utils/working-days.js'

    # B — THE REGRESSION (the backlog): a second file that only *mentions*
    #     the tokens, in comments, to explain the rule. No calendar in it at all.
    #     Must stay PASS — documenting the guard must not trip the guard.
    mkdir -p "$TMP/B/services"; real_calendar "$TMP/B"
    cat >"$TMP/B/services/workflow-handler-deps.js" <<'JS'
// Blocker F: do NOT re-introduce a second calendar here. RECURRING_HOLIDAYS and
// EXTRA_HOLIDAYS_BY_YEAR live in utils/working-days.js and nowhere else.
// PUBLIC_HOLIDAYS (the old env var TH_PUBLIC_HOLIDAYS) is gone on purpose.
const { addWorkingDays } = require('../utils/working-days');
module.exports = { addWorkingDays };
JS
    check B "$TMP/B" 0

    # C — MUTATION 1: a real second calendar as a `const` declaration ⇒ must FAIL.
    #     This is the assertion that stops case B's fix from becoming a blind spot.
    mkdir -p "$TMP/C/services"; real_calendar "$TMP/C"
    cat >"$TMP/C/services/legacy-holidays.js" <<'JS'
const EXTRA_HOLIDAYS_2027 = ['12-05', '12-10'];
module.exports = { EXTRA_HOLIDAYS_2027 };
JS
    check C "$TMP/C" 1 'services/legacy-holidays.js'

    # D — MUTATION 2: a real second calendar as an object-literal KEY ⇒ must FAIL.
    #     Declaration ≠ `const` only; a config table is a source too.
    mkdir -p "$TMP/D/config"; real_calendar "$TMP/D"
    cat >"$TMP/D/config/calendar.js" <<'JS'
module.exports = {
  PUBLIC_HOLIDAYS: ['2026-01-01', '2026-04-13'],
};
JS
    check D "$TMP/D" 1 'config/calendar.js'

    # E — a token named inside a STRING on a live code line (a log message telling
    #     ops which table to extend) is still a mention, not a calendar ⇒ PASS.
    mkdir -p "$TMP/E/services"; real_calendar "$TMP/E"
    cat >"$TMP/E/services/warn.js" <<'JS'
function warnMissingYear(year) {
  console.warn(`EXTRA_HOLIDAYS_BY_YEAR has no entry for ${year}`);
}
module.exports = { warnMissingYear };
JS
    check E "$TMP/E" 0

    # F — zero calendars is NOT a pass: "no source" is a different bug from "one
    #     source", and reporting PASS for it would hide a deleted calendar.
    mkdir -p "$TMP/F/services"; printf 'module.exports = {};\n' >"$TMP/F/services/x.js"
    check F "$TMP/F" 1

    # G — the pattern cannot be read ⇒ BLOCKED, never PASS (fail-loud contract).
    CASES=$((CASES + 1))
    out="$(SSOT_DOMAINS_FILE="$TMP/does-not-exist.txt" HOLIDAY_BACKEND_ROOT="$TMP/A" bash "$0" 2>&1)"; code=$?
    echo "--- selftest G → exit $code (expected 2)"; printf '%s\n' "$out"
    [ "$code" = "2" ] || { echo "*** G FAILED: exit $code != 2"; BAD=$((BAD + 1)); }
    echo

    echo "=================================================="
    [ "$BAD" -eq 0 ] && { echo "holiday-single-source --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "holiday-single-source --selftest: $BAD assertion(s) FAILED"; exit 1
fi

# ── pattern (read from the SSOT registry, never re-typed here) ────────────────
[ -r "$DOMAINS_FILE" ] \
    || blocked "cannot read ${DOMAINS_FILE} — the holiday declaration pattern lives there (Law 3.6); refusing to guess it, so this is BLOCKED not PASS"
PATTERN="$(awk -F'|' '/^[[:space:]]*#/ {next} $1 == "holiday-calendar" { sub(/^[^|]*\|/, ""); print; exit }' "$DOMAINS_FILE")"
[ -n "$PATTERN" ] \
    || blocked "no 'holiday-calendar' domain line in ${DOMAINS_FILE} — cannot tell a calendar declaration from a mention; BLOCKED, not PASS"

# Scanned tree deliberately unchanged from the original probe (services, utils,
# shared, config). Widening it is a separate decision with its own blast radius;
# a second calendar anywhere else under apps/backend is still counted by
# ratchet.sh's dup-source counter, which walks the whole backend.
FILES=$(grep -rlE "$PATTERN" \
    "$SCAN_BACKEND/services" "$SCAN_BACKEND/utils" "$SCAN_BACKEND/shared" "$SCAN_BACKEND/config" \
    --include='*.js' 2>/dev/null || true)
COUNT=$(printf '%s\n' "$FILES" | grep -c . || true)
REL=$(printf '%s' "$FILES" | sed "s#^$SCAN_BACKEND/#apps/backend/#" | tr '\n' ' ')
[ "$COUNT" -eq 1 ] && pass "single calendar source: $REL"
fail "$COUNT holiday calendar declaration(s): $REL"
