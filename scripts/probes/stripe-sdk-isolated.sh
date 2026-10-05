#!/usr/bin/env bash
# stripe-sdk-isolated — the stripe SDK may be imported by ONE adapter file only.
source "$(dirname "$0")/_lib.sh"
ADAPTER="$BACKEND/services/payment/stripe-adapter.js"
HITS=$(grep -rlE "require\(['\"]stripe['\"]\)|from ['\"]stripe['\"]" "$BACKEND" \
    --include='*.js' --exclude-dir=node_modules --exclude-dir=__tests__ 2>/dev/null || true)
[ -z "$HITS" ] && fail "no stripe import anywhere — adapter missing?"
[ "$HITS" = "$ADAPTER" ] && pass "stripe SDK only in services/payment/stripe-adapter.js"
fail "imports outside adapter: $(printf '%s' "$HITS" | tr '\n' ' ')"
