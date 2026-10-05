#!/usr/bin/env bash
# webhook-idempotent — replayed event id must be a 200 no-op (side effect = 1).
source "$(dirname "$0")/_lib.sh"
LOG="$EVIDENCE_DIR/webhook-idempotent.log"
(cd "$BACKEND" && npx jest __tests__/unit/stripe-checkout-engine.test.js \
    -t "redelivered event id is a 200 no-op" --silent --forceExit) >"$LOG" 2>&1 \
    || fail "dedup test failed — $LOG"
pass "replay dedup test green — $LOG"
