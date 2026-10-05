#!/usr/bin/env bash
# suite-green — run the REAL full backend suite; pass = exit 0 AND count >= baseline.
source "$(dirname "$0")/_lib.sh"
BASE="$(baseline suite-tests)"; BASE="${BASE:-6800}"
LOG="$EVIDENCE_DIR/suite-green.log"
(cd "$BACKEND" && npx jest --silent --forceExit) >"$LOG" 2>&1
CODE=$?
# Parse the final "Tests: … N total" summary line ONLY — interim reporter
# output also contains "N total" strings and must not be trusted.
TOTAL=$(grep -E '^Tests:' "$LOG" | tail -1 | grep -Eo '[0-9]+ total' | grep -oE '[0-9]+')
TOTAL=${TOTAL:-0}
[ "$CODE" -ne 0 ] && fail "jest exit $CODE ($TOTAL tests) — log: $LOG"
[ "$TOTAL" -lt "$BASE" ] && fail "test count $TOTAL < baseline $BASE (tests lost?) — log: $LOG"
pass "exit 0, $TOTAL tests >= baseline $BASE — log: $LOG"
