#!/usr/bin/env bash
# quotation-closure — every SETTLED checkout order has its instalment stamped on
# the quotation it collected against. F-G4-64 spec §3.3.
#
# WHY THIS EXISTS. Before this change the word "quotation" did not appear in
# checkout-settlement-service at all: money landed, receipts were issued,
# applications were certified, and the priced document the applicant was meant
# to have agreed to stayed PENDING with acceptedAt null. Nothing in the system
# could tell you that had happened. This probe is the thing that can.
#
# WHAT A PASS DOES NOT MEAN. Two blind spots, both by construction, both named
# so nobody reads a green line as more than it is:
#   1. CARD RAIL ONLY, STILL — but now only the QUERY, not the product. Since
#      2026-08-29 the slip rail closes its instalment too
#      (apps/backend/services/payment-slip-service.js calls recordPhaseInvoiced
#      after the approval transaction commits, pinned by
#      __tests__/unit/slip-approval-closes-quotation.test.js), so a slip-paid
#      quotation is no longer unclosed by construction. This query still cannot
#      SEE it: it JOINs checkout_orders, and a slip payment has no order. Until
#      it is widened to a UNION over both rails, a green line says nothing about
#      transfer-paid applications. Follow-up: F-G4-64-SLIP-CLOSURE
#      (the backlog).
#   2. BOUND ORDERS ONLY. Rows settled before the gate shipped have no
#      quotation_id, so the JOIN drops them (see the note on the query below).
#
# Read-only. Never writes. BLOCKED (exit 2) rather than a vacuous pass when it
# cannot reach a database, per the _lib.sh contract.
#
# Usage:  bash scripts/probes/quotation-closure.sh
#         bash scripts/probes/quotation-closure.sh --selftest
#         QUOTATION_CLOSURE_PSQL=<path> bash scripts/probes/quotation-closure.sh
#           ^ the psql to run. Exists so --selftest can drive this probe against
#             known answers instead of only against whatever database the box
#             happens to be pointed at (same reason holiday-single-source.sh
#             carries HOLIDAY_BACKEND_ROOT). CI sets neither and gets real psql.
source "$(dirname "$0")/_lib.sh"

PSQL="${QUOTATION_CLOSURE_PSQL:-psql}"

# ── selftest ─────────────────────────────────────────────────────────────────
# In-file so the operator can re-run the evidence (L6: a probe an agent wrote
# must prove BOTH directions — the red case and the green case).
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0

    # A stub psql that answers with whatever count the case wants, so the
    # probe's VERDICT logic is exercised without a database.
    stub() { # $1 name  $2 stdout  $3 exit-code
        printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\nexit %s\n' "$2" "$3" >"$TMP/$1"
        chmod +x "$TMP/$1"
    }
    check() { # $1 label  $2 psql-path  $3 database-url  $4 expected-exit  [$5 needle]
        local out code
        CASES=$((CASES + 1))
        out="$(QUOTATION_CLOSURE_PSQL="$2" DATABASE_URL="$3" PROBE_OUT_DIR="$TMP/ev" bash "$0" 2>&1)"; code=$?
        echo "--- selftest $1 -> exit $code (expected $4)"; printf '%s\n' "$out"
        [ "$code" = "$4" ] || { echo "*** $1 FAILED: exit $code != $4"; BAD=$((BAD + 1)); }
        if [ -n "${5:-}" ] && ! printf '%s' "$out" | grep -q -- "$5"; then
            echo "*** $1 FAILED: output does not mention '$5'"; BAD=$((BAD + 1))
        fi
        echo
    }

    stub psql-zero  0 0
    stub psql-three 3 0
    stub psql-dead  ''  2
    stub psql-junk  'ERROR:  column q.phase1InvoicedAt does not exist' 0

    # A — the clean register: zero unstamped instalments ⇒ PASS. Baseline;
    #     without it a probe that always failed would satisfy every case below.
    check A "$TMP/psql-zero" 'postgresql://x/y' 0 '0 settled orders'

    # B — THE BUG THIS PROBE EXISTS FOR: settled money against a quotation with
    #     no invoicedAt for that milestone ⇒ FAIL, and it says how many.
    check B "$TMP/psql-three" 'postgresql://x/y' 1 '3 SETTLED checkout_orders'

    # C — no DATABASE_URL ⇒ BLOCKED, never PASS. "I could not look" is not
    #     "there is nothing wrong".
    check C "$TMP/psql-zero" '' 2 'needs DATABASE_URL'

    # D — psql not on the box ⇒ BLOCKED for the same reason.
    check D "$TMP/does-not-exist" 'postgresql://x/y' 2 'needs DATABASE_URL'

    # E — the query itself failed (connection refused, permission denied) ⇒
    #     BLOCKED. This is the case that would otherwise pass vacuously, because
    #     a failed psql prints nothing on stdout.
    check E "$TMP/psql-dead" 'postgresql://x/y' 2 'query failed'

    # F — psql answered, but not with a number (a renamed column, a notice on
    #     stdout). Neither PASS nor FAIL is honest here ⇒ BLOCKED.
    check F "$TMP/psql-junk" 'postgresql://x/y' 2 'not a count'

    echo "=================================================="
    [ "$BAD" -eq 0 ] && { echo "quotation-closure --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "quotation-closure --selftest: $BAD assertion(s) FAILED"; exit 1
fi

# ── the real check ───────────────────────────────────────────────────────────
{ [ -z "${DATABASE_URL:-}" ] || ! command -v "$PSQL" >/dev/null 2>&1; } \
    && blocked "needs DATABASE_URL + psql against the real DB — no vacuous pass"

# Orders settled AFTER the gate shipped are the ones this rule binds. Rows
# settled before it have no quotationId and are the repair script's business
# (close-quotations-settled-before-gate.js), not this probe's — the JOIN on
# quotation_id is what excludes them.
N=$("$PSQL" "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM checkout_orders o
       JOIN quotations q ON q.id = o.quotation_id
      WHERE o.status = 'SETTLED'
        AND ( (o.milestone = 'M1' AND q.\"phase1InvoicedAt\" IS NULL)
           OR (o.milestone = 'M2' AND q.\"phase2InvoicedAt\" IS NULL) )" \
    2>"$EVIDENCE_DIR/quotation-closure.err" | tr -d '[:space:]')
[ -z "$N" ] && blocked "query failed — $EVIDENCE_DIR/quotation-closure.err"
case "$N" in
    ''|*[!0-9]*) blocked "psql answered '$N', which is not a count — refusing to read that as either a pass or a fail" ;;
esac
[ "$N" = "0" ] && pass "0 settled orders leave their quotation instalment unstamped"
fail "$N SETTLED checkout_orders whose quotation has no invoicedAt for that milestone"
