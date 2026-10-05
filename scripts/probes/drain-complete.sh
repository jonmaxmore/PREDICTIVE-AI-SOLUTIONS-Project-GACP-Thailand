#!/usr/bin/env bash
# drain-complete — REAL DB count of non-terminal legacy slip orders must be 0.
source "$(dirname "$0")/_lib.sh"
{ [ -z "${DATABASE_URL:-}" ] || ! command -v psql >/dev/null 2>&1; } \
    && blocked "needs DATABASE_URL + psql against the real DB — no vacuous pass"
N=$(psql "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM payment_transactions WHERE gateway <> 'STRIPE' AND status NOT IN ('SUCCESS','FAILED','CANCELLED')" \
    2>"$EVIDENCE_DIR/drain-complete.err")
[ -z "$N" ] && blocked "query failed — $EVIDENCE_DIR/drain-complete.err"
[ "$N" = "0" ] && pass "0 non-terminal legacy slip transactions"
fail "$N non-terminal legacy slip transactions remain"
