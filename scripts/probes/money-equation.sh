#!/usr/bin/env bash
# money-equation — every checkout_orders row: gross = net + vat, AND total = gross
# unless the row is CANCELLED. The same two rules the database holds as CHECK
# constraints since migration 20260929155037 (PR3 of the DTAM remittance removal,
# which dropped dtam_fee_amount; the old equation was total = dtam + net + vat).
# A CANCELLED row is exempt from total = gross for one reason: an order cancelled
# before 2026-09-11 kept its DTAM part inside total_payable_amount (no amount is
# rewritten), and a CANCELLED order collected nothing.
#
# Read-only. BLOCKED (exit 2), never a vacuous pass, when it cannot look.
#
# Usage:  bash scripts/probes/money-equation.sh
#         bash scripts/probes/money-equation.sh --selftest
#         MONEY_EQUATION_PSQL=<path> bash scripts/probes/money-equation.sh
#           ^ the psql to run; exists so --selftest can drive the verdict logic
#             against known answers (same pattern as quotation-closure.sh).
source "$(dirname "$0")/_lib.sh"

PSQL="${MONEY_EQUATION_PSQL:-psql}"

if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    stub() { # $1 name  $2 stdout  $3 exit-code
        printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\nexit %s\n' "$2" "$3" >"$TMP/$1"
        chmod +x "$TMP/$1"
    }
    check() { # $1 label  $2 psql-path  $3 database-url  $4 expected-exit  [$5 needle]
        local out code
        CASES=$((CASES + 1))
        out="$(MONEY_EQUATION_PSQL="$2" DATABASE_URL="$3" PROBE_OUT_DIR="$TMP/ev" bash "$0" 2>&1)"; code=$?
        echo "--- selftest $1 -> exit $code (expected $4)"; printf '%s\n' "$out"
        [ "$code" = "$4" ] || { echo "*** $1 FAILED: exit $code != $4"; BAD=$((BAD + 1)); }
        if [ -n "${5:-}" ] && ! printf '%s' "$out" | grep -q -- "$5"; then
            echo "*** $1 FAILED: output does not mention '$5'"; BAD=$((BAD + 1))
        fi
        echo
    }
    stub psql-zero 0 0
    stub psql-two  2 0
    stub psql-dead '' 2
    stub psql-junk 'ERROR:  column "dtam_fee_amount" does not exist' 0

    check A "$TMP/psql-zero" 'postgresql://x/y' 0 '0 rows violate'          # clean → PASS
    check B "$TMP/psql-two"  'postgresql://x/y' 1 '2 checkout_orders rows'  # violations → FAIL with the count
    check C "$TMP/psql-zero" ''                 2 'needs DATABASE_URL'      # no URL → BLOCKED
    check D "$TMP/does-not-exist" 'postgresql://x/y' 2 'needs DATABASE_URL' # no psql → BLOCKED
    check E "$TMP/psql-dead" 'postgresql://x/y' 2 'query failed'            # query failed → BLOCKED
    check F "$TMP/psql-junk" 'postgresql://x/y' 2 'not a count'             # non-number → BLOCKED

    echo "=================================================="
    [ "$BAD" -eq 0 ] && { echo "money-equation --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "money-equation --selftest: $BAD assertion(s) FAILED"; exit 1
fi

{ [ -z "${DATABASE_URL:-}" ] || ! command -v "$PSQL" >/dev/null 2>&1; } \
    && blocked "needs DATABASE_URL + psql against the real DB — no vacuous pass"
N=$("$PSQL" "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM checkout_orders
      WHERE platform_fee_gross <> platform_fee_net + platform_fee_vat
         OR (total_payable_amount <> platform_fee_gross AND status <> 'CANCELLED')" \
    2>"$EVIDENCE_DIR/money-equation.err" | tr -d '[:space:]')
[ -z "$N" ] && blocked "query failed — $EVIDENCE_DIR/money-equation.err"
case "$N" in
    ''|*[!0-9]*) blocked "psql answered '$N', which is not a count — refusing to read that as either a pass or a fail" ;;
esac
[ "$N" = "0" ] && pass "0 rows violate the money equation (gross = net + vat; total = gross unless CANCELLED)"
fail "$N checkout_orders rows violate gross = net + vat or total = gross (non-CANCELLED)"
