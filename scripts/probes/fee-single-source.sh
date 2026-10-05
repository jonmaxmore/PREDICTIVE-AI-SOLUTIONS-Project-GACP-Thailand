#!/usr/bin/env bash
# fee-single-source — exactly ONE file may DEFINE a GACP fee amount.
#
# This is the probe GOALS.md G1 names as its own measure ("ตัววัด: probe ใหม่
# `fee-single-source` PASS"). Until it existed, G1 item 1 had no way to be finished:
# a rule with no machine behind it is a draft rule (the project rules).
#
# ── WHY A SECOND FEE TABLE IS THE WORST KIND OF DUPLICATION ───────────────────
# A duplicated constant is usually a tidiness problem. A duplicated FEE is not: the
# two copies disagree the day one of them is edited, and then the amount an applicant
# is shown, the amount the invoice charges, and the amount remitted to the department
# are three different numbers with no way to tell which is right. GOALS.md G1 records
# this as the "บั๊ก 30k/15k". Money is the one domain where the platform holds public
# funds against a published tariff, so the SSOT here is a legal position, not a style.
#
# ── WHAT COUNTS AS A DEFINITION, AND WHY THE PATTERN HAD TO BE ANCHORED ───────
# A DEFINITION assigns a NUMERIC LITERAL:      PHASE1_PER_SCOPE: 5000
# A RE-EXPORT forwards someone else's number:  PHASE1_PER_SCOPE: FEES.PHASE1_PER_SCOPE
#
# The `fee-table` pattern in ssot-domains.txt used to match the field NAME alone, so
# modules/billing/internal/fee-service.js — which does nothing but forward the value
# it reads from config/business-rules.js — was counted as a third fee table. That is
# the same class of error the holiday-calendar domain was fixed for: a pattern that
# matches a MENTION rather than a DECLARATION. It also made the counter unable to ever
# reach zero, because deleting the real duplicate still left the re-export matching.
#
# ── SINGLE SOURCE FOR THE PATTERN ITSELF ──────────────────────────────────────
# The regex lives in scripts/probes/ssot-domains.txt (domain `fee-table`) and is read
# from there, so this probe and ratchet.sh's dup-source counter cannot drift apart.
# Two copies of one rule is the very thing this probe exists to forbid.
#
# Contract: exit 0 PASS · 1 FAIL · 2 BLOCKED (a pattern it cannot read is BLOCKED,
# never a vacuous PASS).
#
# Usage:  bash scripts/probes/fee-single-source.sh
#         bash scripts/probes/fee-single-source.sh --selftest
#         FEE_BACKEND_ROOT=<dir> bash scripts/probes/fee-single-source.sh
#           ^ scan a synthetic backend tree, so the probe can be exercised against
#             known-dirty and known-clean fixtures rather than only against whatever
#             the repo happens to contain today. CI sets neither.
source "$(dirname "$0")/_lib.sh"

DOMAINS_FILE="${SSOT_DOMAINS_FILE:-$(dirname "$0")/ssot-domains.txt}"
SCAN_BACKEND="${FEE_BACKEND_ROOT:-$BACKEND}"

# ── selftest ──────────────────────────────────────────────────────────────────
# In-file so the operator can re-run the evidence (Law 3.11), same convention as
# scripts/probes/holiday-single-source.sh --selftest.
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0

    # The one real fee table, in the shape apps/backend/config/business-rules.js uses.
    real_table() {
        mkdir -p "$1/config"
        cat >"$1/config/business-rules.js" <<'JS'
const FEE_DEFAULTS = Object.freeze({
    PHASE1_PER_SCOPE: 5000,
    PHASE2_PER_SCOPE: 25000,
});
module.exports = { FEES: { ...FEE_DEFAULTS } };
JS
    }
    check() { # $1 label  $2 backend-dir  $3 expected-exit  [$4 needle]
        local out code
        CASES=$((CASES + 1))
        out="$(FEE_BACKEND_ROOT="$2" bash "$0" 2>&1)"; code=$?
        echo "--- selftest $1 → exit $code (expected $3)"; printf '%s\n' "$out"
        [ "$code" = "$3" ] || { echo "*** $1 FAILED: exit $code != $3"; BAD=$((BAD + 1)); }
        if [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -q -- "$4"; then
            echo "*** $1 FAILED: output does not mention '$4'"; BAD=$((BAD + 1))
        fi
        echo
    }

    # A — one fee table, nothing else ⇒ PASS. Baseline: without it, a probe that
    #     always failed would satisfy every mutation case below.
    mkdir -p "$TMP/A"; real_table "$TMP/A"
    check A "$TMP/A" 0 'config/business-rules.js'

    # B — THE RE-EXPORT. modules/billing forwards the number it read; it defines
    #     nothing. Must stay PASS, or the counter can never reach zero and the
    #     honest layering (one table, one public accessor) is punished.
    mkdir -p "$TMP/B/modules"; real_table "$TMP/B"
    cat >"$TMP/B/modules/fee-service.js" <<'JS'
const { FEES } = require('../config/business-rules');
const FEE_RATES = Object.freeze({
    PHASE1_PER_SCOPE: FEES.PHASE1_PER_SCOPE,
    PHASE2_PER_SCOPE: FEES.PHASE2_PER_SCOPE,
});
module.exports = { FEE_RATES };
JS
    check B "$TMP/B" 0

    # C — A COMMENT that names the fee, to explain the rule. Must stay PASS:
    #     a guard that punishes accurate documentation teaches people to delete
    #     the documentation (the backlog, the holiday-calendar lesson).
    mkdir -p "$TMP/C/services"; real_table "$TMP/C"
    cat >"$TMP/C/services/invoice-service.js" <<'JS'
// Do NOT re-declare the tariff here. PHASE1_PER_SCOPE: 5000 lives in
// config/business-rules.js and is read through modules/billing.
const { FEE_RATES } = require('../modules/fee-service');
module.exports = { FEE_RATES };
JS
    check C "$TMP/C" 0

    # D — MUTATION 1: a real second table under the SAME field name ⇒ must FAIL.
    mkdir -p "$TMP/D/config"; real_table "$TMP/D"
    cat >"$TMP/D/config/payment-fees.js" <<'JS'
const PAYMENT_FEES = {
    PHASE1_PER_SCOPE: 5000,
};
module.exports = PAYMENT_FEES;
JS
    check D "$TMP/D" 1 'payment-fees.js'

    # E — MUTATION 2: the same amount under a DIFFERENT name. This is the real
    #     30k/15k bug shape — nobody re-declares a constant under its own name;
    #     they invent a new one for the same tariff and the two drift apart.
    mkdir -p "$TMP/E/config"; real_table "$TMP/E"
    cat >"$TMP/E/config/payment-fees.js" <<'JS'
module.exports = {
    DOCUMENT_REVIEW_FEE: 5000,
};
JS
    check E "$TMP/E" 1 'payment-fees.js'

    # F — a tree with NO fee table at all. There is no single source to point at,
    #     which is not a pass: it means the pattern no longer finds the tariff and
    #     the probe has silently stopped guarding anything.
    mkdir -p "$TMP/F/services"
    cat >"$TMP/F/services/noop.js" <<'JS'
module.exports = {};
JS
    check F "$TMP/F" 2

    echo "selftest: $CASES case(s), $BAD failure(s)"
    [ "$BAD" -eq 0 ] || exit 1
    exit 0
fi

# ── the probe ─────────────────────────────────────────────────────────────────
[ -r "$DOMAINS_FILE" ] || blocked "cannot read $DOMAINS_FILE — the fee pattern has one home and this is it"

PATTERN="$(grep '^fee-table|' "$DOMAINS_FILE" | head -1 | cut -d'|' -f2-)"
[ -n "$PATTERN" ] || blocked "no 'fee-table' domain in $DOMAINS_FILE — nothing to enforce"

[ -d "$SCAN_BACKEND" ] || blocked "backend root not found: $SCAN_BACKEND"

# A file counts only when a MATCHING line is not comment-only — same rule ratchet.sh
# applies, so documenting the tariff cannot make a file look like a second tariff.
DEFINERS=""
while IFS= read -r f; do
    [ -z "$f" ] && continue
    printf '%s\n' "$(grep -E "$PATTERN" "$f" 2>/dev/null)" \
        | grep -qvE '^[[:space:]]*(//|\*|/\*)|^[[:space:]]*$' || continue
    DEFINERS="$DEFINERS$f"$'\n'
done <<EOF
$(grep -rlE "$PATTERN" "$SCAN_BACKEND" --include='*.js' \
    --exclude-dir=node_modules --exclude-dir=__tests__ 2>/dev/null || true)
EOF

COUNT="$(printf '%s' "$DEFINERS" | grep -c . || true)"

if [ "$COUNT" -eq 0 ]; then
    # Not a pass. Either the tariff moved and the pattern no longer describes it, or
    # the fee table is gone. Both mean this probe is guarding nothing, and a guard
    # that cannot find its subject must say so rather than report success.
    blocked "no file DEFINES a fee amount under $SCAN_BACKEND — the pattern no longer describes the tariff, so this probe is guarding nothing"
fi

if [ "$COUNT" -eq 1 ]; then
    pass "one fee table: $(printf '%s' "$DEFINERS" | tr -d '\n')"
fi

fail "$COUNT files DEFINE a fee amount — exactly one may (GOALS.md G1). The amount an applicant is shown, the amount invoiced and the amount remitted must come from one place:
$(printf '%s' "$DEFINERS" | sed 's/^/    /')"
